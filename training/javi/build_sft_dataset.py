from __future__ import annotations

import argparse
import json
from pathlib import Path

from common import (
    DEFAULT_CONFIG,
    configure_logging,
    deterministic_split,
    ensure_pipeline_directories,
    iter_jsonl,
    load_config,
    stable_id,
    write_jsonl,
)


SYSTEM_PROMPT = (
    "Bạn là model Hakkutsu chuyên tiếng Nhật-Việt. Hãy dịch tự nhiên sang "
    "tiếng Việt và phân tích từ vựng, biến đổi, ngữ pháp theo ngữ cảnh. "
    "Chỉ trả JSON, không thêm markdown."
)


def translation_example(item: dict) -> dict:
    answer = {"translation_vi": item["vi"]}
    return {
        "id": f"translation-{item['id']}",
        "kind": "translation",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": json.dumps(
                    {"task": "translate", "japanese": item["ja"]},
                    ensure_ascii=False,
                ),
            },
            {"role": "assistant", "content": json.dumps(answer, ensure_ascii=False)},
        ],
    }


def grammar_example(item: dict) -> dict:
    answer = item["analysis"]
    answer["translation_vi"] = item["vi"]
    return {
        "id": f"grammar-{item['id']}",
        "kind": "grammar",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": json.dumps(
                    {"task": "analyze", "japanese": item["ja"]},
                    ensure_ascii=False,
                ),
            },
            {"role": "assistant", "content": json.dumps(answer, ensure_ascii=False)},
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    args = parser.parse_args()
    config = load_config(args.config)
    ensure_pipeline_directories(config)
    logger = configure_logging(config, "04_build_sft")
    prepared = Path(config["paths"]["prepared"])
    teacher_path = Path(config["paths"]["teacher"]) / "annotations.jsonl"
    examples = [translation_example(item) for item in iter_jsonl(prepared / "train.jsonl")]
    if teacher_path.is_file():
        grammar = [grammar_example(item) for item in iter_jsonl(teacher_path)]
        examples.extend(
            item
            for item in grammar
            for _ in range(max(1, int(config["data"]["grammar_repeat"])))
        )
    train, validation, test = deterministic_split(
        examples,
        seed=int(config["seed"]),
        validation_ratio=float(config["data"]["validation_ratio"]),
        test_ratio=float(config["data"]["test_ratio"]),
    )
    output = Path(config["paths"]["sft"])
    counts = {
        "train": write_jsonl(output / "train.jsonl", train),
        "validation": write_jsonl(output / "validation.jsonl", validation),
        "test": write_jsonl(output / "test.jsonl", test),
    }
    report = output / "manifest.json"
    report.write_text(json.dumps(counts, indent=2), encoding="utf-8")
    logger.info("SFT dataset built: %s", counts)


if __name__ == "__main__":
    main()
