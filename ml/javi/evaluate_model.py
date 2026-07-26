from __future__ import annotations

import argparse
import json
from pathlib import Path

import sacrebleu
import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

from common import (
    DEFAULT_CONFIG,
    configure_logging,
    iter_jsonl,
    load_config,
    write_jsonl,
)


def parse_assistant_json(messages: list[dict]) -> dict:
    return json.loads(messages[-1]["content"])


def generate(model, tokenizer, messages: list[dict], max_new_tokens: int) -> str:
    prompt = tokenizer.apply_chat_template(
        messages[:-1],
        tokenize=False,
        add_generation_prompt=True,
    )
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.inference_mode():
        output = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            temperature=None,
            top_p=None,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )
    generated = output[0, inputs["input_ids"].shape[1]:]
    return tokenizer.decode(generated, skip_special_tokens=True).strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--limit", type=int, default=500)
    args = parser.parse_args()
    config = load_config(args.config)
    logger = configure_logging(config, "06_evaluate")
    settings = config["training"]
    adapter_root = Path(config["paths"]["adapter"])
    test_path = Path(config["paths"]["sft"]) / "test.jsonl"
    if not adapter_root.is_dir():
        raise RuntimeError("Chưa có adapter để đánh giá.")
    tokenizer = AutoTokenizer.from_pretrained(adapter_root, trust_remote_code=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    dtype = (
        torch.bfloat16
        if torch.cuda.is_available() and torch.cuda.is_bf16_supported()
        else torch.float16
    )
    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=dtype,
    )
    base = AutoModelForCausalLM.from_pretrained(
        settings["base_model"],
        quantization_config=quantization,
        device_map="auto",
        trust_remote_code=True,
        torch_dtype=dtype,
    )
    model = PeftModel.from_pretrained(base, adapter_root)
    model.eval()
    rows = list(iter_jsonl(test_path))[:args.limit]
    predictions, hypotheses, references = [], [], []
    valid_json = 0
    grammar_total = grammar_correct = 0
    for index, row in enumerate(rows, start=1):
        raw = generate(model, tokenizer, row["messages"], max_new_tokens=900)
        reference = parse_assistant_json(row["messages"])
        parsed = None
        try:
            parsed = json.loads(raw)
            valid_json += 1
        except json.JSONDecodeError:
            pass
        predicted_translation = str((parsed or {}).get("translation_vi") or "")
        reference_translation = str(reference.get("translation_vi") or "")
        hypotheses.append(predicted_translation)
        references.append(reference_translation)
        expected_patterns = {
            str(item.get("pattern") or "")
            for item in reference.get("grammar", [])
            if isinstance(item, dict)
        }
        predicted_patterns = {
            str(item.get("pattern") or "")
            for item in (parsed or {}).get("grammar", [])
            if isinstance(item, dict)
        }
        grammar_total += len(expected_patterns)
        grammar_correct += len(expected_patterns & predicted_patterns)
        predictions.append({
            "id": row["id"],
            "raw": raw,
            "parsed": parsed,
            "reference": reference,
        })
        logger.info("Evaluate %s/%s id=%s", index, len(rows), row["id"])
    report = {
        "count": len(rows),
        "valid_json_rate": valid_json / max(1, len(rows)),
        "bleu": sacrebleu.corpus_bleu(hypotheses, [references]).score,
        "chrf": sacrebleu.corpus_chrf(hypotheses, [references]).score,
        "grammar_pattern_recall": grammar_correct / max(1, grammar_total),
    }
    reports = Path(config["paths"]["reports"])
    write_jsonl(reports / "evaluation_predictions.jsonl", predictions)
    (reports / "evaluation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("Evaluation report: %s", report)


if __name__ == "__main__":
    main()
