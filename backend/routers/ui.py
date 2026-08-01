from fastapi import APIRouter
from fastapi.responses import FileResponse, RedirectResponse

from backend.config import STATIC_DIR

router = APIRouter(include_in_schema=False)


@router.get("/")
def app_hub() -> FileResponse:
    return FileResponse(STATIC_DIR / "hub.html")


@router.get("/manga")
@router.get("/admin")
def dashboard() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@router.get("/japtitle")
def japtitle_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "japtitle.html")


@router.get("/docdeco")
def docdeco_page() -> RedirectResponse:
    return RedirectResponse("https://localhost:3000")


@router.get("/editor")
def editor() -> FileResponse:
    return FileResponse(STATIC_DIR / "editor.html")


@router.get("/study")
def study_library_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "study.html")


@router.get("/study/chapter/{chapter_id}")
def study_chapter_page(chapter_id: int) -> FileResponse:
    return FileResponse(STATIC_DIR / "study-reader.html")


@router.get("/study/vocabulary")
def study_vocabulary_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "vocabulary.html")


@router.get("/study/media")
def study_media_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "media.html")
