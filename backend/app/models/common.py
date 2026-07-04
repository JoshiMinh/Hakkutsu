"""
Common Pydantic models shared across endpoints.
"""

from pydantic import BaseModel, Field
from typing import Optional


class ErrorResponse(BaseModel):
    """Standard error response."""

    error: str = Field(..., description="Error message")
    detail: Optional[str] = Field(None, description="Detailed error information")
    code: str = Field("INTERNAL_ERROR", description="Error code")


class SubtitleRequest(BaseModel):
    """Request body for subtitle extraction."""

    video_url: str = Field(..., description="YouTube video URL")
    language: str = Field("ja", description="Target subtitle language code")


class SubtitleSegment(BaseModel):
    """A single subtitle segment with timing."""

    text: str = Field(..., description="Subtitle text")
    start: float = Field(..., description="Start time in seconds")
    duration: float = Field(..., description="Duration in seconds")


class SubtitleResponse(BaseModel):
    """Response body for subtitle extraction."""

    video_id: str = Field(..., description="YouTube video ID")
    language: str = Field(..., description="Subtitle language")
    segments: list[SubtitleSegment] = Field(
        default_factory=list, description="Subtitle segments"
    )
    full_text: str = Field("", description="All subtitles concatenated")
