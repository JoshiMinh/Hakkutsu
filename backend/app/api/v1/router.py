"""
API v1 router — aggregates all endpoint routers.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import analyze, health, subtitles, ocr, srs

api_v1_router = APIRouter()

api_v1_router.include_router(
    health.router,
    prefix="/health",
    tags=["health"],
)

api_v1_router.include_router(
    analyze.router,
    prefix="/analyze",
    tags=["analysis"],
)

api_v1_router.include_router(
    subtitles.router,
    prefix="/subtitles",
    tags=["subtitles"],
)

api_v1_router.include_router(
    ocr.router,
    prefix="/ocr",
    tags=["ocr"],
)

api_v1_router.include_router(
    srs.router,
    prefix="/srs",
    tags=["srs"],
)
