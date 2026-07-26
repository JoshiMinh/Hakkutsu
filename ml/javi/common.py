from __future__ import annotations

import hashlib
import json
import logging
import random
from pathlib import Path
from typing import Iterable, Iterator


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = Path(__file__).with_name("pipeline_config.json")


def resolve_project_path(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else PROJECT_ROOT / path


def load_json(path: str | Path) -> dict:
    return json.loads(resolve_project_path(path).read_text(encoding="utf-8"))


def load_config(path: str | Path = DEFAULT_CONFIG) -> dict:
    config = load_json(path)
    for key, value in config["paths"].items():
        config["paths"][key] = str(resolve_project_path(value))
    return config


def ensure_pipeline_directories(config: dict) -> None:
    for value in config["paths"].values():
        Path(value).mkdir(parents=True, exist_ok=True)
    (Path(config["paths"]["workspace"]) / "logs").mkdir(parents=True, exist_ok=True)
    (Path(config["paths"]["workspace"]) / "inbox").mkdir(parents=True, exist_ok=True)


def configure_logging(config: dict, stage: str) -> logging.Logger:
    ensure_pipeline_directories(config)
    logger = logging.getLogger(f"hakkutsu.javi.{stage}")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    stream = logging.StreamHandler()
    stream.setFormatter(formatter)
    log_file = Path(config["paths"]["workspace"]) / "logs" / f"{stage}.log"
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(stream)
    logger.addHandler(file_handler)
    return logger


def stable_id(*values: str) -> str:
    payload = "\u241f".join(value.strip() for value in values)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def iter_jsonl(path: str | Path) -> Iterator[dict]:
    with resolve_project_path(path).open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            text = line.strip()
            if not text:
                continue
            try:
                item = json.loads(text)
            except json.JSONDecodeError as exc:
                raise ValueError(f"JSONL lỗi tại {path}:{line_number}: {exc}") from exc
            if isinstance(item, dict):
                yield item


def write_jsonl(path: str | Path, items: Iterable[dict]) -> int:
    target = resolve_project_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with target.open("w", encoding="utf-8", newline="\n") as handle:
        for item in items:
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")
            count += 1
    return count


def append_jsonl(path: str | Path, item: dict) -> None:
    target = resolve_project_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(item, ensure_ascii=False) + "\n")
        handle.flush()


def deterministic_split(
    items: list[dict],
    *,
    seed: int,
    validation_ratio: float,
    test_ratio: float,
) -> tuple[list[dict], list[dict], list[dict]]:
    shuffled = list(items)
    random.Random(seed).shuffle(shuffled)
    test_count = round(len(shuffled) * test_ratio)
    validation_count = round(len(shuffled) * validation_ratio)
    test = shuffled[:test_count]
    validation = shuffled[test_count:test_count + validation_count]
    train = shuffled[test_count + validation_count:]
    return train, validation, test
