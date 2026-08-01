import shutil
import sqlite3
import io
import json
import hashlib
import re
from datetime import UTC, datetime, timedelta
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError

from backend.config import (
    BASE_DIR,
    JAVI_ANALYSIS_ENABLED,
    JAVI_ANALYSIS_MODEL,
    SHOW_MODE_SWITCH,
    STATIC_DIR,
    UPLOAD_DIR,
    ensure_directories,
)
from backend.activity_service import prune_history, record_activity
from backend.quality_service import evaluate_page_quality
from backend.study_analysis_service import (
    analyze_phrase_deep,
    analyze_phrase_javi,
    analyze_sentence,
    analyze_sentences,
)
from backend.media_service import (
    decode_subtitle_bytes,
    extension_analysis,
    fetch_youtube_subtitle_result,
    fetch_youtube_subtitles,
    parse_subtitle_text,
    subtitle_title_from_filename,
)
from backend.database import db_session, init_database, row_to_dict, utc_now
from backend.ocr_service import recognize_japanese_crop, run_ocr_job
from backend.inpainting_service import run_inpainting_job
from backend.bubble_segmentation_service import run_bubble_segmentation_job
from backend.schemas import (
    ChapterCreate,
    ChapterReviewRequest,
    ChapterPipelineRequest,
    CropOcrRequest,
    TonariImportRequest,
    ImportCheckRequest,
    MangaCreate,
    MediaAnalyzeRequest,
    MediaImportRequest,
    ImageOcrRequest,
    OcrRequest,
    OutsideTextPolicyRequest,
    PageEditorialDecisionRequest,
    PageOrderRequest,
    PageReviewRequest,
    PipelineRequest,
    TextBlockBatch,
    TranslationRequest,
    VocabularyCreate,
    WebTranslateRequest,
    YoutubeMediaImportRequest,
)
from backend.translation_service import (
    TranslationBlock,
    get_translation_provider,
    run_translation_job,
    translate_blocks_resilient,
)
from backend.visual_supervisor_service import visual_supervisor_config
from backend.typesetting_service import (
    constrain_cell_to_bubble_interior,
    fit_text_layout,
    layout_at_size,
    partition_text_regions_by_source,
    place_text_in_clear_area,
    pack_grouped_text_fallback,
    render_translated_page,
    suggest_text_color,
    text_layout_bounds,
)
from backend.tonarinoyj_service import (
    list_series_episodes,
    run_import_job,
    run_refresh_chapter_job,
    search_series,
)


ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
MAX_UPLOAD_SIZE = 20 * 1024 * 1024
NATURAL_NUMBER = re.compile(r"(\d+)")
STUDY_ASSET_DIR = BASE_DIR / "data" / "study"

# StaticFiles validates its directory at import time.
ensure_directories()
STUDY_ASSET_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_directories()
    init_database()
    yield


app = FastAPI(title="Manga Translator Studio API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/study-assets", StaticFiles(directory=STUDY_ASSET_DIR), name="study-assets")


from backend.utils import (
    _json_list,
    get_or_404,
    natural_filename_key,
    _delete_upload_files,
    _renumber_pages,
    _page_workflow_state,
    _library_summaries,
    _chapter_summaries,
    NATURAL_NUMBER
)



from backend.routers import ui
app.include_router(ui.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "manga-translator-studio"}


@app.get("/api/visual-supervisor/status")
def visual_supervisor_status() -> dict:
    """Expose configured capability without forcing a costly vision inference."""
    return visual_supervisor_config()


@app.get("/api/ui-config")
def ui_config() -> dict:
    return {
        "show_mode_switch": SHOW_MODE_SWITCH,
        "visual_supervisor": visual_supervisor_config(),
    }



from backend.routers import sources
app.include_router(sources.router)



from backend.routers import manga
app.include_router(manga.router)

from backend.routers import processing, study
app.include_router(processing.router)
app.include_router(study.router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
