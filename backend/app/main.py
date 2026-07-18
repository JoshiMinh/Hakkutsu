"""
Hakkutsu Backend — FastAPI Application Entry Point

AI-powered Japanese immersion API providing text analysis,
dictionary lookups, OCR, and subtitle extraction.
"""

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.api.v1.router import api_v1_router

app = FastAPI(
    title="Hakkutsu API",
    description="AI-powered Japanese immersion backend service",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS — allow Chrome extension and local dev origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_v1_router, prefix="/api/v1")

# Serve uploaded images statically
app.mount("/static", StaticFiles(directory="app/data/uploads"), name="static")


@app.get("/", tags=["root"])
async def root():
    """Health check root endpoint."""
    return {
        "service": "Hakkutsu API",
        "version": "0.1.0",
        "status": "running",
    }


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )
