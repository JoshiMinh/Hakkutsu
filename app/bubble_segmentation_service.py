from __future__ import annotations

import json
from pathlib import Path
import re
from threading import Lock
from typing import Callable

import cv2
import numpy as np
from huggingface_hub import hf_hub_download
from PIL import Image, ImageDraw, ImageFont

from app.config import (
    BUBBLE_CONFIDENCE,
    BUBBLE_DEVICE,
    BUBBLE_IMAGE_SIZE,
    BUBBLE_MODEL_FILE,
    BUBBLE_MODEL_ID,
    MODEL_DIR,
)
from app.database import db_session, utc_now
from app.text_policy_service import classify_text_policies
from app.visual_supervisor_service import (
    VisualSupervisorUnavailable,
    analyze_page_visually,
    merge_visual_policies,
    visual_supervisor_config,
)
from app.ocr_service import recognize_japanese_crop


_model = None
_model_lock = Lock()
_JAPANESE_CHARACTER = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]")


def get_bubble_model():
    """Download once and lazily load MangaLens so normal app startup stays fast."""
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None:
            from ultralytics import YOLO

            model_dir = MODEL_DIR / "mangalens"
            model_dir.mkdir(parents=True, exist_ok=True)
            weights = hf_hub_download(
                repo_id=BUBBLE_MODEL_ID,
                filename=BUBBLE_MODEL_FILE,
                local_dir=model_dir,
            )
            _model = YOLO(weights)
    return _model


def extract_bubble_instances(image_path: Path) -> tuple[np.ndarray, list[np.ndarray], list[tuple[float, float, float, float]], list[float]]:
    with Image.open(image_path) as image:
        rgb = np.asarray(image.convert("RGB"))
    model = get_bubble_model()
    result = model.predict(
        source=rgb,
        conf=BUBBLE_CONFIDENCE,
        imgsz=BUBBLE_IMAGE_SIZE,
        device=BUBBLE_DEVICE,
        retina_masks=True,
        verbose=False,
    )[0]
    if result.masks is None or result.boxes is None:
        return rgb, [], [], []

    height, width = rgb.shape[:2]
    masks: list[np.ndarray] = []
    for raw_mask in result.masks.data.cpu().numpy():
        if raw_mask.shape != (height, width):
            raw_mask = cv2.resize(raw_mask, (width, height), interpolation=cv2.INTER_NEAREST)
        masks.append(raw_mask >= 0.5)
    boxes = [tuple(float(value) for value in row) for row in result.boxes.xyxy.cpu().numpy()]
    scores = [float(value) for value in result.boxes.conf.cpu().numpy()]
    return rgb, masks, boxes, scores


def analyze_bubble_instances(
    masks: list[np.ndarray],
    boxes: list[tuple[float, float, float, float]],
    scores: list[float],
    text_blocks: list[dict],
) -> dict:
    """Assign source OCR blocks to instance masks using overlap, then proximity."""
    regions: list[dict] = []
    assigned_ids: set[int] = set()
    for index, (mask, box, score) in enumerate(zip(masks, boxes, scores), start=1):
        x1, y1, x2, y2 = box
        members: list[dict] = []
        for block in text_blocks:
            bx = float(block.get("source_x") if block.get("source_x") is not None else block["x"])
            by = float(block.get("source_y") if block.get("source_y") is not None else block["y"])
            bw = float(block.get("source_width") if block.get("source_width") is not None else block["width"])
            bh = float(block.get("source_height") if block.get("source_height") is not None else block["height"])
            left = max(0, min(mask.shape[1], int(np.floor(bx))))
            top = max(0, min(mask.shape[0], int(np.floor(by))))
            right = max(left + 1, min(mask.shape[1], int(np.ceil(bx + bw))))
            bottom = max(top + 1, min(mask.shape[0], int(np.ceil(by + bh))))
            overlap = float(mask[top:bottom, left:right].mean()) if right > left and bottom > top else 0.0
            center_x = min(mask.shape[1] - 1, max(0, int(round(bx + bw / 2))))
            center_y = min(mask.shape[0] - 1, max(0, int(round(by + bh / 2))))
            center_inside = bool(mask[center_y, center_x])
            if center_inside or overlap >= 0.12:
                members.append({"text_block_id": int(block["id"]), "overlap": round(overlap, 4)})
                assigned_ids.add(int(block["id"]))
        regions.append(
            {
                "index": index,
                "confidence": round(score, 4),
                "bbox": [round(x1, 2), round(y1, 2), round(x2 - x1, 2), round(y2 - y1, 2)],
                "text_blocks": members,
            }
        )

    all_ids = {int(block["id"]) for block in text_blocks}
    return {
        "model": BUBBLE_MODEL_ID,
        "bubble_count": len(regions),
        "assigned_text_block_count": len(assigned_ids),
        "unassigned_text_block_ids": sorted(all_ids - assigned_ids),
        "multi_text_bubble_count": sum(len(region["text_blocks"]) > 1 for region in regions),
        "regions": regions,
    }


def safe_row_spans(mask: np.ndarray, bbox: list[float] | tuple[float, float, float, float]) -> list[list[int]]:
    """Compact an eroded bubble mask into per-row safe horizontal spans."""
    x, y, width, height = (float(value) for value in bbox)
    kernel_size = max(3, round(min(width, height) * 0.045))
    if kernel_size % 2 == 0:
        kernel_size += 1
    eroded = cv2.erode(
        mask.astype(np.uint8),
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)),
    ).astype(bool)
    top = max(0, int(np.floor(y)))
    bottom = min(eroded.shape[0], int(np.ceil(y + height)))
    preferred_x = x + width / 2
    spans: list[list[int]] = []
    for row in range(top, bottom):
        columns = np.flatnonzero(eroded[row])
        if not len(columns):
            continue
        breaks = np.flatnonzero(np.diff(columns) > 1)
        starts = np.r_[0, breaks + 1]
        ends = np.r_[breaks + 1, len(columns)]
        runs = [(int(columns[start]), int(columns[end - 1]) + 1) for start, end in zip(starts, ends)]
        containing = [run for run in runs if run[0] <= preferred_x <= run[1]]
        selected = max(containing or runs, key=lambda run: run[1] - run[0])
        spans.append([row, selected[0], selected[1]])
    return spans


def _japanese_characters(text: str) -> str:
    return "".join(_JAPANESE_CHARACTER.findall(text))


def recover_missing_japanese_fragments(
    rgb: np.ndarray,
    masks: list[np.ndarray],
    analysis: dict,
    text_blocks: list[dict],
    recognizer: Callable[[Image.Image], str] = recognize_japanese_crop,
) -> list[dict]:
    """Recover small glyphs missed beside one OCR block inside a bubble.

    The second OCR pass is deliberately limited to single-block bubbles and is
    only accepted when conservative connected-component analysis finds ink
    outside the original OCR crop. This avoids merging two different speakers
    merely because a segmentation model put them in one large region.
    """
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    blocks_by_id = {int(block["id"]): block for block in text_blocks}
    recoveries: list[dict] = []

    for region in analysis.get("regions", []):
        members = region.get("text_blocks", [])
        if len(members) != 1:
            continue
        block = blocks_by_id.get(int(members[0]["text_block_id"]))
        mask_index = int(region["index"]) - 1
        if block is None or not 0 <= mask_index < len(masks):
            continue

        current_text = str(block.get("original_text") or "").strip()
        current_japanese = _japanese_characters(current_text)
        if not current_japanese:
            continue

        mask = masks[mask_index].astype(np.uint8)
        x, y, width, height = (float(value) for value in region["bbox"])
        bubble_area = max(1.0, width * height)
        kernel_size = max(3, round(min(width, height) * 0.06))
        if kernel_size % 2 == 0:
            kernel_size += 1
        interior = cv2.erode(
            mask,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)),
        ).astype(bool)
        candidate = (gray < 155) & interior

        source_x = float(block.get("source_x") if block.get("source_x") is not None else block["x"])
        source_y = float(block.get("source_y") if block.get("source_y") is not None else block["y"])
        source_width = float(
            block.get("source_width") if block.get("source_width") is not None else block["width"]
        )
        source_height = float(
            block.get("source_height") if block.get("source_height") is not None else block["height"]
        )
        exclusion = max(3, round(min(source_width, source_height) * 0.08))
        left = max(0, int(np.floor(source_x)) - exclusion)
        top = max(0, int(np.floor(source_y)) - exclusion)
        right = min(candidate.shape[1], int(np.ceil(source_x + source_width)) + exclusion)
        bottom = min(candidate.shape[0], int(np.ceil(source_y + source_height)) + exclusion)
        candidate[top:bottom, left:right] = False

        count, labels, stats, _ = cv2.connectedComponentsWithStats(
            candidate.astype(np.uint8), 8
        )
        residual_boxes: list[tuple[int, int, int, int]] = []
        residual_area = 0
        maximum_component_area = max(18, round(bubble_area * 0.035))
        for label in range(1, count):
            component_x = int(stats[label, cv2.CC_STAT_LEFT])
            component_y = int(stats[label, cv2.CC_STAT_TOP])
            component_width = int(stats[label, cv2.CC_STAT_WIDTH])
            component_height = int(stats[label, cv2.CC_STAT_HEIGHT])
            component_area = int(stats[label, cv2.CC_STAT_AREA])
            if not 2 <= component_area <= maximum_component_area:
                continue
            if component_width > width * 0.38 or component_height > height * 0.38:
                continue
            aspect = max(component_width, component_height) / max(1, min(component_width, component_height))
            if aspect > 7:
                continue
            residual_boxes.append(
                (component_x, component_y, component_x + component_width, component_y + component_height)
            )
            residual_area += component_area

        if not residual_boxes or (len(residual_boxes) < 2 and residual_area < 10):
            continue

        bubble_left = max(0, int(np.floor(x)))
        bubble_top = max(0, int(np.floor(y)))
        bubble_right = min(rgb.shape[1], int(np.ceil(x + width)))
        bubble_bottom = min(rgb.shape[0], int(np.ceil(y + height)))
        if bubble_right <= bubble_left or bubble_bottom <= bubble_top:
            continue
        reread = recognizer(Image.fromarray(rgb[bubble_top:bubble_bottom, bubble_left:bubble_right])).strip()
        reread_japanese = _japanese_characters(reread)
        extra_count = len(reread_japanese) - len(current_japanese)
        if (
            extra_count < 1
            or extra_count > max(8, len(current_japanese))
            or current_japanese not in reread_japanese
        ):
            continue

        residual_left = min(box[0] for box in residual_boxes)
        residual_top = min(box[1] for box in residual_boxes)
        residual_right = max(box[2] for box in residual_boxes)
        residual_bottom = max(box[3] for box in residual_boxes)
        padding = max(3, round(min(width, height) * 0.025))
        union_left = max(bubble_left, min(left + exclusion, residual_left) - padding)
        union_top = max(bubble_top, min(top + exclusion, residual_top) - padding)
        union_right = min(bubble_right, max(right - exclusion, residual_right) + padding)
        union_bottom = min(bubble_bottom, max(bottom - exclusion, residual_bottom) + padding)
        recoveries.append(
            {
                "text_block_id": int(block["id"]),
                "previous_text": current_text,
                "recovered_text": reread,
                "source_bbox": [
                    float(union_left), float(union_top),
                    float(union_right - union_left), float(union_bottom - union_top),
                ],
            }
        )
    return recoveries


def render_bubble_preview(
    rgb: np.ndarray,
    masks: list[np.ndarray],
    analysis: dict,
) -> Image.Image:
    overlay = rgb.astype(np.float32).copy()
    palette = np.array(
        [[20, 184, 166], [59, 130, 246], [245, 158, 11], [168, 85, 247], [244, 63, 94]],
        dtype=np.float32,
    )
    for index, mask in enumerate(masks):
        color = palette[index % len(palette)]
        overlay[mask] = overlay[mask] * 0.55 + color * 0.45
    preview = Image.fromarray(np.clip(overlay, 0, 255).astype(np.uint8))
    draw = ImageDraw.Draw(preview)
    font = ImageFont.load_default(size=max(14, round(rgb.shape[1] / 90)))
    line_width = max(2, round(rgb.shape[1] / 700))
    for region in analysis["regions"]:
        x, y, width, height = region["bbox"]
        color = tuple(int(value) for value in palette[(region["index"] - 1) % len(palette)])
        draw.rectangle((x, y, x + width, y + height), outline=color, width=line_width)
        member_ids = [str(item["text_block_id"]) for item in region["text_blocks"]]
        label = f"B{region['index']}" + (f" / T{','.join(member_ids)}" if member_ids else "")
        label_box = draw.textbbox((x, y), label, font=font, stroke_width=2)
        draw.rectangle(label_box, fill=(255, 255, 255))
        draw.text((x, y), label, fill=color, font=font, stroke_width=1, stroke_fill=(255, 255, 255))
    return preview


def run_bubble_segmentation_job(
    job_id: int,
    page_id: int,
    image_path: Path,
    preview_destination: Path,
    preview_relative_path: str,
    analysis_destination: Path,
    analysis_relative_path: str,
) -> None:
    with db_session() as connection:
        connection.execute(
            "UPDATE processing_jobs SET status = 'processing', progress = 0.1, updated_at = ? WHERE id = ?",
            (utc_now(), job_id),
        )
        blocks = [dict(row) for row in connection.execute(
            "SELECT * FROM text_blocks WHERE page_id = ? ORDER BY id", (page_id,)
        ).fetchall()]
        page_row = connection.execute(
            "SELECT outside_text_policy FROM pages WHERE id = ?", (page_id,)
        ).fetchone()
        outside_text_policy = str(page_row["outside_text_policy"] or "auto") if page_row else "auto"
    try:
        rgb, masks, boxes, scores = extract_bubble_instances(image_path)
        analysis = analyze_bubble_instances(masks, boxes, scores, blocks)
        for region in analysis.get("regions", []):
            mask_index = int(region["index"]) - 1
            if 0 <= mask_index < len(masks):
                region["safe_row_spans"] = safe_row_spans(masks[mask_index], region["bbox"])
        if not masks:
            # Captions, narration boxes and free-standing manga text are valid
            # OCR targets even when MangaLens finds no speech balloon. Bubble
            # segmentation improves grouping, but it is not required for the
            # remaining translation/inpainting/typesetting stages.
            analysis["notice"] = "Không phát hiện bong bóng thoại; tiếp tục dùng vùng OCR"
        recoveries = recover_missing_japanese_fragments(rgb, masks, analysis, blocks)
        analysis["recovered_fragments"] = recoveries
        analysis["recovered_fragment_count"] = len(recoveries)
        blocks_by_id = {int(block["id"]): block for block in blocks}
        for recovery in recoveries:
            block = blocks_by_id.get(int(recovery["text_block_id"]))
            if block is not None:
                source_x, source_y, source_width, source_height = recovery["source_bbox"]
                block.update({
                    "original_text": recovery["recovered_text"],
                    "source_x": source_x, "source_y": source_y,
                    "source_width": source_width, "source_height": source_height,
                })
        policies = classify_text_policies(rgb, analysis, blocks)
        visual_suggestions: dict[int, dict] = {}
        visual_metadata = {**visual_supervisor_config(), "status": "disabled"}
        if visual_metadata["enabled"]:
            try:
                with db_session() as connection:
                    connection.execute(
                        """UPDATE processing_jobs
                           SET current_step = 'AI thị giác đang xem trang', progress = 0.55, updated_at = ?
                           WHERE id = ?""",
                        (utc_now(), job_id),
                    )
                visual_result = analyze_page_visually(rgb, analysis, blocks)
                policies = merge_visual_policies(policies, visual_result, blocks)
                for block_id, decision in visual_result.get("decisions", {}).items():
                    effective = policies.get(int(block_id), {})
                    visual_suggestions[int(block_id)] = {
                        **decision,
                        "model": visual_result.get("model"),
                        "effective_action": (
                            "skip" if effective.get("translation_mode") == "skip"
                            else "preserve" if effective.get("render_mode") == "preserve"
                            else "replace"
                        ),
                    }
                visual_metadata = {
                    "status": "completed",
                    "model": visual_result.get("model"),
                    "page_note": visual_result.get("page_note", ""),
                    "decision_count": len(visual_result.get("decisions", {})),
                }
            except (VisualSupervisorUnavailable, RuntimeError) as exc:
                # The visual model is advisory. OCR/CTD/LaMa must remain usable
                # when Ollama is stopped, times out or returns malformed JSON.
                visual_metadata = {
                    **visual_supervisor_config(),
                    "status": "fallback",
                    "error": str(exc)[:500],
                }
            finally:
                with db_session() as connection:
                    connection.execute(
                        """UPDATE processing_jobs
                           SET current_step = 'Hoàn thiện chính sách TextBlock', progress = 0.8, updated_at = ?
                           WHERE id = ?""",
                        (utc_now(), job_id),
                    )
        analysis["visual_supervisor"] = visual_metadata
        for policy in policies.values():
            if policy["text_kind"] != "sfx":
                continue
            if outside_text_policy == "replace":
                policy.update(translation_mode="translate", render_mode="replace")
            elif outside_text_policy == "study":
                policy.update(translation_mode="translate", render_mode="preserve")
            elif outside_text_policy == "skip":
                policy.update(translation_mode="skip", render_mode="preserve")
        analysis["text_policies"] = {str(key): value for key, value in policies.items()}
        analysis.update({"page_id": page_id, "image_width": rgb.shape[1], "image_height": rgb.shape[0]})
        preview_destination.parent.mkdir(parents=True, exist_ok=True)
        render_bubble_preview(rgb, masks, analysis).save(preview_destination, format="PNG", optimize=True)
        analysis_destination.write_text(json.dumps(analysis, ensure_ascii=False, indent=2), encoding="utf-8")
        now = utc_now()
        with db_session() as connection:
            for recovery in recoveries:
                source_x, source_y, source_width, source_height = recovery["source_bbox"]
                connection.execute(
                    """
                    UPDATE text_blocks
                    SET original_text = ?, source_x = ?, source_y = ?, source_width = ?, source_height = ?,
                        final_translation = CASE
                            WHEN final_translation = ai_translation THEN '' ELSE final_translation END,
                        ai_translation = '', updated_at = ?
                    WHERE id = ? AND page_id = ?
                    """,
                    (
                        recovery["recovered_text"], source_x, source_y, source_width, source_height,
                        now, recovery["text_block_id"], page_id,
                    ),
                )
            for block_id, policy in policies.items():
                connection.execute(
                    """
                    UPDATE text_blocks
                    SET visual_suggestion_json = ?, updated_at = ?
                    WHERE id = ? AND page_id = ?
                    """,
                    (
                        json.dumps(visual_suggestions.get(int(block_id), {}), ensure_ascii=False),
                        now, block_id, page_id,
                    ),
                )
                connection.execute(
                    """
                    UPDATE text_blocks
                    SET text_kind = ?, content_type = ?, translation_mode = ?, render_mode = ?,
                        style_preset = ?, font_family = CASE WHEN font_family = 'Arial' THEN ? ELSE font_family END,
                        policy_source = 'auto', sfx_score = ?, mask_strategy = ?,
                        visual_confidence = ?, visual_model = ?,
                        policy_reasons_json = ?, updated_at = ?
                    WHERE id = ? AND page_id = ?
                      AND COALESCE(policy_source, 'auto') <> 'manual'
                    """,
                    (
                        policy["text_kind"], policy["content_type"], policy["translation_mode"],
                        policy["render_mode"], policy["style_preset"], policy["font_family"],
                        policy["sfx_score"], policy.get("mask_strategy", "auto"),
                        policy.get("visual_confidence"), policy.get("visual_model"),
                        json.dumps(policy.get("policy_reasons", []), ensure_ascii=False),
                        now, block_id, page_id,
                    ),
                )
            connection.execute(
                """UPDATE pages
                   SET bubble_preview_path = ?, bubble_analysis_path = ?,
                       visual_analysis_json = ?, visual_analysis_at = ?, updated_at = ?
                   WHERE id = ?""",
                (
                    preview_relative_path, analysis_relative_path,
                    json.dumps(visual_metadata, ensure_ascii=False), now, now, page_id,
                ),
            )
            connection.execute(
                "UPDATE processing_jobs SET status = 'completed', progress = 1, result_count = ?, updated_at = ? WHERE id = ?",
                (analysis["bubble_count"], now, job_id),
            )
    except Exception as exc:
        preview_destination.unlink(missing_ok=True)
        analysis_destination.unlink(missing_ok=True)
        message = str(exc).strip() or exc.__class__.__name__
        with db_session() as connection:
            connection.execute(
                "UPDATE processing_jobs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?",
                (message[:1000], utc_now(), job_id),
            )
