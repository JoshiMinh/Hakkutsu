"""
YouTube subtitle extraction service.

Uses youtube-transcript-api to fetch auto-generated or manual
subtitles from YouTube videos.
"""

import logging
import re
from typing import Optional

from app.models.common import SubtitleResponse, SubtitleSegment

logger = logging.getLogger(__name__)


def _extract_video_id(url: str) -> str:
    """
    Extract YouTube video ID from various URL formats.

    Supports:
    - https://www.youtube.com/watch?v=VIDEO_ID
    - https://youtu.be/VIDEO_ID
    - https://www.youtube.com/embed/VIDEO_ID
    """
    patterns = [
        r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/)([a-zA-Z0-9_-]{11})",
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)

    raise ValueError(f"Could not extract video ID from URL: {url}")


class SubtitleService:
    """YouTube subtitle extraction service."""

    def get_subtitles(
        self,
        video_url: str,
        language: str = "ja",
    ) -> SubtitleResponse:
        """
        Fetch subtitles from a YouTube video.

        Args:
            video_url: YouTube video URL
            language: Target language code (default: "ja" for Japanese)

        Returns:
            SubtitleResponse with segments and full text
        """
        video_id = _extract_video_id(video_url)

        try:
            from youtube_transcript_api import YouTubeTranscriptApi

            # Try to get manually created subtitles first, then auto-generated
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)

            transcript = None
            try:
                transcript = transcript_list.find_transcript([language])
            except Exception:
                # Fall back to auto-generated
                try:
                    transcript = transcript_list.find_generated_transcript([language])
                except Exception:
                    logger.warning(
                        "No %s subtitles found for video %s", language, video_id
                    )

            if transcript is None:
                return SubtitleResponse(
                    video_id=video_id,
                    language=language,
                    segments=[],
                    full_text="",
                )

            raw_segments = transcript.fetch()
            segments = [
                SubtitleSegment(
                    text=seg.get("text", ""),
                    start=seg.get("start", 0.0),
                    duration=seg.get("duration", 0.0),
                )
                for seg in raw_segments
            ]

            full_text = " ".join(seg.text for seg in segments)

            return SubtitleResponse(
                video_id=video_id,
                language=language,
                segments=segments,
                full_text=full_text,
            )

        except ImportError:
            logger.warning(
                "youtube-transcript-api not installed. "
                "Install with: pip install youtube-transcript-api"
            )
            return SubtitleResponse(
                video_id=video_id,
                language=language,
                segments=[],
                full_text="",
            )


# Singleton instance
subtitle_service = SubtitleService()
