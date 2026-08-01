import shutil
import json
import io
from uuid import uuid4
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from PIL import Image

from backend.config import UPLOAD_DIR, ALLOWED_IMAGE_TYPES
from backend.activity_service import prune_history, record_activity
from backend.database import db_session, utc_now
from backend.ocr_service import recognize_japanese_crop, run_ocr_job
from backend.inpainting_service import run_inpainting_job
from backend.bubble_segmentation_service import run_bubble_segmentation_job
from backend.schemas import ChapterPipelineRequest, CropOcrRequest, ImageOcrRequest, OcrRequest, PipelineRequest, TranslationRequest
from backend.translation_service import TranslationBlock, get_translation_provider, run_translation_job, translate_blocks_resilient
from backend.typesetting_service import constrain_cell_to_bubble_interior, pack_grouped_text_fallback, partition_text_regions_by_source, place_text_in_clear_area, suggest_text_color, text_layout_bounds, fit_text_layout, render_translated_page
from backend.utils import get_or_404
from backend.quality_service import evaluate_page_quality
from backend.quality_service import evaluate_page_quality

router = APIRouter(prefix="/api")


@router.post("/api/v1/ocr")
def api_v1_image_ocr(payload: ImageOcrRequest) -> dict:
    import base64
    import tempfile
    from backend.ocr_service import get_ocr_provider
    
    if "," in payload.image_data:
        _, encoded = payload.image_data.split(",", 1)
    else:
        encoded = payload.image_data
    
    image_bytes = base64.b64decode(encoded)
    
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        f.write(image_bytes)
        temp_path = Path(f.name)
        
    try:
        provider = get_ocr_provider()
        regions = provider.recognize(temp_path)
        regions.sort(key=lambda r: (-r.x, r.y))
        full_text = " ".join(r.text for r in regions)
        return {"full_text": full_text}
    finally:
        temp_path.unlink(missing_ok=True)


@router.post("/api/pages/{page_id}/ocr", status_code=202)
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


@router.post("/api/pages/{page_id}/ocr-crop")
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


@router.get("/api/jobs/{job_id}")
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


@router.post("/api/pages/{page_id}/translate", status_code=202)
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


@router.post("/api/pages/{page_id}/inpaint", status_code=202)
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


@router.post("/api/pages/{page_id}/bubble-segmentation", status_code=202)
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


@router.get("/api/pages/{page_id}/bubble-analysis")
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


@router.post("/api/pages/{page_id}/typeset")
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


@router.post("/api/pages/{page_id}/pipeline", status_code=202)
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


@router.post("/api/chapters/{chapter_id}/pipeline", status_code=202)
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


@router.get("/api/pages/{page_id}/export.png")
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


@router.post("/api/pages/{page_id}/clean-image")
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


@router.post("/api/pages/{page_id}/quality-check")
def check_page_quality(page_id: int) -> dict:
    with db_session() as connection:
        get_or_404(connection, "SELECT id FROM pages WHERE id = ?", (page_id,), "trang")
    return evaluate_page_quality(page_id)


@router.get("/api/history")
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

