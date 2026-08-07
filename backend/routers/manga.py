import sqlite3
import hashlib
import json
from pathlib import Path
from uuid import uuid4
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from backend.config import UPLOAD_DIR
from backend.activity_service import record_activity
from backend.database import db_session, utc_now
from backend.schemas import ChapterCreate, ChapterReviewRequest, ImportCheckRequest, MangaCreate, PageOrderRequest, TextBlockBatch, PageReviewRequest, PageEditorialDecisionRequest, OutsideTextPolicyRequest
from backend.utils import _json_list, _page_workflow_state, _chapter_summaries, _renumber_pages, _delete_upload_files, _library_summaries, get_or_404, natural_filename_key
from backend.quality_service import evaluate_page_quality
from backend.typesetting_service import fit_text_layout, layout_at_size

router = APIRouter()

ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_UPLOAD_SIZE = 20 * 1024 * 1024


# Replace @app with @router
@router.post("/api/manga", status_code=201)
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


@router.get("/api/manga/{manga_id}")
def get_manga(manga_id: int) -> dict:
    with db_session() as connection:
        manga = get_or_404(connection, "SELECT * FROM manga WHERE id = ?", (manga_id,), "manga")
        chapters = _chapter_summaries(connection, manga_id)
    manga["chapters"] = chapters
    return manga


@router.post("/api/manga/{manga_id}/chapters", status_code=201)
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


@router.get("/api/chapters/{chapter_id}")
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


@router.post("/api/chapters/{chapter_id}/import-check")
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


@router.post("/api/chapters/{chapter_id}/review")
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


@router.put("/api/chapters/{chapter_id}/pages/order")
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


@router.delete("/api/pages/{page_id}")
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


@router.delete("/api/chapters/{chapter_id}")
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


@router.post("/api/chapters/{chapter_id}/pages", status_code=201)
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


@router.get("/api/pages/{page_id}")
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


@router.put("/api/pages/{page_id}/text-blocks")
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


@router.post("/api/pages/{page_id}/review")
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


@router.put("/api/pages/{page_id}/editorial-decision")
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


@router.put("/api/pages/{page_id}/outside-text-policy")
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


@router.get("/api/manga")
def list_manga() -> list[dict]:
    with db_session() as connection:
        return _library_summaries(connection)


@router.get("/api/library")
def get_library() -> dict:
    with db_session() as connection:
        items = _library_summaries(connection)
    counts = {key: 0 for key in ("unprocessed", "in_progress", "review", "completed")}
    for item in items:
        counts[item["library_state"]] += 1
    return {"items": items, "counts": counts, "total": len(items)}


