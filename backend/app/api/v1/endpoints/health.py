"""
Health check endpoint.
"""

from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def health_check():
    """Service health check."""
    return {
        "status": "healthy",
        "service": "hakkutsu-api",
        "version": "0.1.0",
    }
