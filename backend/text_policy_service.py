from __future__ import annotations

import json
import re
from typing import Mapping

import cv2
import numpy as np

from backend.database import db_session, utc_now


JAPANESE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")


def classify_text_policies(
    rgb_image: np.ndarray,
    analysis: Mapping,
    blocks: list[Mapping],
) -> dict[int, dict]:
    """Classify free-standing, artwork-integrated text conservatively.

    This is deliberately a policy classifier, not an OCR classifier. Text is
    still translated for Study; a preserved block is only excluded from image
    erasing and translated-image rendering.
    """
    image_height, image_width = rgb_image.shape[:2]
    bubble_block_ids = {
        int(member["text_block_id"])
        for region in analysis.get("regions", [])
        for member in region.get("text_blocks", [])
        if member.get("text_block_id") is not None
    }
    policies: dict[int, dict] = {}
    for block in blocks:
        block_id = int(block["id"])
        x = float(block.get("source_x") if block.get("source_x") is not None else block["x"])
        y = float(block.get("source_y") if block.get("source_y") is not None else block["y"])
        width = float(block.get("source_width") if block.get("source_width") is not None else block["width"])
        height = float(block.get("source_height") if block.get("source_height") is not None else block["height"])
        left = max(0, min(image_width - 1, int(np.floor(x))))
        top = max(0, min(image_height - 1, int(np.floor(y))))
        right = max(left + 1, min(image_width, int(np.ceil(x + width))))
        bottom = max(top + 1, min(image_height, int(np.ceil(y + height))))
        crop = rgb_image[top:bottom, left:right]
        gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
        edge_density = float(np.count_nonzero(cv2.Canny(gray, 70, 170))) / max(1, gray.size)
        contrast = float(np.std(gray))
        white_ratio = float(np.count_nonzero(gray >= 225)) / max(1, gray.size)
        area_ratio = width * height / max(1.0, image_width * image_height)
        size_ratio = max(width / max(1, image_width), height / max(1, image_height))
        source = str(block.get("original_text") or "").strip()
        japanese_length = len(JAPANESE.findall(source))
        in_bubble = block_id in bubble_block_ids

        score = 0.0
        reasons: list[str] = []
        if not in_bubble:
            score += 0.42
            reasons.append("ngoài bong bóng thoại")
        if area_ratio >= 0.035 or size_ratio >= 0.22:
            score += 0.24
            reasons.append("vùng chữ lớn")
        if edge_density >= 0.12:
            score += 0.18
            reasons.append("nền có nhiều đường nét")
        if contrast >= 48:
            score += 0.12
            reasons.append("nền tương phản phức tạp")
        if 0 < japanese_length <= 8 and size_ratio >= 0.16:
            score += 0.12
            reasons.append("cụm Nhật ngắn kiểu SFX/tên chiêu")
        if white_ratio >= 0.72:
            score -= 0.35
            reasons.append("nền trắng thuận lợi để thay chữ")
        if in_bubble:
            score -= 0.45
            reasons.append("nằm trong bong bóng thoại")

        score = max(0.0, min(1.0, score))
        preserve = score >= 0.62
        policies[block_id] = {
            "text_kind": "sfx" if preserve else "dialogue",
            "content_type": "sfx" if preserve else ("dialogue" if in_bubble else "narration"),
            "translation_mode": "translate",
            "render_mode": "preserve" if preserve else "replace",
            "style_preset": "action" if preserve else ("dialogue" if in_bubble else "narration"),
            "font_family": "Impact" if preserve else ("Arial" if in_bubble else "Times New Roman"),
            "policy_source": "auto",
            "sfx_score": round(score, 4),
            "mask_strategy": "aggressive" if score >= 0.62 else "standard",
            "visual_confidence": None,
            "visual_model": None,
            "policy_reasons": reasons,
        }
    return policies


def apply_automatic_text_policies(page_id: int, policies: Mapping[int, Mapping]) -> None:
    now = utc_now()
    with db_session() as connection:
        page = connection.execute(
            "SELECT outside_text_policy FROM pages WHERE id = ?", (page_id,)
        ).fetchone()
        outside_policy = str(page["outside_text_policy"] or "auto") if page else "auto"
        for block_id, policy in policies.items():
            resolved = dict(policy)
            if resolved["text_kind"] == "sfx":
                if outside_policy == "replace":
                    resolved.update(translation_mode="translate", render_mode="replace")
                elif outside_policy == "study":
                    resolved.update(translation_mode="translate", render_mode="preserve")
                elif outside_policy == "skip":
                    resolved.update(translation_mode="skip", render_mode="preserve")
            # A choice made in the Editor always wins over later automatic
            # bubble analysis until OCR explicitly replaces the TextBlock.
            connection.execute(
                """
                UPDATE text_blocks
                SET text_kind = ?, content_type = ?, translation_mode = ?, render_mode = ?,
                    style_preset = ?, font_family = CASE WHEN font_family = 'Arial' THEN ? ELSE font_family END,
                    policy_source = 'auto', sfx_score = ?, mask_strategy = ?,
                    visual_confidence = ?, visual_model = ?,
                    policy_reasons_json = ?, updated_at = ?
                WHERE id = ? AND page_id = ? AND COALESCE(policy_source, 'auto') <> 'manual'
                """,
                (
                    resolved["text_kind"], resolved["content_type"], resolved["translation_mode"],
                    resolved["render_mode"], resolved["style_preset"], resolved["font_family"],
                    resolved["sfx_score"], resolved.get("mask_strategy", "auto"),
                    resolved.get("visual_confidence"), resolved.get("visual_model"),
                    json.dumps(resolved.get("policy_reasons", []), ensure_ascii=False),
                    now, int(block_id), page_id,
                ),
            )
