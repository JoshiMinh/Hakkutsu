from __future__ import annotations

import base64
from io import BytesIO
import json
import re
from typing import Mapping

import httpx
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from backend.config import (
    VISUAL_SUPERVISOR_API_KEY,
    VISUAL_SUPERVISOR_API_URL,
    VISUAL_SUPERVISOR_ENABLED,
    VISUAL_SUPERVISOR_MAX_EDGE,
    VISUAL_SUPERVISOR_MIN_CONFIDENCE,
    VISUAL_SUPERVISOR_MODEL,
    VISUAL_SUPERVISOR_TIMEOUT,
)


CONTENT_TYPES = ("dialogue", "narration", "skill", "sfx", "title", "ignore")
ACTIONS = ("replace", "preserve", "skip")
STYLE_PRESETS = ("dialogue", "narration", "shout", "action", "brush", "horror", "skill")
MASK_STRATEGIES = ("standard", "aggressive", "review")
FONT_BY_STYLE = {
    "dialogue": "Arial",
    "narration": "Times New Roman",
    "shout": "Arial",
    "action": "Impact",
    "brush": "Impact",
    "horror": "Impact",
    "skill": "Impact",
}
JAPANESE_TEXT = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")


class VisualSupervisorUnavailable(RuntimeError):
    """The optional local visual model is disabled or could not be reached."""


def visual_supervisor_config() -> dict:
    return {
        "enabled": VISUAL_SUPERVISOR_ENABLED,
        "model": VISUAL_SUPERVISOR_MODEL,
        "api_url": VISUAL_SUPERVISOR_API_URL,
        "min_confidence": VISUAL_SUPERVISOR_MIN_CONFIDENCE,
    }


def _source_box(block: Mapping) -> tuple[float, float, float, float]:
    return tuple(
        float(block.get(source) if block.get(source) is not None else block[field])
        for source, field in (
            ("source_x", "x"),
            ("source_y", "y"),
            ("source_width", "width"),
            ("source_height", "height"),
        )
    )


def _annotated_image(rgb_image: np.ndarray, blocks: list[Mapping]) -> str:
    image = Image.fromarray(rgb_image.astype(np.uint8), mode="RGB")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    line_width = max(2, round(max(image.size) / 700))
    for block in blocks:
        x, y, width, height = _source_box(block)
        right, bottom = x + width, y + height
        draw.rectangle((x, y, right, bottom), outline=(0, 220, 255), width=line_width)
        label = f"T{int(block['id'])}"
        label_box = draw.textbbox((x, y), label, font=font, stroke_width=1)
        draw.rectangle(label_box, fill=(0, 0, 0))
        draw.text((x, y), label, font=font, fill=(0, 255, 255), stroke_width=1)

    longest = max(image.size)
    if longest > VISUAL_SUPERVISOR_MAX_EDGE:
        scale = VISUAL_SUPERVISOR_MAX_EDGE / longest
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.Resampling.LANCZOS,
        )
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=88, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _bubble_members(analysis: Mapping) -> set[int]:
    return {
        int(member["text_block_id"])
        for region in analysis.get("regions", [])
        for member in region.get("text_blocks", [])
        if member.get("text_block_id") is not None
    }


def _response_schema(block_ids: list[int]) -> dict:
    return {
        "type": "object",
        "properties": {
            "decisions": {
                "type": "array",
                "minItems": len(block_ids),
                "maxItems": len(block_ids),
                "items": {
                    "type": "object",
                    "properties": {
                        "block_id": {"type": "integer", "enum": block_ids},
                        "content_type": {"type": "string", "enum": list(CONTENT_TYPES)},
                        "action": {"type": "string", "enum": list(ACTIONS)},
                        "style_preset": {"type": "string", "enum": list(STYLE_PRESETS)},
                        "mask_strategy": {"type": "string", "enum": list(MASK_STRATEGIES)},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                        "reason": {"type": "string", "maxLength": 240},
                    },
                    "required": [
                        "block_id", "content_type", "action", "style_preset",
                        "mask_strategy", "confidence", "reason",
                    ],
                    "additionalProperties": False,
                },
            },
            "page_note": {"type": "string", "maxLength": 300},
        },
        "required": ["decisions", "page_note"],
        "additionalProperties": False,
    }


def _parse_response(content: str, expected_ids: set[int]) -> dict:
    cleaned = content.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", cleaned, re.DOTALL | re.IGNORECASE)
    if fenced:
        cleaned = fenced.group(1)
    try:
        payload = json.loads(cleaned)
        items = payload["decisions"]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise RuntimeError("Model thị giác không trả về JSON hợp lệ") from exc
    if not isinstance(items, list):
        raise RuntimeError("Trường decisions của model thị giác phải là danh sách")

    decisions: dict[int, dict] = {}
    for raw in items:
        try:
            block_id = int(raw["block_id"])
            decision = {
                "block_id": block_id,
                "content_type": str(raw["content_type"]),
                "action": str(raw["action"]),
                "style_preset": str(raw["style_preset"]),
                "mask_strategy": str(raw["mask_strategy"]),
                "confidence": max(0.0, min(1.0, float(raw["confidence"]))),
                "reason": str(raw["reason"]).strip()[:240],
            }
        except (KeyError, TypeError, ValueError) as exc:
            raise RuntimeError("Một quyết định thị giác thiếu trường bắt buộc") from exc
        if block_id not in expected_ids or block_id in decisions:
            raise RuntimeError(f"Model thị giác trả TextBlock không hợp lệ: {block_id}")
        if decision["content_type"] not in CONTENT_TYPES:
            raise RuntimeError("Model thị giác trả loại nội dung không hợp lệ")
        if decision["action"] not in ACTIONS:
            raise RuntimeError("Model thị giác trả hành động không hợp lệ")
        if decision["style_preset"] not in STYLE_PRESETS:
            raise RuntimeError("Model thị giác trả phong cách không hợp lệ")
        if decision["mask_strategy"] not in MASK_STRATEGIES:
            raise RuntimeError("Model thị giác trả chiến lược mask không hợp lệ")
        decisions[block_id] = decision
    if decisions.keys() != expected_ids:
        missing = sorted(expected_ids - decisions.keys())
        raise RuntimeError(f"Model thị giác bỏ sót TextBlock: {missing}")
    return {"decisions": decisions, "page_note": str(payload.get("page_note") or "")[:300]}


def analyze_page_visually(
    rgb_image: np.ndarray,
    analysis: Mapping,
    blocks: list[Mapping],
) -> dict:
    """Ask a local VLM to supervise existing OCR blocks, never to edit pixels."""
    if not VISUAL_SUPERVISOR_ENABLED:
        raise VisualSupervisorUnavailable("Visual supervisor đang tắt")
    if not blocks:
        return {"decisions": {}, "page_note": "Trang không có TextBlock"}

    bubble_ids = _bubble_members(analysis)
    block_payload = []
    for block in blocks:
        x, y, width, height = _source_box(block)
        block_payload.append({
            "block_id": int(block["id"]),
            "bbox": [round(x, 1), round(y, 1), round(width, 1), round(height, 1)],
            "ocr_text": str(block.get("original_text") or ""),
            "inside_speech_bubble": int(block["id"]) in bubble_ids,
            "heuristic_type": str(block.get("content_type") or block.get("text_kind") or "dialogue"),
        })
    block_ids = [item["block_id"] for item in block_payload]
    schema = _response_schema(block_ids)
    prompt = {
        "task": "Review the annotated manga page. Cyan boxes T<ID> are existing OCR blocks.",
        "rules": [
            "Return exactly one decision for every supplied block_id and never invent an ID.",
            "dialogue/narration should normally be replaced; large stylized Japanese display text is sfx or skill.",
            "Every block containing meaningful Japanese must use action=replace even when it overlaps important artwork.",
            "Express artwork risk with mask_strategy=review or aggressive; risk is never a reason to preserve Japanese text.",
            "Use preserve only for a deliberate non-language visual mark; use skip only for noise or punctuation with no meaning.",
            "Use aggressive mask for large, outlined, fragmented or artwork-integrated Japanese glyphs.",
            "Use review when the box contains substantial character/scenery that a mask may damage.",
            "Choose style from the fixed enum. Keep the reason short and factual.",
            "Write every reason and page_note in Vietnamese for the Admin UI.",
        ],
        "image_size": [int(rgb_image.shape[1]), int(rgb_image.shape[0])],
        "blocks": block_payload,
    }
    headers = {"Content-Type": "application/json"}
    if VISUAL_SUPERVISOR_API_KEY:
        headers["Authorization"] = f"Bearer {VISUAL_SUPERVISOR_API_KEY}"
    request = {
        "model": VISUAL_SUPERVISOR_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a conservative manga visual supervisor. Analyze layout, Japanese display text, "
                    "speech bubbles and lettering style. You do not erase pixels. Return only schema-valid JSON."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": _annotated_image(rgb_image, blocks)}},
                    {"type": "text", "text": json.dumps(prompt, ensure_ascii=False)},
                ],
            },
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "manga_visual_policy", "strict": True, "schema": schema},
        },
        "temperature": 0,
        "reasoning_effort": "none",
        "max_tokens": max(1000, len(blocks) * 180),
    }
    try:
        response = httpx.post(
            VISUAL_SUPERVISOR_API_URL,
            headers=headers,
            json=request,
            timeout=VISUAL_SUPERVISOR_TIMEOUT,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text.strip().replace("\n", " ")[:400]
        raise VisualSupervisorUnavailable(
            f"Model thị giác trả lỗi {exc.response.status_code}: {detail}"
        ) from exc
    except httpx.HTTPError as exc:
        raise VisualSupervisorUnavailable(f"Không kết nối được model thị giác: {exc}") from exc
    try:
        content = response.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("API model thị giác trả cấu trúc không hợp lệ") from exc
    result = _parse_response(str(content), set(block_ids))
    result.update({"model": VISUAL_SUPERVISOR_MODEL, "enabled": True})
    return result


def merge_visual_policies(
    heuristic_policies: Mapping[int, Mapping],
    visual_result: Mapping,
    blocks: list[Mapping] | None = None,
) -> dict[int, dict]:
    """Merge high-confidence VLM decisions without overriding manual Editor choices."""
    merged = {int(block_id): dict(policy) for block_id, policy in heuristic_policies.items()}
    blocks_by_id = {int(block["id"]): block for block in (blocks or [])}
    for block_id, visual in visual_result.get("decisions", {}).items():
        block_id = int(block_id)
        if block_id not in merged:
            continue
        confidence = float(visual.get("confidence") or 0)
        if confidence < VISUAL_SUPERVISOR_MIN_CONFIDENCE:
            merged[block_id].setdefault("policy_reasons", []).append(
                f"AI thị giác chưa chắc chắn ({confidence:.0%})"
            )
            continue
        content_type = str(visual["content_type"])
        action = str(visual["action"])
        source_text = str(blocks_by_id.get(block_id, {}).get("original_text") or "")
        if action == "preserve" and content_type != "ignore" and JAPANESE_TEXT.search(source_text):
            # The VLM may flag a dangerous repair, but it must not silently
            # defeat the translate-on-image policy. QA still marks risky SFX.
            action = "replace"
        style = str(visual["style_preset"])
        text_kind = "sfx" if content_type in {"sfx", "skill", "title"} else "dialogue"
        translation_mode = "skip" if action == "skip" else "translate"
        render_mode = "preserve" if action in {"preserve", "skip"} else "replace"
        reasons = list(merged[block_id].get("policy_reasons", []))
        reason = str(visual.get("reason") or "").strip()
        if str(visual.get("action")) == "preserve" and action == "replace":
            reason = (reason + "; vẫn thay chữ theo chính sách tự động").strip("; ")
        reasons.append(
            f"AI thị giác {VISUAL_SUPERVISOR_MODEL} {confidence:.0%}"
            + (f": {reason}" if reason else "")
        )
        merged[block_id].update({
            "text_kind": text_kind,
            "content_type": content_type,
            "translation_mode": translation_mode,
            "render_mode": render_mode,
            "style_preset": style,
            "font_family": FONT_BY_STYLE.get(style, "Arial"),
            "sfx_score": max(float(merged[block_id].get("sfx_score") or 0), confidence if text_kind == "sfx" else 0),
            "mask_strategy": str(visual.get("mask_strategy") or "standard"),
            "visual_confidence": confidence,
            "visual_model": VISUAL_SUPERVISOR_MODEL,
            "policy_reasons": reasons,
        })
    return merged
