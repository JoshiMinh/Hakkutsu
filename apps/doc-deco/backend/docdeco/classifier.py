from __future__ import annotations

import hashlib
import json
import os
import re

import httpx

from .models import Classification, ParagraphInput, SemanticRole

NUMBERED = re.compile(r"^\s*(?P<num>(?:\d+|[IVXLC]+)(?:\.\d+){0,3})[.)]?\s+\S", re.I)
BULLET = re.compile(r"^\s*(?:[-–—•▪◦*+]|[a-zA-ZđĐ][.)]|\d+[.)])\s+\S")
HEADING_WORD = re.compile(
    r"^\s*(?:chương|chapter|phần|part|mục|bài|tiết|phụ lục)\s+"
    r"(?:\d+|[IVXLC]+|[A-ZĐ])(?:\s*[:.–-]|\s+)", re.I
)
CAPTION = re.compile(r"^\s*(?:hình|bảng|biểu đồ|sơ đồ|ảnh|figure|table)\s*\d+", re.I)
NOTE = re.compile(r"^\s*(?:ghi chú|chú ý|lưu ý|note)\s*[:：-]", re.I)
QUOTE = re.compile(r"^\s*[“\"『「].+[”\"』」]\s*$", re.S)
SENTENCE_END = re.compile(r"[.!?。！？;:]\s*$")


def text_hash(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text.strip())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:20]


def _result(p: ParagraphInput, role: SemanticRole, confidence: float, reason: str, level: int = 0):
    return Classification(
        paragraph_id=p.paragraph_id, text_hash=text_hash(p.text), role=role,
        level=level, confidence=confidence, source="rule", reason=reason,
        style_key=role.value,
    )


DETAILED_TO_STYLE = {
    "cover_institution": "subtitle", "cover_faculty": "subtitle",
    "cover_project_type": "subtitle", "document_title": "title",
    "author_metadata": "body", "supervisor_metadata": "body",
    "date_location": "body", "front_matter_title": "heading_1",
    "toc_title": "heading_1", "toc_entry": "body",
    "list_of_figures_title": "heading_1", "list_of_figures_entry": "body",
    "heading_1": "heading_1", "heading_2": "heading_2",
    "heading_3": "heading_3", "heading_4": "heading_3",
    "body": "body", "list_item": "list_item",
    "figure_caption": "caption", "table_caption": "caption",
    "usecase_name": "heading_3", "usecase_field": "body",
    "table_content": "body", "quote": "quote", "note": "note",
    "header": "body", "footer": "body", "page_number": "body",
}


async def classify_with_trained_model(
    document_id: str, p: ParagraphInput
) -> Classification | None:
    if os.getenv("DOCDECO_TRAINED_MODEL_ENABLED", "true").lower() not in {"1", "true", "yes"}:
        return None
    url = os.getenv("DOCDECO_MODEL_SERVICE_URL", "http://127.0.0.1:8011").rstrip("/")
    features = dict(p.layout_features)
    letters = [char for char in p.text if char.isalpha()]
    features.setdefault(
        "uppercase_ratio",
        sum(char.isupper() for char in letters) / max(len(letters), 1),
    )
    features.setdefault("style_is_heading", float(p.current_style.lower().startswith("heading")))
    features.setdefault("style_is_caption", float("caption" in p.current_style.lower()))
    features.setdefault("style_is_list", float("list" in p.current_style.lower()))
    paragraphs = [
        {
            "paragraph_id": f"{p.paragraph_id}-previous", "index": max(p.index - 1, 0),
            "text": p.previous_text, "style_name": "", "features": {},
        },
        {
            "paragraph_id": p.paragraph_id, "index": p.index, "text": p.text,
            "style_name": p.current_style, "features": features,
            "previous_text": p.previous_text, "next_text": p.next_text,
        },
        {
            "paragraph_id": f"{p.paragraph_id}-next", "index": p.index + 1,
            "text": p.next_text, "style_name": "", "features": {},
        },
    ]
    paragraphs = [item for item in paragraphs if item["text"].strip()]
    current_index = next(index for index, item in enumerate(paragraphs) if item["paragraph_id"] == p.paragraph_id)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{url}/predict", json={"document_id": document_id, "paragraphs": paragraphs}
            )
            response.raise_for_status()
        prediction = response.json()[current_index]
        semantic_label = prediction["label"]
        role = SemanticRole(DETAILED_TO_STYLE[semantic_label])
        level = int(role.value[-1]) if role.value.startswith("heading_") else 0
        return Classification(
            paragraph_id=p.paragraph_id, text_hash=text_hash(p.text),
            role=role, level=level, confidence=float(prediction["confidence"]),
            source="context_model",
            reason=f"Context model: {semantic_label}.",
            style_key=role.value, semantic_label=semantic_label,
        )
    except (httpx.HTTPError, KeyError, ValueError, IndexError):
        return None


def classify_rules(p: ParagraphInput) -> Classification:
    text = re.sub(r"\s+", " ", p.text.strip())
    if not text:
        return _result(p, SemanticRole.BODY, 1, "Đoạn trống được giữ ở kiểu Normal.")
    style = p.current_style.lower()
    built_in = {
        "title": SemanticRole.TITLE, "subtitle": SemanticRole.SUBTITLE,
        "heading 1": SemanticRole.HEADING_1, "heading 2": SemanticRole.HEADING_2,
        "heading 3": SemanticRole.HEADING_3, "caption": SemanticRole.CAPTION,
        "quote": SemanticRole.QUOTE,
    }
    if style in built_in:
        role = built_in[style]
        return _result(p, role, .99, f"Giữ vai trò ngữ nghĩa từ style Word hiện có: {p.current_style}.")
    if NOTE.match(text):
        return _result(p, SemanticRole.NOTE, .98, "Nhận diện tiền tố ghi chú/lưu ý.")
    if CAPTION.match(text):
        return _result(p, SemanticRole.CAPTION, .98, "Nhận diện chú thích hình hoặc bảng.")
    if QUOTE.match(text):
        return _result(p, SemanticRole.QUOTE, .9, "Đoạn được bao bởi dấu trích dẫn.")
    if p.is_first_non_empty and len(text) <= 120 and not SENTENCE_END.search(text):
        return _result(p, SemanticRole.TITLE, .92, "Đoạn ngắn đầu tiên không kết thúc như câu văn.")
    if HEADING_WORD.match(text):
        token = text.lower().split(maxsplit=1)[0]
        level = 1 if token in {"chương", "chapter", "phần", "part"} else 2
        role = SemanticRole.HEADING_1 if level == 1 else SemanticRole.HEADING_2
        return _result(p, role, .97, "Nhận diện từ khóa tiêu đề cấu trúc.", level)
    numbered = NUMBERED.match(text)
    if numbered:
        depth = numbered.group("num").count(".") + 1
        level = min(depth, 3)
        role = (SemanticRole.HEADING_1, SemanticRole.HEADING_2, SemanticRole.HEADING_3)[level - 1]
        if len(text) <= 140 and not SENTENCE_END.search(text):
            return _result(p, role, .9, f"Tiêu đề đánh số có độ sâu {depth}.", level)
    if BULLET.match(text):
        return _result(p, SemanticRole.LIST_ITEM, .96, "Nhận diện ký hiệu hoặc số thứ tự đầu dòng.")
    words = text.split()
    if len(words) <= 12 and len(text) <= 100 and not SENTENCE_END.search(text):
        return _result(
            p, SemanticRole.HEADING_2, .64,
            "Đoạn ngắn giống tiêu đề nhưng chưa đủ tín hiệu chắc chắn.", 2,
        )
    return _result(p, SemanticRole.BODY, .88, "Đoạn văn thông thường.")


async def classify_with_ollama(p: ParagraphInput, fallback: Classification) -> Classification:
    enabled = os.getenv("DOCDECO_MODEL_ENABLED", "false").lower() in {"1", "true", "yes"}
    if not enabled or (fallback.confidence >= .75 and not p.force_model):
        return fallback
    base = os.getenv("DOCDECO_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
    model = os.getenv("DOCDECO_MODEL", "qwen3:1.7b")
    roles = ", ".join(role.value for role in SemanticRole)
    prompt = f"""Phân loại vai trò bố cục của đoạn tiếng Việt. Chỉ trả JSON.
Roles: {roles}
Đoạn trước: {p.previous_text[:400]}
Đoạn cần phân loại: {p.text[:1000]}
Đoạn sau: {p.next_text[:400]}
JSON: {{"role":"body","confidence":0.8,"reason":"..."}}"""
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(f"{base}/api/chat", json={
                "model": model, "stream": False, "format": "json",
                "messages": [{"role": "user", "content": prompt}],
                "options": {"temperature": 0},
            })
            response.raise_for_status()
        raw = response.json()["message"]["content"]
        data = json.loads(raw)
        role = SemanticRole(data["role"])
        confidence = min(max(float(data.get("confidence", .7)), 0), 1)
        return Classification(
            paragraph_id=p.paragraph_id, text_hash=text_hash(p.text), role=role,
            level=int(role.value[-1]) if role.value.startswith("heading_") else 0,
            confidence=confidence, source="ollama",
            reason=str(data.get("reason", "Phân loại bởi model local.")),
            style_key=role.value,
        )
    except (httpx.HTTPError, KeyError, ValueError, json.JSONDecodeError):
        fallback.reason += " Model local không khả dụng; đã dùng luật."
        return fallback
