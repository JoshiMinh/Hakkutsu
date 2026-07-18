import os
import aiofiles
from fastapi import UploadFile
from pathlib import Path
from app.core.config import settings
import uuid

UPLOAD_DIR = Path(settings.MANGA_UPLOAD_DIR)

def ensure_upload_dir():
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

async def save_upload_file(upload_file: UploadFile, manga_id: str, chapter_id: str) -> str:
    ensure_upload_dir()
    
    # Create a unique filename while preserving extension
    ext = os.path.splitext(upload_file.filename)[1] if upload_file.filename else ".jpg"
    unique_filename = f"{uuid.uuid4()}{ext}"
    
    # Store in a directory structure: uploads/manga_id/chapter_id/filename
    target_dir = UPLOAD_DIR / manga_id / chapter_id
    target_dir.mkdir(parents=True, exist_ok=True)
    
    file_path = target_dir / unique_filename
    
    async with aiofiles.open(file_path, 'wb') as out_file:
        content = await upload_file.read()
        await out_file.write(content)
        
    # Return the relative path to be stored in the DB, so it can be served via a static mount or endpoint
    return f"{manga_id}/{chapter_id}/{unique_filename}"

def get_absolute_path(relative_path: str) -> Path:
    return UPLOAD_DIR / relative_path

def delete_file(relative_path: str):
    if not relative_path:
        return
    path = get_absolute_path(relative_path)
    if path.exists() and path.is_file():
        path.unlink()
