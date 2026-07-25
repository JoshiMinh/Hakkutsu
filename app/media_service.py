from __future__ import annotations

import html
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from app.study_analysis_service import GRAMMAR_HINTS, _base_tokens


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
    parsed = urlparse(url.strip())
    host = parsed.netloc.lower().split(":")[0]
    if host in {"youtu.be", "www.youtu.be"}:
        candidate = parsed.path.strip("/").split("/")[0]
    elif host.endswith("youtube.com"):
        if parsed.path == "/watch":
            candidate = parse_qs(parsed.query).get("v", [""])[0]
        elif parsed.path.startswith(("/embed/", "/shorts/", "/live/")):
            candidate = parsed.path.strip("/").split("/")[1]
        else:
            candidate = ""
    else:
        candidate = ""
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", candidate):
        raise ValueError("URL YouTube không hợp lệ hoặc thiếu video id")
    return candidate


def fetch_youtube_subtitle_result(
    video_url: str, language: str = "ja"
) -> YouTubeSubtitleResult:
    video_id = youtube_video_id(video_url)
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError as exc:
        raise RuntimeError(
            "Thiếu youtube-transcript-api. Hãy chạy pip install -r requirements.txt"
        ) from exc

    try:
        api = YouTubeTranscriptApi()
        if hasattr(api, "list"):
            transcript_list = api.list(video_id)
        else:  # compatibility with youtube-transcript-api < 1.0
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
        if language.strip().lower() in {"auto", "*"}:
            available = list(transcript_list)
            if not available:
                raise RuntimeError("Video không có subtitle track")
            transcript = next(
                (item for item in available if not bool(getattr(item, "is_generated", False))),
                available[0],
            )
        else:
            try:
                transcript = transcript_list.find_manually_created_transcript([language])
            except Exception:
                try:
                    transcript = transcript_list.find_generated_transcript([language])
                except Exception:
                    transcript = transcript_list.find_transcript([language])
        fetched = transcript.fetch()
    except Exception as exc:
        detail = str(exc).strip().replace("\n", " ")
        if len(detail) > 500:
            detail = detail[:500] + "..."
        raise RuntimeError(
            "Không lấy được track phụ đề phù hợp trực tiếp từ YouTube "
            f"({type(exc).__name__}: {detail or 'không có chi tiết'})."
        ) from exc

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
    if not cues:
        raise RuntimeError("Track phụ đề YouTube tồn tại nhưng không chứa câu nào")
    return YouTubeSubtitleResult(
        video_id=video_id,
        language_code=str(getattr(transcript, "language_code", language)),
        track_name=str(getattr(transcript, "language", language)),
        is_generated=bool(getattr(transcript, "is_generated", False)),
        cues=cues,
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
            "jlpt_level": None,
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
