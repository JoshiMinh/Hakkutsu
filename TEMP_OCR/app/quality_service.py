from __future__ import annotations

import json
import re

from PIL import Image

from app.config import UPLOAD_DIR
from app.database import db_session, utc_now
from app.ocr_service import recognize_japanese_crop


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

    if not blocks:
        issues.append({"severity": "error", "code": "no_text", "message": "Không tìm thấy hội thoại OCR."})
    for index, block in enumerate(blocks, start=1):
        source = str(block.get("original_text") or "").strip()
        translated = str(block.get("final_translation") or block.get("ai_translation") or "").strip()
        if not source:
            issues.append({"severity": "warning", "code": "empty_source", "message": f"Bubble {index} không có câu OCR."})
            continue
        if not translated:
            issues.append({"severity": "error", "code": "empty_translation", "message": f"Bubble {index} chưa có bản dịch."})
        elif source.casefold() == translated.casefold():
            issues.append({"severity": "error", "code": "same_translation", "message": f"Bubble {index} giống nguyên văn."})
        elif len(JAPANESE.findall(translated)) >= 2:
            issues.append({"severity": "warning", "code": "japanese_translation", "message": f"Bubble {index} còn ký tự Nhật trong bản dịch."})

    clean_relative = page.get("clean_image_path")
    clean_path = UPLOAD_DIR / clean_relative if clean_relative else None
    if clean_path is None or not clean_path.is_file():
        issues.append({"severity": "error", "code": "missing_clean", "message": "Chưa tạo được ảnh sạch."})
    elif check_clean_ocr and blocks:
        try:
            with Image.open(clean_path) as clean:
                for index, block in enumerate(blocks, start=1):
                    x = float(block.get("source_x") or block["x"])
                    y = float(block.get("source_y") or block["y"])
                    width = float(block.get("source_width") or block["width"])
                    height = float(block.get("source_height") or block["height"])
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

