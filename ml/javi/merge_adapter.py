from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

from common import DEFAULT_CONFIG, configure_logging, load_config


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    args = parser.parse_args()
    config = load_config(args.config)
    logger = configure_logging(config, "07_merge")
    base_model = config["training"]["base_model"]
    adapter_root = Path(config["paths"]["adapter"])
    merged_root = Path(config["paths"]["merged"])
    if not adapter_root.is_dir():
        raise RuntimeError("Chưa có adapter. Không thể merge.")
    merged_root.mkdir(parents=True, exist_ok=True)
    tokenizer = AutoTokenizer.from_pretrained(adapter_root, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        torch_dtype=torch.float16,
        device_map="cpu",
        trust_remote_code=True,
        low_cpu_mem_usage=True,
    )
    model = PeftModel.from_pretrained(model, adapter_root)
    merged = model.merge_and_unload()
    merged.save_pretrained(
        merged_root,
        safe_serialization=True,
        max_shard_size="2GB",
    )
    tokenizer.save_pretrained(merged_root)
    (merged_root / "hakkutsu_model_manifest.json").write_text(
        json.dumps(
            {
                "name": config["project_name"],
                "base_model": base_model,
                "adapter": str(adapter_root),
                "merged": str(merged_root),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    logger.info("Merged model saved: %s", merged_root)


if __name__ == "__main__":
    main()
