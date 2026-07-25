from __future__ import annotations

import argparse
import json
import re
import unicodedata
from collections import Counter
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


JAPANESE_RE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")
VIETNAMESE_RE = re.compile(
    r"[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệ"
    r"ìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]"
)
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
SPACE_RE = re.compile(r"\s+")


def normalize(text: str) -> str:
    value = unicodedata.normalize("NFKC", text)
    value = CONTROL_RE.sub("", value)
    return SPACE_RE.sub(" ", value).strip()


def validate_pair(ja: str, vi: str, settings: dict) -> str | None:
    if not (settings["min_source_chars"] <= len(ja) <= settings["max_source_chars"]):
        return "source_length"
    if not (settings["min_target_chars"] <= len(vi) <= settings["max_target_chars"]):
        return "target_length"
    if not JAPANESE_RE.search(ja):
        return "source_not_japanese"
    if JAPANESE_RE.search(vi):
        return "target_contains_japanese"
    if not re.search(r"[A-Za-zÀ-ỹ]", vi):
        return "target_not_vietnamese_text"
    ratio = max(len(ja), len(vi)) / max(1, min(len(ja), len(vi)))
    if ratio > settings["max_length_ratio"]:
        return "length_ratio"
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    args = parser.parse_args()
    config = load_config(args.config)
    ensure_pipeline_directories(config)
    logger = configure_logging(config, "02_prepare")
    raw_root = Path(config["paths"]["raw"])
    prepared_root = Path(config["paths"]["prepared"])
    settings = config["data"]
    rejects: Counter[str] = Counter()
    seen: set[str] = set()
    accepted: list[dict] = []
    for path in sorted(raw_root.glob("*/pairs.jsonl")):
        for item in iter_jsonl(path):
            ja = normalize(str(item.get("ja") or ""))
            vi = normalize(str(item.get("vi") or ""))
            reason = validate_pair(ja, vi, settings)
            if reason:
                rejects[reason] += 1
                continue
            pair_id = stable_id(ja, vi)
            if pair_id in seen:
                rejects["duplicate"] += 1
                continue
            seen.add(pair_id)
            accepted.append({
                "id": pair_id,
                "ja": ja,
                "vi": vi,
                "source": item.get("source", path.parent.name),
                "license": item.get("license", "unknown"),
            })
    train, validation, test = deterministic_split(
        accepted,
        seed=int(config["seed"]),
        validation_ratio=float(settings["validation_ratio"]),
        test_ratio=float(settings["test_ratio"]),
    )
    counts = {
        "train": write_jsonl(prepared_root / "train.jsonl", train),
        "validation": write_jsonl(prepared_root / "validation.jsonl", validation),
        "test": write_jsonl(prepared_root / "test.jsonl", test),
    }
    split_ids = [
        {item["id"] for item in split}
        for split in (train, validation, test)
    ]
    split_overlap_count = sum(
        len(split_ids[left] & split_ids[right])
        for left, right in ((0, 1), (0, 2), (1, 2))
    )
    report = {
        "accepted": len(accepted),
        "splits": counts,
        "split_overlap_count": split_overlap_count,
        "rejected": dict(rejects),
        "sources": dict(Counter(item["source"] for item in accepted)),
        "licenses": dict(Counter(item["license"] for item in accepted)),
    }
    report_path = Path(config["paths"]["reports"]) / "prepare_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Prepared dataset: %s", json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
