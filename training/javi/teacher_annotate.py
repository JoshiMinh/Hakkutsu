from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import httpx

from common import (
    DEFAULT_CONFIG,
    append_jsonl,
    configure_logging,
    ensure_pipeline_directories,
    iter_jsonl,
    load_config,
)


def build_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "translation_vi": {"type": "string"},
            "tokens": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "surface": {"type": "string"},
                        "lemma": {"type": "string"},
                        "reading": {"type": "string"},
                        "pos_vi": {"type": "string"},
                        "meaning_vi": {"type": "string"},
                        "grammar_role_vi": {"type": "string"},
                    },
                    "required": [
                        "surface",
                        "lemma",
                        "reading",
                        "pos_vi",
                        "meaning_vi",
                        "grammar_role_vi"
                    ],
                    "additionalProperties": False
                }
            },
            "grammar": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string"},
                        "span": {"type": "string"},
                        "explanation_vi": {"type": "string"},
                    },
                    "required": ["pattern", "span", "explanation_vi"],
                    "additionalProperties": False
                }
            }
        },
        "required": ["translation_vi", "tokens", "grammar"],
        "additionalProperties": False
    }


def request_teacher(client: httpx.Client, item: dict, settings: dict) -> dict:
    schema = build_schema()
    payload = {
        "model": settings["model"],
        "messages": [
            {
                "role": "system",
                "content": (
                    "Bạn là chuyên gia ngôn ngữ Nhật-Việt. Phân tích đúng ngữ cảnh "
                    "toàn câu, không giải thích token trợ động từ như một từ độc lập. "
                    "Ví dụ ました phải được nhận diện là lịch sự + quá khứ. "
                    "Chỉ trả JSON đúng schema, toàn bộ diễn giải dùng tiếng Việt."
                )
            },
            {
                "role": "user",
                "content": json.dumps(
                    {"japanese": item["ja"], "reference_vietnamese": item["vi"]},
                    ensure_ascii=False
                )
            }
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "hakkutsu_javi_teacher",
                "strict": True,
                "schema": schema
            }
        },
        "reasoning_effort": "none",
        "temperature": 0,
        "max_tokens": 1400
    }
    response = client.post(settings["api_url"], json=payload)
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    parsed = json.loads(str(content))
    if not parsed.get("translation_vi") or not isinstance(parsed.get("tokens"), list):
        raise ValueError("Teacher trả thiếu translation_vi hoặc tokens")
    return parsed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    config = load_config(args.config)
    ensure_pipeline_directories(config)
    logger = configure_logging(config, "03_teacher")
    settings = dict(config["teacher"])
    limit = args.limit if args.limit is not None else int(config["data"]["teacher_limit"])
    input_path = Path(config["paths"]["prepared"]) / "train.jsonl"
    output_path = Path(config["paths"]["teacher"]) / "annotations.jsonl"
    failed_path = Path(config["paths"]["teacher"]) / "failed.jsonl"
    completed = {
        item["id"] for item in iter_jsonl(output_path)
    } if output_path.is_file() else set()
    candidates = [item for item in iter_jsonl(input_path) if item["id"] not in completed][:limit]
    logger.info("Teacher pending=%s completed=%s", len(candidates), len(completed))
    timeout = httpx.Timeout(float(settings["timeout_seconds"]))
    with httpx.Client(timeout=timeout) as client:
        for index, item in enumerate(candidates, start=1):
            last_error = ""
            for attempt in range(1, int(settings["max_retries"]) + 1):
                try:
                    analysis = request_teacher(client, item, settings)
                    append_jsonl(output_path, {
                        **item,
                        "teacher_model": settings["model"],
                        "analysis": analysis,
                    })
                    logger.info("Teacher %s/%s id=%s", index, len(candidates), item["id"])
                    break
                except Exception as exc:
                    last_error = str(exc)
                    logger.warning(
                        "Teacher retry=%s id=%s error=%s",
                        attempt,
                        item["id"],
                        last_error,
                    )
                    time.sleep(min(30, 2 ** attempt))
            else:
                append_jsonl(failed_path, {**item, "error": last_error})
    logger.info("Teacher stage finished; output=%s", output_path)


if __name__ == "__main__":
    main()
