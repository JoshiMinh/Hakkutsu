"""
OCR endpoint — extract Japanese text from images.
"""

import base64
import tempfile
from pathlib import Path
from fastapi import APIRouter, HTTPException

from app.models.ocr import OcrRequest, OcrResponse, OcrRegion
from app.services.ocr_service import detect_text_blocks

router = APIRouter()


@router.post("", response_model=OcrResponse)
async def extract_text(request: OcrRequest):
    """
    Extract Japanese text from an image using OCR.
    """
    try:
        # Decode base64 image data (remove data URI prefix if present)
        image_data = request.image_data
        if "," in image_data:
            image_data = image_data.split(",")[1]
            
        decoded_bytes = base64.b64decode(image_data)
        
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_file:
            temp_file.write(decoded_bytes)
            temp_path = Path(temp_file.name)
            
        try:
            blocks = detect_text_blocks(temp_path)
            
            regions = []
            full_text_parts = []
            for block in blocks:
                # OcrRegion from models has: text, confidence, bbox=[x1, y1, x2, y2]
                bbox = [
                    int(block.x),
                    int(block.y),
                    int(block.x + block.width),
                    int(block.y + block.height)
                ]
                regions.append(OcrRegion(
                    text=block.original_text,
                    confidence=block.ocr_confidence or 1.0,
                    bbox=bbox
                ))
                full_text_parts.append(block.original_text)
                
            return OcrResponse(
                full_text=" ".join(full_text_parts),
                regions=regions,
                language=request.language,
            )
        finally:
            if temp_path.exists():
                temp_path.unlink()

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"OCR extraction failed: {str(e)}"
        )
