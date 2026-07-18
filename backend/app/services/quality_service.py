from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from PIL import Image

from app.services import storage_service
from app.services.ocr_service import recognize_japanese_crop
from app.models.manga_studio import Page, TextBlock
from app.data import manga_studio_db


JAPANESE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")


def evaluate_page_quality(manga_id: str, chapter_id: str, page_id: str, *, check_clean_ocr: bool = True) -> dict:
    issues: list[dict[str, str]] = []
    
    page = manga_studio_db.get_page(manga_id, chapter_id, page_id)
    if not page:
        raise RuntimeError("Không tìm thấy trang để kiểm tra")
        
    blocks = manga_studio_db.get_text_blocks(manga_id, chapter_id, page_id)

    if not blocks:
        issues.append({"severity": "error", "code": "no_text", "message": "Không tìm thấy hội thoại OCR."})
        
    for index, block in enumerate(blocks, start=1):
        source = str(block.original_text or "").strip()
        translated = str(block.final_translation or block.ai_translation or "").strip()
        if not source:
            issues.append({"severity": "warning", "code": "empty_source", "message": f"Bubble {index} không có câu OCR."})
            continue
        if not translated:
            issues.append({"severity": "error", "code": "empty_translation", "message": f"Bubble {index} chưa có bản dịch."})
        elif source.casefold() == translated.casefold():
            issues.append({"severity": "error", "code": "same_translation", "message": f"Bubble {index} giống nguyên văn."})
        elif len(JAPANESE.findall(translated)) >= 2:
            issues.append({"severity": "warning", "code": "japanese_translation", "message": f"Bubble {index} còn ký tự Nhật trong bản dịch."})

    clean_relative = page.clean_image_path
    clean_path = storage_service.get_absolute_path(clean_relative) if clean_relative else None
    
    if clean_path is None or not clean_path.is_file():
        issues.append({"severity": "error", "code": "missing_clean", "message": "Chưa tạo được ảnh sạch."})
    elif check_clean_ocr and blocks:
        try:
            with Image.open(clean_path) as clean:
                for index, block in enumerate(blocks, start=1):
                    x = float(block.source_x if block.source_x is not None else block.x)
                    y = float(block.source_y if block.source_y is not None else block.y)
                    width = float(block.source_width if block.source_width is not None else block.width)
                    height = float(block.source_height if block.source_height is not None else block.height)
                    crop = clean.crop((max(0, int(x)), max(0, int(y)),
                                       min(clean.width, int(x + width)), min(clean.height, int(y + height))))
                    residual = recognize_japanese_crop(crop)
                    if len(JAPANESE.findall(residual)) >= 2:
                        issues.append({"severity": "warning", "code": "residual_japanese", "message": f"Bubble {index} có thể còn sót chữ Nhật trên ảnh sạch."})
        except Exception as exc:
            issues.append({"severity": "warning", "code": "clean_ocr_failed", "message": f"Không thể kiểm tra ảnh sạch: {str(exc)[:120]}"})

    qa_status = "error" if any(item["severity"] == "error" for item in issues) else "warning" if issues else "pass"
    
    # Normally we would update the page with qa_status in Firestore
    # But since Page model doesn't have qa_status field currently, we just return the issues
    
    return {"status": qa_status, "issues": issues}
