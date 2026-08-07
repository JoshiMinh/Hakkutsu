import sqlite3
from fastapi import UploadFile, File, Form
from backend.translation_service import get_translation_provider, TranslationBlock, translate_blocks_resilient
from backend.config import STUDY_ASSET_DIR
import shutil
import json
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, HTTPException

from backend.config import STUDY_ASSET_DIR, UPLOAD_DIR, JAVI_ANALYSIS_ENABLED, JAVI_ANALYSIS_MODEL
from backend.activity_service import record_activity
from backend.database import db_session, row_to_dict, utc_now
from backend.media_service import decode_subtitle_bytes, extension_analysis, fetch_youtube_subtitle_result, fetch_youtube_subtitles, parse_subtitle_text, subtitle_title_from_filename
from backend.schemas import MediaAnalyzeRequest, MediaImportRequest, TranslationRequest, VocabularyCreate, WebTranslateRequest, YoutubeMediaImportRequest
from backend.study_analysis_service import analyze_phrase_deep, analyze_phrase_javi, analyze_sentence, analyze_sentences
from backend.typesetting_service import render_translated_page
from backend.utils import _json_list, get_or_404
from backend.quality_service import evaluate_page_quality

router = APIRouter()


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


@router.post("/api/chapters/{chapter_id}/publish", status_code=202)
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


@router.delete("/api/chapters/{chapter_id}/publish")
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


@router.get("/api/study")
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


@router.get("/api/study/chapters/{chapter_id}")
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


@router.get("/api/media")
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


@router.get("/api/media/{source_id}")
def get_media_source(source_id: int) -> dict:
    with db_session() as connection:
        return _get_media_source(connection, source_id)


@router.post("/api/media/import", status_code=201)
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


@router.post("/api/media/import-subtitle", status_code=201)
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


@router.post("/api/media/youtube", status_code=201)
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


@router.post("/api/media/segments/{segment_id}/analyze")
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


@router.delete("/api/media/{source_id}")
def delete_media_source(source_id: int) -> dict:
    with db_session() as connection:
        get_or_404(connection, "SELECT id FROM media_sources WHERE id = ?", (source_id,), "nguồn media")
        connection.execute("DELETE FROM media_sources WHERE id = ?", (source_id,))
    return {"status": "deleted", "id": source_id}


@router.post("/api/media/analyze")
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
@router.get("/api/v1/health")
def extension_health() -> dict:
    return {
        "status": "ok",
        "service": "Manga Translator Study Media",
        "version": "0.1.0",
        "javi_analysis": {
            "enabled": JAVI_ANALYSIS_ENABLED,
            "model": JAVI_ANALYSIS_MODEL if JAVI_ANALYSIS_ENABLED else None,
        },
    }


# --- MOCK SRS ENDPOINTS ---
# Added to satisfy the extension's API client and prevent 404s.

@router.post("/api/v1/srs/card")
def add_srs_card(payload: dict) -> dict:
    # payload expects: user_id, word, reading, meaning, sentence
    return {"status": "ok", "id": "mock_card_123", **payload}

@router.post("/api/v1/srs/mine")
def mine_sentence(payload: dict) -> dict:
    return {"status": "ok", **payload}

@router.get("/api/v1/srs/due")
def get_due_cards(user_id: str, limit: int = 50) -> list:
    return []

@router.get("/api/v1/srs/cards")
def get_all_srs_cards(user_id: str) -> list:
    return []

@router.get("/api/v1/srs/stats")
def get_srs_stats(user_id: str) -> dict:
    return {"due": 0, "new": 0, "learning": 0, "graduated": 0}

@router.post("/api/v1/srs/review")
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


@router.post("/api/v1/analyze")
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


@router.post("/api/v1/analyze/javi")
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


@router.post("/api/v1/analyze/phrase")
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


@router.post("/api/v1/translate")
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


@router.post("/api/v1/subtitles/youtube")
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


@router.get("/api/vocabulary")
def list_vocabulary() -> list[dict]:
    with db_session() as connection:
        return [dict(row) for row in connection.execute(
            "SELECT * FROM vocabulary ORDER BY created_at DESC, id DESC"
        ).fetchall()]


@router.post("/api/vocabulary", status_code=201)
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


@router.delete("/api/vocabulary/{item_id}")
def delete_vocabulary(item_id: int) -> dict:
    with db_session() as connection:
        item = connection.execute("SELECT id FROM vocabulary WHERE id = ?", (item_id,)).fetchone()
        if item is None:
            raise HTTPException(status_code=404, detail="Không tìm thấy từ đã lưu")
        connection.execute("DELETE FROM vocabulary WHERE id = ?", (item_id,))
    return {"status": "deleted", "id": item_id}

