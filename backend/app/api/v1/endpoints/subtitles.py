"""
YouTube subtitle extraction endpoint.
"""

from fastapi import APIRouter, HTTPException

from app.models.common import SubtitleRequest, SubtitleResponse
from app.services.subtitles import subtitle_service

router = APIRouter()


@router.post("/youtube", response_model=SubtitleResponse)
async def get_youtube_subtitles(request: SubtitleRequest):
    """Extract Japanese subtitles from a YouTube video."""
    try:
        result = subtitle_service.get_subtitles(
            video_url=request.video_url,
            language=request.language,
        )
        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Subtitle extraction failed: {str(e)}"
        )
