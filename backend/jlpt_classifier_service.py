"""Lazy-loaded JLPT level classifier using the fine-tuned BertForSequenceClassification
stored at ml/models/jlpt_classifier/.

The model was trained to classify Japanese words or short sentences into
JLPT difficulty levels: N1 (hardest) through N5 (easiest).

Usage::

    from backend.jlpt_classifier_service import predict_jlpt

    level = predict_jlpt("食べる")  # → "N5"
    level = predict_jlpt("語彙")   # → "N2" or "N3", etc.
    level = predict_jlpt("")       # → None  (empty / non-Japanese input)

The model is only loaded on the first call. Subsequent calls are fast (CPU inference,
~1 ms per token on modern hardware). If the model directory is missing or PyTorch /
transformers are not installed, every call returns None gracefully.
"""
from __future__ import annotations

import re
from pathlib import Path
from threading import Lock

from backend.config import JLPT_CLASSIFIER_ENABLED, JLPT_CLASSIFIER_PATH

_JAPANESE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")

_model = None
_tokenizer = None
_id2label: dict[int, str] = {}
_device = None
_load_lock = Lock()
_load_attempted = False  # avoid re-trying after a permanent failure


def _load() -> bool:
    """Load model + tokenizer. Returns True on success, False on any failure."""
    global _model, _tokenizer, _id2label, _device, _load_attempted
    if _load_attempted:
        return _model is not None
    with _load_lock:
        if _load_attempted:
            return _model is not None
        _load_attempted = True

        if not JLPT_CLASSIFIER_ENABLED:
            return False

        model_dir = Path(JLPT_CLASSIFIER_PATH)
        if not model_dir.is_dir():
            return False

        try:
            import torch
            from transformers import AutoTokenizer, BertForSequenceClassification
        except ImportError:
            return False

        try:
            # AutoTokenizer gracefully falls back to wordpiece when MeCab is
            # unavailable, so we don't require MeCab on the host machine.
            _tokenizer = AutoTokenizer.from_pretrained(str(model_dir), use_fast=True)
        except Exception:
            try:
                # Hard fallback: plain BertTokenizer (no Japanese-specific word split)
                from transformers import BertTokenizer
                _tokenizer = BertTokenizer.from_pretrained(str(model_dir))
            except Exception:
                return False

        try:
            _device = "cuda" if torch.cuda.is_available() else "cpu"
            _model = BertForSequenceClassification.from_pretrained(str(model_dir))
            _model.to(_device).eval()  # type: ignore[union-attr]
            _id2label = _model.config.id2label  # type: ignore[union-attr]
        except Exception:
            _model = None
            _tokenizer = None
            return False

        return True


def predict_jlpt(text: str) -> str | None:
    """Return the predicted JLPT level ('N1'-'N5') for *text*, or None.

    *text* should be a Japanese word (lemma / dictionary form) or a short
    sentence.  Non-Japanese text or empty strings return None immediately
    without invoking the model.
    """
    if not text or not _JAPANESE.search(text):
        return None

    if not _load():
        return None

    try:
        import torch

        inputs = _tokenizer(  # type: ignore[call-arg]
            text,
            return_tensors="pt",
            truncation=True,
            max_length=64,
            padding=False,
        )
        inputs = {k: v.to(_device) for k, v in inputs.items()}

        with torch.no_grad():
            logits = _model(**inputs).logits  # type: ignore[misc]

        label_id = int(logits.argmax(dim=-1).item())
        return _id2label.get(label_id)
    except Exception:
        return None


def classifier_available() -> bool:
    """Return True if the classifier has been (or can be) loaded successfully."""
    return _load()
