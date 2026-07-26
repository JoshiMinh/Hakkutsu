from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from app.database import db_session, utc_now


def prune_history() -> None:
    cutoff = (datetime.now(UTC) - timedelta(days=7)).isoformat()
    with db_session() as connection:
        connection.execute("DELETE FROM activity_history WHERE created_at < ?", (cutoff,))


def record_activity(
    action: str,
    summary: str,
    *,
    manga_id: int | None = None,
    chapter_id: int | None = None,
    page_id: int | None = None,
    details: dict | None = None,
) -> None:
    with db_session() as connection:
        connection.execute(
            """
            INSERT INTO activity_history
                (manga_id, chapter_id, page_id, action, summary, details_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (manga_id, chapter_id, page_id, action, summary,
             json.dumps(details or {}, ensure_ascii=False), utc_now()),
        )
    prune_history()

