from __future__ import annotations

import hashlib
import json
import re
from functools import lru_cache
from threading import Lock

import httpx

from app.config import (
    JAMDICT_DB_PATH,
    JAVI_ANALYSIS_API_KEY,
    JAVI_ANALYSIS_API_URL,
    JAVI_ANALYSIS_MODEL,
    JAVI_ANALYSIS_TIMEOUT,
    TRANSLATION_API_KEY,
    TRANSLATION_API_URL,
    TRANSLATION_MODEL,
    TRANSLATION_TIMEOUT,
)
from app.database import db_session, utc_now


GRAMMAR_HINTS = {
    "というわけではない": "Không hẳn là…; phủ định một cách hiểu hoặc kết luận quá rộng.",
    "なければならない": "Diễn tả nghĩa vụ: phải làm.",
    "なくてはいけない": "Diễn tả nghĩa vụ: phải làm, nếu không thì không được.",
    "なければいけない": "Diễn tả nghĩa vụ: phải làm.",
    "ことになっている": "Diễn tả quy định, lịch trình hoặc điều đã được quyết định.",
    "ことができる": "Diễn tả khả năng: có thể làm.",
    "たことがある": "Diễn tả kinh nghiệm đã từng làm.",
    "たほうがいい": "Đưa ra lời khuyên: nên làm.",
    "わけではない": "Không hẳn là/không có nghĩa là.",
    "かもしれない": "Diễn tả khả năng chưa chắc chắn: có thể/có lẽ.",
    "に違いない": "Phỏng đoán có độ chắc chắn cao: chắc chắn là.",
    "ようにする": "Cố gắng tạo thành thói quen hoặc chủ động làm sao cho.",
    "ようになる": "Diễn tả sự thay đổi để trở nên/có thể làm.",
    "ことにする": "Người nói tự quyết định sẽ làm.",
    "てはいけない": "Diễn tả sự cấm đoán: không được làm.",
    "てもいい": "Diễn tả sự cho phép: có thể làm.",
    "てしまう": "Làm xong hoàn toàn hoặc thể hiện sự tiếc nuối ngoài ý muốn.",
    "てもらう": "Nhận hành động giúp đỡ từ người khác.",
    "てくれる": "Người khác làm điều gì đó cho người nói/nhóm người nói.",
    "てあげる": "Làm điều gì đó cho người khác.",
    "ておく": "Làm trước để chuẩn bị hoặc giữ nguyên trạng thái.",
    "てみる": "Thử làm một việc.",
    "について": "Nêu chủ đề: về/liên quan đến.",
    "に対して": "Đối với/đối chiếu với một đối tượng.",
    "によって": "Tùy theo, do, bởi hoặc bằng phương tiện nào đó.",
    "として": "Với tư cách là.",
    "という": "Dùng để trích dẫn, gọi tên hoặc giải thích nội dung.",
    "と思う": "Nêu suy nghĩ hoặc nhận định: tôi nghĩ rằng.",
    "んです": "Mẫu giải thích/nhấn mạnh bối cảnh, dạng hội thoại của のです.",
    "のです": "Mẫu giải thích hoặc nhấn mạnh nguyên nhân/bối cảnh.",
    "そうだ": "Có vẻ như hoặc nghe nói rằng, tùy cấu trúc đứng trước.",
    "らしい": "Nghe nói/có vẻ đúng chất, dựa trên thông tin hoặc dấu hiệu.",
    "みたい": "Cách nói thân mật của ようだ: giống như/có vẻ.",
    "ながら": "Hai hành động diễn ra đồng thời: vừa… vừa…",
    "ために": "Diễn tả mục đích hoặc nguyên nhân: để/vì.",
    "ように": "Diễn tả mục tiêu, lời nhắc hoặc cách thức: để sao cho.",
    "ばかり": "Chỉ/toàn là hoặc vừa mới làm, tùy cấu trúc.",
    "べき": "Nêu điều nên làm hoặc trách nhiệm mang tính chuẩn mực.",
    "はず": "Phỏng đoán có căn cứ: lẽ ra/chắc là.",
    "ので": "Nêu nguyên nhân với sắc thái mềm và khách quan.",
    "のに": "Nêu sự tương phản ngoài mong đợi: mặc dù/thế mà.",
    "ない": "Dạng phủ định: không làm/không có.",
    "たい": "Diễn tả mong muốn làm một hành động.",
    "ている": "Diễn tả hành động đang diễn ra hoặc trạng thái đang tiếp diễn.",
    "から": "Nêu nguyên nhân hoặc điểm bắt đầu, tùy ngữ cảnh.",
    "けど": "Nối ý tương phản nhẹ: nhưng/mặc dù.",
    "の？": "Cách hỏi thân mật, thường yêu cầu giải thích hoặc xác nhận.",
}

_resources_lock = Lock()
_tokenizer_resource = None
_jamdict_resource = None
_resources_ready = False


def _resources():
    global _tokenizer_resource, _jamdict_resource, _resources_ready
    if not _resources_ready:
        with _resources_lock:
            if not _resources_ready:
                try:
                    from sudachipy import dictionary
                except ImportError as exc:
                    raise RuntimeError("Thiếu SudachiPy/sudachidict_core để chuẩn bị dữ liệu Study") from exc
                _tokenizer_resource = dictionary.Dictionary().create()
                try:
                    from jamdict import Jamdict
                    _jamdict_resource = Jamdict(db_file=str(JAMDICT_DB_PATH)) if JAMDICT_DB_PATH.is_file() else Jamdict()
                except Exception:
                    _jamdict_resource = None
                _resources_ready = True
    return _tokenizer_resource, _jamdict_resource


def _base_tokens(text: str, *, include_dictionary: bool = True) -> list[dict]:
    from sudachipy import tokenizer
    tokenizer_obj, jam = _resources()
    tokens = []
    for morpheme in tokenizer_obj.tokenize(text, tokenizer.Tokenizer.SplitMode.C):
        surface = morpheme.surface()
        if not surface.strip() or re.fullmatch(r"[\s。、！？!?…]+", surface):
            continue
        lemma = morpheme.dictionary_form() or surface
        meaning_en = ""
        if include_dictionary:
            try:
                lookup = jam.lookup(lemma) if jam is not None else None
                if lookup and lookup.entries and lookup.entries[0].senses:
                    glosses = lookup.entries[0].senses[0].gloss
                    meaning_en = "; ".join(str(item.text) for item in glosses[:3])
            except Exception:
                meaning_en = ""
        tokens.append({
            "surface": surface,
            "lemma": lemma,
            "reading": morpheme.reading_form() or "",
            "part_of_speech": morpheme.part_of_speech()[0],
            "meaning_vi": "",
            "dictionary_gloss": meaning_en,
        })
    return tokens


def _ai_enrich(text: str, translation: str, tokens: list[dict]) -> dict:
    if not TRANSLATION_API_URL:
        raise RuntimeError("Chưa cấu hình model local để phân tích Study")
    headers = {"Content-Type": "application/json"}
    if TRANSLATION_API_KEY:
        headers["Authorization"] = f"Bearer {TRANSLATION_API_KEY}"
    prompt = {
        "japanese": text,
        "vietnamese_translation": translation,
        "tokens": tokens,
        "task": "Trả meanings_vi theo đúng thứ tự và đúng số lượng token, kèm giải thích ngữ pháp tiếng Việt.",
    }
    response_format = {"type": "json_object"}
    if TRANSLATION_API_URL.startswith(("http://127.0.0.1", "http://localhost")):
        response_format = {"type": "json_schema", "json_schema": {
            "name": "study_sentence_analysis", "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "meanings_vi": {
                        "type": "array", "items": {"type": "string"},
                        "minItems": len(tokens), "maxItems": len(tokens),
                    },
                    "grammar": {
                        "type": "array", "items": {
                            "type": "object",
                            "properties": {
                                "pattern": {"type": "string"},
                                "explanation_vi": {"type": "string"},
                            },
                            "required": ["pattern", "explanation_vi"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["meanings_vi", "grammar"],
                "additionalProperties": False,
            },
        }}
    payload = {
        "model": TRANSLATION_MODEL,
        "messages": [
            {"role": "system", "content": "Bạn là giáo viên tiếng Nhật. Chỉ trả JSON gồm meanings_vi và grammar. meanings_vi phải đúng thứ tự, đúng số phần tử token đầu vào. Không lặp lại metadata token."},
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ],
        "response_format": response_format,
        "temperature": 0,
        "max_tokens": min(3000, 900 + len(tokens) * 120),
    }
    if TRANSLATION_API_URL.startswith(("http://127.0.0.1", "http://localhost")):
        payload["reasoning_effort"] = "none"
    try:
        response = httpx.post(TRANSLATION_API_URL, headers=headers, json=payload, timeout=TRANSLATION_TIMEOUT)
        response.raise_for_status()
        content = str(response.json()["choices"][0]["message"]["content"]).strip()
        fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", content, flags=re.DOTALL | re.IGNORECASE)
        enriched = json.loads(fenced.group(1) if fenced else content)
    except Exception as exc:
        raise RuntimeError(f"Model local không tạo được phân tích Study: {exc}") from exc
    if not isinstance(enriched.get("grammar"), list):
        raise RuntimeError("Model local trả dữ liệu phân tích Study không đúng định dạng")
    meanings = enriched.get("meanings_vi")
    # Backward compatibility for OpenAI-compatible providers that still obey
    # the older token-object prompt shape.
    if meanings is None and isinstance(enriched.get("tokens"), list):
        meanings = [
            item.get("meaning_vi", "") if isinstance(item, dict) else ""
            for item in enriched["tokens"]
        ]
    if not isinstance(meanings, list) or len(meanings) != len(tokens):
        raise RuntimeError("Model local trả thiếu từ vựng trong phân tích Study")
    safe_tokens = []
    for base, meaning in zip(tokens, meanings):
        safe = dict(base)
        safe["meaning_vi"] = str(meaning or "").strip()
        safe_tokens.append(safe)
    grammar = [
        {"pattern": str(item.get("pattern") or "").strip(),
         "explanation_vi": str(item.get("explanation_vi") or "").strip()}
        for item in enriched["grammar"] if isinstance(item, dict) and item.get("explanation_vi")
    ]
    return {"tokens": safe_tokens, "grammar": grammar}


@lru_cache(maxsize=512)
def analyze_phrase_deep(text: str) -> dict:
    """Translate and analyze one subtitle with a single cached model call."""
    clean_text = text.strip()
    tokens = _base_tokens(clean_text, include_dictionary=False)
    if not TRANSLATION_API_URL:
        raise RuntimeError("Chưa cấu hình model local để phân tích câu")
    headers = {"Content-Type": "application/json"}
    if TRANSLATION_API_KEY:
        headers["Authorization"] = f"Bearer {TRANSLATION_API_KEY}"
    schema = {
        "type": "object",
        "properties": {
            "translation": {"type": "string"},
            "meanings_vi": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": len(tokens),
                "maxItems": len(tokens),
            },
            "grammar": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string"},
                        "explanation_vi": {"type": "string"},
                    },
                    "required": ["pattern", "explanation_vi"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["translation", "meanings_vi", "grammar"],
        "additionalProperties": False,
    }
    response_format: dict = {"type": "json_object"}
    is_local = TRANSLATION_API_URL.startswith(
        ("http://127.0.0.1", "http://localhost")
    )
    if is_local:
        response_format = {
            "type": "json_schema",
            "json_schema": {
                "name": "subtitle_sentence_analysis",
                "strict": True,
                "schema": schema,
            },
        }
    prompt_tokens = [
        {
            "surface": token["surface"],
            "lemma": token["lemma"],
            "part_of_speech": token["part_of_speech"],
        }
        for token in tokens
    ]
    payload = {
        "model": TRANSLATION_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Bạn là giáo viên tiếng Nhật cho người Việt. Dịch tự nhiên sang "
                    "tiếng Việt, giải nghĩa từng token đúng thứ tự và giải thích các "
                    "mẫu ngữ pháp theo ngữ cảnh. Chỉ trả JSON đúng schema."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {"japanese": clean_text, "tokens": prompt_tokens},
                    ensure_ascii=False,
                ),
            },
        ],
        "response_format": response_format,
        "temperature": 0,
        "max_tokens": min(1400, 320 + len(tokens) * 70),
    }
    if is_local:
        payload["reasoning_effort"] = "none"
    try:
        response = httpx.post(
            TRANSLATION_API_URL,
            headers=headers,
            json=payload,
            timeout=TRANSLATION_TIMEOUT,
        )
        response.raise_for_status()
        content = str(response.json()["choices"][0]["message"]["content"]).strip()
        fenced = re.fullmatch(
            r"```(?:json)?\s*(.*?)\s*```",
            content,
            flags=re.DOTALL | re.IGNORECASE,
        )
        result = json.loads(fenced.group(1) if fenced else content)
    except Exception as exc:
        raise RuntimeError(f"Model local không phân tích được câu: {exc}") from exc
    meanings = result.get("meanings_vi")
    if not isinstance(meanings, list) or len(meanings) != len(tokens):
        raise RuntimeError("Model local trả sai số lượng nghĩa token")
    grammar = result.get("grammar")
    if not isinstance(grammar, list):
        raise RuntimeError("Model local trả ngữ pháp không đúng định dạng")
    return {
        "translation": str(result.get("translation") or "").strip(),
        "meanings_vi": [str(item or "").strip() for item in meanings],
        "grammar": grammar,
    }


@lru_cache(maxsize=2048)
def analyze_phrase_javi(text: str) -> dict:
    """Use the fine-tuned Hakkutsu Ja–Vi model with its training schema."""
    clean_text = text.strip()
    tokens = _base_tokens(clean_text, include_dictionary=False)
    if not JAVI_ANALYSIS_API_URL or not JAVI_ANALYSIS_MODEL:
        raise RuntimeError("Chưa cấu hình model Hakkutsu Ja–Vi")
    headers = {"Content-Type": "application/json"}
    if JAVI_ANALYSIS_API_KEY:
        headers["Authorization"] = f"Bearer {JAVI_ANALYSIS_API_KEY}"
    token_schema = {
        "type": "object",
        "properties": {
            "surface": {"type": "string"},
            "lemma": {"type": "string"},
            "reading": {"type": "string"},
            "pos_vi": {"type": "string"},
            "meaning_vi": {"type": "string"},
            "grammar_role_vi": {"type": "string"},
        },
        "required": [
            "surface",
            "lemma",
            "reading",
            "pos_vi",
            "meaning_vi",
            "grammar_role_vi",
        ],
        "additionalProperties": False,
    }
    grammar_schema = {
        "type": "object",
        "properties": {
            "pattern": {"type": "string"},
            "span": {"type": "string"},
            "explanation_vi": {"type": "string"},
        },
        "required": ["pattern", "span", "explanation_vi"],
        "additionalProperties": False,
    }
    schema = {
        "type": "object",
        "properties": {
            "translation_vi": {"type": "string"},
            "tokens": {"type": "array", "items": token_schema},
            "grammar": {"type": "array", "items": grammar_schema},
        },
        "required": ["translation_vi", "tokens", "grammar"],
        "additionalProperties": False,
    }
    payload = {
        "model": JAVI_ANALYSIS_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Bạn là model Hakkutsu chuyên Nhật-Việt. Dịch tự nhiên và "
                    "phân tích biến đổi/ngữ pháp theo toàn câu. Chỉ trả JSON."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "task": "analyze",
                        "japanese": clean_text,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "hakkutsu_javi_analysis",
                "strict": True,
                "schema": schema,
            },
        },
        "reasoning_effort": "none",
        "temperature": 0,
        "max_tokens": min(1100, 260 + len(tokens) * 70),
    }
    try:
        response = httpx.post(
            JAVI_ANALYSIS_API_URL,
            headers=headers,
            json=payload,
            timeout=JAVI_ANALYSIS_TIMEOUT,
        )
        response.raise_for_status()
        content = str(response.json()["choices"][0]["message"]["content"]).strip()
        fenced = re.fullmatch(
            r"```(?:json)?\s*(.*?)\s*```",
            content,
            flags=re.DOTALL | re.IGNORECASE,
        )
        result = json.loads(fenced.group(1) if fenced else content)
    except Exception as exc:
        raise RuntimeError(f"Model Hakkutsu Ja–Vi không phân tích được câu: {exc}") from exc
    model_tokens = result.get("tokens")
    grammar = result.get("grammar")
    if not isinstance(model_tokens, list) or not isinstance(grammar, list):
        raise RuntimeError("Model Hakkutsu Ja–Vi trả sai schema")
    meanings = [
        str(item.get("meaning_vi") or "").strip()
        for item in model_tokens
        if isinstance(item, dict)
    ]
    if len(meanings) < len(tokens):
        meanings.extend([""] * (len(tokens) - len(meanings)))
    return {
        "translation": str(result.get("translation_vi") or "").strip(),
        "meanings_vi": meanings[:len(tokens)],
        "grammar": grammar,
    }


def _ai_enrich_batch(items: list[dict]) -> list[dict]:
    if len(items) == 1:
        item = items[0]
        return [_ai_enrich(item["text"], item["translation"], item["tokens"])]
    headers = {"Content-Type": "application/json"}
    if TRANSLATION_API_KEY:
        headers["Authorization"] = f"Bearer {TRANSLATION_API_KEY}"
    prompt_items = [
        {"index": index, "japanese": item["text"],
         "vietnamese_translation": item["translation"], "tokens": item["tokens"]}
        for index, item in enumerate(items)
    ]
    result_properties = {
        str(index): {
            "type": "object",
            "properties": {
                "meanings_vi": {"type": "array", "items": {"type": "string"},
                                "minItems": len(item["tokens"]), "maxItems": len(item["tokens"])},
                "grammar": {"type": "array", "items": {"type": "object", "properties": {
                    "pattern": {"type": "string"}, "explanation_vi": {"type": "string"}},
                    "required": ["pattern", "explanation_vi"], "additionalProperties": False}},
            },
            "required": ["meanings_vi", "grammar"], "additionalProperties": False,
        }
        for index, item in enumerate(items)
    }
    response_format = {"type": "json_object"}
    if TRANSLATION_API_URL.startswith(("http://127.0.0.1", "http://localhost")):
        response_format = {"type": "json_schema", "json_schema": {
            "name": "study_batch_analysis", "strict": True,
            "schema": {"type": "object", "properties": {
                "results": {"type": "object", "properties": result_properties,
                            "required": list(result_properties), "additionalProperties": False}},
                "required": ["results"], "additionalProperties": False},
        }}
    payload = {
        "model": TRANSLATION_MODEL,
        "messages": [
            {"role": "system", "content": "Bạn là giáo viên tiếng Nhật. Trả đúng JSON theo schema. results dùng key số của câu. meanings_vi đúng thứ tự token, grammar gồm pattern và explanation_vi."},
            {"role": "user", "content": json.dumps({"items": prompt_items}, ensure_ascii=False)},
        ],
        "response_format": response_format, "temperature": 0,
        "max_tokens": min(7000, 1200 + len(items) * 1200),
    }
    if TRANSLATION_API_URL.startswith(("http://127.0.0.1", "http://localhost")):
        payload["reasoning_effort"] = "none"
    try:
        response = httpx.post(TRANSLATION_API_URL, headers=headers, json=payload, timeout=TRANSLATION_TIMEOUT)
        response.raise_for_status()
        content = str(response.json()["choices"][0]["message"]["content"]).strip()
        fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", content, flags=re.DOTALL | re.IGNORECASE)
        parsed = json.loads(fenced.group(1) if fenced else content)
        if "results" in parsed:
            generated_items = [dict(parsed["results"][str(index)], index=index) for index in range(len(items))]
        else:
            generated_items = parsed["items"]
    except Exception as exc:
        # Small local models occasionally truncate or corrupt a large strict
        # JSON response even though every sentence is valid on its own. Keep
        # batching as the fast path, then degrade to one request per sentence
        # so one malformed group cannot abort the whole publication snapshot.
        try:
            return [
                _ai_enrich(item["text"], item["translation"], item["tokens"])
                for item in items
            ]
        except Exception as fallback_exc:
            raise RuntimeError(
                f"Model local không tạo được phân tích Study sau khi thử lại từng câu: {fallback_exc}"
            ) from fallback_exc
    by_index = {int(item["index"]): item for item in generated_items if isinstance(item, dict) and "index" in item}
    results = []
    for index, source in enumerate(items):
        generated = by_index.get(index)
        meanings = generated.get("meanings_vi") if generated else None
        if meanings is None and generated and isinstance(generated.get("tokens"), list):
            meanings = [token.get("meaning_vi", "") if isinstance(token, dict) else "" for token in generated["tokens"]]
        if not isinstance(meanings, list) or len(meanings) != len(source["tokens"]):
            # Qwen đôi lúc tự gộp token khi xử lý nhiều câu. Chỉ fallback
            # các câu trong nhóm này, không làm hỏng toàn bộ lần xuất bản.
            return [_ai_enrich(item["text"], item["translation"], item["tokens"]) for item in items]
        safe_tokens = []
        for base, meaning in zip(source["tokens"], meanings):
            safe = dict(base)
            safe["meaning_vi"] = str(meaning or "").strip()
            safe_tokens.append(safe)
        grammar = [
            {"pattern": str(item.get("pattern") or "").strip(),
             "explanation_vi": str(item.get("explanation_vi") or "").strip()}
            for item in generated.get("grammar", []) if isinstance(item, dict) and item.get("explanation_vi")
        ]
        results.append({"tokens": safe_tokens, "grammar": grammar})
    return results


def _finish_analysis(text: str, digest: str, analysis: dict) -> dict:
    hints = [
        {"pattern": pattern, "explanation_vi": explanation}
        for pattern, explanation in GRAMMAR_HINTS.items() if pattern in text
    ]
    existing = {item.get("pattern") for item in analysis["grammar"] if isinstance(item, dict)}
    analysis["grammar"].extend(item for item in hints if item["pattern"] not in existing)
    now = utc_now()
    with db_session() as connection:
        connection.execute(
            "INSERT OR REPLACE INTO study_analysis_cache (text_hash, source_text, analysis_json, created_at, updated_at) VALUES (?, ?, ?, COALESCE((SELECT created_at FROM study_analysis_cache WHERE text_hash = ?), ?), ?)",
            (digest, text, json.dumps(analysis, ensure_ascii=False), digest, now, now),
        )
    return analysis


def analyze_sentences(pairs: list[tuple[str, str]], *, batch_size: int = 4, progress_callback=None) -> list[dict]:
    results: list[dict | None] = [None] * len(pairs)
    missing: list[dict] = []
    with db_session() as connection:
        for index, (text, translation) in enumerate(pairs):
            digest = hashlib.sha256(f"{text}\n{translation}".encode("utf-8")).hexdigest()
            cached = connection.execute(
                "SELECT analysis_json FROM study_analysis_cache WHERE text_hash = ?", (digest,)
            ).fetchone()
            if cached:
                results[index] = json.loads(cached["analysis_json"])
            else:
                missing.append({"index": index, "text": text, "translation": translation,
                                "digest": digest, "tokens": _base_tokens(text)})
    for start in range(0, len(missing), batch_size):
        chunk = missing[start:start + batch_size]
        generated = _ai_enrich_batch(chunk)
        for item, analysis in zip(chunk, generated):
            results[item["index"]] = _finish_analysis(item["text"], item["digest"], analysis)
        if progress_callback:
            progress_callback(min(start + len(chunk), len(missing)), len(missing))
    return [item if item is not None else {"tokens": [], "grammar": []} for item in results]


def analyze_sentence(text: str, translation: str) -> dict:
    return analyze_sentences([(text, translation)], batch_size=1)[0]
