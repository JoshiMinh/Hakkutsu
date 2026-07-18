from __future__ import annotations

import json
from pathlib import Path
import re
from threading import Lock
from typing import Callable, Tuple, List, Dict

import cv2
import numpy as np
from huggingface_hub import hf_hub_download
from PIL import Image, ImageDraw, ImageFont

from app.core.config import settings
from app.services.ocr_service import recognize_japanese_crop
from app.models.manga_studio import TextBlock


_model = None
_model_lock = Lock()
_JAPANESE_CHARACTER = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]")


def get_bubble_model():
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None:
            from ultralytics import YOLO

            model_dir = Path("app/data/models") / "mangalens"
            model_dir.mkdir(parents=True, exist_ok=True)
            weights = hf_hub_download(
                repo_id=settings.BUBBLE_MODEL_ID,
                filename=settings.BUBBLE_MODEL_FILE,
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
        conf=settings.BUBBLE_CONFIDENCE,
        imgsz=settings.BUBBLE_IMAGE_SIZE,
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
    text_blocks: list[TextBlock],
) -> dict:
    regions: list[dict] = []
    assigned_ids: set[str] = set()
    for index, (mask, box, score) in enumerate(zip(masks, boxes, scores), start=1):
        x1, y1, x2, y2 = box
        members: list[dict] = []
        for block in text_blocks:
            bx = float(block.source_x if block.source_x is not None else block.x)
            by = float(block.source_y if block.source_y is not None else block.y)
            bw = float(block.source_width if block.source_width is not None else block.width)
            bh = float(block.source_height if block.source_height is not None else block.height)
            left = max(0, min(mask.shape[1], int(np.floor(bx))))
            top = max(0, min(mask.shape[0], int(np.floor(by))))
            right = max(left + 1, min(mask.shape[1], int(np.ceil(bx + bw))))
            bottom = max(top + 1, min(mask.shape[0], int(np.ceil(by + bh))))
            overlap = float(mask[top:bottom, left:right].mean()) if right > left and bottom > top else 0.0
            center_x = min(mask.shape[1] - 1, max(0, int(round(bx + bw / 2))))
            center_y = min(mask.shape[0] - 1, max(0, int(round(by + bh / 2))))
            center_inside = bool(mask[center_y, center_x])
            if center_inside or overlap >= 0.12:
                members.append({"text_block_id": str(block.id), "overlap": round(overlap, 4)})
                assigned_ids.add(str(block.id))
        regions.append(
            {
                "index": index,
                "confidence": round(score, 4),
                "bbox": [round(x1, 2), round(y1, 2), round(x2 - x1, 2), round(y2 - y1, 2)],
                "text_blocks": members,
            }
        )

    all_ids = {str(block.id) for block in text_blocks}
    return {
        "model": settings.BUBBLE_MODEL_ID,
        "bubble_count": len(regions),
        "assigned_text_block_count": len(assigned_ids),
        "unassigned_text_block_ids": sorted(list(all_ids - assigned_ids)),
        "multi_text_bubble_count": sum(len(region["text_blocks"]) > 1 for region in regions),
        "regions": regions,
    }


def _japanese_characters(text: str) -> str:
    return "".join(_JAPANESE_CHARACTER.findall(text))


def recover_missing_japanese_fragments(
    rgb: np.ndarray,
    masks: list[np.ndarray],
    analysis: dict,
    text_blocks: list[TextBlock],
    recognizer: Callable[[Image.Image], str] = recognize_japanese_crop,
) -> list[dict]:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    blocks_by_id = {str(block.id): block for block in text_blocks}
    recoveries: list[dict] = []

    for region in analysis.get("regions", []):
        members = region.get("text_blocks", [])
        if len(members) != 1:
            continue
        block = blocks_by_id.get(str(members[0]["text_block_id"]))
        mask_index = int(region["index"]) - 1
        if block is None or not 0 <= mask_index < len(masks):
            continue

        current_text = str(block.original_text or "").strip()
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

        source_x = float(block.source_x if block.source_x is not None else block.x)
        source_y = float(block.source_y if block.source_y is not None else block.y)
        source_width = float(block.source_width if block.source_width is not None else block.width)
        source_height = float(block.source_height if block.source_height is not None else block.height)
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
                "text_block_id": str(block.id),
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


def process_bubble_segmentation(
    image_path: Path,
    preview_destination: Path,
    text_blocks: list[TextBlock]
) -> Tuple[List[TextBlock], Dict]:
    rgb, masks, boxes, scores = extract_bubble_instances(image_path)
    if not masks:
        return text_blocks, {}
        
    analysis = analyze_bubble_instances(masks, boxes, scores, text_blocks)
    recoveries = recover_missing_japanese_fragments(rgb, masks, analysis, text_blocks)
    
    analysis["recovered_fragments"] = recoveries
    analysis["recovered_fragment_count"] = len(recoveries)
    analysis.update({"image_width": rgb.shape[1], "image_height": rgb.shape[0]})
    
    preview_destination.parent.mkdir(parents=True, exist_ok=True)
    render_bubble_preview(rgb, masks, analysis).save(preview_destination, format="PNG", optimize=True)
    
    # Update text blocks in memory based on recoveries
    blocks_by_id = {str(b.id): b for b in text_blocks}
    for recovery in recoveries:
        block = blocks_by_id.get(recovery["text_block_id"])
        if block:
            source_x, source_y, source_width, source_height = recovery["source_bbox"]
            block.original_text = recovery["recovered_text"]
            block.source_x = source_x
            block.source_y = source_y
            block.source_width = source_width
            block.source_height = source_height
            
            if block.final_translation == block.ai_translation:
                block.final_translation = ""
            block.ai_translation = ""
            
    return text_blocks, analysis
