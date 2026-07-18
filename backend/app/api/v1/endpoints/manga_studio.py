from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from typing import List

from app.models.manga_studio import (
    Manga, Chapter, Page, TextBlock, TextBlockInput,
    MangaCreate, ChapterCreate, TextBlockBatch,
    OcrRequest, TranslationRequest, PipelineRequest
)
from app.data import manga_studio_db
from app.services import storage_service
from app.services.ocr_service import detect_text_blocks
from app.services.translation_service import translate_page
from app.services.inpainting_service import process_inpainting
from app.services.study_analysis_service import analyze_sentence
from app.services.bubble_segmentation_service import process_bubble_segmentation
from app.services.tonarinoyj_service import run_import_job
from fastapi import BackgroundTasks
from pydantic import BaseModel

router = APIRouter()

# --- Mangas ---

@router.get("/", response_model=List[Manga])
def get_mangas():
    return manga_studio_db.list_mangas()

@router.post("/", response_model=Manga)
def create_manga(data: MangaCreate):
    return manga_studio_db.create_manga(data)

@router.get("/{manga_id}", response_model=Manga)
def get_manga(manga_id: str):
    manga = manga_studio_db.get_manga(manga_id)
    if not manga:
        raise HTTPException(status_code=404, detail="Manga not found")
    return manga

# --- Chapters ---

@router.get("/{manga_id}/chapters", response_model=List[Chapter])
def get_chapters(manga_id: str):
    return manga_studio_db.list_chapters(manga_id)

@router.post("/{manga_id}/chapters", response_model=Chapter)
def create_chapter(manga_id: str, data: ChapterCreate):
    return manga_studio_db.create_chapter(manga_id, data)

# --- Pages ---

@router.get("/{manga_id}/chapters/{chapter_id}/pages", response_model=List[Page])
def get_pages(manga_id: str, chapter_id: str):
    return manga_studio_db.list_pages(manga_id, chapter_id)

def process_page_background(manga_id: str, chapter_id: str, page: Page):
    try:
        abs_path = storage_service.get_absolute_path(page.original_image_path)
        blocks_data = detect_text_blocks(abs_path)
        manga_studio_db.save_text_blocks(manga_id, chapter_id, page.id, blocks_data)
        
        page.status = "ready"
        manga_studio_db.update_page(manga_id, chapter_id, page)
    except Exception as e:
        page.status = "failed"
        manga_studio_db.update_page(manga_id, chapter_id, page)
        print(f"Background OCR failed: {e}")

@router.post("/{manga_id}/chapters/{chapter_id}/pages/upload", response_model=Page)
async def upload_page(
    manga_id: str, 
    chapter_id: str, 
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):
    from PIL import Image
    import io
    
    content = await file.read()
    with Image.open(io.BytesIO(content)) as img:
        width, height = img.size
    
    file.file.seek(0)
    rel_path = await storage_service.save_upload_file(file, manga_id, chapter_id)
    
    # Using a 0 page number for simple append for now. UI can allow reordering.
    pages = manga_studio_db.list_pages(manga_id, chapter_id)
    next_page_num = len(pages) + 1
    
    page = manga_studio_db.create_page(
        manga_id=manga_id,
        chapter_id=chapter_id,
        page_number=next_page_num,
        original_image_path=rel_path,
        width=width,
        height=height
    )
    
    page.status = "processing"
    manga_studio_db.update_page(manga_id, chapter_id, page)
    
    background_tasks.add_task(process_page_background, manga_id, chapter_id, page)
    
    return page

@router.get("/{manga_id}/chapters/{chapter_id}/pages/{page_id}/blocks", response_model=List[TextBlock])
def get_blocks(manga_id: str, chapter_id: str, page_id: str):
    return manga_studio_db.get_text_blocks(manga_id, chapter_id, page_id)

@router.put("/{manga_id}/chapters/{chapter_id}/pages/{page_id}/blocks", response_model=List[TextBlock])
def save_blocks(manga_id: str, chapter_id: str, page_id: str, batch: TextBlockBatch):
    return manga_studio_db.save_text_blocks(manga_id, chapter_id, page_id, batch.blocks)

# --- AI Endpoints ---

@router.post("/{manga_id}/chapters/{chapter_id}/pages/{page_id}/translate", response_model=List[TextBlock])
def translate_page_endpoint(manga_id: str, chapter_id: str, page_id: str):
    manga = manga_studio_db.get_manga(manga_id)
    chapter = manga_studio_db.get_chapter(manga_id, chapter_id)
    page = manga_studio_db.get_page(manga_id, chapter_id, page_id)
    blocks = manga_studio_db.get_text_blocks(manga_id, chapter_id, page_id)
    
    updated_blocks = translate_page(manga, chapter, page, blocks)
    
    # Save back to DB
    blocks_input = [TextBlockInput(**b.model_dump(exclude={'created_at', 'updated_at'})) for b in updated_blocks]
    return manga_studio_db.save_text_blocks(manga_id, chapter_id, page_id, blocks_input)

@router.post("/{manga_id}/chapters/{chapter_id}/pages/{page_id}/inpaint", response_model=Page)
def inpaint_page_endpoint(manga_id: str, chapter_id: str, page_id: str):
    page = manga_studio_db.get_page(manga_id, chapter_id, page_id)
    blocks = manga_studio_db.get_text_blocks(manga_id, chapter_id, page_id)
    
    original_abs = storage_service.get_absolute_path(page.original_image_path)
    clean_rel = f"{manga_id}/{chapter_id}/{page_id}_clean.png"
    preview_rel = f"{manga_id}/{chapter_id}/{page_id}_mask.png"
    
    clean_abs = storage_service.get_absolute_path(clean_rel)
    preview_abs = storage_service.get_absolute_path(preview_rel)
    
    process_inpainting(original_abs, clean_abs, preview_abs, blocks)
    
    page.clean_image_path = clean_rel
    page.mask_preview_path = preview_rel
    return manga_studio_db.update_page(manga_id, chapter_id, page)

@router.post("/{manga_id}/chapters/{chapter_id}/pages/{page_id}/study-analysis")
def study_analysis_endpoint(manga_id: str, chapter_id: str, page_id: str):
    blocks = manga_studio_db.get_text_blocks(manga_id, chapter_id, page_id)
    results = []
    for block in blocks:
        if block.final_translation.strip() and block.original_text.strip():
            analysis = analyze_sentence(block.original_text, block.final_translation)
            results.append({
                "block_id": block.id,
                "analysis": analysis
            })
    return {"results": results}

@router.post("/{manga_id}/chapters/{chapter_id}/pages/{page_id}/bubble-analysis", response_model=Page)
def bubble_analysis_endpoint(manga_id: str, chapter_id: str, page_id: str):
    page = manga_studio_db.get_page(manga_id, chapter_id, page_id)
    blocks = manga_studio_db.get_text_blocks(manga_id, chapter_id, page_id)
    
    original_abs = storage_service.get_absolute_path(page.original_image_path)
    preview_rel = f"{manga_id}/{chapter_id}/{page_id}_bubbles.png"
    preview_abs = storage_service.get_absolute_path(preview_rel)
    
    updated_blocks, analysis = process_bubble_segmentation(original_abs, preview_abs, blocks)
    
    if updated_blocks:
        blocks_input = [TextBlockInput(**b.model_dump(exclude={'created_at', 'updated_at'})) for b in updated_blocks]
        manga_studio_db.save_text_blocks(manga_id, chapter_id, page_id, blocks_input)
        
    page.bubble_preview_path = preview_rel
    # For now we won't save the JSON analysis to the page directly, but we could add a field for it
    return manga_studio_db.update_page(manga_id, chapter_id, page)


class TonariImportRequest(BaseModel):
    series_id: str
    episode_ids: list[str]

@router.post("/import/tonarinoyj")
def import_tonari_endpoint(request: TonariImportRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(
        run_import_job,
        request.series_id,
        request.episode_ids
    )
    return {"status": "Import job started"}
