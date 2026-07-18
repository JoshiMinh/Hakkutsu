import json
import re
from threading import Lock
from typing import Protocol, List, Dict
import httpx

from app.core.config import settings
from app.models.manga_studio import TextBlock, Page, Manga, Chapter

class TranslationProvider(Protocol):
    name: str

    def translate(self, blocks: List[TextBlock], context: Dict[str, object]) -> Dict[str, str]: ...

class OpenAiCompatibleTranslationProvider:
    name = "openai-compatible"

    def __init__(self) -> None:
        if not settings.TRANSLATION_API_URL:
            raise RuntimeError("TRANSLATION_API_URL is not configured")
        
        is_local = settings.TRANSLATION_API_URL.startswith(("http://127.0.0.1", "http://localhost"))
        if not settings.TRANSLATION_API_KEY and not is_local:
            raise RuntimeError("Translation API key is required.")
        
        self._is_local = is_local
        self.name = f"openai-compatible:{settings.TRANSLATION_MODEL}"

    def translate(self, blocks: List[TextBlock], context: Dict[str, object]) -> Dict[str, str]:
        source = [{"id": block.id, "text": block.original_text} for block in blocks if block.original_text.strip()]
        if not source:
            return {}

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
            "{\"translations\":[{\"id\":\"123\",\"text\":\"bản dịch\"}]}. "
            "Phải trả đúng một kết quả cho mỗi id đầu vào và không được thay đổi id."
        )
        user_payload = {
            "context": context,
            "source_language": "Japanese",
            "target_language": "Vietnamese",
            "blocks": source,
        }
        headers = {"Content-Type": "application/json"}
        if settings.TRANSLATION_API_KEY:
            headers["Authorization"] = f"Bearer {settings.TRANSLATION_API_KEY}"
            
        translation_schema = {
            "type": "object",
            "properties": {
                "translations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
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
            "model": settings.TRANSLATION_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
            "response_format": response_format,
            "temperature": 0,
            "max_tokens": min(8192, max(1024, len(blocks) * 160)),
        }
        
        if self._is_local:
            payload["reasoning_effort"] = "none"
            
        try:
            response = httpx.post(
                settings.TRANSLATION_API_URL,
                headers=headers,
                json=payload,
                timeout=settings.TRANSLATION_TIMEOUT,
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
            
        return parse_translation_response(str(content), {block.id for block in blocks if block.original_text.strip()})


def parse_translation_response(content: str, expected_ids: set[str]) -> Dict[str, str]:
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

    translated: Dict[str, str] = {}
    for item in items:
        try:
            block_id = str(item["id"])
            text = str(item["text"]).strip()
        except (KeyError, TypeError, ValueError) as exc:
            raise RuntimeError("Một kết quả dịch thiếu id hoặc text") from exc
            
        if block_id in translated:
            raise RuntimeError(f"Mô hình trả trùng TextBlock {block_id}")
        if block_id not in expected_ids:
            continue # ignore unknown ids for safety
        if not text:
            continue
        translated[block_id] = text

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

def translate_page(manga: Manga, chapter: Chapter, page: Page, text_blocks: List[TextBlock]) -> List[TextBlock]:
    """Translates the text blocks using the configured provider and returns the updated blocks."""
    from app.services.typesetting_service import suggest_font_size
    
    valid_blocks = [b for b in text_blocks if b.original_text.strip()]
    if not valid_blocks:
        return text_blocks
        
    context: Dict[str, object] = {
        "manga": manga.title,
        "chapter": chapter.chapter_number,
        "chapter_title": chapter.title,
        "page": str(page.page_number),
        "bubble_groups": [], # Bubble groups logic can be integrated if analysis exists
    }
    
    translations = get_translation_provider().translate(valid_blocks, context)
    
    for block in text_blocks:
        if block.id in translations:
            translated_text = translations[block.id]
            font_size = suggest_font_size(
                translated_text,
                block.width,
                block.height,
                block.font_family
            )
            block.ai_translation = translated_text
            
            # Auto-apply to final if it's empty or hasn't been manually edited
            if not block.final_translation.strip() or block.final_translation == block.ai_translation:
                block.final_translation = translated_text
                
            block.font_size = font_size
            
    return text_blocks
