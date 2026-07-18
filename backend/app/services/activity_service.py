from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.core.firebase import get_db


def prune_history() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    db = get_db()
    # Simple prune logic using Firestore query
    docs = db.collection("activity_history").where("created_at", "<", cutoff).stream()
    batch = db.batch()
    count = 0
    for doc in docs:
        batch.delete(doc.reference)
        count += 1
        if count >= 500:  # Firestore batch limit
            batch.commit()
            batch = db.batch()
            count = 0
    if count > 0:
        batch.commit()


def record_activity(
    action: str,
    summary: str,
    *,
    manga_id: str | None = None,
    chapter_id: str | None = None,
    page_id: str | None = None,
    details: dict | None = None,
) -> None:
    db = get_db()
    db.collection("activity_history").add({
        "manga_id": manga_id,
        "chapter_id": chapter_id,
        "page_id": page_id,
        "action": action,
        "summary": summary,
        "details": details or {},
        "created_at": datetime.now(timezone.utc)
    })
    
    # Prune in background (usually this shouldn't be synchronous in prod, but for local it's fine)
    try:
        prune_history()
    except Exception:
        pass
