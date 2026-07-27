from __future__ import annotations

import json
import re

import cv2
import numpy as np
from PIL import Image

from backend.config import UPLOAD_DIR
from backend.database import db_session, utc_now
from backend.ocr_service import recognize_japanese_crop
from backend.inpainting_service import create_primary_text_mask


JAPANESE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")


def evaluate_page_quality(page_id: int, *, check_clean_ocr: bool = True) -> dict:
    issues: list[dict[str, str]] = []
    with db_session() as connection:
        page_row = connection.execute("SELECT * FROM pages WHERE id = ?", (page_id,)).fetchone()
        if page_row is None:
            raise RuntimeError("Không tìm thấy trang để kiểm tra")
        page = dict(page_row)
        blocks = [dict(row) for row in connection.execute(
            "SELECT * FROM text_blocks WHERE page_id = ? ORDER BY id", (page_id,)
        ).fetchall()]

    editorial_decision = str(page.get("editorial_decision") or "auto")
    if not blocks:
        if editorial_decision == "preserve_sfx":
            issues = []
        elif editorial_decision == "needs_manual_repair":
            issues.append({
                "severity": "warning",
                "code": "manual_repair_needed",
                "message": "Trang được đánh dấu cần sửa tay trước khi xuất bản.",
            })
        else:
            issues.append({
                "severity": "warning",
                "code": "no_dialogue_or_sfx_review",
                "message": "Chưa phát hiện được vùng chữ. Trang chưa được tự động bỏ qua; hãy quét dự phòng, khoanh TextBlock hoặc xác nhận Giữ SFX.",
            })
    for index, block in enumerate(blocks, start=1):
        if str(block.get("translation_mode") or "translate") == "skip":
            continue
        source = str(block.get("original_text") or "").strip()
        translated = str(block.get("final_translation") or block.get("ai_translation") or "").strip()
        if not source:
            issues.append({"severity": "warning", "code": "empty_source", "message": f"Bubble {index} không có câu OCR."})
            continue
        # Ellipses and layout-only OCR fragments do not require translation.
        if not JAPANESE.search(source):
            continue
        if not translated:
            issues.append({"severity": "error", "code": "empty_translation", "message": f"Bubble {index} chưa có bản dịch."})
        elif source.casefold() == translated.casefold():
            issues.append({"severity": "error", "code": "same_translation", "message": f"Bubble {index} giống nguyên văn."})
        elif len(JAPANESE.findall(translated)) >= 2:
            issues.append({"severity": "warning", "code": "japanese_translation", "message": f"Bubble {index} còn ký tự Nhật trong bản dịch."})

    replace_blocks = [
        block for block in blocks
        if str(block.get("render_mode") or "replace") == "replace"
        and str(block.get("translation_mode") or "translate") == "translate"
    ]
    clean_relative = page.get("clean_image_path")
    clean_path = UPLOAD_DIR / clean_relative if clean_relative else None
    if replace_blocks and (clean_path is None or not clean_path.is_file()):
        issues.append({"severity": "error", "code": "missing_clean", "message": "Chưa tạo được ảnh sạch."})
    elif check_clean_ocr and replace_blocks:
        try:
            original_path = UPLOAD_DIR / page["original_image_path"]
            with Image.open(original_path) as original_image, Image.open(clean_path) as clean:
                original_rgb = np.asarray(original_image.convert("RGB"))
                clean_rgb = np.asarray(clean.convert("RGB"))
                boxes = [(
                    float(block.get("source_x") or block["x"]),
                    float(block.get("source_y") or block["y"]),
                    float(block.get("source_width") or block["width"]),
                    float(block.get("source_height") or block["height"]),
                ) for block in replace_blocks]
                original_mask, original_mask_engine = create_primary_text_mask(original_rgb, boxes)
                residual_mask, _ = create_primary_text_mask(clean_rgb, boxes)
                for index, block in enumerate(replace_blocks, start=1):
                    source = str(block.get("original_text") or "").strip()
                    if not JAPANESE.search(source):
                        continue
                    x = float(block.get("source_x") or block["x"])
                    y = float(block.get("source_y") or block["y"])
                    width = float(block.get("source_width") or block["width"])
                    height = float(block.get("source_height") or block["height"])
                    left, top = max(0, int(x)), max(0, int(y))
                    right = min(clean.width, int(x + width))
                    bottom = min(clean.height, int(y + height))
                    original_region = original_mask[top:bottom, left:right] > 0
                    residual_region = residual_mask[top:bottom, left:right] > 0
                    original_ink = int(np.count_nonzero(original_region))
                    # Only count learned text pixels that remain at the same
                    # glyph positions. Counting every new dark line in a large
                    # SFX crop mistakes reconstructed artwork for Japanese.
                    residual_ink = int(np.count_nonzero(original_region & residual_region))
                    crop_area = max(1, (right - left) * (bottom - top))
                    residual_ratio = residual_ink / max(1, original_ink)

                    # A learned text mask also lets QA detect the old failure
                    # mode: broad inpainting changed artwork far away from the
                    # Japanese glyph strokes even though OCR happened to fail.
                    source_crop = original_rgb[top:bottom, left:right]
                    clean_crop = clean_rgb[top:bottom, left:right]
                    changed = np.max(
                        np.abs(source_crop.astype(np.int16) - clean_crop.astype(np.int16)),
                        axis=2,
                    ) >= 24
                    protected = cv2.dilate(
                        original_mask[top:bottom, left:right],
                        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)),
                        iterations=2,
                    ) > 0
                    changed_outside = float(np.count_nonzero(changed & ~protected) / crop_area)
                    if original_mask_engine.startswith("ctd") and changed_outside >= 0.025:
                        issues.append({
                            "severity": "error",
                            "code": "artwork_changed_outside_text",
                            "message": f"Bubble {index} bị thay đổi nét tranh ngoài mask chữ ({changed_outside:.1%}).",
                        })

                    if original_ink / crop_area >= 0.18:
                        gray_crop = cv2.cvtColor(source_crop, cv2.COLOR_RGB2GRAY)
                        edge_density = float(np.mean(cv2.Canny(gray_crop, 70, 160) > 0))
                        if float(gray_crop.std()) >= 35 and edge_density >= 0.07:
                            issues.append({
                                "severity": "warning",
                                "code": "large_sfx_repair_review",
                                "message": f"Bubble {index} là SFX lớn trên nền phức tạp; cần xem nhanh kết quả tái tạo.",
                            })

                    if original_ink >= 30 and residual_ratio >= 0.32:
                        issues.append({
                            "severity": "error",
                            "code": "residual_text_mask",
                            "message": f"Bubble {index} vẫn còn nhiều nét giống chữ Nhật ({residual_ratio:.0%}).",
                        })
                        continue
                    # Manga-OCR tends to hallucinate sentences on empty manga
                    # bubbles. Only ask it to confirm when image evidence says
                    # a meaningful portion of the original strokes remains.
                    if residual_ink < 30 or residual_ratio < 0.08:
                        continue
                    crop = clean.crop((max(0, int(x)), max(0, int(y)),
                                       min(clean.width, int(x + width)), min(clean.height, int(y + height))))
                    residual = recognize_japanese_crop(crop)
                    if len(JAPANESE.findall(residual)) >= 2:
                        issues.append({"severity": "warning", "code": "residual_japanese", "message": f"Bubble {index} có thể còn sót chữ Nhật trên ảnh sạch."})
        except Exception as exc:
            issues.append({"severity": "warning", "code": "clean_ocr_failed", "message": f"Không thể kiểm tra ảnh sạch: {str(exc)[:120]}"})

    qa_status = "error" if any(item["severity"] == "error" for item in issues) else "warning" if issues else "pass"
    now = utc_now()
    with db_session() as connection:
        connection.execute(
            "UPDATE pages SET qa_status = ?, qa_issues_json = ?, last_processed_at = ?, qa_overridden = 0, updated_at = ? WHERE id = ?",
            (qa_status, json.dumps(issues, ensure_ascii=False), now, now, page_id),
        )
    return {"status": qa_status, "issues": issues}
