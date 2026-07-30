from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from collections import Counter
from contextlib import closing
from pathlib import Path

from .extract_docx import extract_docx
from .records import FEATURE_NAMES, ParagraphRecord, write_jsonl
from .synthetic import generate_synthetic

FEEDBACK_ROLE_MAP = {
    "title": "document_title",
    "subtitle": "cover_project_type",
    "heading1": "heading_1",
    "heading2": "heading_2",
    "heading3": "heading_3",
    "body": "body",
    "caption": "figure_caption",
}


def _split(document_id: str) -> str:
    bucket = int(hashlib.sha256(document_id.encode()).hexdigest()[:8], 16) % 100
    return "train" if bucket < 80 else ("validation" if bucket < 90 else "test")


def _feedback_records(path: Path) -> list[ParagraphRecord]:
    if not path.exists():
        return []
    records: list[ParagraphRecord] = []
    with closing(sqlite3.connect(path)) as db:
        db.row_factory = sqlite3.Row
        table = db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='feedback'"
        ).fetchone()
        if not table:
            return []
        rows = db.execute(
            "SELECT id, document_id, paragraph_id, text, corrected_role, context_json "
            "FROM feedback ORDER BY id"
        ).fetchall()
    for row in rows:
        label = FEEDBACK_ROLE_MAP.get(row["corrected_role"])
        if not label:
            continue
        try:
            context = json.loads(row["context_json"] or "{}")
        except json.JSONDecodeError:
            context = {}
        supplied = context.get("layout_features", context.get("features", {}))
        features = {
            name: float(supplied.get(name, 0.0))
            for name in FEATURE_NAMES
            if isinstance(supplied, dict)
        }
        text = row["text"].strip()
        features["char_length"] = min(len(text) / 500, 1)
        features["word_count"] = min(len(text.split()) / 100, 1)
        records.append(ParagraphRecord(
            document_id=f"feedback::{row['document_id']}",
            paragraph_id=f"feedback::{row['paragraph_id']}::{row['id']}",
            index=int(row["id"]),
            text=text,
            label=label,
            label_source="human_feedback",
            label_confidence=1.0,
            zone=str(context.get("zone", "main")),
            style_name=str(context.get("style_name", "")),
            features=features,
            previous_text=str(context.get("previous_text", "")),
            next_text=str(context.get("next_text", "")),
        ))
    return records


def build_dataset(
    raw_dir: Path,
    output_dir: Path,
    synthetic_documents: int,
    seed: int,
    feedback_db: Path | None = None,
) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    grouped: dict[str, list[ParagraphRecord]] = {"train": [], "validation": [], "test": []}
    errors: list[dict] = []
    documents: Counter[str] = Counter()
    labels: Counter[str] = Counter()

    for path in sorted(raw_dir.glob("**/*.docx")) if raw_dir.exists() else []:
        try:
            records = extract_docx(path)
            if records:
                destination = _split(records[0].document_id)
                grouped[destination].extend(records)
                documents[destination] += 1
                labels.update(record.label for record in records)
        except Exception as error:
            errors.append({"file": str(path), "error": str(error)})

    synthetic_by_doc: dict[str, list[ParagraphRecord]] = {}
    for record in generate_synthetic(synthetic_documents, seed):
        synthetic_by_doc.setdefault(record.document_id, []).append(record)
    for document_id, records in synthetic_by_doc.items():
        destination = _split(document_id)
        grouped[destination].extend(records)
        documents[destination] += 1
        labels.update(record.label for record in records)

    feedback = _feedback_records(feedback_db) if feedback_db else []
    feedback_by_doc: dict[str, list[ParagraphRecord]] = {}
    for record in feedback:
        feedback_by_doc.setdefault(record.document_id, []).append(record)
    for document_id, records in feedback_by_doc.items():
        destination = _split(document_id)
        grouped[destination].extend(records)
        documents[destination] += 1
        labels.update(record.label for record in records)

    counts = {split: write_jsonl(output_dir / f"{split}.jsonl", records) for split, records in grouped.items()}
    manifest = {
        "version": 1,
        "seed": seed,
        "raw_dir": str(raw_dir.resolve()),
        "synthetic_documents": synthetic_documents,
        "human_feedback_paragraphs": len(feedback),
        "paragraphs": counts,
        "documents": dict(documents),
        "labels": dict(sorted(labels.items())),
        "errors": errors,
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Build DocDeco dataset from DOCX and synthetic documents.")
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--synthetic-documents", type=int, default=2000)
    parser.add_argument("--feedback-db", type=Path)
    parser.add_argument("--seed", type=int, default=20260729)
    args = parser.parse_args()
    manifest = build_dataset(
        args.raw_dir,
        args.output_dir,
        args.synthetic_documents,
        args.seed,
        args.feedback_db,
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
