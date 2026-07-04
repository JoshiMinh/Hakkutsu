"""
OCR endpoint — extract Japanese text from images.

Note: Full OCR (MangaOCR/PaddleOCR) will be integrated in Phase 2.
This is a placeholder that returns a structured response.
"""

from fastapi import APIRouter, HTTPException

from app.models.ocr import OcrRequest, OcrResponse

router = APIRouter()


@router.post("", response_model=OcrResponse)
async def extract_text(request: OcrRequest):
    """
    Extract Japanese text from an image using OCR.

    Phase 1: Returns placeholder. Phase 2 will integrate MangaOCR/PaddleOCR.
    """
    try:
        # Phase 2: Replace with actual OCR service
        return OcrResponse(
            full_text="",
            regions=[],
            language=request.language,
        )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"OCR extraction failed: {str(e)}"
        )
