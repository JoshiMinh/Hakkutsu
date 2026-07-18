from __future__ import annotations

import hashlib
import json
import re
from threading import Lock

import httpx

from app.config import JAMDICT_DB_PATH, TRANSLATION_API_KEY, TRANSLATION_API_URL, TRANSLATION_MODEL, TRANSLATION_TIMEOUT
from app.database import db_session, utc_now


GRAMMAR_HINTS = {
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


def _base_tokens(text: str) -> list[dict]:
    from sudachipy import tokenizer
    tokenizer_obj, jam = _resources()
    tokens = []
    for morpheme in tokenizer_obj.tokenize(text, tokenizer.Tokenizer.SplitMode.C):
        surface = morpheme.surface()
        if not surface.strip() or re.fullmatch(r"[\s。、！？!?…]+", surface):
            continue
        lemma = morpheme.dictionary_form() or surface
        meaning_en = ""
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
        "task": "Bổ sung meaning_vi ngắn gọn cho từng token và giải thích các mẫu ngữ pháp bằng tiếng Việt.",
    }
    payload = {
        "model": TRANSLATION_MODEL,
        "messages": [
            {"role": "system", "content": "Bạn là giáo viên tiếng Nhật. Chỉ trả JSON gồm tokens và grammar. Giữ nguyên surface, lemma, reading của token đầu vào. grammar là mảng {pattern, explanation_vi}."},
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0,
        "max_tokens": 3000,
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
    if not isinstance(enriched.get("tokens"), list) or not isinstance(enriched.get("grammar"), list):
        raise RuntimeError("Model local trả dữ liệu phân tích Study không đúng định dạng")
    if len(enriched["tokens"]) != len(tokens):
        raise RuntimeError("Model local trả thiếu từ vựng trong phân tích Study")
    safe_tokens = []
    for base, generated in zip(tokens, enriched["tokens"]):
        if not isinstance(generated, dict):
            raise RuntimeError("Model local trả token Study không đúng định dạng")
        safe = dict(base)
        safe["meaning_vi"] = str(generated.get("meaning_vi") or "").strip()
        safe_tokens.append(safe)
    grammar = [
        {"pattern": str(item.get("pattern") or "").strip(),
         "explanation_vi": str(item.get("explanation_vi") or "").strip()}
        for item in enriched["grammar"] if isinstance(item, dict) and item.get("explanation_vi")
    ]
    return {"tokens": safe_tokens, "grammar": grammar}


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
        raise RuntimeError(f"Model local không tạo được nhóm phân tích Study: {exc}") from exc
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
