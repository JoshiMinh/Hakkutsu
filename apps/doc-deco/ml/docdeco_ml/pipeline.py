from __future__ import annotations

import argparse
import json
from pathlib import Path

from .build_dataset import build_dataset
from .training import train


def main() -> None:
    parser = argparse.ArgumentParser(description="One-command DocDeco data + training pipeline.")
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--synthetic-documents", type=int, default=2000)
    parser.add_argument("--feedback-db", type=Path)
    parser.add_argument("--base-model", default="vinai/phobert-base-v2")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--window-size", type=int, default=48)
    parser.add_argument("--max-tokens", type=int, default=128)
    parser.add_argument("--seed", type=int, default=20260729)
    parser.add_argument("--gradient-accumulation", type=int, default=1)
    args = parser.parse_args()
    dataset_dir = args.work_dir / "dataset"
    manifest = build_dataset(
        args.raw_dir,
        dataset_dir,
        args.synthetic_documents,
        args.seed,
        args.feedback_db,
    )
    report = train(
        dataset_dir=dataset_dir,
        output_dir=args.output_dir,
        base_model=args.base_model,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        window_size=args.window_size,
        max_tokens=args.max_tokens,
        seed=args.seed,
        gradient_accumulation=args.gradient_accumulation,
    )
    print(json.dumps({"dataset": manifest, "training": report}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
