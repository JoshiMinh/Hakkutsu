from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from .models import Classification, FeedbackRequest, SemanticRole


class StateStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS paragraph_state (
                    document_id TEXT NOT NULL,
                    paragraph_id TEXT NOT NULL,
                    text_hash TEXT NOT NULL,
                    role TEXT NOT NULL,
                    level INTEGER NOT NULL,
                    confidence REAL NOT NULL,
                    source TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    semantic_label TEXT,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (document_id, paragraph_id)
                );
                CREATE TABLE IF NOT EXISTS feedback (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    document_id TEXT NOT NULL,
                    paragraph_id TEXT NOT NULL,
                    text TEXT NOT NULL,
                    predicted_role TEXT NOT NULL,
                    corrected_role TEXT NOT NULL,
                    context_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
            """)
            columns = {row["name"] for row in db.execute("PRAGMA table_info(paragraph_state)")}
            if "semantic_label" not in columns:
                db.execute("ALTER TABLE paragraph_state ADD COLUMN semantic_label TEXT")

    def get(self, document_id: str, paragraph_id: str, text_hash: str) -> Classification | None:
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM paragraph_state WHERE document_id=? AND paragraph_id=? AND text_hash=?",
                (document_id, paragraph_id, text_hash),
            ).fetchone()
        if not row:
            return None
        return Classification(
            paragraph_id=paragraph_id, text_hash=text_hash,
            role=SemanticRole(row["role"]), level=row["level"],
            confidence=row["confidence"], source="cache",
            reason=row["reason"], style_key=row["role"], unchanged=True,
            semantic_label=row["semantic_label"],
        )

    def save(self, document_id: str, result: Classification) -> None:
        with self.connect() as db:
            db.execute("""
                INSERT INTO paragraph_state
                (document_id, paragraph_id, text_hash, role, level, confidence, source, reason, semantic_label, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(document_id, paragraph_id) DO UPDATE SET
                    text_hash=excluded.text_hash, role=excluded.role, level=excluded.level,
                    confidence=excluded.confidence, source=excluded.source,
                    reason=excluded.reason, semantic_label=excluded.semantic_label,
                    updated_at=excluded.updated_at
            """, (
                document_id, result.paragraph_id, result.text_hash, result.role.value,
                result.level, result.confidence, result.source, result.reason,
                result.semantic_label,
                datetime.now(UTC).isoformat(),
            ))

    def add_feedback(self, item: FeedbackRequest) -> None:
        with self.connect() as db:
            db.execute("""
                INSERT INTO feedback
                (document_id, paragraph_id, text, predicted_role, corrected_role, context_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                item.document_id, item.paragraph_id, item.text,
                item.predicted_role.value, item.corrected_role.value,
                json.dumps(item.context, ensure_ascii=False), datetime.now(UTC).isoformat(),
            ))
