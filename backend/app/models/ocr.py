"""
Pydantic models for OCR requests and responses.
"""

from pydantic import BaseModel, Field
from typing import List, Optional


class OcrRequest(BaseModel):
    """Request body for OCR text extraction."""

    image_data: str = Field(..., description="Base64-encoded image data")
    language: str = Field("jpn", description="Target language for OCR")


class OcrRegion(BaseModel):
    """A detected text region in the image."""

    text: str = Field(..., description="Extracted text")
    confidence: float = Field(..., description="OCR confidence score (0-1)")
    bbox: Optional[List[int]] = Field(
        None, description="Bounding box [x1, y1, x2, y2]"
    )


class OcrResponse(BaseModel):
    """Response body for OCR text extraction."""

    full_text: str = Field(..., description="All extracted text concatenated")
    regions: List[OcrRegion] = Field(
        default_factory=list, description="Individual text regions"
    )
    language: str = Field(..., description="Detected language")
