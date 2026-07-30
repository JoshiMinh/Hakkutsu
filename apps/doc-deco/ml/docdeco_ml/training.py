from __future__ import annotations

import argparse
import json
import math
import random
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

import torch
from torch import nn
from torch.optim import AdamW
from torch.utils.data import DataLoader, Dataset
from transformers import AutoTokenizer, get_cosine_schedule_with_warmup

from .labels import LABELS, LABEL_TO_ID
from .model import ContextualRoleModel
from .records import FEATURE_NAMES, ParagraphRecord, read_jsonl


@dataclass(slots=True)
class Window:
    document_id: str
    records: list[ParagraphRecord]


class WindowDataset(Dataset):
    def __init__(self, records: list[ParagraphRecord], window_size: int, stride: int):
        grouped: dict[str, list[ParagraphRecord]] = defaultdict(list)
        for record in records:
            grouped[record.document_id].append(record)
        self.windows: list[Window] = []
        for document_id, items in grouped.items():
            items.sort(key=lambda item: item.index)
            if len(items) <= window_size:
                self.windows.append(Window(document_id, items))
                continue
            for start in range(0, len(items), stride):
                window = items[start:start + window_size]
                if window:
                    self.windows.append(Window(document_id, window))
                if start + window_size >= len(items):
                    break

    def __len__(self) -> int:
        return len(self.windows)

    def __getitem__(self, index: int) -> Window:
        return self.windows[index]


class DocumentCollator:
    def __init__(self, tokenizer, max_tokens: int):
        self.tokenizer = tokenizer
        self.max_tokens = max_tokens

    def __call__(self, windows: list[Window]) -> dict[str, torch.Tensor | list]:
        max_sequence = max(len(window.records) for window in windows)
        flattened: list[str] = []
        for window in windows:
            flattened.extend(record.text for record in window.records)
            flattened.extend([""] * (max_sequence - len(window.records)))
        encoded = self.tokenizer(
            flattened, padding=True, truncation=True, max_length=self.max_tokens,
            return_tensors="pt",
        )
        batch = len(windows)
        tokens = encoded["input_ids"].shape[-1]
        input_ids = encoded["input_ids"].reshape(batch, max_sequence, tokens)
        attention = encoded["attention_mask"].reshape(batch, max_sequence, tokens)
        features = torch.zeros(batch, max_sequence, len(FEATURE_NAMES), dtype=torch.float32)
        labels = torch.full((batch, max_sequence), -100, dtype=torch.long)
        mask = torch.zeros(batch, max_sequence, dtype=torch.bool)
        document_ids: list[str] = []
        for batch_index, window in enumerate(windows):
            document_ids.append(window.document_id)
            for sequence_index, record in enumerate(window.records):
                features[batch_index, sequence_index] = torch.tensor(record.feature_vector())
                labels[batch_index, sequence_index] = LABEL_TO_ID[record.label]
                mask[batch_index, sequence_index] = True
        return {
            "input_ids": input_ids,
            "attention_mask": attention,
            "structural_features": features,
            "paragraph_mask": mask,
            "labels": labels,
            "document_ids": document_ids,
        }


def _macro_metrics(
    predictions: list[int],
    targets: list[int],
    *,
    hierarchy_jumps: int = 0,
    heading_transitions: int = 0,
) -> dict:
    per_label = {}
    f1_values = []
    for label_id, label in enumerate(LABELS):
        tp = sum(p == label_id and t == label_id for p, t in zip(predictions, targets))
        fp = sum(p == label_id and t != label_id for p, t in zip(predictions, targets))
        fn = sum(p != label_id and t == label_id for p, t in zip(predictions, targets))
        support = sum(t == label_id for t in targets)
        if support == 0:
            continue
        precision = tp / max(tp + fp, 1)
        recall = tp / max(tp + fn, 1)
        f1 = 2 * precision * recall / max(precision + recall, 1e-12)
        per_label[label] = {"precision": precision, "recall": recall, "f1": f1, "support": support}
        f1_values.append(f1)
    accuracy = sum(p == t for p, t in zip(predictions, targets)) / max(len(targets), 1)
    return {
        "accuracy": accuracy,
        "macro_f1": sum(f1_values) / max(len(f1_values), 1),
        "hierarchy_violation_rate": hierarchy_jumps / max(heading_transitions, 1),
        "labels": per_label,
    }


@torch.inference_mode()
def evaluate(model, loader, device: torch.device) -> dict:
    model.eval()
    predictions: list[int] = []
    targets: list[int] = []
    hierarchy_jumps = 0
    heading_transitions = 0
    for batch in loader:
        model_inputs = {
            key: batch[key].to(device)
            for key in ("input_ids", "attention_mask", "structural_features", "paragraph_mask")
        }
        logits = model(**model_inputs)
        valid = batch["labels"] != -100
        predicted_rows = logits.detach().cpu().argmax(-1)
        predictions.extend(predicted_rows[valid].tolist())
        targets.extend(batch["labels"][valid].tolist())
        for predicted_row, valid_row in zip(predicted_rows.tolist(), valid.tolist()):
            previous_heading_level: int | None = None
            for predicted, is_valid in zip(predicted_row, valid_row):
                if not is_valid:
                    continue
                label = LABELS[predicted]
                if label.startswith("heading_"):
                    current_level = int(label.rsplit("_", 1)[1])
                    if previous_heading_level is not None:
                        heading_transitions += 1
                        if current_level > previous_heading_level + 1:
                            hierarchy_jumps += 1
                    previous_heading_level = current_level
    return _macro_metrics(
        predictions,
        targets,
        hierarchy_jumps=hierarchy_jumps,
        heading_transitions=heading_transitions,
    )


def train(
    *,
    dataset_dir: Path,
    output_dir: Path,
    base_model: str,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    window_size: int,
    max_tokens: int,
    seed: int,
    gradient_accumulation: int = 1,
) -> dict:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = AutoTokenizer.from_pretrained(base_model, use_fast=False)
    train_records = list(read_jsonl(dataset_dir / "train.jsonl"))
    validation_records = list(read_jsonl(dataset_dir / "validation.jsonl"))
    test_records = list(read_jsonl(dataset_dir / "test.jsonl"))
    if not train_records:
        raise ValueError("Training dataset is empty.")
    stride = max(window_size // 2, 1)
    collator = DocumentCollator(tokenizer, max_tokens)
    train_loader = DataLoader(
        WindowDataset(train_records, window_size, stride),
        batch_size=batch_size, shuffle=True, collate_fn=collator,
    )
    validation_loader = DataLoader(
        WindowDataset(validation_records, window_size, window_size),
        batch_size=batch_size, shuffle=False, collate_fn=collator,
    )
    test_loader = DataLoader(
        WindowDataset(test_records, window_size, window_size),
        batch_size=batch_size, shuffle=False, collate_fn=collator,
    )
    model = ContextualRoleModel(
        base_model, num_labels=len(LABELS), num_features=len(FEATURE_NAMES)
    ).to(device)
    if device.type == "cuda" and hasattr(model.encoder, "gradient_checkpointing_enable"):
        model.encoder.gradient_checkpointing_enable()
    frequencies = Counter(record.label for record in train_records)
    weights = torch.tensor(
        [
            math.sqrt(len(train_records) / frequencies[label])
            if frequencies.get(label, 0)
            else 0.0
            for label in LABELS
        ],
        device=device, dtype=torch.float32,
    )
    positive_weights = weights[weights > 0]
    weights = weights / positive_weights.mean() if positive_weights.numel() else torch.ones_like(weights)
    criterion = nn.CrossEntropyLoss(weight=weights, ignore_index=-100)
    optimizer = AdamW(model.parameters(), lr=learning_rate, weight_decay=.01)
    update_steps = math.ceil(len(train_loader) / max(gradient_accumulation, 1))
    total_steps = max(update_steps * epochs, 1)
    scheduler = get_cosine_schedule_with_warmup(
        optimizer, num_warmup_steps=max(total_steps // 10, 1), num_training_steps=total_steps
    )
    best_f1 = -1.0
    history = []
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    for epoch in range(1, epochs + 1):
        model.train()
        running_loss = 0.0
        optimizer.zero_grad(set_to_none=True)
        for step, batch in enumerate(train_loader, start=1):
            model_inputs = {
                key: batch[key].to(device)
                for key in ("input_ids", "attention_mask", "structural_features", "paragraph_mask")
            }
            labels = batch["labels"].to(device)
            with torch.amp.autocast("cuda", enabled=device.type == "cuda"):
                logits = model(**model_inputs)
                raw_loss = criterion(logits.reshape(-1, len(LABELS)), labels.reshape(-1))
                loss = raw_loss / max(gradient_accumulation, 1)
            scaler.scale(loss).backward()
            should_update = (
                step % max(gradient_accumulation, 1) == 0
                or step == len(train_loader)
            )
            if should_update:
                scaler.unscale_(optimizer)
                nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)
                scheduler.step()
            running_loss += float(raw_loss.detach())
        validation = evaluate(model, validation_loader, device) if validation_records else {}
        row = {
            "epoch": epoch,
            "train_loss": running_loss / max(len(train_loader), 1),
            "validation": validation,
        }
        history.append(row)
        score = validation.get("macro_f1", -row["train_loss"])
        if score > best_f1:
            best_f1 = score
            model.save_artifact(output_dir, tokenizer, LABELS, FEATURE_NAMES)
        print(json.dumps(row, ensure_ascii=False))
    best_model = ContextualRoleModel.from_artifact(output_dir, device)
    test = evaluate(best_model, test_loader, device) if test_records else {}
    report = {
        "base_model": base_model,
        "device": str(device),
        "gpu": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
        "mixed_precision": device.type == "cuda",
        "gradient_accumulation": gradient_accumulation,
        "epochs": epochs,
        "best_validation_macro_f1": best_f1,
        "test": test,
        "history": history,
    }
    (output_dir / "metrics.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Train DocDeco contextual document classifier.")
    parser.add_argument("--dataset-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--base-model", default="vinai/phobert-base-v2")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--window-size", type=int, default=48)
    parser.add_argument("--max-tokens", type=int, default=128)
    parser.add_argument("--seed", type=int, default=20260729)
    parser.add_argument("--gradient-accumulation", type=int, default=1)
    args = parser.parse_args()
    report = train(**vars(args))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
