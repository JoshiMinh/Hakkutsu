from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .inference import DocumentPredictor
from .records import FEATURE_NAMES, ParagraphRecord


class PredictItem(BaseModel):
    paragraph_id: str
    index: int
    text: str
    style_name: str = ""
    zone: str = "unknown"
    features: dict[str, float] = Field(default_factory=dict)
    previous_text: str = ""
    next_text: str = ""


class PredictRequest(BaseModel):
    document_id: str
    paragraphs: list[PredictItem] = Field(min_length=1, max_length=128)


artifact_dir = Path(os.environ.get("DOCDECO_ARTIFACT_DIR", ""))
predictor: DocumentPredictor | None = None
startup_error = ""

app = FastAPI(title="DocDeco Context Model", version="1.0")


@app.on_event("startup")
def load_model() -> None:
    global predictor, startup_error
    try:
        if not artifact_dir or not (artifact_dir / "config.json").exists():
            raise FileNotFoundError(f"Model artifact not found: {artifact_dir}")
        predictor = DocumentPredictor(artifact_dir)
    except Exception as error:
        startup_error = str(error)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok" if predictor else "error",
        "artifact": str(artifact_dir),
        "error": startup_error,
    }


@app.post("/predict")
def predict(request: PredictRequest) -> list[dict]:
    if predictor is None:
        raise HTTPException(status_code=503, detail=startup_error or "Model is not loaded.")
    records = []
    for item in request.paragraphs:
        features = {name: float(item.features.get(name, 0.0)) for name in FEATURE_NAMES}
        features["char_length"] = min(len(item.text) / 500, 1)
        features["word_count"] = min(len(item.text.split()) / 100, 1)
        records.append(ParagraphRecord(
            document_id=request.document_id,
            paragraph_id=item.paragraph_id,
            index=item.index,
            text=item.text,
            label="body",
            label_source="runtime",
            label_confidence=0,
            zone=item.zone,
            style_name=item.style_name,
            features=features,
            previous_text=item.previous_text,
            next_text=item.next_text,
        ))
    return predictor.predict(records)

