import sqlite3
from fastapi import APIRouter, BackgroundTasks, HTTPException
from backend.schemas import TonariImportRequest
from backend.tonarinoyj_service import list_series_episodes, run_import_job, run_refresh_chapter_job, search_series
from backend.database import db_session, utc_now
from backend.config import UPLOAD_DIR
from backend.utils import get_or_404

router = APIRouter(prefix="/api")

@router.get("/sources/tonarinoyj/search")
def search_tonarinoyj(q: str = "") -> dict:
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=400, detail="Hãy nhập ít nhất 2 ký tự để tìm truyện")
    try:
        return {"items": search_series(query)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Không thể tìm trên Tonari no Young Jump: {exc}") from exc


@router.get("/sources/tonarinoyj/series/{series_id}")
def get_tonarinoyj_series(series_id: str, seed_episode_id: str | None = None) -> dict:
    if not series_id.isdigit() or (seed_episode_id and not seed_episode_id.isdigit()):
        raise HTTPException(status_code=400, detail="ID nguồn không hợp lệ")
    try:
        result = list_series_episodes(series_id, seed_episode_id)
        episode_ids = [str(item.get("episode_id") or "") for item in result.get("episodes", [])]
        with db_session() as connection:
            imported = {
                str(row["source_episode_id"]): int(row["id"])
                for row in connection.execute(
                    f"SELECT id, source_episode_id FROM chapters WHERE source_provider = 'tonarinoyj' "
                    f"AND source_episode_id IN ({','.join('?' for _ in episode_ids)})",
                    episode_ids,
                ).fetchall()
            } if episode_ids else {}
        for episode in result.get("episodes", []):
            chapter_id = imported.get(str(episode.get("episode_id") or ""))
            episode["already_imported"] = chapter_id is not None
            episode["chapter_id"] = chapter_id
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Không thể đọc danh sách chapter: {exc}") from exc


@router.post("/sources/tonarinoyj/import", status_code=202)
def import_tonarinoyj(payload: TonariImportRequest, background_tasks: BackgroundTasks) -> dict:
    episode_ids = list(dict.fromkeys(item.strip() for item in payload.episode_ids))
    if not payload.series_id.isdigit() or any(not item.isdigit() for item in episode_ids):
        raise HTTPException(status_code=400, detail="ID truyện hoặc chapter không hợp lệ")
    now = utc_now()
    with db_session() as connection:
        existing_ids = {
            str(row["source_episode_id"])
            for row in connection.execute(
                f"SELECT source_episode_id FROM chapters WHERE source_provider = 'tonarinoyj' "
                f"AND source_episode_id IN ({','.join('?' for _ in episode_ids)})",
                episode_ids,
            ).fetchall()
        }
        new_episode_ids = [item for item in episode_ids if item not in existing_ids]
        if not new_episode_ids:
            raise HTTPException(
                status_code=409,
                detail="Các chapter đã có trong thư viện. Hãy chọn chapter chưa nhập; "
                       "muốn tải lại ảnh, dùng 'Ghép lại ảnh nguồn Tonari' trong Editor.",
            )
        active = connection.execute(
            """SELECT id FROM processing_jobs WHERE stage = 'source_import'
               AND status IN ('pending', 'processing') LIMIT 1"""
        ).fetchone()
        if active:
            raise HTTPException(status_code=409, detail=f"Một lần import khác đang chạy (job #{active['id']})")
        cursor = connection.execute(
            """INSERT INTO processing_jobs
               (stage, status, progress, current_step, created_at, updated_at)
               VALUES ('source_import', 'pending', 0, 'Đang chờ bắt đầu', ?, ?)""",
            (now, now),
        )
        job_id = cursor.lastrowid
    background_tasks.add_task(run_import_job, job_id, payload.series_id, new_episode_ids, UPLOAD_DIR)
    return {"job_id": job_id, "status": "pending", "skipped_existing": len(existing_ids)}


@router.post("/chapters/{chapter_id}/refresh-source", status_code=202)
def refresh_tonari_chapter(chapter_id: int, background_tasks: BackgroundTasks) -> dict:
    now = utc_now()
    with db_session() as connection:
        chapter = get_or_404(
            connection, "SELECT * FROM chapters WHERE id = ?", (chapter_id,), "chapter"
        )
        if chapter.get("source_provider") != "tonarinoyj":
            raise HTTPException(status_code=409, detail="Chapter này không phải nguồn Tonari")
        if chapter.get("publication_status") == "published":
            raise HTTPException(status_code=409, detail="Hãy gỡ xuất bản chapter trước")
        active = connection.execute(
            """SELECT id FROM processing_jobs
               WHERE (chapter_id = ? OR page_id IN (SELECT id FROM pages WHERE chapter_id = ?))
                 AND status IN ('pending', 'processing') LIMIT 1""",
            (chapter_id, chapter_id),
        ).fetchone()
        if active:
            raise HTTPException(status_code=409, detail=f"Chapter đang có tác vụ chạy (job #{active['id']})")
        cursor = connection.execute(
            """INSERT INTO processing_jobs
               (chapter_id, stage, status, progress, current_step, created_at, updated_at)
               VALUES (?, 'source_refresh', 'pending', 0, 'Đang chờ bắt đầu', ?, ?)""",
            (chapter_id, now, now),
        )
        job_id = cursor.lastrowid
    background_tasks.add_task(run_refresh_chapter_job, job_id, chapter_id, UPLOAD_DIR)
    return {"job_id": job_id, "status": "pending"}
