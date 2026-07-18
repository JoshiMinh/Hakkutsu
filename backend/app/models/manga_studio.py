from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime

class TextBlock(BaseModel):
    id: str
    x: float
    y: float
    width: float
    height: float
    source_x: Optional[float] = None
    source_y: Optional[float] = None
    source_width: Optional[float] = None
    source_height: Optional[float] = None
    original_text: str = ""
    ai_translation: str = ""
    final_translation: str = ""
    font_family: str = "Arial"
    font_size: float = 28
    color: str = "#000000"
    text_align: str = "center"
    text_offset_y: float = 0.0
    placement_anchor_x: Optional[float] = None
    placement_anchor_y: Optional[float] = None
    rotation: float = 0.0
    ocr_confidence: Optional[float] = None
    ocr_provider: Optional[str] = None
    created_at: datetime
    updated_at: datetime

class Page(BaseModel):
    id: str
    page_number: int
    original_image_path: str
    clean_image_path: Optional[str] = None
    mask_preview_path: Optional[str] = None
    bubble_preview_path: Optional[str] = None
    bubble_analysis_path: Optional[str] = None
    width: int
    height: int
    status: str = "uploaded"  # uploaded, processing, ready, failed
    created_at: datetime
    updated_at: datetime
    # Note: text_blocks will be stored as a subcollection in Firestore

class Chapter(BaseModel):
    id: str
    chapter_number: str
    title: str = ""
    status: str = "pending"  # pending, processing, completed, failed
    created_at: datetime
    updated_at: datetime
    # Note: pages will be stored as a subcollection in Firestore

class Manga(BaseModel):
    id: str
    title: str
    author: str = ""
    description: str = ""
    thumbnail: Optional[str] = None
    tags: str = ""
    created_at: datetime
    updated_at: datetime
    # Note: chapters will be stored as a subcollection in Firestore

# Request / Response Schemas
class MangaCreate(BaseModel):
    title: str
    author: str = ""
    description: str = ""
    tags: str = ""

class ChapterCreate(BaseModel):
    chapter_number: str
    title: str = ""

class TextBlockInput(BaseModel):
    id: Optional[str] = None
    x: float
    y: float
    width: float
    height: float
    source_x: Optional[float] = None
    source_y: Optional[float] = None
    source_width: Optional[float] = None
    source_height: Optional[float] = None
    original_text: str = ""
    ai_translation: str = ""
    final_translation: str = ""
    font_family: str = "Arial"
    font_size: float = 28
    color: str = "#000000"
    text_align: str = "center"
    text_offset_y: float = 0.0
    placement_anchor_x: Optional[float] = None
    placement_anchor_y: Optional[float] = None
    rotation: float = 0.0
    ocr_confidence: Optional[float] = None
    ocr_provider: Optional[str] = None

class TextBlockBatch(BaseModel):
    blocks: List[TextBlockInput]

class OcrRequest(BaseModel):
    replace_existing: bool = False

class TranslationRequest(BaseModel):
    overwrite_existing_ai: bool = False

class PipelineRequest(BaseModel):
    replace_existing: bool = False
