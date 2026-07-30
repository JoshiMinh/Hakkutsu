from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable, Iterator


FEATURE_NAMES = [
    "char_length",
    "word_count",
    "font_size_mean",
    "font_size_max",
    "bold_ratio",
    "italic_ratio",
    "uppercase_ratio",
    "is_centered",
    "is_justified",
    "is_right_aligned",
    "first_line_indent",
    "left_indent",
    "space_before",
    "space_after",
    "has_numbering",
    "numbering_depth",
    "outline_level",
    "is_in_table",
    "is_header",
    "is_footer",
    "page_break_before",
    "style_is_heading",
    "style_is_caption",
    "style_is_list",
]


@dataclass(slots=True)
class ParagraphRecord:
    document_id: str
    paragraph_id: str
    index: int
    text: str
    label: str
    label_source: str
    label_confidence: float
    zone: str
    style_name: str = ""
    features: dict[str, float] = field(default_factory=dict)
    previous_text: str = ""
    next_text: str = ""

    def feature_vector(self) -> list[float]:
        return [float(self.features.get(name, 0.0)) for name in FEATURE_NAMES]

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "ParagraphRecord":
        return cls(**data)


def write_jsonl(path: Path, records: Iterable[ParagraphRecord]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8", newline="\n") as stream:
        for record in records:
            stream.write(json.dumps(record.to_dict(), ensure_ascii=False) + "\n")
            count += 1
    return count


def read_jsonl(path: Path) -> Iterator[ParagraphRecord]:
    with path.open("r", encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                yield ParagraphRecord.from_dict(json.loads(line))

