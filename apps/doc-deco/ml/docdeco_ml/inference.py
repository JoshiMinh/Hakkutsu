from __future__ import annotations

import json
from pathlib import Path

import torch
from transformers import AutoTokenizer

from .model import ContextualRoleModel
from .records import FEATURE_NAMES, ParagraphRecord


class DocumentPredictor:
    def __init__(self, artifact_dir: Path, device: str | None = None):
        self.artifact_dir = artifact_dir
        config = json.loads((artifact_dir / "config.json").read_text(encoding="utf-8"))
        self.labels = config["labels"]
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.tokenizer = AutoTokenizer.from_pretrained(artifact_dir / "tokenizer", use_fast=False)
        self.model = ContextualRoleModel.from_artifact(artifact_dir, self.device).eval()

    @torch.inference_mode()
    def predict(self, records: list[ParagraphRecord], max_tokens: int = 128) -> list[dict]:
        if not records:
            return []
        encoded = self.tokenizer(
            [record.text for record in records],
            padding=True, truncation=True, max_length=max_tokens, return_tensors="pt",
        )
        input_ids = encoded["input_ids"].unsqueeze(0).to(self.device)
        attention = encoded["attention_mask"].unsqueeze(0).to(self.device)
        features = torch.tensor(
            [[record.feature_vector() for record in records]], dtype=torch.float32, device=self.device
        )
        mask = torch.ones(1, len(records), dtype=torch.bool, device=self.device)
        probabilities = self.model(
            input_ids=input_ids, attention_mask=attention,
            structural_features=features, paragraph_mask=mask,
        ).softmax(-1)[0]
        confidences, label_ids = probabilities.max(-1)
        results = [
            {
                "paragraph_id": record.paragraph_id,
                "label": self.labels[int(label_id)],
                "confidence": float(confidence),
            }
            for record, label_id, confidence in zip(records, label_ids, confidences)
        ]
        # Preserve multi-line cover blocks. Vietnamese school names and document
        # titles are frequently split into separate Word paragraphs.
        for index in range(1, len(results) - 1):
            previous_label = results[index - 1]["label"]
            next_label = results[index + 1]["label"]
            record = records[index]
            uppercase = record.features.get("uppercase_ratio", 0.0)
            if (
                previous_label == "cover_institution"
                and next_label == "cover_faculty"
                and uppercase >= 0.7
            ):
                results[index]["label"] = "cover_institution"
            elif (
                previous_label == "cover_project_type"
                and next_label == "author_metadata"
                and uppercase >= 0.7
            ):
                results[index]["label"] = "document_title"
        return results
