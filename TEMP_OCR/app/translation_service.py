from __future__ import annotations

from dataclasses import dataclass
import json
import re
from threading import Lock
from typing import Protocol

import httpx

from app.config import (
    TRANSLATION_API_KEY,
    TRANSLATION_API_URL,
    TRANSLATION_MODEL,
    TRANSLATION_TIMEOUT,
    UPLOAD_DIR,
)
from app.database import db_session, utc_now
from app.typesetting_service import suggest_font_size


@dataclass(frozen=True)
class TranslationBlock:
    id: int
    text: str


class TranslationProvider(Protocol):
    name: str

    def translate(self, blocks: list[TranslationBlock], context: dict[str, object]) -> dict[int, str]: ...


class OpenAiCompatibleTranslationProvider:
    name = "openai-compatible"

    def __init__(self) -> None:
        if not TRANSLATION_API_URL:
            raise RuntimeError("TRANSLATION_API_URL chưa được cấu hình")
        is_local = TRANSLATION_API_URL.startswith(("http://127.0.0.1", "http://localhost"))
        if not TRANSLATION_API_KEY and not is_local:
            raise RuntimeError(
                "Chưa có khóa dịch. Hãy đặt TRANSLATION_API_KEY hoặc DEEPSEEK_API_KEY."
            )
        self._is_local = is_local
        self.name = f"openai-compatible:{TRANSLATION_MODEL}"

    def translate(self, blocks: list[TranslationBlock], context: dict[str, object]) -> dict[int, str]:
        source = [{"id": block.id, "text": block.text} for block in blocks]
        system_prompt = (
            "Bạn là biên dịch viên manga Nhật-Việt. Dịch tự nhiên theo ngữ cảnh toàn trang, "
            "giữ nhất quán tên riêng và cách xưng hô, giữ sắc thái cảm xúc và âm thanh. "
            "Ưu tiên lời thoại Việt Nam ngắn gọn, đời thường; tuyệt đối tránh từ Hán-Việt cổ hoặc "
            "dịch từng chữ gây máy móc. 先輩 phải là 'đàn anh' hoặc 'tiền bối', không dùng 'cao niên'. "
            "Khi あの đứng trước cách gọi một người và mang sắc thái ngập ngừng, hãy dịch là "
            "'ờm...', 'à...' thay vì 'người kia'. ぐずぐずするな mang nghĩa đừng chần chừ/lề mề. "
            "Các id trong cùng bubble_group là lời thoại ở gần nhau để tham khảo ngữ cảnh và bố cục, "
            "nhưng vẫn phải trả riêng đúng từng id. "
            "Không giải thích. Trả về JSON có dạng "
            "{\"translations\":[{\"id\":123,\"text\":\"bản dịch\"}]}. "
            "Phải trả đúng một kết quả cho mỗi id đầu vào và không được thay đổi id."
        )
        user_payload = {
            "context": context,
            "source_language": "Japanese",
            "target_language": "Vietnamese",
            "blocks": source,
        }
        headers = {"Content-Type": "application/json"}
        if TRANSLATION_API_KEY:
            headers["Authorization"] = f"Bearer {TRANSLATION_API_KEY}"
        translation_schema = {
            "type": "object",
            "properties": {
                "translations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "integer"},
                            "text": {"type": "string"},
                        },
                        "required": ["id", "text"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["translations"],
            "additionalProperties": False,
        }
        response_format = {"type": "json_object"}
        if self._is_local:
            response_format = {
                "type": "json_schema",
                "json_schema": {
                    "name": "translation_response",
                    "strict": True,
                    "schema": translation_schema,
                },
            }
        payload = {
            "model": TRANSLATION_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
            "response_format": response_format,
            "temperature": 0,
            "max_tokens": min(8192, max(1024, len(blocks) * 160)),
        }
        if self._is_local:
            # Ollama exposes this OpenAI-compatible field for thinking models.
            # Translation needs the final structured answer, not a long trace.
            payload["reasoning_effort"] = "none"
        try:
            response = httpx.post(
                TRANSLATION_API_URL,
                headers=headers,
                json=payload,
                timeout=TRANSLATION_TIMEOUT,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text.strip().replace("\n", " ")[:500]
            raise RuntimeError(f"API dịch trả lỗi {exc.response.status_code}: {detail}") from exc
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Không kết nối được API dịch: {exc}") from exc

        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise RuntimeError("API dịch trả về cấu trúc không hợp lệ") from exc
        return parse_translation_response(str(content), {block.id for block in blocks})


def parse_translation_response(content: str, expected_ids: set[int]) -> dict[int, str]:
    cleaned = content.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", cleaned, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        cleaned = fenced.group(1)
    try:
        payload = json.loads(cleaned)
        items = payload["translations"]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise RuntimeError("Mô hình dịch không trả về JSON đúng định dạng") from exc
    if not isinstance(items, list):
        raise RuntimeError("Trường translations phải là một danh sách")

    translated: dict[int, str] = {}
    for item in items:
        try:
            block_id = int(item["id"])
            text = str(item["text"]).strip()
        except (KeyError, TypeError, ValueError) as exc:
            raise RuntimeError("Một kết quả dịch thiếu id hoặc text") from exc
        if block_id in translated:
            raise RuntimeError(f"Mô hình trả trùng TextBlock {block_id}")
        if block_id not in expected_ids:
            raise RuntimeError(f"Mô hình trả TextBlock lạ {block_id}")
        if not text:
            raise RuntimeError(f"Bản dịch TextBlock {block_id} bị trống")
        translated[block_id] = text

    missing = expected_ids - translated.keys()
    if missing:
        raise RuntimeError(f"Mô hình bỏ sót TextBlock: {sorted(missing)}")
    return translated


_provider: TranslationProvider | None = None
_provider_lock = Lock()


def get_translation_provider() -> TranslationProvider:
    global _provider
    if _provider is None:
        with _provider_lock:
            if _provider is None:
                _provider = OpenAiCompatibleTranslationProvider()
    return _provider


def run_translation_job(job_id: int, page_id: int) -> None:
    now = utc_now()
    with db_session() as connection:
        connection.execute(
            "UPDATE processing_jobs SET status = 'processing', progress = 0.1, updated_at = ? WHERE id = ?",
            (now, job_id),
        )
        page = connection.execute(
            """
            SELECT p.page_number, c.chapter_number, c.title AS chapter_title,
                   m.title AS manga_title, p.bubble_analysis_path
            FROM pages p
            JOIN chapters c ON c.id = p.chapter_id
            JOIN manga m ON m.id = c.manga_id
            WHERE p.id = ?
            """,
            (page_id,),
        ).fetchone()
        rows = connection.execute(
            """
            SELECT id, original_text, width, height, font_family FROM text_blocks
            WHERE page_id = ? AND TRIM(original_text) <> ''
            ORDER BY y, x DESC, id
            """,
            (page_id,),
        ).fetchall()

    try:
        blocks = [TranslationBlock(int(row["id"]), row["original_text"]) for row in rows]
        bubble_groups: list[list[int]] = []
        analysis_relative_path = page["bubble_analysis_path"]
        if analysis_relative_path:
            analysis_path = UPLOAD_DIR / analysis_relative_path
            if analysis_path.is_file():
                try:
                    analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
                    valid_ids = {block.id for block in blocks}
                    for region in analysis.get("regions", []):
                        member_ids = [
                            int(item["text_block_id"])
                            for item in region.get("text_blocks", [])
                            if int(item["text_block_id"]) in valid_ids
                        ]
                        if len(member_ids) > 1:
                            bubble_groups.append(member_ids)
                except (OSError, ValueError, KeyError, TypeError):
                    bubble_groups = []
        context: dict[str, object] = {
            "manga": page["manga_title"],
            "chapter": str(page["chapter_number"]),
            "chapter_title": page["chapter_title"] or "",
            "page": str(page["page_number"]),
            "bubble_groups": bubble_groups,
        }
        translations = get_translation_provider().translate(blocks, context)
        now = utc_now()
        with db_session() as connection:
            for block in blocks:
                translated = translations[block.id]
                source_row = next(row for row in rows if int(row["id"]) == block.id)
                font_size = suggest_font_size(
                    translated,
                    float(source_row["width"]),
                    float(source_row["height"]),
                    source_row["font_family"],
                )
                connection.execute(
                    """
                    UPDATE text_blocks
                    SET final_translation = CASE
                            WHEN TRIM(final_translation) = '' OR final_translation = ai_translation
                            THEN ? ELSE final_translation END,
                        ai_translation = ?, font_size = ?, updated_at = ?
                    WHERE id = ? AND page_id = ?
                    """,
                    (translated, translated, font_size, now, block.id, page_id),
                )
            connection.execute(
                """
                UPDATE processing_jobs
                SET status = 'completed', progress = 1, result_count = ?, updated_at = ?
                WHERE id = ?
                """,
                (len(translations), now, job_id),
            )
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
