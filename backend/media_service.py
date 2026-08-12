from __future__ import annotations

import html
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from backend.study_analysis_service import GRAMMAR_HINTS, _base_tokens


@dataclass(frozen=True)
class SubtitleCue:
    text: str
    start: float = 0
    duration: float = 0


@dataclass(frozen=True)
class YouTubeSubtitleResult:
    video_id: str
    language_code: str
    track_name: str
    is_generated: bool
    cues: list[SubtitleCue]


TIMECODE_RE = re.compile(
    r"(?P<h>\d{1,2}):(?P<m>\d{2}):(?P<s>\d{2})[,.](?P<ms>\d{1,3})"
)
TAG_RE = re.compile(r"<[^>]+>")


def _seconds(value: str) -> float:
    match = TIMECODE_RE.search(value.strip())
    if not match:
        raise ValueError(f"Mốc thời gian phụ đề không hợp lệ: {value}")
    milliseconds = int(match.group("ms").ljust(3, "0")[:3])
    return (
        int(match.group("h")) * 3600
        + int(match.group("m")) * 60
        + int(match.group("s"))
        + milliseconds / 1000
    )


def _clean_caption_text(value: str) -> str:
    cleaned = TAG_RE.sub("", html.unescape(value))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def parse_subtitle_text(content: str) -> list[SubtitleCue]:
    """Parse SRT or WebVTT without pulling another parser into the app."""
    normalized = content.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    if normalized.startswith("WEBVTT"):
        normalized = normalized.split("\n", 1)[1] if "\n" in normalized else ""
    blocks = re.split(r"\n\s*\n", normalized)
    cues: list[SubtitleCue] = []
    for block in blocks:
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        if not lines:
            continue
        timing_index = next((index for index, line in enumerate(lines) if "-->" in line), None)
        if timing_index is None:
            continue
        timing = lines[timing_index].split("-->", 1)
        try:
            start = _seconds(timing[0])
            end = _seconds(timing[1].split()[0])
        except ValueError:
            continue
        text = _clean_caption_text(" ".join(lines[timing_index + 1 :]))
        if text:
            cues.append(SubtitleCue(text=text, start=start, duration=max(0, end - start)))
    if not cues:
        raise ValueError("Không tìm thấy câu phụ đề hợp lệ trong file SRT/VTT")
    return cues


def decode_subtitle_bytes(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "cp932", "shift_jis"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("Không đọc được mã chữ của file phụ đề")


def youtube_video_id(url: str) -> str:
    cleaned = url.strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", cleaned):
        return cleaned

    parsed = urlparse(cleaned)
    host = parsed.netloc.lower().split(":")[0]
    candidate = ""

    if host in {"youtu.be", "www.youtu.be"}:
        candidate = parsed.path.strip("/").split("/")[0]
    elif host.endswith("youtube.com") or host in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
        if parsed.path in {"/watch", "/watch_popup"}:
            candidate = parse_qs(parsed.query).get("v", [""])[0]
        elif parsed.path.startswith(("/embed/", "/shorts/", "/live/", "/v/")):
            parts = parsed.path.strip("/").split("/")
            if len(parts) >= 2:
                candidate = parts[1]
        else:
            query_v = parse_qs(parsed.query).get("v", [""])
            if query_v and query_v[0]:
                candidate = query_v[0]
            else:
                parts = [p for p in parsed.path.strip("/").split("/") if p]
                if parts and re.fullmatch(r"[A-Za-z0-9_-]{11}", parts[-1]):
                    candidate = parts[-1]

    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", candidate):
        match = re.search(r"(?:v=|\/embed\/|\/shorts\/|\/live\/|youtu\.be\/|\/v\/)([A-Za-z0-9_-]{11})", cleaned)
        if match:
            candidate = match.group(1)

    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", candidate):
        raise ValueError("URL YouTube không hợp lệ hoặc thiếu video id")
    return candidate


def _parse_xml_timedtext(xml_text: str) -> list[SubtitleCue]:
    """Parse both YouTube XML format 1 (<text start dur>) and format 3 / srv3 (<p t d>)."""
    cues: list[SubtitleCue] = []
    
    p_matches = list(re.finditer(r"<p\b([^>]*)>([\s\S]*?)</p>", xml_text, re.IGNORECASE))
    if p_matches:
        for m in p_matches:
            attrs, content = m.group(1), m.group(2)
            tm = re.search(r'\bt="(\d+)"', attrs)
            dm = re.search(r'\bd="(\d+)"', attrs)
            if not tm:
                continue
            start_sec = int(tm.group(1)) / 1000.0
            dur_sec = int(dm.group(1)) / 1000.0 if dm else 0.0
            clean_text = _clean_caption_text(content)
            if clean_text:
                cues.append(SubtitleCue(text=clean_text, start=start_sec, duration=dur_sec))
        if cues:
            return cues

    text_matches = list(re.finditer(r"<text\b([^>]*)>([\s\S]*?)</text>", xml_text, re.IGNORECASE))
    if text_matches:
        for m in text_matches:
            attrs, content = m.group(1), m.group(2)
            sm = re.search(r'\bstart="([^"]+)"', attrs)
            dm = re.search(r'\bdur="([^"]+)"', attrs)
            if not sm:
                continue
            start_sec = float(sm.group(1))
            dur_sec = float(dm.group(1)) if dm else 0.0
            clean_text = _clean_caption_text(content)
            if clean_text:
                cues.append(SubtitleCue(text=clean_text, start=start_sec, duration=dur_sec))
        if cues:
            return cues

    return cues


def _parse_json3_timedtext(json_data: dict) -> list[SubtitleCue]:
    events = json_data.get("events")
    if not isinstance(events, list):
        return []
    cues: list[SubtitleCue] = []
    for event in events:
        if not isinstance(event, dict) or "segs" not in event or event.get("tStartMs") is None:
            continue
        segs = event.get("segs", [])
        if not isinstance(segs, list):
            continue
        text = "".join(str(s.get("utf8", "")) for s in segs if isinstance(s, dict))
        clean_text = _clean_caption_text(text)
        if clean_text:
            start_sec = float(event.get("tStartMs", 0)) / 1000.0
            dur_sec = float(event.get("dDurationMs", 0)) / 1000.0
            cues.append(SubtitleCue(text=clean_text, start=start_sec, duration=dur_sec))
    return cues


def _fetch_direct_youtube_subtitles(video_id: str, language: str = "ja") -> YouTubeSubtitleResult | None:
    """Fallback: fetch watch page HTML directly and extract caption tracks."""
    import json
    import urllib.request

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    }
    url = f"https://www.youtube.com/watch?v={video_id}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            html_text = resp.read().decode("utf-8", errors="ignore")
    except Exception:
        return None

    m = re.search(r'"captionTracks":\s*(\[[\s\S]*?\])\s*,\s*"', html_text)
    if not m:
        m = re.search(r'"captionTracks":\s*(\[[\s\S]*?\])\s*\}', html_text)
    if not m:
        return None

    try:
        tracks = json.loads(m.group(1))
    except Exception:
        return None

    if not isinstance(tracks, list) or not tracks:
        return None

    norm_lang = language.strip().lower()
    
    def is_ja(tr: dict) -> bool:
        code = str(tr.get("languageCode") or "").lower()
        vss = str(tr.get("vssId") or "").lower()
        name = str(tr.get("name") or {}).lower() if isinstance(tr.get("name"), dict) else str(tr.get("name") or "").lower()
        return code == "ja" or code.startswith("ja-") or ".ja" in vss or "japan" in name or "日本語" in name

    def is_match(tr: dict, lang: str) -> bool:
        code = str(tr.get("languageCode") or "").lower()
        return code == lang or code.startswith(f"{lang}-")

    selected_track = None
    is_generated = False
    track_lang = language

    if norm_lang in {"ja", "auto", "*"}:
        for tr in tracks:
            kind = str(tr.get("kind") or "").lower()
            vss = str(tr.get("vssId") or "")
            tr_auto = kind == "asr" or vss.startswith("a.")
            if is_ja(tr) and not tr_auto:
                selected_track = tr
                is_generated = False
                track_lang = "ja"
                break
        if not selected_track:
            for tr in tracks:
                if is_ja(tr):
                    selected_track = tr
                    is_generated = True
                    track_lang = "ja"
                    break
    else:
        for tr in tracks:
            kind = str(tr.get("kind") or "").lower()
            vss = str(tr.get("vssId") or "")
            tr_auto = kind == "asr" or vss.startswith("a.")
            if is_match(tr, norm_lang) and not tr_auto:
                selected_track = tr
                is_generated = False
                track_lang = norm_lang
                break
        if not selected_track:
            for tr in tracks:
                if is_match(tr, norm_lang):
                    selected_track = tr
                    is_generated = True
                    track_lang = norm_lang
                    break

    auto_translated = False
    if not selected_track and tracks:
        base_tr = tracks[0]
        selected_track = dict(base_tr)
        base_url = str(selected_track.get("baseUrl") or "")
        target_tlang = "ja" if norm_lang in {"ja", "auto", "*"} else norm_lang
        sep = "&" if "?" in base_url else "?"
        selected_track["baseUrl"] = f"{base_url}{sep}tlang={target_tlang}"
        is_generated = True
        auto_translated = True
        track_lang = target_tlang

    if not selected_track:
        return None

    raw_base_url = str(selected_track.get("baseUrl") or "")
    if raw_base_url.startswith("//"):
        raw_base_url = f"https:{raw_base_url}"
    elif not raw_base_url.startswith("http"):
        raw_base_url = f"https://www.youtube.com{raw_base_url}"

    fetch_urls = [
        f"{raw_base_url}&fmt=json3" if "fmt=" not in raw_base_url else raw_base_url,
        raw_base_url,
    ]

    cues: list[SubtitleCue] = []
    for fetch_url in fetch_urls:
        try:
            sub_req = urllib.request.Request(fetch_url, headers=headers)
            with urllib.request.urlopen(sub_req, timeout=10) as sub_resp:
                sub_body = sub_resp.read().decode("utf-8", errors="ignore")
            if not sub_body.strip():
                continue
            if sub_body.strip().startswith("{"):
                cues = _parse_json3_timedtext(json.loads(sub_body))
            else:
                cues = _parse_xml_timedtext(sub_body)
            if cues:
                break
        except Exception:
            continue

    if not cues:
        return None

    track_name = str(selected_track.get("name") or {}).get("simpleText") if isinstance(selected_track.get("name"), dict) else str(selected_track.get("name") or track_lang)
    if auto_translated:
        track_name = f"{track_name} (Auto-translated to Japanese)"

    return YouTubeSubtitleResult(
        video_id=video_id,
        language_code=track_lang,
        track_name=track_name,
        is_generated=is_generated,
        cues=cues,
    )


def fetch_youtube_subtitle_result(
    video_url: str, language: str = "ja"
) -> YouTubeSubtitleResult:
    video_id = youtube_video_id(video_url)
    lang_code = language.strip().lower()
    errors: list[str] = []

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        api = YouTubeTranscriptApi()
        if hasattr(api, "list"):
            transcript_list = api.list(video_id)
        else:
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)

        target_transcript = None

        def is_ja_transcript(t) -> bool:
            code = getattr(t, "language_code", "").lower()
            name = getattr(t, "language", "").lower()
            return code == "ja" or code.startswith("ja-") or "japan" in name or "日本語" in name

        if lang_code in {"ja", "auto", "*"}:
            for t in transcript_list:
                if is_ja_transcript(t) and not bool(getattr(t, "is_generated", False)):
                    target_transcript = t
                    break
            if not target_transcript:
                for t in transcript_list:
                    if is_ja_transcript(t):
                        target_transcript = t
                        break
            if not target_transcript:
                for t in transcript_list:
                    if bool(getattr(t, "is_translatable", False)):
                        try:
                            target_transcript = t.translate("ja")
                            break
                        except Exception:
                            continue
        else:
            search_langs = [lang_code, f"{lang_code}-US", f"{lang_code}-GB"]
            try:
                target_transcript = transcript_list.find_manually_created_transcript(search_langs)
            except Exception:
                try:
                    target_transcript = transcript_list.find_generated_transcript(search_langs)
                except Exception:
                    try:
                        target_transcript = transcript_list.find_transcript(search_langs)
                    except Exception:
                        for t in transcript_list:
                            if bool(getattr(t, "is_translatable", False)):
                                try:
                                    target_transcript = t.translate(lang_code)
                                    break
                                except Exception:
                                    continue

        if not target_transcript:
            available = list(transcript_list)
            if available:
                target_transcript = next(
                    (item for item in available if not bool(getattr(item, "is_generated", False))),
                    available[0],
                )

        if target_transcript:
            fetched = target_transcript.fetch()
            cues = []
            for item in fetched:
                text = getattr(item, "text", None)
                start = getattr(item, "start", None)
                duration = getattr(item, "duration", None)
                if isinstance(item, dict):
                    text, start, duration = item.get("text"), item.get("start"), item.get("duration")
                cleaned = _clean_caption_text(str(text or ""))
                if cleaned:
                    cues.append(SubtitleCue(cleaned, float(start or 0), float(duration or 0)))
            if cues:
                return YouTubeSubtitleResult(
                    video_id=video_id,
                    language_code=str(getattr(target_transcript, "language_code", language)),
                    track_name=str(getattr(target_transcript, "language", language)),
                    is_generated=bool(getattr(target_transcript, "is_generated", False)),
                    cues=cues,
                )
    except Exception as exc:
        errors.append(f"YouTubeTranscriptApi: {type(exc).__name__}: {str(exc)[:120]}")

    try:
        direct_result = _fetch_direct_youtube_subtitles(video_id, language)
        if direct_result and direct_result.cues:
            return direct_result
    except Exception as exc:
        errors.append(f"DirectTimedtext: {type(exc).__name__}: {str(exc)[:120]}")

    raise RuntimeError(
        f"Không lấy được track phụ đề phù hợp từ YouTube ({' | '.join(errors) if errors else 'video không có phụ đề'})."
    )


def fetch_youtube_subtitles(video_url: str, language: str = "ja") -> tuple[str, list[SubtitleCue]]:
    result = fetch_youtube_subtitle_result(video_url, language)
    return result.video_id, result.cues


def katakana_to_hiragana(value: str) -> str:
    return "".join(chr(ord(char) - 0x60) if "ァ" <= char <= "ヶ" else char for char in value)


_AUXILIARY_NOTES_VI = {
    "ます": "đuôi lịch sự",
    "た": "thì quá khứ hoặc hành động đã hoàn thành",
    "ない": "dạng phủ định: không",
    "たい": "diễn tả mong muốn: muốn làm",
    "れる": "dạng bị động hoặc khả năng, tùy ngữ cảnh",
    "られる": "dạng bị động hoặc khả năng, tùy ngữ cảnh",
    "せる": "dạng sai khiến: làm/cho phép ai làm",
    "させる": "dạng sai khiến: làm/cho phép ai làm",
}


def _group_inflection_tokens(base_tokens: list[dict]) -> list[dict]:
    """Keep Sudachi morphology while presenting inflected words as one unit."""
    groups: list[dict] = []
    for raw in base_tokens:
        component = {
            "surface": str(raw.get("surface") or ""),
            "lemma": str(raw.get("lemma") or ""),
            "reading": str(raw.get("reading") or ""),
            "part_of_speech": str(raw.get("part_of_speech") or ""),
        }
        is_auxiliary = component["part_of_speech"] == "助動詞"
        can_attach = bool(groups) and groups[-1]["part_of_speech"] in {
            "動詞",
            "形容詞",
            "形状詞",
        }
        if is_auxiliary and can_attach:
            group = groups[-1]
            group["surface"] += component["surface"]
            group["reading"] += component["reading"]
            group["components"].append(component)
            continue

        group = dict(raw)
        group["surface"] = component["surface"]
        group["reading"] = component["reading"]
        group["part_of_speech"] = component["part_of_speech"]
        group["components"] = [component]
        groups.append(group)
    return groups


def _grammar_note_for_components(components: list[dict]) -> str:
    auxiliaries = [
        str(item.get("lemma") or "")
        for item in components
        if item.get("part_of_speech") == "助動詞"
    ]
    if not auxiliaries:
        return ""
    surface = "".join(str(item.get("surface") or "") for item in components)
    if auxiliaries == ["ます", "た"]:
        return f"{surface}: động từ dạng lịch sự ở thì quá khứ — hành động đã xảy ra."
    if auxiliaries == ["ない", "た"]:
        return f"{surface}: động từ dạng phủ định ở thì quá khứ — đã không làm."
    explanations = [
        _AUXILIARY_NOTES_VI.get(lemma, f"trợ động từ {lemma}")
        for lemma in auxiliaries
    ]
    return f"{surface}: " + "; ".join(explanations) + "."


def extension_analysis(text: str, *, include_definitions: bool = True) -> dict:
    """Fast deterministic shape consumed by the Hakkutsu browser extension."""
    base_tokens = _group_inflection_tokens(
        _base_tokens(text, include_dictionary=include_definitions)
    )
    tokens = []
    for token in base_tokens:
        gloss = token.get("dictionary_gloss") or ""
        definitions = []
        if include_definitions and gloss:
            definitions.append({
                "dictionary": "JMdict (English)",
                "glosses": [
                    item.strip()
                    for item in gloss.split(";")
                    if item.strip()
                ],
                "pos": [],
            })
        surface = str(token.get("surface") or "")
        # jlpt_level is already populated by _base_tokens (Jamdict → classifier).
        # For grouped inflection tokens we inherit from the first component.
        jlpt_level: str | None = token.get("jlpt_level") or None
        tokens.append({
            "surface": surface,
            "dictionary_form": token.get("lemma") or surface,
            "reading": {
                "hiragana": katakana_to_hiragana(str(token.get("reading") or "")),
                "romaji": "",
            },
            "pos": token.get("part_of_speech") or "",
            "pos_detail": [],
            "is_japanese": bool(re.search(r"[\u3040-\u30ff\u3400-\u9fff]", surface)),
            "jlpt_level": jlpt_level,
            "frequency_rank": None,
            "definitions": definitions,
            "components": token.get("components", []),
            "grammar_note_vi": _grammar_note_for_components(
                token.get("components", [])
            ),
        })
    grammar = [
        {"pattern": pattern, "meaning": explanation, "explanation": explanation, "jlpt_level": None}
        for pattern, explanation in GRAMMAR_HINTS.items()
        if pattern in text
    ]
    return {
        "text": text,
        "tokens": tokens,
        "sentence_reading": "".join(item["reading"]["hiragana"] for item in tokens),
        "token_count": len(tokens),
        "difficulty_score": None,
        "difficulty_label": None,
        "grammar_patterns": grammar,
    }


def subtitle_title_from_filename(filename: str) -> str:
    return Path(filename or "phu-de").stem[:500]
