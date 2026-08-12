from __future__ import annotations

from dataclasses import dataclass
import json
import re
from threading import Lock
from typing import Protocol

import httpx

from backend.config import (
    GEMINI_API_KEY,
    GEMINI_API_URL,
    GEMINI_MODEL,
    GEMINI_TIMEOUT,
    TRANSLATION_API_KEY,
    TRANSLATION_API_URL,
    TRANSLATION_MODEL,
    TRANSLATION_TIMEOUT,
    UPLOAD_DIR,
    is_gemini_configured,
)
from backend.database import db_session, utc_now
from backend.typesetting_service import suggest_font_size


@dataclass(frozen=True)
class TranslationBlock:
    id: int
    text: str
    text_kind: str = "dialogue"


class TranslationProvider(Protocol):
    name: str

    def translate(self, blocks: list[TranslationBlock], context: dict[str, object]) -> dict[int, str]: ...


class MissingTranslationsError(RuntimeError):
    """A valid response that contains only part of the requested IDs."""

    def __init__(self, missing_ids: set[int], translations: dict[int, str]) -> None:
        self.missing_ids = set(missing_ids)
        self.translations = dict(translations)
        super().__init__(f"Mô hình bỏ sót TextBlock: {sorted(self.missing_ids)}")


class OpenAiCompatibleTranslationProvider:
    name = "openai-compatible"

    def __init__(
        self,
        api_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self._api_url = api_url or TRANSLATION_API_URL
        self._api_key = api_key if api_key is not None else TRANSLATION_API_KEY
        self._model = model or TRANSLATION_MODEL
        self._timeout = timeout if timeout is not None else TRANSLATION_TIMEOUT

        if not self._api_url:
            raise RuntimeError("TRANSLATION_API_URL chưa được cấu hình")
        is_local = self._api_url.startswith(("http://127.0.0.1", "http://localhost"))
        if not self._api_key and not is_local:
            raise RuntimeError(
                "Chưa có khóa dịch. Hãy đặt TRANSLATION_API_KEY hoặc GEMINI_API_KEY."
            )
        self._is_local = is_local
        self.name = f"openai-compatible:{self._model}"

    def translate(self, blocks: list[TranslationBlock], context: dict[str, object]) -> dict[int, str]:
        source = [
            {"id": block.id, "text": block.text, "text_kind": block.text_kind}
            for block in blocks
        ]
        system_prompt = (
            "Bạn là biên dịch viên manga Nhật-Việt. Dịch tự nhiên theo ngữ cảnh toàn trang, "
            "giữ nhất quán tên riêng và cách xưng hô, giữ sắc thái cảm xúc và âm thanh. "
            "Ưu tiên lời thoại Việt Nam ngắn gọn, đời thường; tuyệt đối tránh từ Hán-Việt cổ hoặc "
            "dịch từng chữ gây máy móc. 先輩 phải là 'đàn anh' hoặc 'tiền bối', không dùng 'cao niên'. "
            "Khi あの đứng trước cách gọi một người và mang sắc thái ngập ngừng, hãy dịch là "
            "'ờm...', 'à...' thay vì 'người kia'. ぐずぐずするな mang nghĩa đừng chần chừ/lề mề. "
            "Các id trong cùng bubble_group là lời thoại ở gần nhau để tham khảo ngữ cảnh và bố cục, "
            "nhưng vẫn phải trả riêng đúng từng id. "
            "Với text_kind=sfx, hãy phân biệt âm thanh và tên chiêu. Tên chiêu phải dịch đủ mọi "
            "thành phần có nghĩa, ngắn gọn như một tên kỹ năng; không được bỏ mất danh từ chính. "
            "Ví dụ 閃光拳 là 'Quyền chớp sáng', không phải chỉ 'Phát sáng'. "
            "Không giải thích. Trả về JSON có dạng "
            "{\"translations\":[{\"id\":123,\"text\":\"bản dịch\"}]}. "
            "Phải trả đúng một kết quả cho mỗi id đầu vào và không được thay đổi id."
        )
        if context.get("content_type") == "webpage":
            system_prompt = (
                "Bạn là biên dịch viên Nhật-Việt cho nội dung trang web. "
                "Dịch tự nhiên, chính xác theo tiêu đề và ngữ cảnh trang; giữ nguyên tên riêng, "
                "số, URL và thuật ngữ kỹ thuật. Không giải thích, không thêm nội dung. "
                "Trả về JSON dạng "
                "{\"translations\":[{\"id\":123,\"text\":\"bản dịch\"}]}. "
                "Phải trả đúng một kết quả cho mỗi id đầu vào và không thay đổi id."
            )
        user_payload = {
            "context": context,
            "source_language": "Japanese",
            "target_language": "Vietnamese",
            "blocks": source,
        }
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        translation_schema = {
            "type": "object",
            "properties": {
                "translations": {
                    "type": "array",
                    "minItems": len(blocks),
                    "maxItems": len(blocks),
                    "items": {
                        "type": "object",
                        "properties": {
                            # Constrain local structured-output models to the
                            # IDs in this request. Small models otherwise
                            # occasionally increment a database ID even when
                            # the translated text itself is valid.
                            "id": {
                                "type": "integer",
                                "enum": [block.id for block in blocks],
                            },
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
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
            "response_format": response_format,
            "temperature": 0,
        }
        if self._is_local:
            # Ollama exposes this OpenAI-compatible field for thinking models.
            # Translation needs the final structured answer, not a long trace.
            payload["reasoning_effort"] = "none"
        else:
            payload["max_tokens"] = min(8192, max(1024, len(blocks) * 160))
        try:
            response = httpx.post(
                self._api_url,
                headers=headers,
                json=payload,
                timeout=self._timeout,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text.strip().replace("\n", " ")[:500]
            raise RuntimeError(f"API dịch ({self._model}) trả lỗi {exc.response.status_code}: {detail}") from exc
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Không kết nối được API dịch ({self._model}): {exc}") from exc

        try:
            content = response.json()["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise RuntimeError("API dịch trả về cấu trúc không hợp lệ") from exc
        return parse_translation_response(str(content), {block.id for block in blocks})


class GeminiTranslationProvider(OpenAiCompatibleTranslationProvider):
    name = "gemini"

    def __init__(self) -> None:
        if not is_gemini_configured():
            raise RuntimeError("GEMINI_API_KEY chưa được cấu hình")
        super().__init__(
            api_url=GEMINI_API_URL,
            api_key=GEMINI_API_KEY,
            model=GEMINI_MODEL,
            timeout=GEMINI_TIMEOUT,
        )
        self.name = f"gemini:{GEMINI_MODEL}"


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
    # A one-block retry is unambiguous even if a small local model mutates the
    # numeric ID (for example 2223 -> 2224). Recover that response instead of
    # throwing away a valid translation. Multi-block responses remain strict:
    # silently remapping them could attach dialogue to the wrong bubble.
    sole_expected_id = next(iter(expected_ids)) if len(expected_ids) == 1 and len(items) == 1 else None
    for item in items:
        try:
            block_id = int(item["id"])
            text = str(item["text"]).strip()
        except (KeyError, TypeError, ValueError) as exc:
            raise RuntimeError("Một kết quả dịch thiếu id hoặc text") from exc
        if sole_expected_id is not None and block_id not in expected_ids:
            block_id = sole_expected_id
        if block_id in translated:
            raise RuntimeError(f"Mô hình trả trùng TextBlock {block_id}")
        if block_id not in expected_ids:
            raise RuntimeError(f"Mô hình trả TextBlock lạ {block_id}")
        if not text:
            raise RuntimeError(f"Bản dịch TextBlock {block_id} bị trống")
        translated[block_id] = text

    missing = expected_ids - translated.keys()
    if missing:
        raise MissingTranslationsError(missing, translated)
    return translated


PUNCTUATION_ONLY = re.compile(r"^[\s\W_・ー…。、！？．·]+$", re.UNICODE)


def _chunks(items: list[TranslationBlock], size: int) -> list[list[TranslationBlock]]:
    return [items[index:index + size] for index in range(0, len(items), size)]


def google_translate_free(text: str, sl: str = "ja", tl: str = "vi") -> str:
    """Free public Google Translate fallback requiring zero API keys."""
    cleaned = text.strip()
    if not cleaned:
        return ""
    import urllib.parse
    import urllib.request
    try:
        url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl={sl}&tl={tl}&dt=t&q={urllib.parse.quote(cleaned)}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req, timeout=4) as res:
            data = json.loads(res.read().decode("utf-8"))
            if data and isinstance(data, list) and data[0]:
                return "".join(item[0] for item in data[0] if item and item[0]).strip()
    except Exception:
        pass
    return ""


def translate_blocks_resilient(
    provider: TranslationProvider,
    blocks: list[TranslationBlock],
    context: dict[str, object],
    *,
    batch_size: int = 5,
    retry_count: int = 2,
) -> dict[int, str]:
    """Translate small batches and retry only IDs omitted by the model."""
    translated: dict[int, str] = {}
    meaningful: list[TranslationBlock] = []
    for block in blocks:
        text = block.text.strip()
        if not text or PUNCTUATION_ONLY.fullmatch(text):
            translated[block.id] = text
        else:
            meaningful.append(block)

    for batch in _chunks(meaningful, max(1, batch_size)):
        pending = list(batch)
        last_error: Exception | None = None
        for _attempt in range(max(1, retry_count)):
            if not pending:
                break
            expected = {block.id for block in pending}
            request_context = dict(context)
            request_context["requested_ids"] = sorted(expected)
            request_context["bubble_groups"] = [
                [block_id for block_id in group if block_id in expected]
                for group in context.get("bubble_groups", [])
                if any(block_id in expected for block_id in group)
            ]
            try:
                result = provider.translate(pending, request_context)
            except MissingTranslationsError as exc:
                result = exc.translations
                last_error = exc
            except Exception as exc:
                result = {}
                last_error = exc

            valid = {
                int(block_id): str(text).strip()
                for block_id, text in result.items()
                if int(block_id) in expected and str(text).strip()
            }
            translated.update(valid)
            pending = [block for block in pending if block.id not in valid]

        # Local models become more reliable when the remaining sentences are
        # isolated instead of making the whole page fail again.
        for block in list(pending):
            request_context = dict(context)
            request_context["requested_ids"] = [block.id]
            request_context["bubble_groups"] = [
                [block.id] for group in context.get("bubble_groups", []) if block.id in group
            ]
            try:
                result = provider.translate([block], request_context)
            except MissingTranslationsError as exc:
                result = exc.translations
                last_error = exc
            except Exception as exc:
                last_error = exc
                continue
            text = str(result.get(block.id, "")).strip()
            if text:
                translated[block.id] = text
                pending.remove(block)

        # Fallback to Gemini if the primary provider failed and Gemini is configured
        if pending and is_gemini_configured() and not provider.name.startswith("gemini"):
            try:
                gemini_provider = GeminiTranslationProvider()
                gemini_result = gemini_provider.translate(pending, context)
                for block in list(pending):
                    text = str(gemini_result.get(block.id, "")).strip()
                    if text:
                        translated[block.id] = text
                        pending.remove(block)
            except Exception as exc:
                last_error = exc

        # Fallback to Free Google Translate so translations never fail
        if pending:
            for block in list(pending):
                try:
                    gt_res = google_translate_free(block.text, "ja", "vi")
                    if gt_res:
                        translated[block.id] = gt_res
                        pending.remove(block)
                except Exception:
                    pass

        if pending:
            missing = sorted(block.id for block in pending)
            detail = f": {last_error}" if last_error else ""
            raise RuntimeError(f"Không dịch được TextBlock {missing}{detail}")

    return translated



_provider: TranslationProvider | None = None
_provider_lock = Lock()


def get_translation_provider() -> TranslationProvider:
    global _provider
    if _provider is None:
        with _provider_lock:
            if _provider is None:
                try:
                    _provider = OpenAiCompatibleTranslationProvider()
                except RuntimeError:
                    if is_gemini_configured():
                        _provider = GeminiTranslationProvider()
                    else:
                        raise
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
            SELECT id, original_text, text_kind, width, height, font_family FROM text_blocks
            WHERE page_id = ? AND TRIM(original_text) <> ''
              AND COALESCE(translation_mode, 'translate') = 'translate'
            ORDER BY y, x DESC, id
            """,
            (page_id,),
        ).fetchall()

    try:
        blocks = [
            TranslationBlock(
                int(row["id"]),
                row["original_text"],
                row["text_kind"] or "dialogue",
            )
            for row in rows
        ]
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
            # Page context helps wording, but including other TextBlock IDs
            # makes small-model retries copy an ID that was not requested.
            "page_context_texts": [block.text for block in blocks],
        }
        translations = translate_blocks_resilient(get_translation_provider(), blocks, context)
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
