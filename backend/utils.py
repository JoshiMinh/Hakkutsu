import json
import re
import sqlite3
from pathlib import Path

from fastapi import HTTPException
from backend.config import UPLOAD_DIR
from backend.database import row_to_dict

NATURAL_NUMBER = re.compile(r"(\d+)")

def _json_list(value: str | None) -> list:
    try:
        parsed = json.loads(value or "[]")
        return parsed if isinstance(parsed, list) else []
    except (TypeError, json.JSONDecodeError):
        return []

def get_or_404(connection: sqlite3.Connection, query: str, params: tuple, label: str) -> dict:
    item = row_to_dict(connection.execute(query, params).fetchone())
    if item is None:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy {label}")
    return item

def natural_filename_key(filename: str) -> tuple:
    return tuple(
        int(part) if part.isdigit() else part.casefold()
        for part in NATURAL_NUMBER.split(filename or "")
    )

def _delete_upload_files(paths: list[str | None]) -> None:
    upload_root = UPLOAD_DIR.resolve()
    for relative_path in {path for path in paths if path}:
        candidate = (UPLOAD_DIR / relative_path).resolve()
        if candidate == upload_root or upload_root not in candidate.parents:
            continue
        candidate.unlink(missing_ok=True)

def _renumber_pages(connection: sqlite3.Connection, chapter_id: int, page_ids: list[int]) -> None:
    for offset, page_id in enumerate(page_ids, start=1):
        connection.execute(
            "UPDATE pages SET page_number = ? WHERE id = ? AND chapter_id = ?",
            (-offset, page_id, chapter_id),
        )
    for page_number, page_id in enumerate(page_ids, start=1):
        connection.execute(
            "UPDATE pages SET page_number = ? WHERE id = ? AND chapter_id = ?",
            (page_number, page_id, chapter_id),
        )

def _page_workflow_state(page: dict) -> str:
    if int(page.get("active_job_count") or 0) > 0 or page.get("status") == "processing":
        return "processing"
    if page.get("status") == "failed" or page.get("latest_job_status") == "failed":
        return "review"
    if page.get("review_status") == "approved":
        return "completed"
    block_count = int(page.get("block_count") or 0)
    translated_count = int(page.get("translated_count") or 0)
    if page.get("status") == "uploaded" and block_count == 0:
        return "unprocessed"
    if page.get("clean_image_path") and (block_count == 0 or translated_count == block_count):
        return "review"
    return "in_progress"

def _library_summaries(connection: sqlite3.Connection) -> list[dict]:
    manga_rows = [dict(row) for row in connection.execute("SELECT * FROM manga ORDER BY updated_at DESC, id DESC").fetchall()]
    chapter_rows = [dict(row) for row in connection.execute("SELECT * FROM chapters ORDER BY manga_id, CAST(chapter_number AS REAL), chapter_number").fetchall()]
    page_rows = [dict(row) for row in connection.execute(
        """
        SELECT p.*,
               COUNT(DISTINCT tb.id) AS block_count,
               COUNT(DISTINCT CASE WHEN TRIM(COALESCE(tb.final_translation, '')) <> '' OR TRIM(COALESCE(tb.ai_translation, '')) <> '' THEN tb.id END) AS translated_count,
               COUNT(DISTINCT CASE WHEN j.status IN ('pending', 'processing') THEN j.id END) AS active_job_count,
               (SELECT latest.status FROM processing_jobs latest WHERE latest.page_id = p.id ORDER BY latest.id DESC LIMIT 1) AS latest_job_status
        FROM pages p
        LEFT JOIN text_blocks tb ON tb.page_id = p.id
        LEFT JOIN processing_jobs j ON j.page_id = p.id
        GROUP BY p.id
        ORDER BY p.chapter_id, p.page_number
        """
    ).fetchall()]
    
    chapters_by_manga: dict[int, list[dict]] = {}
    for chapter in chapter_rows:
        chapter["pages"] = []
        chapters_by_manga.setdefault(int(chapter["manga_id"]), []).append(chapter)
    chapters_by_id = {int(chapter["id"]): chapter for chapter in chapter_rows}
    for page in page_rows:
        page["qa_issues"] = _json_list(page.get("qa_issues_json"))
        page["workflow_state"] = _page_workflow_state(page)
        chapters_by_id[int(page["chapter_id"])]["pages"].append(page)

    summaries: list[dict] = []
    for manga in manga_rows:
        chapters = chapters_by_manga.get(int(manga["id"]), [])
        pages = [page for chapter in chapters for page in chapter["pages"]]
        counts = {key: 0 for key in ("unprocessed", "processing", "in_progress", "review", "completed")}
        for page in pages:
            counts[page["workflow_state"]] += 1
        if not pages or counts["unprocessed"] == len(pages):
            library_state = "unprocessed"
        elif counts["processing"]:
            library_state = "in_progress"
        elif counts["review"]:
            library_state = "review"
        elif counts["completed"] == len(pages):
            library_state = "completed"
        else:
            library_state = "in_progress"
        manga.update({
            "chapter_count": len(chapters),
            "page_count": len(pages),
            "state_counts": counts,
            "library_state": library_state,
            "progress_percent": round(counts["completed"] / len(pages) * 100) if pages else 0,
            "latest_page_id": pages[-1]["id"] if pages else None,
        })
        summaries.append(manga)
    return summaries

def _chapter_summaries(connection: sqlite3.Connection, manga_id: int) -> list[dict]:
    chapters = [dict(row) for row in connection.execute("SELECT * FROM chapters WHERE manga_id = ? ORDER BY CAST(chapter_number AS REAL), chapter_number", (manga_id,)).fetchall()]
    for chapter in chapters:
        pages = [dict(row) for row in connection.execute(
            """
            SELECT p.*,
                   COUNT(DISTINCT tb.id) AS block_count,
                   COUNT(DISTINCT CASE WHEN TRIM(COALESCE(tb.final_translation, '')) <> '' OR TRIM(COALESCE(tb.ai_translation, '')) <> '' THEN tb.id END) AS translated_count,
                   COUNT(DISTINCT CASE WHEN j.status IN ('pending', 'processing') THEN j.id END) AS active_job_count,
                   (SELECT latest.status FROM processing_jobs latest WHERE latest.page_id = p.id ORDER BY latest.id DESC LIMIT 1) AS latest_job_status
            FROM pages p
            LEFT JOIN text_blocks tb ON tb.page_id = p.id
            LEFT JOIN processing_jobs j ON j.page_id = p.id
            WHERE p.chapter_id = ?
            GROUP BY p.id ORDER BY p.page_number
            """, (chapter["id"],)).fetchall()]
        counts = {key: 0 for key in ("unprocessed", "processing", "in_progress", "review", "completed")}
        for page in pages:
            page["qa_issues"] = _json_list(page.get("qa_issues_json"))
            state = _page_workflow_state(page)
            page["workflow_state"] = state
            counts[state] += 1
        chapter["page_count"] = len(pages)
        chapter["state_counts"] = counts
        chapter["pages"] = pages
        publish_job = connection.execute(
            "SELECT id, status, progress, current_step, error_message, created_at, updated_at FROM processing_jobs WHERE chapter_id = ? AND stage = 'study_publish' ORDER BY id DESC LIMIT 1",
            (chapter["id"],)
        ).fetchone()
        chapter["publish_job"] = dict(publish_job) if publish_job else None
    return chapters
