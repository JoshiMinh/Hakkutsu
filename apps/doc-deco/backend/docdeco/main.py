from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .classifier import (
    classify_rules, classify_with_ollama, classify_with_trained_model, text_hash,
)
from .models import (
    BatchClassifyRequest, Classification, ClassifyRequest, FeedbackRequest,
)
from .storage import StateStore
from .styles import STYLE_PRESETS

ROOT = Path(__file__).resolve().parents[4]
db_path = Path(os.getenv("DOCDECO_DB_PATH", ROOT / "data" / "docdeco" / "docdeco.db"))
store = StateStore(db_path)

app = FastAPI(title="DocDeco Local API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://localhost:3000", "http://localhost:3000",
        "https://127.0.0.1:3000", "http://127.0.0.1:3000",
    ],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


@app.get("/api/docdeco/health")
def health() -> dict:
    return {
        "status": "ok", "service": "docdeco",
        "model_enabled": os.getenv("DOCDECO_MODEL_ENABLED", "false").lower() in {"1", "true", "yes"},
        "model": os.getenv("DOCDECO_MODEL", "gemini-2.5-flash"),
        "trained_model_enabled": os.getenv(
            "DOCDECO_TRAINED_MODEL_ENABLED", "true"
        ).lower() in {"1", "true", "yes"},
    }


@app.get("/api/docdeco/styles")
def styles() -> dict:
    return STYLE_PRESETS


async def classify_one(document_id: str, paragraph) -> Classification:
    digest = text_hash(paragraph.text)
    cached = store.get(document_id, paragraph.paragraph_id, digest)
    if cached and not paragraph.force_model:
        return cached
    result = await classify_with_trained_model(document_id, paragraph)
    if result is None:
        result = await classify_with_ollama(paragraph, classify_rules(paragraph))
    store.save(document_id, result)
    return result


@app.post("/api/docdeco/classify", response_model=Classification)
async def classify(request: ClassifyRequest) -> Classification:
    return await classify_one(request.document_id, request.paragraph)


@app.post("/api/docdeco/classify/batch", response_model=list[Classification])
async def classify_batch(request: BatchClassifyRequest) -> list[Classification]:
    results = []
    for paragraph in request.paragraphs:
        results.append(await classify_one(request.document_id, paragraph))
    return results


@app.post("/api/docdeco/feedback", status_code=204)
def feedback(request: FeedbackRequest) -> None:
    store.add_feedback(request)
