import shutil
import sqlite3
import io
import json
import hashlib
import re
from datetime import UTC, datetime, timedelta
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError

from backend.config import (
    BASE_DIR,
    JAVI_ANALYSIS_ENABLED,
    JAVI_ANALYSIS_MODEL,
    SHOW_MODE_SWITCH,
    STATIC_DIR,
    UPLOAD_DIR,
    ensure_directories,
)
from backend.activity_service import prune_history, record_activity
from backend.quality_service import evaluate_page_quality
from backend.study_analysis_service import (
    analyze_phrase_deep,
    analyze_phrase_javi,
    analyze_sentence,
    analyze_sentences,
)
from backend.media_service import (
    decode_subtitle_bytes,
    extension_analysis,
    fetch_youtube_subtitle_result,
    fetch_youtube_subtitles,
    parse_subtitle_text,
    subtitle_title_from_filename,
)
from backend.database import db_session, init_database, row_to_dict, utc_now
from backend.ocr_service import recognize_japanese_crop, run_ocr_job
from backend.inpainting_service import run_inpainting_job
from backend.bubble_segmentation_service import run_bubble_segmentation_job
from backend.schemas import (
    ChapterCreate,
    ChapterReviewRequest,
    ChapterPipelineRequest,
    CropOcrRequest,
    TonariImportRequest,
    ImportCheckRequest,
    MangaCreate,
    MediaAnalyzeRequest,
    MediaImportRequest,
    OcrRequest,
    OutsideTextPolicyRequest,
    PageEditorialDecisionRequest,
    PageOrderRequest,
    PageReviewRequest,
    PipelineRequest,
    TextBlockBatch,
    TranslationRequest,
    VocabularyCreate,
    WebTranslateRequest,
    YoutubeMediaImportRequest,
)
from backend.translation_service import (
    TranslationBlock,
    get_translation_provider,
    run_translation_job,
    translate_blocks_resilient,
)
from backend.visual_supervisor_service import visual_supervisor_config
from backend.typesetting_service import (
    constrain_cell_to_bubble_interior,
    fit_text_layout,
    layout_at_size,
    partition_text_regions_by_source,
    place_text_in_clear_area,
    pack_grouped_text_fallback,
    render_translated_page,
    suggest_text_color,
    text_layout_bounds,
)
from backend.tonarinoyj_service import (
    list_series_episodes,
    run_import_job,
    run_refresh_chapter_job,
    search_series,
)


ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_UPLOAD_SIZE = 20 * 1024 * 1024
NATURAL_NUMBER = re.compile(r"(\d+)")
STUDY_ASSET_DIR = BASE_DIR / "data" / "study"

# StaticFiles validates its directory at import time.
ensure_directories()
STUDY_ASSET_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_directories()
    init_database()
    yield


app = FastAPI(title="Manga Translator Studio API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "https://www.youtube.com",
        "https://www.netflix.com",
    ],
    allow_origin_regex=r"^(chrome-extension|moz-extension)://.+$",
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/study-assets", StaticFiles(directory=STUDY_ASSET_DIR), name="study-assets")


def _json_list(value: str | None) -> list:
    try:
        parsed = json.loads(value or "[]")
        return parsed if isinstance(parsed, list) else []
    except (TypeError, json.JSONDecodeError):
        return []


def get_or_404(connection: sqlite3.Connection, query: str, params: tuple, label: str) -> dict:
    item = row_to_dict(connection.execute(query, params).fetchone())
    if item is None:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy {label}")
    return item


def natural_filename_key(filename: str) -> tuple:
    return tuple(
        int(part) if part.isdigit() else part.casefold()
        for part in NATURAL_NUMBER.split(filename or "")
    )


def _delete_upload_files(paths: list[str | None]) -> None:
    upload_root = UPLOAD_DIR.resolve()
    for relative_path in {path for path in paths if path}:
        candidate = (UPLOAD_DIR / relative_path).resolve()
        if candidate == upload_root or upload_root not in candidate.parents:
            continue
        candidate.unlink(missing_ok=True)


def _renumber_pages(connection: sqlite3.Connection, chapter_id: int, page_ids: list[int]) -> None:
    # Hai pha tránh đụng UNIQUE(chapter_id, page_number) trong lúc đổi thứ tự.
    for offset, page_id in enumerate(page_ids, start=1):
        connection.execute(
            "UPDATE pages SET page_number = ? WHERE id = ? AND chapter_id = ?",
            (-offset, page_id, chapter_id),
        )
    for page_number, page_id in enumerate(page_ids, start=1):
        connection.execute(
            "UPDATE pages SET page_number = ? WHERE id = ? AND chapter_id = ?",
            (page_number, page_id, chapter_id),
        )


def _page_workflow_state(page: dict) -> str:
    if int(page.get("active_job_count") or 0) > 0 or page.get("status") == "processing":
        return "processing"
    if page.get("status") == "failed" or page.get("latest_job_status") == "failed":
        return "review"
    if page.get("review_status") == "approved":
        return "completed"
    block_count = int(page.get("block_count") or 0)
    translated_count = int(page.get("translated_count") or 0)
    if page.get("status") == "uploaded" and block_count == 0:
        return "unprocessed"
    if page.get("clean_image_path") and (block_count == 0 or translated_count == block_count):
        return "review"
    return "in_progress"


def _library_summaries(connection: sqlite3.Connection) -> list[dict]:
    manga_rows = [dict(row) for row in connection.execute(
        "SELECT * FROM manga ORDER BY updated_at DESC, id DESC"
    ).fetchall()]
    chapter_rows = [dict(row) for row in connection.execute(
        "SELECT * FROM chapters ORDER BY manga_id, CAST(chapter_number AS REAL), chapter_number"
    ).fetchall()]
    page_rows = [dict(row) for row in connection.execute(
        """
        SELECT p.*,
               COUNT(DISTINCT tb.id) AS block_count,
               COUNT(DISTINCT CASE
                   WHEN TRIM(COALESCE(tb.final_translation, '')) <> ''
                     OR TRIM(COALESCE(tb.ai_translation, '')) <> '' THEN tb.id END
               ) AS translated_count,
               COUNT(DISTINCT CASE WHEN j.status IN ('pending', 'processing') THEN j.id END) AS active_job_count,
               (SELECT latest.status FROM processing_jobs latest
                WHERE latest.page_id = p.id ORDER BY latest.id DESC LIMIT 1) AS latest_job_status
        FROM pages p
        LEFT JOIN text_blocks tb ON tb.page_id = p.id
        LEFT JOIN processing_jobs j ON j.page_id = p.id
        GROUP BY p.id
        ORDER BY p.chapter_id, p.page_number
        """
    ).fetchall()]
    chapters_by_manga: dict[int, list[dict]] = {}
    for chapter in chapter_rows:
        chapter["pages"] = []
        chapters_by_manga.setdefault(int(chapter["manga_id"]), []).append(chapter)
    chapters_by_id = {int(chapter["id"]): chapter for chapter in chapter_rows}
    for page in page_rows:
        page["qa_issues"] = _json_list(page.get("qa_issues_json"))
        page["workflow_state"] = _page_workflow_state(page)
        chapters_by_id[int(page["chapter_id"])]["pages"].append(page)

    summaries: list[dict] = []
    for manga in manga_rows:
        chapters = chapters_by_manga.get(int(manga["id"]), [])
        pages = [page for chapter in chapters for page in chapter["pages"]]
        counts = {key: 0 for key in ("unprocessed", "processing", "in_progress", "review", "completed")}
        for page in pages:
            counts[page["workflow_state"]] += 1
        if not pages or counts["unprocessed"] == len(pages):
            library_state = "unprocessed"
        elif counts["processing"]:
            library_state = "in_progress"
        elif counts["review"]:
            library_state = "review"
        elif counts["completed"] == len(pages):
            library_state = "completed"
        else:
            library_state = "in_progress"
        manga.update({
            "chapter_count": len(chapters),
            "page_count": len(pages),
            "state_counts": counts,
            "library_state": library_state,
            "progress_percent": round(counts["completed"] / len(pages) * 100) if pages else 0,
            "latest_page_id": pages[-1]["id"] if pages else None,
        })
        summaries.append(manga)
    return summaries


def _chapter_summaries(connection: sqlite3.Connection, manga_id: int) -> list[dict]:
    chapters = [dict(row) for row in connection.execute(
        """
        SELECT * FROM chapters WHERE manga_id = ?
        ORDER BY CAST(chapter_number AS REAL), chapter_number
        """,
        (manga_id,),
    ).fetchall()]
    for chapter in chapters:
        pages = [dict(row) for row in connection.execute(
            """
            SELECT p.*,
                   COUNT(DISTINCT tb.id) AS block_count,
                   COUNT(DISTINCT CASE
                       WHEN TRIM(COALESCE(tb.final_translation, '')) <> ''
                         OR TRIM(COALESCE(tb.ai_translation, '')) <> '' THEN tb.id END
                   ) AS translated_count,
                   COUNT(DISTINCT CASE WHEN j.status IN ('pending', 'processing') THEN j.id END) AS active_job_count,
                   (SELECT latest.status FROM processing_jobs latest
                    WHERE latest.page_id = p.id ORDER BY latest.id DESC LIMIT 1) AS latest_job_status
            FROM pages p
            LEFT JOIN text_blocks tb ON tb.page_id = p.id
            LEFT JOIN processing_jobs j ON j.page_id = p.id
            WHERE p.chapter_id = ?
            GROUP BY p.id ORDER BY p.page_number
            """,
            (chapter["id"],),
        ).fetchall()]
        counts = {key: 0 for key in ("unprocessed", "processing", "in_progress", "review", "completed")}
        for page in pages:
            page["qa_issues"] = _json_list(page.get("qa_issues_json"))
            state = _page_workflow_state(page)
            page["workflow_state"] = state
            counts[state] += 1
        chapter["page_count"] = len(pages)
        chapter["state_counts"] = counts
        chapter["pages"] = pages
        publish_job = connection.execute(
            """SELECT id, status, progress, current_step, error_message, created_at, updated_at
               FROM processing_jobs WHERE chapter_id = ? AND stage = 'study_publish'
               ORDER BY id DESC LIMIT 1""",
            (chapter["id"],),
        ).fetchone()
        chapter["publish_job"] = dict(publish_job) if publish_job else None
    return chapters


@app.get("/", include_in_schema=False)
def app_hub() -> FileResponse:
    return FileResponse(STATIC_DIR / "hub.html")


@app.get("/manga", include_in_schema=False)
@app.get("/admin", include_in_schema=False)
def dashboard() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/japtitle", include_in_schema=False)
def japtitle_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "japtitle.html")


@app.get("/editor", include_in_schema=False)
def editor() -> FileResponse:
    return FileResponse(STATIC_DIR / "editor.html")


@app.get("/study", include_in_schema=False)
def study_library_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "study.html")


@app.get("/study/chapter/{chapter_id}", include_in_schema=False)
def study_chapter_page(chapter_id: int) -> FileResponse:
    return FileResponse(STATIC_DIR / "study-reader.html")


@app.get("/study/vocabulary", include_in_schema=False)
def study_vocabulary_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "vocabulary.html")


@app.get("/study/media", include_in_schema=False)
def study_media_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "media.html")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "manga-translator-studio"}


@app.get("/api/visual-supervisor/status")
def visual_supervisor_status() -> dict:
    """Expose configured capability without forcing a costly vision inference."""
    return visual_supervisor_config()


@app.get("/api/ui-config")
def ui_config() -> dict:
    return {
        "show_mode_switch": SHOW_MODE_SWITCH,
        "visual_supervisor": visual_supervisor_config(),
    }


@app.get("/api/manga")
def list_manga() -> list[dict]:
    with db_session() as connection:
        return _library_summaries(connection)


@app.get("/api/library")
def get_library() -> dict:
    with db_session() as connection:
        items = _library_summaries(connection)
    counts = {key: 0 for key in ("unprocessed", "in_progress", "review", "completed")}
    for item in items:
        counts[item["library_state"]] += 1
    return {"items": items, "counts": counts, "total": len(items)}


@app.get("/api/sources/tonarinoyj/search")
def search_tonarinoyj(q: str = "") -> dict:
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=400, detail="Hãy nhập ít nhất 2 ký tự để tìm truyện")
    try:
        return {"items": search_series(query)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Không thể tìm trên Tonari no Young Jump: {exc}") from exc


@app.get("/api/sources/tonarinoyj/series/{series_id}")
def get_tonarinoyj_series(series_id: str, seed_episode_id: str | None = None) -> dict:
    if not series_id.isdigit() or (seed_episode_id and not seed_episode_id.isdigit()):
        raise HTTPException(status_code=400, detail="ID nguồn không hợp lệ")
    try:
        result = list_series_episodes(series_id, seed_episode_id)
        episode_ids = [str(item.get("episode_id") or "") for item in result.get("episodes", [])]
        with db_session() as connection:
            imported = {
                str(row["source_episode_id"]): int(row["id"])
                for row in connection.execute(
                    f"SELECT id, source_episode_id FROM chapters WHERE source_provider = 'tonarinoyj' "
                    f"AND source_episode_id IN ({','.join('?' for _ in episode_ids)})",
                    episode_ids,
                ).fetchall()
            } if episode_ids else {}
        for episode in result.get("episodes", []):
            chapter_id = imported.get(str(episode.get("episode_id") or ""))
            episode["already_imported"] = chapter_id is not None
            episode["chapter_id"] = chapter_id
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Không thể đọc danh sách chapter: {exc}") from exc


@app.post("/api/sources/tonarinoyj/import", status_code=202)
def import_tonarinoyj(payload: TonariImportRequest, background_tasks: BackgroundTasks) -> dict:
    episode_ids = list(dict.fromkeys(item.strip() for item in payload.episode_ids))
    if not payload.series_id.isdigit() or any(not item.isdigit() for item in episode_ids):
        raise HTTPException(status_code=400, detail="ID truyện hoặc chapter không hợp lệ")
    now = utc_now()
    with db_session() as connection:
        existing_ids = {
            str(row["source_episode_id"])
            for row in connection.execute(
                f"SELECT source_episode_id FROM chapters WHERE source_provider = 'tonarinoyj' "
                f"AND source_episode_id IN ({','.join('?' for _ in episode_ids)})",
                episode_ids,
            ).fetchall()
        }
        new_episode_ids = [item for item in episode_ids if item not in existing_ids]
        if not new_episode_ids:
            raise HTTPException(
                status_code=409,
                detail="Các chapter đã có trong thư viện. Hãy chọn chapter chưa nhập; "
                       "muốn tải lại ảnh, dùng 'Ghép lại ảnh nguồn Tonari' trong Editor.",
            )
        active = connection.execute(
            """SELECT id FROM processing_jobs WHERE stage = 'source_import'
               AND status IN ('pending', 'processing') LIMIT 1"""
        ).fetchone()
        if active:
            raise HTTPException(status_code=409, detail=f"Một lần import khác đang chạy (job #{active['id']})")
        cursor = connection.execute(
            """INSERT INTO processing_jobs
               (stage, status, progress, current_step, created_at, updated_at)
               VALUES ('source_import', 'pending', 0, 'Đang chờ bắt đầu', ?, ?)""",
            (now, now),
        )
        job_id = cursor.lastrowid
    background_tasks.add_task(run_import_job, job_id, payload.series_id, new_episode_ids, UPLOAD_DIR)
    return {"job_id": job_id, "status": "pending", "skipped_existing": len(existing_ids)}


@app.post("/api/chapters/{chapter_id}/refresh-source", status_code=202)
def refresh_tonari_chapter(chapter_id: int, background_tasks: BackgroundTasks) -> dict:
    now = utc_now()
    with db_session() as connection:
        chapter = get_or_404(
            connection, "SELECT * FROM chapters WHERE id = ?", (chapter_id,), "chapter"
        )
        if chapter.get("source_provider") != "tonarinoyj":
            raise HTTPException(status_code=409, detail="Chapter này không phải nguồn Tonari")
        if chapter.get("publication_status") == "published":
            raise HTTPException(status_code=409, detail="Hãy gỡ xuất bản chapter trước")
        active = connection.execute(
            """SELECT id FROM processing_jobs
               WHERE (chapter_id = ? OR page_id IN (SELECT id FROM pages WHERE chapter_id = ?))
                 AND status IN ('pending', 'processing') LIMIT 1""",
            (chapter_id, chapter_id),
        ).fetchone()
        if active:
            raise HTTPException(status_code=409, detail=f"Chapter đang có tác vụ chạy (job #{active['id']})")
        cursor = connection.execute(
            """INSERT INTO processing_jobs
               (chapter_id, stage, status, progress, current_step, created_at, updated_at)
               VALUES (?, 'source_refresh', 'pending', 0, 'Đang chờ bắt đầu', ?, ?)""",
            (chapter_id, now, now),
        )
        job_id = cursor.lastrowid
    background_tasks.add_task(run_refresh_chapter_job, job_id, chapter_id, UPLOAD_DIR)
    return {"job_id": job_id, "status": "pending"}


@app.post("/api/manga", status_code=201)
def create_manga(payload: MangaCreate) -> dict:
    now = utc_now()
    with db_session() as connection:
        cursor = connection.execute(
            """
            INSERT INTO manga (title, author, description, tags, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (payload.title.strip(), payload.author.strip(), payload.description.strip(), payload.tags.strip(), now, now),
        )
        return get_or_404(connection, "SELECT * FROM manga WHERE id = ?", (cursor.lastrowid,), "manga")


@app.get("/api/manga/{manga_id}")
def get_manga(manga_id: int) -> dict:
    with db_session() as connection:
        manga = get_or_404(connection, "SELECT * FROM manga WHERE id = ?", (manga_id,), "manga")
        chapters = _chapter_summaries(connection, manga_id)
    manga["chapters"] = chapters
    return manga


@app.post("/api/manga/{manga_id}/chapters", status_code=201)
def create_chapter(manga_id: int, payload: ChapterCreate) -> dict:
    now = utc_now()
    try:
        with db_session() as connection:
            get_or_404(connection, "SELECT id FROM manga WHERE id = ?", (manga_id,), "manga")
            cursor = connection.execute(
                """
                INSERT INTO chapters (manga_id, chapter_number, title, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (manga_id, payload.chapter_number.strip(), payload.title.strip(), now, now),
            )
            return get_or_404(connection, "SELECT * FROM chapters WHERE id = ?", (cursor.lastrowid,), "chapter")
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Chapter này đã tồn tại") from exc


@app.get("/api/chapters/{chapter_id}")
def get_chapter(chapter_id: int) -> dict:
    with db_session() as connection:
        chapter = get_or_404(
            connection,
            """
            SELECT c.*, m.title AS manga_title
            FROM chapters c JOIN manga m ON m.id = c.manga_id
            WHERE c.id = ?
            """,
            (chapter_id,),
            "chapter",
        )
        pages = connection.execute(
            "SELECT * FROM pages WHERE chapter_id = ? ORDER BY page_number",
            (chapter_id,),
        ).fetchall()
    chapter["pages"] = [dict(row) for row in pages]
    return chapter


@app.post("/api/chapters/{chapter_id}/import-check")
def check_import_files(chapter_id: int, payload: ImportCheckRequest) -> dict:
    with db_session() as connection:
        get_or_404(connection, "SELECT id FROM chapters WHERE id = ?", (chapter_id,), "chapter")
        hashes = [item.content_hash.lower() for item in payload.files]
        existing: dict[str, dict] = {}
        if hashes:
            placeholders = ",".join("?" for _ in hashes)
            rows = connection.execute(
                f"""
                SELECT id, page_number, original_filename, content_hash
                FROM pages WHERE chapter_id = ? AND content_hash IN ({placeholders})
                """,
                (chapter_id, *hashes),
            ).fetchall()
            existing = {str(row["content_hash"]).lower(): dict(row) for row in rows}

    seen: dict[str, str] = {}
    results: list[dict] = []
    for item in payload.files:
        digest = item.content_hash.lower()
        duplicate_type = None
        duplicate_of = None
        if digest in existing:
            duplicate_type = "existing"
            duplicate_of = existing[digest]
        elif digest in seen:
            duplicate_type = "selection"
            duplicate_of = {"original_filename": seen[digest]}
        else:
            seen[digest] = item.name
        results.append({
            "name": item.name,
            "content_hash": digest,
            "duplicate_type": duplicate_type,
            "duplicate_of": duplicate_of,
        })
    return {
        "files": results,
        "duplicate_count": sum(item["duplicate_type"] is not None for item in results),
    }


@app.post("/api/chapters/{chapter_id}/review")
def review_chapter(chapter_id: int, payload: ChapterReviewRequest) -> dict:
    now = utc_now()
    with db_session() as connection:
        chapter = get_or_404(connection, "SELECT * FROM chapters WHERE id = ?", (chapter_id,), "chapter")
        pages = connection.execute(
            "SELECT id, status FROM pages WHERE chapter_id = ? ORDER BY page_number", (chapter_id,)
        ).fetchall()
        if not pages:
            raise HTTPException(status_code=409, detail="Chapter chưa có trang để hoàn thành")
        active = connection.execute(
            """
            SELECT COUNT(*) FROM processing_jobs
            WHERE chapter_id = ? AND status IN ('pending', 'processing')
            """,
            (chapter_id,),
        ).fetchone()[0]
        if active:
            raise HTTPException(status_code=409, detail="Chapter vẫn còn tác vụ đang chạy")
        if payload.approved and any(page["status"] != "ready" for page in pages):
            raise HTTPException(
                status_code=409,
                detail="Chỉ có thể hoàn thành khi mọi trang đã xử lý xong",
            )
        if payload.approved:
            error_page = connection.execute(
                """SELECT page_number FROM pages
                   WHERE chapter_id = ? AND qa_status = 'error'
                   ORDER BY page_number LIMIT 1""",
                (chapter_id,),
            ).fetchone()
            if error_page:
                raise HTTPException(
                    status_code=409,
                    detail=f"Trang {error_page['page_number']} còn lỗi pipeline/QA bắt buộc phải xử lý trước",
                )
            warning_count = int(connection.execute(
                """SELECT COUNT(*) FROM pages
                   WHERE chapter_id = ? AND qa_status = 'warning' AND qa_overridden = 0""",
                (chapter_id,),
            ).fetchone()[0])
            if warning_count and not payload.override_warnings:
                raise HTTPException(
                    status_code=409,
                    detail=f"Chapter còn {warning_count} trang có cảnh báo QA; có thể xác nhận bỏ qua để tiếp tục",
                )
        review_status = "approved" if payload.approved else "pending"
        chapter_status = "completed" if payload.approved else "processing"
        connection.execute(
            """UPDATE pages
               SET review_status = ?,
                   qa_overridden = CASE
                       WHEN ? = 1 AND qa_status = 'warning' THEN 1 ELSE qa_overridden END,
                   updated_at = ?
               WHERE chapter_id = ?""",
            (review_status, int(payload.approved and payload.override_warnings), now, chapter_id),
        )
        connection.execute(
            "UPDATE chapters SET status = ?, updated_at = ? WHERE id = ?",
            (chapter_status, now, chapter_id),
        )
        connection.execute(
            "UPDATE manga SET updated_at = ? WHERE id = ?", (now, chapter["manga_id"])
        )
    record_activity("chapter_review", "Xác nhận chapter đạt" if payload.approved else "Mở lại chapter",
                    manga_id=chapter["manga_id"], chapter_id=chapter_id,
                    details={"page_count": len(pages), "override_warnings": payload.override_warnings})
    return {"status": review_status, "chapter_id": chapter_id, "page_count": len(pages)}


@app.put("/api/chapters/{chapter_id}/pages/order")
def reorder_chapter_pages(chapter_id: int, payload: PageOrderRequest) -> dict:
    now = utc_now()
    if len(payload.page_ids) != len(set(payload.page_ids)):
        raise HTTPException(status_code=422, detail="Danh sách thứ tự có trang bị lặp")
    with db_session() as connection:
        chapter = get_or_404(connection, "SELECT * FROM chapters WHERE id = ?", (chapter_id,), "chapter")
        current_ids = [row["id"] for row in connection.execute(
            "SELECT id FROM pages WHERE chapter_id = ? ORDER BY page_number", (chapter_id,)
        ).fetchall()]
        if set(current_ids) != set(payload.page_ids) or len(current_ids) != len(payload.page_ids):
            raise HTTPException(status_code=409, detail="Thứ tự gửi lên không khớp toàn bộ trang trong chapter")
        active = connection.execute(
            "SELECT COUNT(*) FROM processing_jobs WHERE chapter_id = ? AND status IN ('pending', 'processing')",
            (chapter_id,),
        ).fetchone()[0]
        if active:
            raise HTTPException(status_code=409, detail="Không thể đổi thứ tự khi chapter đang xử lý")
        _renumber_pages(connection, chapter_id, payload.page_ids)
        connection.execute("UPDATE chapters SET updated_at = ? WHERE id = ?", (now, chapter_id))
        connection.execute("UPDATE manga SET updated_at = ? WHERE id = ?", (now, chapter["manga_id"]))
    return {"status": "reordered", "page_ids": payload.page_ids}


@app.delete("/api/pages/{page_id}")
def delete_page(page_id: int) -> dict:
    paths: list[str | None] = []
    now = utc_now()
    with db_session() as connection:
        page = get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (page_id,), "trang")
        chapter = get_or_404(connection, "SELECT * FROM chapters WHERE id = ?", (page["chapter_id"],), "chapter")
        active = connection.execute(
            "SELECT COUNT(*) FROM processing_jobs WHERE page_id = ? AND status IN ('pending', 'processing')",
            (page_id,),
        ).fetchone()[0]
        if active:
            raise HTTPException(status_code=409, detail="Không thể xóa trang đang xử lý")
        paths = [page.get(key) for key in (
            "original_image_path", "clean_image_path", "mask_preview_path",
            "bubble_preview_path", "bubble_analysis_path",
        )]
        connection.execute("DELETE FROM pages WHERE id = ?", (page_id,))
        remaining = [row["id"] for row in connection.execute(
            "SELECT id FROM pages WHERE chapter_id = ? ORDER BY page_number", (page["chapter_id"],)
        ).fetchall()]
        if remaining:
            _renumber_pages(connection, page["chapter_id"], remaining)
        connection.execute("UPDATE chapters SET status = 'processing', updated_at = ? WHERE id = ?", (now, page["chapter_id"]))
        connection.execute("UPDATE manga SET updated_at = ? WHERE id = ?", (now, chapter["manga_id"]))
    _delete_upload_files(paths)
    return {"status": "deleted", "page_id": page_id, "remaining_page_ids": remaining}


@app.delete("/api/chapters/{chapter_id}")
def delete_chapter(chapter_id: int) -> dict:
    paths: list[str | None] = []
    now = utc_now()
    with db_session() as connection:
        chapter = get_or_404(connection, "SELECT * FROM chapters WHERE id = ?", (chapter_id,), "chapter")
        active = connection.execute(
            "SELECT COUNT(*) FROM processing_jobs WHERE chapter_id = ? AND status IN ('pending', 'processing')",
            (chapter_id,),
        ).fetchone()[0]
        if active:
            raise HTTPException(status_code=409, detail="Không thể xóa chapter đang xử lý")
        for row in connection.execute("SELECT * FROM pages WHERE chapter_id = ?", (chapter_id,)).fetchall():
            page = dict(row)
            paths.extend(page.get(key) for key in (
                "original_image_path", "clean_image_path", "mask_preview_path",
                "bubble_preview_path", "bubble_analysis_path",
            ))
        connection.execute("DELETE FROM chapters WHERE id = ?", (chapter_id,))
        connection.execute("UPDATE manga SET updated_at = ? WHERE id = ?", (now, chapter["manga_id"]))
    _delete_upload_files(paths)
    return {"status": "deleted", "chapter_id": chapter_id}


@app.post("/api/chapters/{chapter_id}/pages", status_code=201)
async def upload_pages(
    chapter_id: int,
    files: list[UploadFile] = File(...),
    preserve_order: bool = Form(False),
    batch_label: str = Form(""),
) -> list[dict]:
    if not files:
        raise HTTPException(status_code=400, detail="Hãy chọn ít nhất một ảnh")

    with db_session() as connection:
        get_or_404(connection, "SELECT id FROM chapters WHERE id = ?", (chapter_id,), "chapter")
        current_max = connection.execute(
            "SELECT COALESCE(MAX(page_number), 0) FROM pages WHERE chapter_id = ?", (chapter_id,)
        ).fetchone()[0]

    chapter_dir = UPLOAD_DIR / f"chapter_{chapter_id}"
    chapter_dir.mkdir(parents=True, exist_ok=True)
    staged: list[tuple[Path, int, int, str, str]] = []
    ordered_files = list(files) if preserve_order else sorted(
        files, key=lambda item: natural_filename_key(item.filename or "")
    )
    try:
        staged_hashes: set[str] = set()
        for upload in ordered_files:
            extension = ALLOWED_IMAGE_TYPES.get(upload.content_type or "")
            if extension is None:
                raise HTTPException(status_code=415, detail=f"{upload.filename}: chỉ hỗ trợ JPG, PNG hoặc WebP")

            destination = chapter_dir / f"{uuid4().hex}{extension}"
            size = 0
            digest = hashlib.sha256()
            try:
                with destination.open("wb") as target:
                    while chunk := await upload.read(1024 * 1024):
                        size += len(chunk)
                        if size > MAX_UPLOAD_SIZE:
                            raise HTTPException(status_code=413, detail=f"{upload.filename}: ảnh vượt quá 20 MB")
                        digest.update(chunk)
                        target.write(chunk)
                with Image.open(destination) as image:
                    image.verify()
                with Image.open(destination) as image:
                    width, height = image.size
                content_hash = digest.hexdigest()
                if content_hash in staged_hashes:
                    raise HTTPException(
                        status_code=409,
                        detail=f"{upload.filename}: ảnh bị trùng trong lần chọn này",
                    )
                with db_session() as connection:
                    duplicate = connection.execute(
                        """
                        SELECT page_number, original_filename FROM pages
                        WHERE chapter_id = ? AND content_hash = ? LIMIT 1
                        """,
                        (chapter_id, content_hash),
                    ).fetchone()
                if duplicate:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"{upload.filename}: trùng với trang {duplicate['page_number']} "
                            f"({duplicate['original_filename'] or 'ảnh đã nhập'})"
                        ),
                    )
                staged_hashes.add(content_hash)
                staged.append((destination, width, height, upload.filename or "", content_hash))
            except (UnidentifiedImageError, OSError) as exc:
                destination.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail=f"{upload.filename}: file ảnh không hợp lệ") from exc
            except Exception:
                destination.unlink(missing_ok=True)
                raise
            finally:
                await upload.close()

        uploaded: list[dict] = []
        now = utc_now()
        with db_session() as connection:
            chapter = get_or_404(connection, "SELECT * FROM chapters WHERE id = ?", (chapter_id,), "chapter")
            batch_cursor = connection.execute(
                """
                INSERT INTO import_batches (
                    chapter_id, label, source_kind, file_count, status, created_at, updated_at
                ) VALUES (?, ?, 'folder', ?, 'completed', ?, ?)
                """,
                (chapter_id, batch_label.strip()[:255], len(staged), now, now),
            )
            batch_id = batch_cursor.lastrowid
            for offset, (destination, width, height, original_filename, content_hash) in enumerate(staged, start=1):
                relative_path = destination.relative_to(UPLOAD_DIR).as_posix()
                cursor = connection.execute(
                    """
                    INSERT INTO pages (
                        chapter_id, page_number, original_image_path, import_batch_id,
                        original_filename, content_hash, review_status,
                        width, height, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
                    """,
                    (
                        chapter_id, current_max + offset, relative_path, batch_id,
                        original_filename, content_hash, width, height, now, now,
                    ),
                )
                uploaded.append(
                    get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (cursor.lastrowid,), "trang")
                )
            connection.execute(
                "UPDATE chapters SET status = 'processing', updated_at = ? WHERE id = ?",
                (now, chapter_id),
            )
            connection.execute(
                "UPDATE manga SET updated_at = ? WHERE id = ?", (now, chapter["manga_id"])
            )
        return uploaded
    except Exception:
        for destination, *_ in staged:
            destination.unlink(missing_ok=True)
        for upload in ordered_files:
            await upload.close()
        raise


@app.get("/api/pages/{page_id}")
def get_page(page_id: int) -> dict:
    with db_session() as connection:
        page = get_or_404(
            connection,
            """
            SELECT p.*, c.chapter_number, c.title AS chapter_title,
                   c.source_provider AS chapter_source_provider,
                   m.id AS manga_id, m.title AS manga_title
            FROM pages p
            JOIN chapters c ON c.id = p.chapter_id
            JOIN manga m ON m.id = c.manga_id
            WHERE p.id = ?
            """,
            (page_id,),
            "trang",
        )
        blocks = connection.execute(
            "SELECT * FROM text_blocks WHERE page_id = ? ORDER BY id", (page_id,)
        ).fetchall()
        siblings = connection.execute(
            """
            SELECT p.*,
                   COUNT(DISTINCT tb.id) AS block_count,
                   COUNT(DISTINCT CASE WHEN TRIM(COALESCE(tb.final_translation, '')) <> ''
                       OR TRIM(COALESCE(tb.ai_translation, '')) <> '' THEN tb.id END) AS translated_count,
                   COUNT(DISTINCT CASE WHEN j.status IN ('pending', 'processing') THEN j.id END) AS active_job_count,
                   (SELECT latest.status FROM processing_jobs latest
                    WHERE latest.page_id = p.id ORDER BY latest.id DESC LIMIT 1) AS latest_job_status
            FROM pages p
            LEFT JOIN text_blocks tb ON tb.page_id = p.id
            LEFT JOIN processing_jobs j ON j.page_id = p.id
            WHERE p.chapter_id = ? GROUP BY p.id ORDER BY p.page_number
            """,
            (page["chapter_id"],),
        ).fetchall()
    page["original_image_url"] = f"/uploads/{page['original_image_path']}"
    clean_path = page.get("clean_image_path") or page["original_image_path"]
    page["clean_image_url"] = f"/uploads/{clean_path}"
    page["mask_preview_url"] = (
        f"/uploads/{page['mask_preview_path']}" if page.get("mask_preview_path") else None
    )
    page["bubble_preview_url"] = (
        f"/uploads/{page['bubble_preview_path']}" if page.get("bubble_preview_path") else None
    )
    page["text_blocks"] = [dict(row) for row in blocks]
    for block in page["text_blocks"]:
        block["policy_reasons"] = _json_list(block.get("policy_reasons_json"))
        try:
            block["visual_suggestion"] = json.loads(block.get("visual_suggestion_json") or "{}")
        except (TypeError, json.JSONDecodeError):
            block["visual_suggestion"] = {}
        display_text = str(block.get("final_translation") or block.get("ai_translation") or "").strip()
        if not display_text:
            block["render_text"] = ""
            block["render_source_text"] = ""
            block["render_font_size"] = int(block.get("font_size") or 6)
            continue
        fitted = fit_text_layout(
            display_text, float(block["width"]), float(block["height"]),
            str(block.get("font_family") or "Arial"),
        )
        requested_size = max(6, round(float(block.get("font_size") or fitted.font_size)))
        actual_size = min(requested_size, fitted.font_size)
        exact_layout = layout_at_size(
            display_text, float(block["width"]), actual_size,
            str(block.get("font_family") or "Arial"),
        )
        block["render_text"] = "\n".join(exact_layout.lines)
        block["render_source_text"] = display_text
        block["render_font_size"] = actual_size
    page["qa_issues"] = _json_list(page.get("qa_issues_json"))
    try:
        page["visual_analysis"] = json.loads(page.get("visual_analysis_json") or "{}")
    except (TypeError, json.JSONDecodeError):
        page["visual_analysis"] = {}
    page["needs_inpainting"] = bool(
        any(
            (block.get("render_mode") or "replace") == "replace"
            and (block.get("translation_mode") or "translate") == "translate"
            for block in page["text_blocks"]
        )
        and not page.get("clean_image_path")
    )
    page["chapter_pages"] = []
    for row in siblings:
        sibling = dict(row)
        sibling["qa_issues"] = _json_list(sibling.get("qa_issues_json"))
        sibling["workflow_state"] = _page_workflow_state(sibling)
        sibling["original_image_url"] = f"/uploads/{sibling['original_image_path']}"
        page["chapter_pages"].append(sibling)
    current_summary = next(item for item in page["chapter_pages"] if item["id"] == page_id)
    page["workflow_state"] = current_summary["workflow_state"]
    return page


@app.put("/api/pages/{page_id}/text-blocks")
def save_text_blocks(page_id: int, payload: TextBlockBatch) -> dict:
    now = utc_now()
    with db_session() as connection:
        page = get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (page_id,), "trang")
        previous_blocks = [dict(row) for row in connection.execute(
            "SELECT * FROM text_blocks WHERE page_id = ? ORDER BY id", (page_id,)
        ).fetchall()]
        submitted_blocks = [block.model_dump() for block in payload.blocks]
        def mask_box(block: dict) -> tuple[float, float, float, float]:
            return tuple(float(block.get(source) if block.get(source) is not None else block[field])
                         for source, field in (("source_x", "x"), ("source_y", "y"),
                                               ("source_width", "width"), ("source_height", "height")))

        requires_inpainting = any(
            (submitted.get("render_mode") or "replace") == "replace"
            and (submitted.get("translation_mode") or "translate") == "translate"
            and (
                index >= len(previous_blocks)
                or (previous_blocks[index].get("render_mode") or "replace") != "replace"
                or any(abs(first - second) > 0.25 for first, second in zip(
                    mask_box(previous_blocks[index]), mask_box(submitted), strict=True
                ))
            )
            for index, submitted in enumerate(submitted_blocks)
        )
        for block in payload.blocks:
            # Browser scaling can produce values such as 800.0000001 for a
            # block whose right edge is exactly at pixel 800.
            if block.x + block.width > page["width"] + 0.75 or block.y + block.height > page["height"] + 0.75:
                raise HTTPException(status_code=422, detail="TextBlock nằm ngoài giới hạn ảnh")

        connection.execute("DELETE FROM text_blocks WHERE page_id = ?", (page_id,))
        saved_ids: list[int] = []
        for block in payload.blocks:
            cursor = connection.execute(
                """
                INSERT INTO text_blocks (
                    page_id, x, y, width, height, source_x, source_y, source_width,
                    source_height, original_text, ai_translation,
                    final_translation, font_family, font_size, color, text_align,
                    text_offset_y, placement_anchor_x, placement_anchor_y,
                    rotation, ocr_confidence, ocr_provider, text_kind, content_type,
                    translation_mode, render_mode, style_preset, policy_source,
                    sfx_score, mask_strategy, visual_confidence, visual_model,
                    visual_suggestion_json, policy_reasons_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    page_id, block.x, block.y, block.width, block.height,
                    block.source_x, block.source_y, block.source_width, block.source_height,
                    block.original_text, block.ai_translation, block.final_translation,
                    block.font_family, block.font_size, block.color, block.text_align,
                    block.text_offset_y, block.placement_anchor_x, block.placement_anchor_y,
                    block.rotation, block.ocr_confidence, block.ocr_provider,
                    block.text_kind, block.content_type, block.translation_mode,
                    block.render_mode, block.style_preset, block.policy_source,
                    block.sfx_score, block.mask_strategy, block.visual_confidence,
                    block.visual_model, block.visual_suggestion_json,
                    block.policy_reasons_json, now, now,
                ),
            )
            saved_ids.append(cursor.lastrowid)
        if requires_inpainting:
            connection.execute(
                """UPDATE pages
                   SET status = 'ready', review_status = 'pending',
                       clean_image_path = NULL, mask_preview_path = NULL,
                       qa_status = 'unknown', qa_issues_json = '[]', qa_overridden = 0,
                       updated_at = ?
                   WHERE id = ?""",
                (now, page_id),
            )
        else:
            connection.execute(
                "UPDATE pages SET status = 'ready', review_status = 'pending', updated_at = ? WHERE id = ?",
                (now, page_id),
            )
    tracked_fields = ("original_text", "ai_translation", "final_translation", "font_family", "font_size", "color", "text_align", "x", "y", "width", "height", "rotation", "content_type", "translation_mode", "render_mode", "style_preset")
    changes = []
    submitted = submitted_blocks
    for index in range(max(len(previous_blocks), len(submitted))):
        before = previous_blocks[index] if index < len(previous_blocks) else None
        after = submitted[index] if index < len(submitted) else None
        if before is None:
            changes.append({"block": index + 1, "change": "added"})
        elif after is None:
            changes.append({"block": index + 1, "change": "removed"})
        else:
            fields = [field for field in tracked_fields if before.get(field) != after.get(field)]
            if fields:
                changes.append({"block": index + 1, "change": "updated", "fields": fields})
    record_activity("text_edit", f"Đã lưu {len(saved_ids)} TextBlock · {len(changes)} thay đổi",
                    manga_id=None, chapter_id=page["chapter_id"], page_id=page_id,
                    details={"block_count": len(saved_ids), "changes": changes})
    return {
        "status": "saved", "count": len(saved_ids), "ids": saved_ids,
        "requires_inpainting": requires_inpainting,
    }


@app.post("/api/pages/{page_id}/review")
def review_page(page_id: int, payload: PageReviewRequest) -> dict:
    now = utc_now()
    with db_session() as connection:
        page = get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (page_id,), "trang")
        active = connection.execute(
            "SELECT COUNT(*) FROM processing_jobs WHERE page_id = ? AND status IN ('pending', 'processing')",
            (page_id,),
        ).fetchone()[0]
        if active:
            raise HTTPException(status_code=409, detail="Trang vẫn đang được xử lý")
        if payload.approved and page["status"] != "ready":
            raise HTTPException(status_code=409, detail="Chỉ có thể xác nhận trang đã xử lý xong")
        qa_status = page.get("qa_status") or "unknown"
        if payload.approved and qa_status == "error":
            raise HTTPException(status_code=409, detail="Trang còn lỗi bắt buộc phải xử lý trước khi duyệt")
        if payload.approved and qa_status == "warning" and not payload.override_warnings:
            raise HTTPException(status_code=409, detail="Trang có cảnh báo; hãy xác nhận bỏ qua cảnh báo")
        review_status = "approved" if payload.approved else "pending"
        connection.execute(
            "UPDATE pages SET review_status = ?, qa_overridden = ?, updated_at = ? WHERE id = ?",
            (review_status, int(payload.approved and payload.override_warnings), now, page_id),
        )
        connection.execute("UPDATE chapters SET updated_at = ? WHERE id = ?", (now, page["chapter_id"]))
    record_activity("page_review", "Xác nhận trang đạt" if payload.approved else "Mở lại trang",
                    chapter_id=page["chapter_id"], page_id=page_id,
                    details={"override_warnings": payload.override_warnings})
    return {"status": review_status, "page_id": page_id}


@app.put("/api/pages/{page_id}/editorial-decision")
def set_page_editorial_decision(page_id: int, payload: PageEditorialDecisionRequest) -> dict:
    now = utc_now()
    decision = payload.decision
    note = payload.note.strip()
    with db_session() as connection:
        page = get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (page_id,), "trang")
        active = connection.execute(
            "SELECT COUNT(*) FROM processing_jobs WHERE page_id = ? AND status IN ('pending', 'processing')",
            (page_id,),
        ).fetchone()[0]
        if active:
            raise HTTPException(status_code=409, detail="Trang vẫn đang được xử lý")
        clean_path = page.get("clean_image_path") or page["original_image_path"]
        if decision == "preserve_sfx":
            connection.execute(
                """UPDATE pages
                   SET editorial_decision = ?, editorial_note = ?, editorial_decision_at = ?,
                       clean_image_path = ?, status = 'ready', review_status = 'pending',
                       qa_status = 'pass', qa_issues_json = '[]', qa_overridden = 0,
                       last_processed_at = ?, updated_at = ?
                   WHERE id = ?""",
                (decision, note, now, clean_path, now, now, page_id),
            )
            quality = {"status": "pass", "issues": []}
        elif decision == "needs_manual_repair":
            issues = [{
                "severity": "warning",
                "code": "manual_repair_needed",
                "message": "Trang được đánh dấu cần sửa tay trước khi xuất bản.",
            }]
            connection.execute(
                """UPDATE pages
                   SET editorial_decision = ?, editorial_note = ?, editorial_decision_at = ?,
                       status = 'ready', review_status = 'pending',
                       qa_status = 'warning', qa_issues_json = ?, qa_overridden = 0,
                       last_processed_at = ?, updated_at = ?
                   WHERE id = ?""",
                (decision, note, now, json.dumps(issues, ensure_ascii=False), now, now, page_id),
            )
            quality = {"status": "warning", "issues": issues}
        else:
            connection.execute(
                """UPDATE pages
                   SET editorial_decision = 'auto', editorial_note = '', editorial_decision_at = NULL,
                       review_status = 'pending', updated_at = ?
                   WHERE id = ?""",
                (now, page_id),
            )
            quality = None
        connection.execute("UPDATE chapters SET updated_at = ? WHERE id = ?", (now, page["chapter_id"]))

    if decision == "auto":
        quality = evaluate_page_quality(page_id, check_clean_ocr=False)
    labels = {
        "auto": "Quay lại QA tự động",
        "preserve_sfx": "Giữ SFX/trang tranh",
        "needs_manual_repair": "Đánh dấu cần sửa tay",
    }
    record_activity("editorial_decision", labels[decision],
                    chapter_id=page["chapter_id"], page_id=page_id,
                    details={"decision": decision, "note": note, "quality": quality})
    return {"status": "saved", "decision": decision, "quality": quality}


@app.put("/api/pages/{page_id}/outside-text-policy")
def set_outside_text_policy(page_id: int, payload: OutsideTextPolicyRequest) -> dict:
    """Save the page policy even before OCR has created any TextBlock."""
    now = utc_now()
    policy = payload.policy
    with db_session() as connection:
        page = get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (page_id,), "trang")
        connection.execute(
            "UPDATE pages SET outside_text_policy = ?, review_status = 'pending', updated_at = ? WHERE id = ?",
            (policy, now, page_id),
        )
        if policy == "replace":
            connection.execute(
                """UPDATE text_blocks
                   SET translation_mode = 'translate', render_mode = 'replace', updated_at = ?
                   WHERE page_id = ? AND text_kind = 'sfx' AND policy_source <> 'manual'""",
                (now, page_id),
            )
            connection.execute(
                """UPDATE pages SET clean_image_path = NULL, mask_preview_path = NULL,
                       qa_status = 'unknown', qa_issues_json = '[]', qa_overridden = 0
                   WHERE id = ?""",
                (page_id,),
            )
        elif policy == "study":
            connection.execute(
                """UPDATE text_blocks
                   SET translation_mode = 'translate', render_mode = 'preserve', updated_at = ?
                   WHERE page_id = ? AND text_kind = 'sfx' AND policy_source <> 'manual'""",
                (now, page_id),
            )
        elif policy == "skip":
            connection.execute(
                """UPDATE text_blocks
                   SET translation_mode = 'skip', render_mode = 'preserve', updated_at = ?
                   WHERE page_id = ? AND text_kind = 'sfx' AND policy_source <> 'manual'""",
                (now, page_id),
            )
        else:
            connection.execute(
                """UPDATE text_blocks
                   SET translation_mode = 'translate',
                       render_mode = CASE WHEN sfx_score >= 0.62 THEN 'preserve' ELSE 'replace' END,
                       updated_at = ?
                   WHERE page_id = ? AND policy_source <> 'manual'""",
                (now, page_id),
            )
        connection.execute("UPDATE chapters SET updated_at = ? WHERE id = ?", (now, page["chapter_id"]))
    record_activity(
        "outside_text_policy", "Đổi chính sách chữ ngoài bong bóng",
        chapter_id=page["chapter_id"], page_id=page_id,
        details={"policy": policy},
    )
    return {"page_id": page_id, "outside_text_policy": policy}


@app.post("/api/pages/{page_id}/ocr", status_code=202)
def start_page_ocr(
    page_id: int,
    payload: OcrRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    now = utc_now()
    with db_session() as connection:
        page = get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (page_id,), "trang")
        active_job = connection.execute(
            """
            SELECT id FROM processing_jobs
            WHERE page_id = ? AND stage = 'ocr' AND status IN ('pending', 'processing')
            ORDER BY id DESC LIMIT 1
            """,
            (page_id,),
        ).fetchone()
        if active_job:
            raise HTTPException(status_code=409, detail="Trang này đang chạy OCR")
        existing_count = connection.execute(
            "SELECT COUNT(*) FROM text_blocks WHERE page_id = ?", (page_id,)
        ).fetchone()[0]
        if existing_count and not payload.replace_existing:
            raise HTTPException(
                status_code=409,
                detail="Trang đã có TextBlock. Chỉ chạy lại OCR khi bạn xác nhận thay thế dữ liệu hiện tại.",
            )
        cursor = connection.execute(
            """
            INSERT INTO processing_jobs (
                chapter_id, page_id, stage, status, progress, created_at, updated_at
            ) VALUES (?, ?, 'ocr', 'pending', 0, ?, ?)
            """,
            (page["chapter_id"], page_id, now, now),
        )
        job_id = cursor.lastrowid
        connection.execute(
            """UPDATE pages
               SET status = 'processing', editorial_decision = 'auto',
                   editorial_note = '', editorial_decision_at = NULL, updated_at = ?
               WHERE id = ?""",
            (now, page_id),
        )

    image_path = UPLOAD_DIR / page["original_image_path"]
    if not image_path.is_file():
        with db_session() as connection:
            connection.execute(
                "UPDATE pages SET status = 'failed', updated_at = ? WHERE id = ?", (utc_now(), page_id)
            )
            connection.execute(
                "UPDATE processing_jobs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?",
                ("Không tìm thấy ảnh gốc", utc_now(), job_id),
            )
        raise HTTPException(status_code=409, detail="Không tìm thấy ảnh gốc của trang")

    background_tasks.add_task(run_ocr_job, job_id, page_id, image_path, payload.replace_existing)
    return {"job_id": job_id, "status": "pending", "stage": "ocr"}


@app.post("/api/pages/{page_id}/ocr-crop")
def recognize_page_crop(page_id: int, payload: CropOcrRequest) -> dict:
    """Recognize a region drawn by the editor without changing saved blocks."""
    with db_session() as connection:
        page = get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (page_id,), "trang")

    right = min(float(page["width"]), payload.x + payload.width)
    bottom = min(float(page["height"]), payload.y + payload.height)
    if payload.x >= right or payload.y >= bottom:
        raise HTTPException(status_code=422, detail="Vùng OCR nằm ngoài ảnh")

    image_path = UPLOAD_DIR / page["original_image_path"]
    if not image_path.is_file():
        raise HTTPException(status_code=409, detail="Không tìm thấy ảnh gốc của trang")

    with Image.open(image_path) as image:
        crop = image.convert("RGB").crop((
            max(0, int(payload.x)),
            max(0, int(payload.y)),
            min(image.width, int(right + 0.999)),
            min(image.height, int(bottom + 0.999)),
        ))
        text = recognize_japanese_crop(crop)
    return {"page_id": page_id, "text": text}


@app.get("/api/jobs/{job_id}")
def get_processing_job(job_id: int) -> dict:
    with db_session() as connection:
        job = get_or_404(
            connection,
            "SELECT * FROM processing_jobs WHERE id = ?",
            (job_id,),
            "tác vụ",
        )
        if job["stage"] == "chapter_pipeline":
            job["items"] = [dict(row) for row in connection.execute(
                "SELECT b.*, p.page_number, p.qa_status FROM batch_job_pages b JOIN pages p ON p.id = b.page_id WHERE b.job_id = ? ORDER BY b.position",
                (job_id,),
            ).fetchall()]
        return job


@app.post("/api/pages/{page_id}/translate", status_code=202)
def start_page_translation(
    page_id: int,
    payload: TranslationRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    now = utc_now()
    with db_session() as connection:
        page = get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (page_id,), "trang")
        active_job = connection.execute(
            """
            SELECT id FROM processing_jobs
            WHERE page_id = ? AND stage = 'translation' AND status IN ('pending', 'processing')
            ORDER BY id DESC LIMIT 1
            """,
            (page_id,),
        ).fetchone()
        if active_job:
            raise HTTPException(status_code=409, detail="Trang này đang được dịch")
        blocks = connection.execute(
            "SELECT id, original_text, ai_translation FROM text_blocks WHERE page_id = ?",
            (page_id,),
        ).fetchall()
        translatable = [row for row in blocks if row["original_text"].strip()]
        if not translatable:
            raise HTTPException(status_code=409, detail="Trang chưa có văn bản OCR để dịch")
        if not payload.overwrite_existing_ai and any(row["ai_translation"].strip() for row in translatable):
            raise HTTPException(
                status_code=409,
                detail="Trang đã có đề xuất AI. Hãy xác nhận nếu muốn dịch lại.",
            )
        cursor = connection.execute(
            """
            INSERT INTO processing_jobs (
                chapter_id, page_id, stage, status, progress, created_at, updated_at
            ) VALUES (?, ?, 'translation', 'pending', 0, ?, ?)
            """,
            (page["chapter_id"], page_id, now, now),
        )
        job_id = cursor.lastrowid

    background_tasks.add_task(run_translation_job, job_id, page_id)
    return {"job_id": job_id, "status": "pending", "stage": "translation"}


@app.post("/api/pages/{page_id}/inpaint", status_code=202)
def start_page_inpainting(page_id: int, background_tasks: BackgroundTasks) -> dict:
    now = utc_now()
    with db_session() as connection:
        page = get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (page_id,), "trang")
        active_job = connection.execute(
            """
            SELECT id FROM processing_jobs
            WHERE page_id = ? AND stage = 'inpainting' AND status IN ('pending', 'processing')
            ORDER BY id DESC LIMIT 1
            """,
            (page_id,),
        ).fetchone()
        if active_job:
            raise HTTPException(status_code=409, detail="Trang này đang được làm sạch")
        block_count = connection.execute(
            "SELECT COUNT(*) FROM text_blocks WHERE page_id = ?", (page_id,)
        ).fetchone()[0]
        if not block_count:
            raise HTTPException(status_code=409, detail="Trang chưa có TextBlock để xóa chữ")
        cursor = connection.execute(
            """
            INSERT INTO processing_jobs (
                chapter_id, page_id, stage, status, progress, created_at, updated_at
            ) VALUES (?, ?, 'inpainting', 'pending', 0, ?, ?)
            """,
            (page["chapter_id"], page_id, now, now),
        )
        job_id = cursor.lastrowid

    original_path = UPLOAD_DIR / page["original_image_path"]
    relative_path = (
        Path(page["original_image_path"]).parent / f"auto_clean_{uuid4().hex}.png"
    ).as_posix()
    destination = UPLOAD_DIR / relative_path
    preview_relative_path = (
        Path(page["original_image_path"]).parent / f"mask_preview_{uuid4().hex}.png"
    ).as_posix()
    preview_destination = UPLOAD_DIR / preview_relative_path
    background_tasks.add_task(
        run_inpainting_job,
        job_id,
        page_id,
        original_path,
        destination,
        relative_path,
        preview_destination,
        preview_relative_path,
    )
    return {"job_id": job_id, "status": "pending", "stage": "inpainting"}


@app.post("/api/pages/{page_id}/bubble-segmentation", status_code=202)
def start_bubble_segmentation(page_id: int, background_tasks: BackgroundTasks) -> dict:
    now = utc_now()
    with db_session() as connection:
        page = get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (page_id,), "trang")
        active_job = connection.execute(
            """
            SELECT id FROM processing_jobs
            WHERE page_id = ? AND stage = 'bubble_segmentation' AND status IN ('pending', 'processing')
            ORDER BY id DESC LIMIT 1
            """,
            (page_id,),
        ).fetchone()
        if active_job:
            raise HTTPException(status_code=409, detail="Trang này đang được phân tích bong bóng thoại")
        cursor = connection.execute(
            """
            INSERT INTO processing_jobs (
                chapter_id, page_id, stage, status, progress, created_at, updated_at
            ) VALUES (?, ?, 'bubble_segmentation', 'pending', 0, ?, ?)
            """,
            (page["chapter_id"], page_id, now, now),
        )
        job_id = cursor.lastrowid

    original_path = UPLOAD_DIR / page["original_image_path"]
    parent = Path(page["original_image_path"]).parent
    preview_relative_path = (parent / f"bubble_preview_{uuid4().hex}.png").as_posix()
    analysis_relative_path = (parent / f"bubble_analysis_{uuid4().hex}.json").as_posix()
    background_tasks.add_task(
        run_bubble_segmentation_job,
        job_id,
        page_id,
        original_path,
        UPLOAD_DIR / preview_relative_path,
        preview_relative_path,
        UPLOAD_DIR / analysis_relative_path,
        analysis_relative_path,
    )
    return {"job_id": job_id, "status": "pending", "stage": "bubble_segmentation"}


@app.get("/api/pages/{page_id}/bubble-analysis")
def get_bubble_analysis(page_id: int) -> dict:
    with db_session() as connection:
        page = get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (page_id,), "trang")
    relative_path = page.get("bubble_analysis_path")
    if not relative_path:
        raise HTTPException(status_code=404, detail="Trang chưa có kết quả phân tích bong bóng thoại")
    analysis_path = UPLOAD_DIR / relative_path
    if not analysis_path.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy file phân tích bong bóng thoại")
    return json.loads(analysis_path.read_text(encoding="utf-8"))


@app.post("/api/pages/{page_id}/typeset")
def auto_typeset_page(page_id: int) -> dict:
    try:
        updated = perform_auto_typeset(page_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"status": "typeset", "count": len(updated), "blocks": updated}


def _map_blocks_to_bubble_regions(rows: list[dict], regions: list[dict]) -> dict[int, dict]:
    """Reconnect stored bubble regions after Editor autosave replaces block IDs."""
    row_ids = {int(row["id"]) for row in rows}
    mapped: dict[int, dict] = {}
    for region in regions:
        for member in region.get("text_blocks", []):
            block_id = int(member["text_block_id"])
            if block_id in row_ids:
                mapped[block_id] = region

    for row in rows:
        row_id = int(row["id"])
        if row_id in mapped:
            continue
        source_x = float(row["source_x"] if row.get("source_x") is not None else row["x"])
        source_y = float(row["source_y"] if row.get("source_y") is not None else row["y"])
        source_width = float(row["source_width"] if row.get("source_width") is not None else row["width"])
        source_height = float(row["source_height"] if row.get("source_height") is not None else row["height"])
        center_x = source_x + source_width / 2
        center_y = source_y + source_height / 2
        source_area = max(1.0, source_width * source_height)
        best: tuple[float, dict] | None = None
        for region in regions:
            rx, ry, rw, rh = (float(value) for value in region["bbox"])
            overlap_width = max(0.0, min(source_x + source_width, rx + rw) - max(source_x, rx))
            overlap_height = max(0.0, min(source_y + source_height, ry + rh) - max(source_y, ry))
            overlap = overlap_width * overlap_height / source_area
            center_inside = rx <= center_x <= rx + rw and ry <= center_y <= ry + rh
            if not center_inside and overlap < 0.12:
                continue
            score = overlap + (1.0 if center_inside else 0.0)
            candidate = (score, region)
            if best is None or candidate[0] > best[0]:
                best = candidate
        if best is not None:
            mapped[row_id] = best[1]
    return mapped


def perform_auto_typeset(page_id: int) -> list[dict]:
    now = utc_now()
    updated: list[dict] = []
    with db_session() as connection:
        page = get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (page_id,), "trang")
        rows = connection.execute(
            """SELECT * FROM text_blocks
               WHERE page_id = ? AND COALESCE(render_mode, 'replace') = 'replace'
                 AND COALESCE(translation_mode, 'translate') = 'translate'
               ORDER BY id""", (page_id,)
        ).fetchall()
        rows = [dict(row) for row in rows]
        image_path = UPLOAD_DIR / (page["clean_image_path"] or page["original_image_path"])
        background_image = Image.open(image_path).convert("RGB")
        bubble_regions: dict[int, dict] = {}
        analysis_path = page.get("bubble_analysis_path")
        if analysis_path:
            stored_analysis = UPLOAD_DIR / analysis_path
            if stored_analysis.is_file():
                try:
                    analysis = json.loads(stored_analysis.read_text(encoding="utf-8"))
                    bubble_regions = _map_blocks_to_bubble_regions(
                        rows, analysis.get("regions", [])
                    )
                except (OSError, ValueError, KeyError, TypeError):
                    bubble_regions = {}

        grouped_rows: dict[str, list[dict]] = {}
        for row in rows:
            region = bubble_regions.get(int(row["id"]))
            key = f"bubble:{region['index']}" if region else f"block:{row['id']}"
            grouped_rows.setdefault(key, []).append(row)
        ordered_groups = sorted(
            grouped_rows.values(),
            key=lambda group: min(float(row["y"]) for row in group),
        )
        placed_text_boxes: list[tuple[float, float, float, float]] = []
        for group in ordered_groups:
            # Japanese vertical columns are read from right to left. Placing
            # the right-hand column first preserves that anchor, then the next
            # column is repelled into balanced whitespace instead of crowding it.
            group.sort(
                key=lambda row: float(
                    row["source_x"] if row.get("source_x") is not None else row["x"]
                ),
                reverse=True,
            )
            region = bubble_regions.get(int(group[0]["id"]))
            member_count = len(group)
            container_bounds = None
            source_cells: dict[int, tuple[float, float, float, float]] = {}
            if region is not None and member_count > 1:
                bx, by, bw, bh = (float(value) for value in region["bbox"])
                container_bounds = (bx, by, bx + bw, by + bh)
                source_cells = partition_text_regions_by_source(region["bbox"], group)
            for row in group:
                text = (row["final_translation"] or row["ai_translation"] or "").strip()
                if not text:
                    continue
                anchor_x = float(row["placement_anchor_x"] if row["placement_anchor_x"] is not None else row["x"])
                anchor_y = float(row["placement_anchor_y"] if row["placement_anchor_y"] is not None else row["y"])
                source_cell = source_cells.get(int(row["id"]))
                if source_cell is not None:
                    # The author's Japanese column layout owns the placement.
                    # Fit within that stable cell instead of searching the
                    # whole bubble and allowing neighboring dialogue to swap.
                    source_cell = constrain_cell_to_bubble_interior(
                        background_image, region, source_cell
                    )
                    placed_x, placed_y, target_width, target_height = source_cell
                    layout = fit_text_layout(
                        text, target_width, target_height, row["font_family"],
                        maximum_size=max(12, min(48, round(min(target_width, target_height) * 0.32))),
                    )
                    collision_score = 0.0
                else:
                    target_width, target_height = float(row["width"]), float(row["height"])
                    layout, placed_x, placed_y, collision_score = place_text_in_clear_area(
                        background_image,
                        text,
                        anchor_x,
                        anchor_y,
                        target_width,
                        target_height,
                        row["font_family"],
                        row["text_align"],
                        tuple(placed_text_boxes),
                        3.0,
                        container_bounds,
                    )
                placed_text_boxes.append(
                    text_layout_bounds(
                        layout, placed_x, placed_y, target_width,
                        target_height, row["text_align"],
                    )
                )
                font_size = layout.font_size
                color = suggest_text_color(
                    background_image,
                    placed_x,
                    placed_y,
                    target_width,
                    target_height,
                )
                connection.execute(
                    """UPDATE text_blocks
                       SET x = ?, y = ?, width = ?, height = ?, font_size = ?, color = ?, text_offset_y = 0,
                           placement_anchor_x = ?, placement_anchor_y = ?, updated_at = ?
                       WHERE id = ?""",
                    (placed_x, placed_y, target_width, target_height, font_size, color,
                     anchor_x, anchor_y, now, row["id"]),
                )
                updated.append({
                    "id": row["id"], "font_size": font_size, "color": color,
                    "x": round(placed_x, 2), "y": round(placed_y, 2),
                    "width": round(target_width, 2), "height": round(target_height, 2),
                    "collision_score": round(collision_score, 3),
                })
        background_image.close()
    if not updated:
        raise RuntimeError("Trang chưa có bản dịch để tự căn chữ")
    return updated


def _set_pipeline_step(job_id: int, step: str, progress: float) -> None:
    with db_session() as connection:
        connection.execute(
            """
            UPDATE processing_jobs
            SET status = 'processing', current_step = ?, progress = ?,
                error_message = NULL, updated_at = ?
            WHERE id = ?
            """,
            (step, progress, utc_now(), job_id),
        )


def _ensure_pipeline_stage_succeeded(job_id: int, label: str) -> None:
    with db_session() as connection:
        row = connection.execute(
            "SELECT status, error_message FROM processing_jobs WHERE id = ?", (job_id,)
        ).fetchone()
    if row is None:
        raise RuntimeError(f"{label}: không tìm thấy tác vụ")
    if row["status"] == "failed":
        raise RuntimeError(f"{label}: {row['error_message'] or 'xử lý thất bại'}")


def _count_text_blocks(page_id: int) -> int:
    with db_session() as connection:
        return int(connection.execute(
            "SELECT COUNT(*) FROM text_blocks WHERE page_id = ?", (page_id,)
        ).fetchone()[0])


def _complete_no_dialogue_page(job_id: int, page_id: int) -> dict:
    now = utc_now()
    with db_session() as connection:
        page = dict(connection.execute("SELECT * FROM pages WHERE id = ?", (page_id,)).fetchone())
        clean_path = page.get("clean_image_path") or page["original_image_path"]
        connection.execute(
            """UPDATE pages
               SET status = 'ready', clean_image_path = ?, updated_at = ?
               WHERE id = ?""",
            (clean_path, now, page_id),
        )
        connection.execute(
            """UPDATE processing_jobs
               SET status = 'completed', current_step = 'Không phát hiện chữ · cần admin kiểm tra',
                   progress = 1, result_count = 0, error_message = NULL, updated_at = ?
               WHERE id = ?""",
            (now, job_id),
        )
    return evaluate_page_quality(page_id, check_clean_ocr=False)


def run_full_pipeline_job(
    job_id: int,
    page_id: int,
    original_path: Path,
    replace_existing: bool,
    bubble_preview_destination: Path,
    bubble_preview_relative_path: str,
    bubble_analysis_destination: Path,
    bubble_analysis_relative_path: str,
    clean_destination: Path,
    clean_relative_path: str,
    mask_destination: Path,
    mask_relative_path: str,
) -> None:
    try:
        with db_session() as connection:
            existing_count = connection.execute(
                "SELECT COUNT(*) FROM text_blocks WHERE page_id = ?", (page_id,)
            ).fetchone()[0]

        if replace_existing or not existing_count:
            _set_pipeline_step(job_id, "OCR", 0.05)
            run_ocr_job(job_id, page_id, original_path, replace_existing)
            _ensure_pipeline_stage_succeeded(job_id, "OCR")

        # A page without OCR text is a valid manga page (art, transition or
        # SFX-only), not a failed balloon-segmentation job.
        if _count_text_blocks(page_id) == 0:
            quality = _complete_no_dialogue_page(job_id, page_id)
            with db_session() as connection:
                page_info = dict(connection.execute(
                    "SELECT p.chapter_id, c.manga_id FROM pages p JOIN chapters c ON c.id = p.chapter_id WHERE p.id = ?",
                    (page_id,),
                ).fetchone())
            record_activity("pipeline", "Không tìm thấy TextBlock · cần xem trang tranh/SFX",
                            manga_id=page_info["manga_id"], chapter_id=page_info["chapter_id"],
                            page_id=page_id, details=quality)
            return

        _set_pipeline_step(job_id, "Phân tích bóng thoại", 0.25)
        run_bubble_segmentation_job(
            job_id,
            page_id,
            original_path,
            bubble_preview_destination,
            bubble_preview_relative_path,
            bubble_analysis_destination,
            bubble_analysis_relative_path,
        )
        _ensure_pipeline_stage_succeeded(job_id, "Phân tích bóng thoại")

        with db_session() as connection:
            needs_translation = bool(connection.execute(
                """SELECT 1 FROM text_blocks
                   WHERE page_id = ? AND COALESCE(translation_mode, 'translate') = 'translate'
                     AND TRIM(original_text) <> ''
                     AND TRIM(COALESCE(final_translation, ai_translation, '')) = ''
                   LIMIT 1""",
                (page_id,),
            ).fetchone())
        if needs_translation:
            _set_pipeline_step(job_id, "Dịch Nhật - Việt", 0.45)
            run_translation_job(job_id, page_id)
            _ensure_pipeline_stage_succeeded(job_id, "Dịch Nhật - Việt")

        _set_pipeline_step(job_id, "Xóa chữ Nhật", 0.65)
        run_inpainting_job(
            job_id,
            page_id,
            original_path,
            clean_destination,
            clean_relative_path,
            mask_destination,
            mask_relative_path,
        )
        _ensure_pipeline_stage_succeeded(job_id, "Xóa chữ Nhật")

        with db_session() as connection:
            has_renderable_translation = bool(connection.execute(
                """SELECT 1 FROM text_blocks
                   WHERE page_id = ? AND COALESCE(render_mode, 'replace') = 'replace'
                     AND COALESCE(translation_mode, 'translate') = 'translate'
                     AND TRIM(COALESCE(final_translation, ai_translation, '')) <> ''
                   LIMIT 1""",
                (page_id,),
            ).fetchone())
        if has_renderable_translation:
            _set_pipeline_step(job_id, "Tự căn chữ", 0.85)
            updated = perform_auto_typeset(page_id)
        else:
            updated = []
        now = utc_now()
        with db_session() as connection:
            connection.execute(
                """
                UPDATE processing_jobs
                SET status = 'completed', current_step = 'Hoàn tất', progress = 1,
                    result_count = ?, error_message = NULL, updated_at = ?
                WHERE id = ?
                """,
                (len(updated), now, job_id),
            )
            connection.execute(
                "UPDATE pages SET status = 'ready', updated_at = ? WHERE id = ?",
                (now, page_id),
            )
        quality = evaluate_page_quality(page_id)
        with db_session() as connection:
            page_info = dict(connection.execute(
                "SELECT p.chapter_id, c.manga_id FROM pages p JOIN chapters c ON c.id = p.chapter_id WHERE p.id = ?",
                (page_id,),
            ).fetchone())
        record_activity("pipeline", f"Xử lý trang hoàn tất · QA {quality['status']}",
                        manga_id=page_info["manga_id"], chapter_id=page_info["chapter_id"],
                        page_id=page_id, details=quality)
    except Exception as exc:
        message = str(exc).strip() or exc.__class__.__name__
        with db_session() as connection:
            connection.execute(
                """
                UPDATE processing_jobs
                SET status = 'failed', error_message = ?, updated_at = ?
                WHERE id = ?
                """,
                (message[:1000], utc_now(), job_id),
            )
            connection.execute(
                "UPDATE pages SET status = 'failed', qa_status = 'error', qa_issues_json = ?, last_processed_at = ?, updated_at = ? WHERE id = ?",
                (json.dumps([{"severity": "error", "code": "pipeline_failed", "message": message[:500]}], ensure_ascii=False),
                 utc_now(), utc_now(), page_id),
            )


@app.post("/api/pages/{page_id}/pipeline", status_code=202)
def start_full_pipeline(
    page_id: int,
    payload: PipelineRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    now = utc_now()
    with db_session() as connection:
        page = get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (page_id,), "trang")
        original_path = UPLOAD_DIR / page["original_image_path"]
        if not original_path.is_file():
            raise HTTPException(status_code=409, detail="Không tìm thấy ảnh gốc của trang")
        active_job = connection.execute(
            """
            SELECT id FROM processing_jobs
            WHERE page_id = ? AND stage = 'full_pipeline' AND status IN ('pending', 'processing')
            ORDER BY id DESC LIMIT 1
            """,
            (page_id,),
        ).fetchone()
        if active_job:
            raise HTTPException(status_code=409, detail="Trang này đang được xử lý toàn bộ")
        cursor = connection.execute(
            """
            INSERT INTO processing_jobs (
                chapter_id, page_id, stage, status, progress, current_step, created_at, updated_at
            ) VALUES (?, ?, 'full_pipeline', 'pending', 0, 'Chuẩn bị', ?, ?)
            """,
            (page["chapter_id"], page_id, now, now),
        )
        job_id = cursor.lastrowid
        connection.execute(
            """UPDATE pages
               SET status = 'processing', editorial_decision = 'auto',
                   editorial_note = '', editorial_decision_at = NULL, updated_at = ?
               WHERE id = ?""",
            (now, page_id),
        )

    parent = Path(page["original_image_path"]).parent
    bubble_preview_relative = (parent / f"bubble_preview_{uuid4().hex}.png").as_posix()
    bubble_analysis_relative = (parent / f"bubble_analysis_{uuid4().hex}.json").as_posix()
    clean_relative = (parent / f"auto_clean_{uuid4().hex}.png").as_posix()
    mask_relative = (parent / f"mask_preview_{uuid4().hex}.png").as_posix()
    background_tasks.add_task(
        run_full_pipeline_job,
        job_id,
        page_id,
        original_path,
        payload.replace_existing,
        UPLOAD_DIR / bubble_preview_relative,
        bubble_preview_relative,
        UPLOAD_DIR / bubble_analysis_relative,
        bubble_analysis_relative,
        UPLOAD_DIR / clean_relative,
        clean_relative,
        UPLOAD_DIR / mask_relative,
        mask_relative,
    )
    return {"job_id": job_id, "status": "pending", "stage": "full_pipeline"}


def _run_chapter_pipeline_job(job_id: int, chapter_id: int) -> None:
    with db_session() as connection:
        items = [dict(row) for row in connection.execute(
            "SELECT * FROM batch_job_pages WHERE job_id = ? ORDER BY position", (job_id,)
        ).fetchall()]
        connection.execute(
            "UPDATE processing_jobs SET status = 'processing', current_step = 'Chuẩn bị', progress = 0, updated_at = ? WHERE id = ?",
            (utc_now(), job_id),
        )
    completed = warnings = failed = 0
    for index, item in enumerate(items, start=1):
        page_id = int(item["page_id"])
        try:
            with db_session() as connection:
                page = dict(connection.execute("SELECT * FROM pages WHERE id = ?", (page_id,)).fetchone())
                existing_count = connection.execute(
                    "SELECT COUNT(*) FROM text_blocks WHERE page_id = ?", (page_id,)
                ).fetchone()[0]
                now = utc_now()
                child = connection.execute(
                    """INSERT INTO processing_jobs
                       (chapter_id, page_id, stage, status, progress, current_step, created_at, updated_at)
                       VALUES (?, ?, 'full_pipeline', 'pending', 0, 'Chuẩn bị', ?, ?)""",
                    (chapter_id, page_id, now, now),
                ).lastrowid
                connection.execute(
                    "UPDATE batch_job_pages SET status = 'processing', child_job_id = ?, updated_at = ? WHERE id = ?",
                    (child, now, item["id"]),
                )
                connection.execute(
                    """UPDATE pages
                       SET status = 'processing', editorial_decision = 'auto',
                           editorial_note = '', editorial_decision_at = NULL, updated_at = ?
                       WHERE id = ?""",
                    (now, page_id),
                )
                connection.execute(
                    "UPDATE processing_jobs SET current_step = ?, progress = ?, updated_at = ? WHERE id = ?",
                    (f"Trang {page['page_number']}", (index - 1) / max(1, len(items)), now, job_id),
                )

            parent = Path(page["original_image_path"]).parent
            bubble_preview_relative = (parent / f"bubble_preview_{uuid4().hex}.png").as_posix()
            bubble_analysis_relative = (parent / f"bubble_analysis_{uuid4().hex}.json").as_posix()
            clean_relative = (parent / f"auto_clean_{uuid4().hex}.png").as_posix()
            mask_relative = (parent / f"mask_preview_{uuid4().hex}.png").as_posix()
            run_full_pipeline_job(
                child, page_id, UPLOAD_DIR / page["original_image_path"], bool(existing_count),
                UPLOAD_DIR / bubble_preview_relative, bubble_preview_relative,
                UPLOAD_DIR / bubble_analysis_relative, bubble_analysis_relative,
                UPLOAD_DIR / clean_relative, clean_relative,
                UPLOAD_DIR / mask_relative, mask_relative,
            )
            with db_session() as connection:
                child_row = connection.execute("SELECT status, error_message FROM processing_jobs WHERE id = ?", (child,)).fetchone()
                page_row = connection.execute("SELECT qa_status FROM pages WHERE id = ?", (page_id,)).fetchone()
                if child_row["status"] == "failed":
                    item_status = "failed"
                    failed += 1
                    error_message = child_row["error_message"]
                elif page_row["qa_status"] == "warning":
                    item_status = "warning"
                    warnings += 1
                    error_message = None
                elif page_row["qa_status"] == "error":
                    item_status = "failed"
                    failed += 1
                    error_message = "Kiểm tra chất lượng không đạt"
                else:
                    item_status = "completed"
                    completed += 1
                    error_message = None
                connection.execute(
                    "UPDATE batch_job_pages SET status = ?, error_message = ?, updated_at = ? WHERE id = ?",
                    (item_status, error_message, utc_now(), item["id"]),
                )
        except Exception as exc:
            failed += 1
            with db_session() as connection:
                connection.execute(
                    "UPDATE batch_job_pages SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?",
                    (str(exc)[:1000], utc_now(), item["id"]),
                )
        with db_session() as connection:
            connection.execute(
                "UPDATE processing_jobs SET progress = ?, result_count = ?, updated_at = ? WHERE id = ?",
                (index / max(1, len(items)), completed, utc_now(), job_id),
            )

    final_status = "completed" if completed or warnings or not items else "failed"
    summary = f"Hoàn tất {completed} · cảnh báo {warnings} · lỗi {failed}"
    with db_session() as connection:
        connection.execute(
            "UPDATE processing_jobs SET status = ?, progress = 1, current_step = ?, result_count = ?, error_message = ?, updated_at = ? WHERE id = ?",
            (final_status, summary, completed, None if final_status == "completed" else summary, utc_now(), job_id),
        )
        chapter = dict(connection.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone())
    record_activity("chapter_pipeline", summary, manga_id=chapter["manga_id"], chapter_id=chapter_id,
                    details={"completed": completed, "warnings": warnings, "failed": failed})


@app.post("/api/chapters/{chapter_id}/pipeline", status_code=202)
def start_chapter_pipeline(chapter_id: int, payload: ChapterPipelineRequest, background_tasks: BackgroundTasks) -> dict:
    now = utc_now()
    with db_session() as connection:
        chapter = get_or_404(connection, "SELECT * FROM chapters WHERE id = ?", (chapter_id,), "chapter")
        active = connection.execute(
            "SELECT id FROM processing_jobs WHERE chapter_id = ? AND stage = 'chapter_pipeline' AND status IN ('pending','processing')",
            (chapter_id,),
        ).fetchone()
        if active:
            raise HTTPException(status_code=409, detail="Chapter này đang được xử lý")
        pages = [dict(row) for row in connection.execute(
            """
            SELECT p.*, COUNT(tb.id) AS block_count,
                   SUM(CASE WHEN COALESCE(tb.render_mode, 'replace') = 'replace'
                                 AND COALESCE(tb.translation_mode, 'translate') = 'translate'
                            THEN 1 ELSE 0 END) AS replace_count
            FROM pages p LEFT JOIN text_blocks tb ON tb.page_id = p.id
            WHERE p.chapter_id = ? AND p.review_status <> 'approved'
            GROUP BY p.id ORDER BY p.page_number
            """,
            (chapter_id,),
        ).fetchall()]
        targets = [
            page for page in pages
            if page["status"] in {"uploaded", "failed"}
            or not page.get("qa_status")
            or page.get("qa_status") in {"unknown", "error"}
            or (page.get("qa_status") == "warning" and not bool(page.get("qa_overridden")))
            or (bool(page.get("replace_count")) and not page.get("clean_image_path"))
        ]
        if not targets:
            raise HTTPException(status_code=409, detail="Không có trang mới hoặc trang lỗi cần xử lý")
        job_id = connection.execute(
            """INSERT INTO processing_jobs
               (chapter_id, stage, status, progress, current_step, created_at, updated_at)
               VALUES (?, 'chapter_pipeline', 'pending', 0, 'Xếp hàng', ?, ?)""",
            (chapter_id, now, now),
        ).lastrowid
        for position, page in enumerate(targets, start=1):
            connection.execute(
                "INSERT INTO batch_job_pages (job_id, page_id, position, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)",
                (job_id, page["id"], position, now, now),
            )
    background_tasks.add_task(_run_chapter_pipeline_job, job_id, chapter_id)
    return {"job_id": job_id, "status": "pending", "page_count": len(targets), "manga_id": chapter["manga_id"]}


@app.get("/api/pages/{page_id}/export.png")
def export_translated_page(page_id: int) -> StreamingResponse:
    with db_session() as connection:
        page = get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (page_id,), "trang")
        blocks = [
            dict(row)
            for row in connection.execute(
                "SELECT * FROM text_blocks WHERE page_id = ? ORDER BY id", (page_id,)
            ).fetchall()
        ]
    has_translation = any((block["final_translation"] or block["ai_translation"]).strip() for block in blocks)
    if not has_translation and page.get("editorial_decision") != "preserve_sfx":
        raise HTTPException(status_code=409, detail="Trang chưa có bản dịch để xuất")
    image_path = UPLOAD_DIR / (page["clean_image_path"] or page["original_image_path"])
    if not image_path.is_file():
        raise HTTPException(status_code=409, detail="Không tìm thấy ảnh nền để xuất")
    rendered = render_translated_page(image_path, blocks)
    output = io.BytesIO()
    rendered.save(output, format="PNG", optimize=True)
    output.seek(0)
    headers = {"Content-Disposition": f'attachment; filename="page-{page_id}-translated.png"'}
    return StreamingResponse(output, media_type="image/png", headers=headers)


@app.post("/api/pages/{page_id}/clean-image")
async def upload_clean_image(page_id: int, file: UploadFile = File(...)) -> dict:
    extension = ALLOWED_IMAGE_TYPES.get(file.content_type or "")
    if extension is None:
        raise HTTPException(status_code=415, detail="Chỉ hỗ trợ JPG, PNG hoặc WebP")
    with db_session() as connection:
        page = get_or_404(connection, "SELECT * FROM pages WHERE id = ?", (page_id,), "trang")

    destination = UPLOAD_DIR / Path(page["original_image_path"]).parent / f"clean_{uuid4().hex}{extension}"
    try:
        with destination.open("wb") as target:
            shutil.copyfileobj(file.file, target)
        with Image.open(destination) as image:
            image.verify()
        with Image.open(destination) as image:
            if image.size != (page["width"], page["height"]):
                raise HTTPException(status_code=422, detail="Ảnh sạch phải cùng kích thước với ảnh gốc")
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    relative_path = destination.relative_to(UPLOAD_DIR).as_posix()
    with db_session() as connection:
        connection.execute(
            "UPDATE pages SET clean_image_path = ?, updated_at = ? WHERE id = ?",
            (relative_path, utc_now(), page_id),
        )
    return {"status": "saved", "clean_image_url": f"/uploads/{relative_path}"}


@app.post("/api/pages/{page_id}/quality-check")
def check_page_quality(page_id: int) -> dict:
    with db_session() as connection:
        get_or_404(connection, "SELECT id FROM pages WHERE id = ?", (page_id,), "trang")
    return evaluate_page_quality(page_id)


@app.get("/api/history")
def get_history() -> list[dict]:
    prune_history()
    cutoff = (datetime.now(UTC) - timedelta(days=7)).isoformat()
    with db_session() as connection:
        rows = connection.execute(
            """SELECT h.*, m.title AS manga_title, c.chapter_number, p.page_number
               FROM activity_history h
               LEFT JOIN manga m ON m.id = h.manga_id
               LEFT JOIN chapters c ON c.id = h.chapter_id
               LEFT JOIN pages p ON p.id = h.page_id
               WHERE h.created_at >= ? ORDER BY h.created_at DESC, h.id DESC""",
            (cutoff,),
        ).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        try:
            item["details"] = json.loads(item.pop("details_json") or "{}")
        except json.JSONDecodeError:
            item["details"] = {}
        result.append(item)
    return result


def _build_study_snapshot(chapter_id: int, progress_callback=None) -> tuple[dict, Path]:
    with db_session() as connection:
        chapter = get_or_404(
            connection,
            """SELECT c.*, m.title AS manga_title, m.author
               FROM chapters c JOIN manga m ON m.id = c.manga_id WHERE c.id = ?""",
            (chapter_id,), "chapter",
        )
        if chapter["status"] != "completed":
            raise HTTPException(status_code=409, detail="Phải xác nhận chapter hoàn thành trước khi xuất bản")
        pages = [dict(row) for row in connection.execute(
            "SELECT * FROM pages WHERE chapter_id = ? ORDER BY page_number", (chapter_id,)
        ).fetchall()]
        if not pages or any(page["review_status"] != "approved" for page in pages):
            raise HTTPException(status_code=409, detail="Mọi trang phải được xác nhận đạt trước khi xuất bản")
        existing = connection.execute(
            "SELECT revision FROM study_publications WHERE chapter_id = ?", (chapter_id,)
        ).fetchone()
        revision = int(existing["revision"]) + 1 if existing else 1

    temp_dir = STUDY_ASSET_DIR / f".tmp-{chapter_id}-{uuid4().hex}"
    final_dir = STUDY_ASSET_DIR / str(chapter_id) / str(revision)
    temp_dir.mkdir(parents=True, exist_ok=False)
    snapshot = {
        "chapter_id": chapter_id, "manga_id": chapter["manga_id"],
        "manga_title": chapter["manga_title"], "author": chapter["author"],
        "chapter_number": chapter["chapter_number"], "chapter_title": chapter["title"],
        "revision": revision, "pages": [],
    }
    try:
        for page_index, page in enumerate(pages, start=1):
            if progress_callback:
                progress_callback(page_index, len(pages), "render", 0, 0)
            with db_session() as connection:
                blocks = [dict(row) for row in connection.execute(
                    "SELECT * FROM text_blocks WHERE page_id = ? ORDER BY id", (page["id"],)
                ).fetchall()]
            original_source = UPLOAD_DIR / page["original_image_path"]
            clean_source = UPLOAD_DIR / (page["clean_image_path"] or page["original_image_path"])
            original_name = f"page-{page['page_number']}-original{original_source.suffix.lower()}"
            translated_name = f"page-{page['page_number']}-translated.png"
            shutil.copy2(original_source, temp_dir / original_name)
            render_translated_page(clean_source, blocks).save(temp_dir / translated_name, format="PNG")
            analysis_inputs = []
            analysis_block_indexes = []
            for block_index, block in enumerate(blocks):
                source_text = str(block.get("original_text") or "").strip()
                if source_text:
                    translation = str(block.get("final_translation") or block.get("ai_translation") or "").strip()
                    analysis_inputs.append((source_text, translation))
                    analysis_block_indexes.append(block_index)
            analyses = analyze_sentences(
                analysis_inputs,
                progress_callback=(
                    lambda done, total, pi=page_index, pt=len(pages):
                    progress_callback(pi, pt, "analysis", done, total)
                ) if progress_callback else None,
            ) if analysis_inputs else []
            analysis_by_block = dict(zip(analysis_block_indexes, analyses))
            published_blocks = []
            for block_index, block in enumerate(blocks):
                source_text = str(block.get("original_text") or "").strip()
                translation = str(block.get("final_translation") or block.get("ai_translation") or "").strip()
                analysis = analysis_by_block.get(block_index, {"tokens": [], "grammar": []})
                published_blocks.append({
                    "id": block["id"],
                    "x": block.get("source_x") if block.get("source_x") is not None else block["x"],
                    "y": block.get("source_y") if block.get("source_y") is not None else block["y"],
                    "width": block.get("source_width") if block.get("source_width") is not None else block["width"],
                    "height": block.get("source_height") if block.get("source_height") is not None else block["height"],
                    "original_text": source_text, "translation": translation, "analysis": analysis,
                    "text_kind": block.get("text_kind") or "dialogue",
                    "render_mode": block.get("render_mode") or "replace",
                })
            snapshot["pages"].append({
                "id": page["id"], "page_number": page["page_number"],
                "width": page["width"], "height": page["height"],
                "original_image_url": f"/study-assets/{chapter_id}/{revision}/{original_name}",
                "translated_image_url": f"/study-assets/{chapter_id}/{revision}/{translated_name}",
                "editorial_decision": page.get("editorial_decision") or "auto",
                "editorial_note": page.get("editorial_note") or "",
                "blocks": published_blocks,
            })
        final_dir.parent.mkdir(parents=True, exist_ok=True)
        temp_dir.replace(final_dir)
        return snapshot, final_dir
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise


def _run_publish_job(job_id: int, chapter_id: int) -> None:
    final_dir = None
    for stale in STUDY_ASSET_DIR.glob(f".tmp-{chapter_id}-*"):
        if stale.is_dir():
            shutil.rmtree(stale, ignore_errors=True)

    def update_progress(page_index: int, page_total: int, stage: str, done: int, total: int) -> None:
        if stage == "render":
            label = f"Trang {page_index}/{page_total} · tạo ảnh"
            page_fraction = 0.08
        else:
            label = f"Trang {page_index}/{page_total} · phân tích {done}/{total or done} câu"
            page_fraction = 0.1 + (0.85 * done / max(1, total))
        progress = min(0.98, ((page_index - 1) + page_fraction) / max(1, page_total))
        with db_session() as connection:
            connection.execute(
                "UPDATE processing_jobs SET status = 'processing', current_step = ?, progress = ?, updated_at = ? WHERE id = ?",
                (label, progress, utc_now(), job_id),
            )

    try:
        snapshot, final_dir = _build_study_snapshot(chapter_id, update_progress)
        now = utc_now()
        with db_session() as connection:
            chapter = get_or_404(connection, "SELECT * FROM chapters WHERE id = ?", (chapter_id,), "chapter")
            existing = connection.execute("SELECT id FROM study_publications WHERE chapter_id = ?", (chapter_id,)).fetchone()
            if existing:
                connection.execute(
                    "UPDATE study_publications SET revision = ?, snapshot_json = ?, updated_at = ? WHERE chapter_id = ?",
                    (snapshot["revision"], json.dumps(snapshot, ensure_ascii=False), now, chapter_id),
                )
            else:
                connection.execute(
                    "INSERT INTO study_publications (manga_id, chapter_id, revision, snapshot_json, published_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (chapter["manga_id"], chapter_id, snapshot["revision"], json.dumps(snapshot, ensure_ascii=False), now, now),
                )
            connection.execute(
                "UPDATE chapters SET publication_status = 'published', published_at = ?, updated_at = ? WHERE id = ?",
                (now, now, chapter_id),
            )
            connection.execute(
                "UPDATE processing_jobs SET status = 'completed', progress = 1, current_step = 'Đã xuất bản', result_count = ?, updated_at = ? WHERE id = ?",
                (len(snapshot["pages"]), now, job_id),
            )
        record_activity("publish", f"Xuất bản Study revision {snapshot['revision']}",
                        manga_id=snapshot["manga_id"], chapter_id=chapter_id,
                        details={"revision": snapshot["revision"], "page_count": len(snapshot["pages"])})
    except Exception as exc:
        if final_dir is not None:
            shutil.rmtree(final_dir, ignore_errors=True)
        message = str(exc).strip() or exc.__class__.__name__
        with db_session() as connection:
            has_publication = connection.execute(
                "SELECT 1 FROM study_publications WHERE chapter_id = ?", (chapter_id,)
            ).fetchone() is not None
            connection.execute(
                "UPDATE chapters SET publication_status = ?, updated_at = ? WHERE id = ?",
                ("published" if has_publication else "draft", utc_now(), chapter_id),
            )
            connection.execute(
                "UPDATE processing_jobs SET status = 'failed', error_message = ?, current_step = 'Xuất bản thất bại', updated_at = ? WHERE id = ?",
                (message[:1000], utc_now(), job_id),
            )


@app.post("/api/chapters/{chapter_id}/publish", status_code=202)
def publish_chapter(chapter_id: int, background_tasks: BackgroundTasks) -> dict:
    now = utc_now()
    with db_session() as connection:
        chapter = get_or_404(connection, "SELECT * FROM chapters WHERE id = ?", (chapter_id,), "chapter")
        if chapter["status"] != "completed":
            raise HTTPException(status_code=409, detail="Phải xác nhận chapter hoàn thành trước khi xuất bản")
        page_rows = connection.execute(
            "SELECT review_status FROM pages WHERE chapter_id = ?", (chapter_id,)
        ).fetchall()
        if not page_rows or any(row["review_status"] != "approved" for row in page_rows):
            raise HTTPException(status_code=409, detail="Mọi trang phải được xác nhận đạt trước khi xuất bản")
        active = connection.execute(
            "SELECT id FROM processing_jobs WHERE chapter_id = ? AND stage = 'study_publish' AND status IN ('pending','processing') ORDER BY id DESC LIMIT 1",
            (chapter_id,),
        ).fetchone()
        if active:
            return {"job_id": active["id"], "status": "processing", "chapter_id": chapter_id}
        job_id = connection.execute(
            """INSERT INTO processing_jobs
               (chapter_id, stage, status, progress, current_step, created_at, updated_at)
               VALUES (?, 'study_publish', 'pending', 0, 'Xếp hàng xuất bản', ?, ?)""",
            (chapter_id, now, now),
        ).lastrowid
        connection.execute(
            "UPDATE chapters SET publication_status = 'publishing', updated_at = ? WHERE id = ?",
            (now, chapter_id),
        )
    background_tasks.add_task(_run_publish_job, job_id, chapter_id)
    return {"job_id": job_id, "status": "pending", "chapter_id": chapter_id}


@app.delete("/api/chapters/{chapter_id}/publish")
def unpublish_chapter(chapter_id: int) -> dict:
    with db_session() as connection:
        chapter = get_or_404(connection, "SELECT * FROM chapters WHERE id = ?", (chapter_id,), "chapter")
        connection.execute("DELETE FROM study_publications WHERE chapter_id = ?", (chapter_id,))
        connection.execute(
            "UPDATE chapters SET publication_status = 'draft', published_at = NULL, updated_at = ? WHERE id = ?",
            (utc_now(), chapter_id),
        )
    record_activity("unpublish", "Gỡ chapter khỏi Study", manga_id=chapter["manga_id"], chapter_id=chapter_id)
    return {"status": "unpublished", "chapter_id": chapter_id}


@app.get("/api/study")
def get_study_library() -> list[dict]:
    with db_session() as connection:
        rows = connection.execute(
            """SELECT sp.*, m.title AS manga_title, m.author, m.description, m.tags,
                      c.chapter_number, c.title AS chapter_title
               FROM study_publications sp
               JOIN manga m ON m.id = sp.manga_id JOIN chapters c ON c.id = sp.chapter_id
               ORDER BY sp.updated_at DESC, sp.id DESC"""
        ).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        snapshot = json.loads(item.pop("snapshot_json"))
        item["page_count"] = len(snapshot.get("pages", []))
        item["cover_url"] = snapshot["pages"][0]["original_image_url"] if snapshot.get("pages") else None
        result.append(item)
    return result


@app.get("/api/study/chapters/{chapter_id}")
def get_study_chapter(chapter_id: int) -> dict:
    with db_session() as connection:
        row = connection.execute(
            "SELECT snapshot_json, published_at, updated_at FROM study_publications WHERE chapter_id = ?", (chapter_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Chapter chưa được xuất bản sang Study")
    snapshot = json.loads(row["snapshot_json"])
    snapshot["published_at"] = row["published_at"]
    snapshot["updated_at"] = row["updated_at"]
    return snapshot


def _insert_media_source(
    connection: sqlite3.Connection,
    *,
    source_type: str,
    external_id: str | None,
    title: str,
    source_url: str,
    language: str,
    segments: list,
) -> int:
    now = utc_now()
    source_id = connection.execute(
        """INSERT INTO media_sources
           (source_type, external_id, title, source_url, language, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (source_type, external_id, title.strip(), source_url.strip(), language.strip(), now, now),
    ).lastrowid
    connection.executemany(
        """INSERT INTO media_segments
           (media_source_id, position, start_time, duration, source_text, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                source_id,
                position,
                float(getattr(segment, "start", 0)),
                float(getattr(segment, "duration", 0)),
                str(getattr(segment, "text", "")).strip(),
                now,
                now,
            )
            for position, segment in enumerate(segments, start=1)
            if str(getattr(segment, "text", "")).strip()
        ],
    )
    return int(source_id)


def _get_media_source(connection: sqlite3.Connection, source_id: int) -> dict:
    source = get_or_404(
        connection,
        "SELECT * FROM media_sources WHERE id = ?",
        (source_id,),
        "nguồn media",
    )
    segments = [
        dict(row)
        for row in connection.execute(
            "SELECT * FROM media_segments WHERE media_source_id = ? ORDER BY position",
            (source_id,),
        ).fetchall()
    ]
    for segment in segments:
        try:
            segment["analysis"] = json.loads(segment.pop("analysis_json") or "{}")
        except json.JSONDecodeError:
            segment["analysis"] = {}
    source["segments"] = segments
    source["segment_count"] = len(segments)
    source["analyzed_count"] = sum(bool(item.get("analyzed_at")) for item in segments)
    return source


def _translate_and_analyze_media(text: str, translation: str, context: dict) -> dict:
    translated = translation.strip()
    if not translated:
        provider = get_translation_provider()
        translated = provider.translate(
            [TranslationBlock(id=1, text=text, text_kind="dialogue")],
            context,
        )[1]
    analysis = analyze_sentence(text, translated)
    return {"text": text, "translation": translated, "analysis": analysis}


@app.get("/api/media")
def list_media_sources() -> list[dict]:
    with db_session() as connection:
        rows = connection.execute(
            """SELECT ms.*,
                      COUNT(seg.id) AS segment_count,
                      SUM(CASE WHEN seg.analyzed_at IS NOT NULL THEN 1 ELSE 0 END) AS analyzed_count
               FROM media_sources ms
               LEFT JOIN media_segments seg ON seg.media_source_id = ms.id
               GROUP BY ms.id
               ORDER BY ms.updated_at DESC, ms.id DESC"""
        ).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/media/{source_id}")
def get_media_source(source_id: int) -> dict:
    with db_session() as connection:
        return _get_media_source(connection, source_id)


@app.post("/api/media/import", status_code=201)
def import_media_segments(payload: MediaImportRequest) -> dict:
    title = payload.title.strip() or "Nội dung Nhật chưa đặt tên"
    with db_session() as connection:
        source_id = _insert_media_source(
            connection,
            source_type=payload.source_type,
            external_id=payload.external_id,
            title=title,
            source_url=payload.source_url,
            language=payload.language,
            segments=payload.segments,
        )
        result = _get_media_source(connection, source_id)
    return result


@app.post("/api/media/import-subtitle", status_code=201)
async def import_media_subtitle(
    file: UploadFile = File(...),
    title: str = Form(""),
    source_url: str = Form(""),
) -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".srt", ".vtt"}:
        raise HTTPException(status_code=415, detail="Chỉ hỗ trợ file .srt hoặc .vtt")
    raw = await file.read()
    if not raw or len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File phụ đề trống hoặc lớn hơn 10 MB")
    try:
        cues = parse_subtitle_text(decode_subtitle_bytes(raw))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    with db_session() as connection:
        source_id = _insert_media_source(
            connection,
            source_type="subtitle_file",
            external_id=None,
            title=title.strip() or subtitle_title_from_filename(file.filename or ""),
            source_url=source_url,
            language="ja",
            segments=cues,
        )
        return _get_media_source(connection, source_id)


@app.post("/api/media/youtube", status_code=201)
def import_youtube_media(payload: YoutubeMediaImportRequest) -> dict:
    try:
        video_id, cues = fetch_youtube_subtitles(payload.video_url, payload.language)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    with db_session() as connection:
        source_id = _insert_media_source(
            connection,
            source_type="youtube",
            external_id=video_id,
            title=payload.title.strip() or f"YouTube · {video_id}",
            source_url=payload.video_url,
            language=payload.language,
            segments=cues,
        )
        return _get_media_source(connection, source_id)


@app.post("/api/media/segments/{segment_id}/analyze")
def analyze_media_segment(segment_id: int) -> dict:
    with db_session() as connection:
        row = connection.execute(
            """SELECT seg.*, ms.title AS source_title, ms.source_type, ms.source_url
               FROM media_segments seg JOIN media_sources ms ON ms.id = seg.media_source_id
               WHERE seg.id = ?""",
            (segment_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy câu phụ đề")
        segment = dict(row)
    try:
        result = _translate_and_analyze_media(
            segment["source_text"],
            segment.get("translation") or "",
            {
                "content_type": "subtitle",
                "media_title": segment.get("source_title") or "",
                "source_type": segment.get("source_type") or "",
                "timestamp": segment.get("start_time") or 0,
            },
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    now = utc_now()
    with db_session() as connection:
        connection.execute(
            """UPDATE media_segments
               SET translation = ?, analysis_json = ?, analyzed_at = ?, updated_at = ?
               WHERE id = ?""",
            (
                result["translation"],
                json.dumps(result["analysis"], ensure_ascii=False),
                now,
                now,
                segment_id,
            ),
        )
        connection.execute(
            "UPDATE media_sources SET updated_at = ? WHERE id = ?",
            (now, segment["media_source_id"]),
        )
    return {**segment, **result, "analyzed_at": now}


@app.delete("/api/media/{source_id}")
def delete_media_source(source_id: int) -> dict:
    with db_session() as connection:
        get_or_404(connection, "SELECT id FROM media_sources WHERE id = ?", (source_id,), "nguồn media")
        connection.execute("DELETE FROM media_sources WHERE id = ?", (source_id,))
    return {"status": "deleted", "id": source_id}


@app.post("/api/media/analyze")
def analyze_media_text(payload: MediaAnalyzeRequest) -> dict:
    try:
        return _translate_and_analyze_media(
            payload.text.strip(),
            payload.translation,
            {"content_type": payload.context_type},
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# Compatibility adapter for the Hakkutsu extension from project part 3.
# This path intentionally performs deterministic Sudachi/JMdict analysis only;
# subtitles change every few seconds and must not invoke Qwen continuously.
@app.get("/api/v1/health")
def extension_health() -> dict:
    return {
        "status": "ok",
        "service": "Manga Translator Study Media",
        "version": app.version,
        "javi_analysis": {
            "enabled": JAVI_ANALYSIS_ENABLED,
            "model": JAVI_ANALYSIS_MODEL if JAVI_ANALYSIS_ENABLED else None,
        },
    }


# --- MOCK SRS ENDPOINTS ---
# Added to satisfy the extension's API client and prevent 404s.

@app.post("/api/v1/srs/card")
def add_srs_card(payload: dict) -> dict:
    # payload expects: user_id, word, reading, meaning, sentence
    return {"status": "ok", "id": "mock_card_123", **payload}

@app.post("/api/v1/srs/mine")
def mine_sentence(payload: dict) -> dict:
    return {"status": "ok", **payload}

@app.get("/api/v1/srs/due")
def get_due_cards(user_id: str, limit: int = 50) -> list:
    return []

@app.get("/api/v1/srs/cards")
def get_all_srs_cards(user_id: str) -> list:
    return []

@app.get("/api/v1/srs/stats")
def get_srs_stats(user_id: str) -> dict:
    return {"due": 0, "new": 0, "learning": 0, "graduated": 0}

@app.post("/api/v1/srs/review")
def submit_srs_review(user_id: str, payload: dict) -> dict:
    return {"status": "ok", "card_id": payload.get("card_id"), "quality": payload.get("quality")}


def _extension_analysis_with_srs(text: str, *, include_definitions: bool) -> dict:
    result = extension_analysis(text, include_definitions=include_definitions)
    with db_session() as connection:
        known_words = {
            str(value).strip()
            for row in connection.execute(
                "SELECT lemma, surface, reading FROM vocabulary"
            ).fetchall()
            for value in row
            if str(value or "").strip()
        }
    for token in result.get("tokens", []):
        candidates = {
            str(token.get("surface") or "").strip(),
            str(token.get("dictionary_form") or "").strip(),
            str((token.get("reading") or {}).get("hiragana") or "").strip(),
        }
        token["srs_state"] = (
            "graduated" if any(candidate in known_words for candidate in candidates if candidate)
            else "new"
        )
    return result


@app.post("/api/v1/analyze")
def extension_analyze(payload: MediaAnalyzeRequest) -> dict:
    try:
        return _extension_analysis_with_srs(
            payload.text.strip(),
            include_definitions=payload.include_definitions,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _merge_model_analysis(
    result: dict,
    enriched: dict,
    *,
    dictionary_name: str,
) -> dict:
    enriched_meanings = enriched.get("meanings_vi", [])
    result_tokens = result.get("tokens", [])
    enriched_index = 0
    for token in result_tokens:
        component_count = max(1, len(token.get("components") or []))
        meaning_slice = enriched_meanings[
            enriched_index:enriched_index + component_count
        ]
        enriched_index += component_count
        meaning_vi = next(
            (
                str(item or "").strip()
                for item in meaning_slice
                if str(item or "").strip()
            ),
            "",
        )
        if not meaning_vi and len(result_tokens) == 1:
            meaning_vi = str(enriched.get("translation") or "").strip()
        if meaning_vi:
            token["definitions"] = [
                {"dictionary": dictionary_name, "glosses": [meaning_vi], "pos": []}
            ]
    result["translation"] = enriched.get("translation", "")
    result["grammar_patterns"] = [
        {
            "pattern": str(item.get("pattern") or "").strip(),
            "meaning": str(item.get("explanation_vi") or "").strip(),
            "explanation": str(item.get("explanation_vi") or "").strip(),
            "jlpt_level": None,
        }
        for item in enriched.get("grammar", [])
        if isinstance(item, dict) and item.get("explanation_vi")
    ]
    return result


@app.post("/api/v1/analyze/javi")
def extension_analyze_javi(payload: MediaAnalyzeRequest) -> dict:
    """Fast specialized model; deterministic local analysis until explicitly enabled."""
    text = payload.text.strip()
    try:
        result = _extension_analysis_with_srs(text, include_definitions=True)
        if not JAVI_ANALYSIS_ENABLED:
            result["analysis_engine"] = "sudachi-jmdict"
            return result
        enriched = analyze_phrase_javi(text)
        result = _merge_model_analysis(
            result,
            enriched,
            dictionary_name="Hakkutsu Ja–Vi",
        )
        result["analysis_engine"] = JAVI_ANALYSIS_MODEL
        return result
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/analyze/phrase")
def extension_analyze_phrase(payload: MediaAnalyzeRequest) -> dict:
    """Expensive AI path used only after a learner explicitly selects a phrase."""
    text = payload.text.strip()
    try:
        enriched = analyze_phrase_deep(text)
        result = _extension_analysis_with_srs(text, include_definitions=True)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return _merge_model_analysis(
        result,
        enriched,
        dictionary_name="Hakkutsu Qwen Deep",
    )


@app.post("/api/v1/translate")
def extension_translate_webpage(payload: WebTranslateRequest) -> dict:
    texts = [text.strip() for text in payload.texts]
    if any(not text for text in texts):
        raise HTTPException(status_code=422, detail="Đoạn văn dịch không được để trống")
    if sum(len(text) for text in texts) > 20_000:
        raise HTTPException(status_code=413, detail="Tổng nội dung trang vượt quá 20.000 ký tự")

    blocks = [
        TranslationBlock(id=index, text=text, text_kind="webpage")
        for index, text in enumerate(texts)
    ]
    try:
        translations = translate_blocks_resilient(
            get_translation_provider(),
            blocks,
            {
                "content_type": "webpage",
                "page_url": payload.page_url,
                "page_title": payload.page_title,
            },
            batch_size=10,
            retry_count=2,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "source_language": "ja",
        "target_language": "vi",
        "items": [
            {
                "index": index,
                "source": text,
                "translation": translations[index],
                "tokens": _extension_analysis_with_srs(
                    text, include_definitions=False
                )["tokens"],
            }
            for index, text in enumerate(texts)
        ],
    }


@app.post("/api/v1/subtitles/youtube")
def extension_youtube_subtitles(payload: YoutubeMediaImportRequest) -> dict:
    try:
        result = fetch_youtube_subtitle_result(payload.video_url, payload.language)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "video_id": result.video_id,
        "language": result.language_code,
        "track_name": result.track_name,
        "is_auto_generated": result.is_generated,
        "segments": [
            {"text": cue.text, "start": cue.start, "duration": cue.duration}
            for cue in result.cues
        ],
        "full_text": " ".join(cue.text for cue in result.cues),
    }


@app.get("/api/vocabulary")
def list_vocabulary() -> list[dict]:
    with db_session() as connection:
        return [dict(row) for row in connection.execute(
            "SELECT * FROM vocabulary ORDER BY created_at DESC, id DESC"
        ).fetchall()]


@app.post("/api/vocabulary", status_code=201)
def save_vocabulary(payload: VocabularyCreate) -> dict:
    now = utc_now()
    with db_session() as connection:
        existing = connection.execute(
            "SELECT * FROM vocabulary WHERE lemma = ? AND reading = ?",
            (payload.lemma.strip(), payload.reading.strip()),
        ).fetchone()
        if existing:
            return {**dict(existing), "already_saved": True}
        item_id = connection.execute(
            """INSERT INTO vocabulary
               (lemma, reading, surface, meaning_vi, source_sentence, translation,
                manga_title, chapter_number, page_number, source_kind, source_url,
                source_time, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (payload.lemma.strip(), payload.reading.strip(), payload.surface.strip(),
             payload.meaning_vi.strip(), payload.source_sentence.strip(), payload.translation.strip(),
             payload.manga_title.strip(), payload.chapter_number.strip(), payload.page_number,
             payload.source_kind, payload.source_url.strip(), payload.source_time, now),
        ).lastrowid
        return dict(connection.execute("SELECT * FROM vocabulary WHERE id = ?", (item_id,)).fetchone())


@app.delete("/api/vocabulary/{item_id}")
def delete_vocabulary(item_id: int) -> dict:
    with db_session() as connection:
        item = connection.execute("SELECT id FROM vocabulary WHERE id = ?", (item_id,)).fetchone()
        if item is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy từ đã lưu")
        connection.execute("DELETE FROM vocabulary WHERE id = ?", (item_id,))
    return {"status": "deleted", "id": item_id}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
