from __future__ import annotations

import hashlib
import html
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urljoin
from uuid import uuid4

import httpx
from PIL import Image, UnidentifiedImageError

from app.database import db_session, utc_now


BASE_URL = "https://tonarinoyj.jp"
USER_AGENT = "MangaTranslatorStudio/1.0 (local personal import)"
EPISODE_RE = re.compile(r"https?://tonarinoyj\.jp/episode/(\d+)|/episode/(\d+)")
JSON_RE = re.compile(r"id=['\"]episode-json['\"][^>]*data-value=['\"](.*?)['\"]", re.S)
MAX_SEARCH_EPISODES = 12
MAX_SERIES_EPISODES = 30
MAX_IMAGE_BYTES = 25 * 1024 * 1024


class TonariError(RuntimeError):
    pass


def _client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept-Language": "ja,en;q=0.8"},
        follow_redirects=True,
        timeout=httpx.Timeout(30, connect=10),
    )


def _get(client: httpx.Client, url: str, **kwargs) -> httpx.Response:
    response = client.get(url, **kwargs)
    response.raise_for_status()
    return response


def _episode_ids(document: str) -> list[str]:
    found: list[str] = []
    for match in EPISODE_RE.finditer(document):
        episode_id = match.group(1) or match.group(2)
        if episode_id and episode_id not in found:
            found.append(episode_id)
    return found


def parse_episode_html(document: str) -> dict:
    match = JSON_RE.search(document)
    if not match:
        raise TonariError("Trang không chứa dữ liệu episode có thể đọc")
    try:
        payload = json.loads(html.unescape(match.group(1)))
    except (ValueError, TypeError) as exc:
        raise TonariError("Dữ liệu episode của nguồn không hợp lệ") from exc
    product = payload.get("readableProduct") or payload
    series = product.get("series") or {}
    structure = product.get("pageStructure") or payload.get("pageStructure") or {}
    pages = []
    for item in structure.get("pages") or []:
        src = item.get("src") or item.get("imageUri")
        if item.get("type") == "main" and src:
            pages.append({
                "src": urljoin(BASE_URL, src),
                "width": item.get("width"),
                "height": item.get("height"),
            })
    episode_id = str(product.get("id") or "")
    if not episode_id:
        permalink = product.get("permalink") or ""
        ids = _episode_ids(permalink)
        episode_id = ids[0] if ids else ""
    return {
        "episode_id": episode_id,
        "title": product.get("title") or "",
        "published_at": product.get("publishedAt"),
        "is_public": bool(pages),
        "page_count": len(pages),
        "pages": pages,
        "url": product.get("permalink") or (f"{BASE_URL}/episode/{episode_id}" if episode_id else ""),
        "series": {
            "id": str(series.get("id") or ""),
            "title": series.get("title") or "",
            "author": series.get("author") or series.get("authorName") or "",
            "description": series.get("description") or "",
            "thumbnail": series.get("thumbnailUri") or series.get("thumbnail") or "",
        },
    }


def fetch_episode(client: httpx.Client, episode_id: str) -> dict:
    document = _get(client, f"{BASE_URL}/episode/{episode_id}").text
    return parse_episode_html(document)


def search_series(query: str) -> list[dict]:
    query = query.strip()
    if not query:
        return []
    with _client() as client:
        document = _get(client, f"{BASE_URL}/search", params={"q": query}).text
        results: dict[str, dict] = {}
        episode_ids = _episode_ids(document)[:MAX_SEARCH_EPISODES]
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = {pool.submit(fetch_episode, client, item): item for item in episode_ids}
            episodes = []
            for future in as_completed(futures):
                try:
                    episodes.append(future.result())
                except (httpx.HTTPError, TonariError):
                    pass
        for episode in episodes:
            series = episode["series"]
            series_id = series["id"]
            if not series_id or series_id in results:
                continue
            results[series_id] = {
                **series,
                "latest_episode_id": episode["episode_id"],
                "latest_episode_title": episode["title"],
                "source_url": episode["url"],
            }
        return list(results.values())


def list_series_episodes(series_id: str, seed_episode_id: str | None = None) -> dict:
    with _client() as client:
        ids: list[str] = []
        for feed_kind in ("rss", "atom"):
            try:
                feed = _get(client, f"{BASE_URL}/{feed_kind}/series/{series_id}").text
                ids = _episode_ids(feed)
                if ids:
                    break
            except httpx.HTTPError:
                continue
        if seed_episode_id and seed_episode_id not in ids:
            ids.insert(0, seed_episode_id)
        episodes = []
        series = None
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = [pool.submit(fetch_episode, client, item) for item in ids[:MAX_SERIES_EPISODES]]
            fetched = []
            for future in as_completed(futures):
                try:
                    fetched.append(future.result())
                except (httpx.HTTPError, TonariError):
                    pass
        for episode in fetched:
            if episode["series"]["id"] != str(series_id):
                continue
            series = episode["series"]
            episodes.append({key: episode[key] for key in (
                "episode_id", "title", "published_at", "is_public", "page_count", "url"
            )})
        episodes.sort(key=lambda item: item.get("published_at") or "", reverse=True)
        return {"series": series or {"id": str(series_id)}, "episodes": episodes}


def _chapter_number(title: str, fallback: str) -> str:
    patterns = (r"(?:第\s*)?([0-9０-９]+(?:\.[0-9０-９]+)?)\s*(?:話|回)", r"([0-9]+(?:\.[0-9]+)?)")
    for pattern in patterns:
        match = re.search(pattern, title)
        if match:
            return match.group(1).translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    return fallback[-12:]


def _set_job(job_id: int, *, status: str | None = None, progress: float | None = None,
             step: str | None = None, error: str | None = None, result_count: int | None = None) -> None:
    fields, values = ["updated_at = ?"], [utc_now()]
    for column, value in (("status", status), ("progress", progress), ("current_step", step),
                          ("error_message", error), ("result_count", result_count)):
        if value is not None:
            fields.append(f"{column} = ?")
            values.append(value)
    values.append(job_id)
    with db_session() as connection:
        connection.execute(f"UPDATE processing_jobs SET {', '.join(fields)} WHERE id = ?", values)


def run_import_job(job_id: int, series_id: str, episode_ids: list[str], upload_dir: Path) -> None:
    created_files: list[Path] = []
    try:
        _set_job(job_id, status="processing", progress=0.01, step="Đang kiểm tra dữ liệu nguồn")
        with _client() as client:
            episodes = []
            for index, episode_id in enumerate(episode_ids):
                _set_job(job_id, progress=0.03 + 0.07 * index / max(1, len(episode_ids)),
                         step=f"Đang đọc chapter {index + 1}/{len(episode_ids)}")
                episode = fetch_episode(client, episode_id)
                if episode["series"]["id"] != str(series_id) or not episode["pages"]:
                    raise TonariError(f"Chapter {episode_id} không còn công khai hoặc không thuộc truyện đã chọn")
                episodes.append(episode)

            series = episodes[0]["series"]
            now = utc_now()
            with db_session() as connection:
                manga = connection.execute(
                    "SELECT * FROM manga WHERE source_provider = 'tonarinoyj' AND source_series_id = ?",
                    (str(series_id),),
                ).fetchone()
                if manga:
                    manga_id = manga["id"]
                else:
                    cursor = connection.execute(
                        """INSERT INTO manga
                        (title, author, description, thumbnail, tags, source_provider, source_series_id,
                         source_url, created_at, updated_at) VALUES (?, ?, ?, ?, '', 'tonarinoyj', ?, ?, ?, ?)""",
                        (series["title"] or "Tonari manga", series["author"], series["description"],
                         series["thumbnail"], str(series_id), episodes[0]["url"], now, now),
                    )
                    manga_id = cursor.lastrowid

            imported = 0
            total_pages = sum(len(item["pages"]) for item in episodes)
            completed_pages = 0
            for episode_index, episode in enumerate(episodes, start=1):
                with db_session() as connection:
                    exists = connection.execute(
                        "SELECT id FROM chapters WHERE source_provider = 'tonarinoyj' AND source_episode_id = ?",
                        (episode["episode_id"],),
                    ).fetchone()
                if exists:
                    completed_pages += len(episode["pages"])
                    continue

                staged = []
                chapter_temp = upload_dir / f"tonari_{job_id}_{episode['episode_id']}"
                chapter_temp.mkdir(parents=True, exist_ok=True)
                for page_index, page in enumerate(episode["pages"], start=1):
                    progress = 0.1 + 0.82 * (completed_pages / max(1, total_pages))
                    _set_job(job_id, progress=progress,
                             step=f"Đang tải chapter {episode_index}/{len(episodes)} · trang {page_index}/{len(episode['pages'])}")
                    response = _get(client, page["src"])
                    content = response.content
                    if len(content) > MAX_IMAGE_BYTES:
                        raise TonariError("Một ảnh nguồn vượt quá giới hạn 25 MB")
                    extension = ".png" if "png" in response.headers.get("content-type", "") else ".jpg"
                    destination = chapter_temp / f"{page_index:04d}_{uuid4().hex}{extension}"
                    destination.write_bytes(content)
                    created_files.append(destination)
                    try:
                        with Image.open(destination) as image:
                            image.verify()
                        with Image.open(destination) as image:
                            width, height = image.size
                    except (UnidentifiedImageError, OSError) as exc:
                        raise TonariError(f"Ảnh trang {page_index} không hợp lệ") from exc
                    staged.append((destination, width, height, hashlib.sha256(content).hexdigest()))
                    completed_pages += 1
                    time.sleep(0.15)

                now = utc_now()
                chapter_number = _chapter_number(episode["title"], episode["episode_id"])
                with db_session() as connection:
                    cursor = connection.execute(
                        """INSERT INTO chapters
                        (manga_id, chapter_number, title, status, source_provider, source_episode_id,
                         source_url, source_published_at, created_at, updated_at)
                        VALUES (?, ?, ?, 'processing', 'tonarinoyj', ?, ?, ?, ?, ?)""",
                        (manga_id, chapter_number, episode["title"], episode["episode_id"], episode["url"],
                         episode["published_at"], now, now),
                    )
                    chapter_id = cursor.lastrowid
                    final_dir = upload_dir / f"chapter_{chapter_id}"
                    final_dir.mkdir(parents=True, exist_ok=True)
                    batch = connection.execute(
                        """INSERT INTO import_batches
                        (chapter_id, label, source_kind, file_count, status, created_at, updated_at)
                        VALUES (?, ?, 'tonarinoyj', ?, 'completed', ?, ?)""",
                        (chapter_id, f"Tonari episode {episode['episode_id']}", len(staged), now, now),
                    ).lastrowid
                    for page_index, (temporary, width, height, digest) in enumerate(staged, start=1):
                        final_path = final_dir / temporary.name
                        temporary.replace(final_path)
                        created_files.remove(temporary)
                        created_files.append(final_path)
                        connection.execute(
                            """INSERT INTO pages
                            (chapter_id, page_number, original_image_path, import_batch_id, original_filename,
                             content_hash, review_status, width, height, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)""",
                            (chapter_id, page_index, final_path.relative_to(upload_dir).as_posix(), batch,
                             f"tonari_{page_index:04d}{final_path.suffix}", digest, width, height, now, now),
                        )
                    connection.execute("UPDATE manga SET updated_at = ? WHERE id = ?", (now, manga_id))
                # Chapter đã commit; lỗi ở chapter sau không được xóa tài nguyên hợp lệ này.
                for final_path in final_dir.iterdir():
                    if final_path in created_files:
                        created_files.remove(final_path)
                try:
                    chapter_temp.rmdir()
                except OSError:
                    pass
                imported += 1

        _set_job(job_id, status="completed", progress=1, step="Import hoàn tất", result_count=imported)
    except Exception as exc:
        for path in created_files:
            path.unlink(missing_ok=True)
        _set_job(job_id, status="failed", progress=1, step="Import thất bại", error=str(exc)[:2000])
