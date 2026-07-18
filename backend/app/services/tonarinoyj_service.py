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

from app.models.manga_studio import MangaCreate, ChapterCreate, Page
from app.data import manga_studio_db
from app.services import storage_service

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


def run_import_job(series_id: str, episode_ids: list[str]) -> None:
    created_files: list[Path] = []
    try:
        with _client() as client:
            episodes = []
            for index, episode_id in enumerate(episode_ids):
                episode = fetch_episode(client, episode_id)
                if episode["series"]["id"] != str(series_id) or not episode["pages"]:
                    raise TonariError(f"Chapter {episode_id} không còn công khai hoặc không thuộc truyện đã chọn")
                episodes.append(episode)

            series = episodes[0]["series"]
            
            # Find existing manga by looking at all mangas
            all_mangas = manga_studio_db.list_mangas()
            manga = next((m for m in all_mangas if m.title == (series["title"] or "Tonari manga")), None)
            
            if manga:
                manga_id = manga.id
            else:
                new_manga = MangaCreate(
                    title=series["title"] or "Tonari manga",
                    author=series["author"],
                    description=series["description"],
                    thumbnail=series["thumbnail"],
                    tags="tonarinoyj"
                )
                manga = manga_studio_db.create_manga(new_manga)
                manga_id = manga.id

            imported = 0
            for episode_index, episode in enumerate(episodes, start=1):
                # Find if chapter exists
                all_chapters = manga_studio_db.list_chapters(manga_id)
                chapter_number = _chapter_number(episode["title"], episode["episode_id"])
                
                existing_chapter = next((c for c in all_chapters if c.chapter_number == chapter_number), None)
                if existing_chapter:
                    continue
                    
                new_chapter = ChapterCreate(
                    chapter_number=chapter_number,
                    title=episode["title"]
                )
                chapter = manga_studio_db.create_chapter(manga_id, new_chapter)
                chapter_id = chapter.id
                
                # We need a temp directory to download the images
                upload_dir = storage_service.UPLOADS_DIR / manga_id / chapter_id
                upload_dir.mkdir(parents=True, exist_ok=True)
                
                for page_index, page in enumerate(episode["pages"], start=1):
                    response = _get(client, page["src"])
                    content = response.content
                    if len(content) > MAX_IMAGE_BYTES:
                        raise TonariError("Một ảnh nguồn vượt quá giới hạn 25 MB")
                        
                    extension = ".png" if "png" in response.headers.get("content-type", "") else ".jpg"
                    rel_path = f"{manga_id}/{chapter_id}/tonari_{page_index:04d}_{uuid4().hex}{extension}"
                    destination = storage_service.get_absolute_path(rel_path)
                    
                    destination.write_bytes(content)
                    created_files.append(destination)
                    
                    try:
                        with Image.open(destination) as image:
                            image.verify()
                        with Image.open(destination) as image:
                            width, height = image.size
                    except (UnidentifiedImageError, OSError) as exc:
                        raise TonariError(f"Ảnh trang {page_index} không hợp lệ") from exc

                    # Save page to DB
                    manga_studio_db.create_page(
                        manga_id=manga_id,
                        chapter_id=chapter_id,
                        page_number=page_index,
                        original_image_path=rel_path,
                        width=width,
                        height=height
                    )
                
                imported += 1

    except Exception as exc:
        print(f"Import failed: {exc}")
        for path in created_files:
            path.unlink(missing_ok=True)
