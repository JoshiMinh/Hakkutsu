from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import torch
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from torch.utils.data import Dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    Trainer,
    TrainingArguments,
)

from common import DEFAULT_CONFIG, configure_logging, iter_jsonl, load_config


class ChatSupervisedDataset(Dataset):
    def __init__(self, path: Path, tokenizer, max_length: int) -> None:
        self.rows = list(iter_jsonl(path))
        self.tokenizer = tokenizer
        self.max_length = max_length

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict[str, list[int]]:
        messages = self.rows[index]["messages"]
        prompt_messages = messages[:-1]
        full_text = self.tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
        prompt_text = self.tokenizer.apply_chat_template(
            prompt_messages,
            tokenize=False,
            add_generation_prompt=True,
        )
        encoded = self.tokenizer(
            full_text,
            truncation=True,
            max_length=self.max_length,
            add_special_tokens=False,
        )
        prompt_ids = self.tokenizer(
            prompt_text,
            truncation=True,
            max_length=self.max_length,
            add_special_tokens=False,
        )["input_ids"]
        labels = list(encoded["input_ids"])
        masked_length = min(len(prompt_ids), len(labels))
        labels[:masked_length] = [-100] * masked_length
        return {
            "input_ids": encoded["input_ids"],
            "attention_mask": encoded["attention_mask"],
            "labels": labels,
        }


@dataclass
class CompletionOnlyCollator:
    tokenizer: object

    def __call__(self, features: list[dict]) -> dict[str, torch.Tensor]:
        max_length = max(len(item["input_ids"]) for item in features)
        input_ids, attention_masks, labels = [], [], []
        pad_id = self.tokenizer.pad_token_id
        for item in features:
            padding = max_length - len(item["input_ids"])
            input_ids.append(item["input_ids"] + [pad_id] * padding)
            attention_masks.append(item["attention_mask"] + [0] * padding)
            labels.append(item["labels"] + [-100] * padding)
        return {
            "input_ids": torch.tensor(input_ids, dtype=torch.long),
            "attention_mask": torch.tensor(attention_masks, dtype=torch.long),
            "labels": torch.tensor(labels, dtype=torch.long),
        }


def latest_checkpoint(checkpoint_root: Path) -> str | None:
    checkpoints = [
        path for path in checkpoint_root.glob("checkpoint-*")
        if path.is_dir() and path.name.split("-")[-1].isdigit()
    ]
    if not checkpoints:
        return None
    checkpoints.sort(key=lambda path: int(path.name.split("-")[-1]))
    return str(checkpoints[-1])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument(
        "--resume",
        default="auto",
        help="'auto', 'none' hoặc đường dẫn checkpoint cụ thể.",
    )
    args = parser.parse_args()
    config = load_config(args.config)
    logger = configure_logging(config, "05_train")
    settings = config["training"]
    sft_root = Path(config["paths"]["sft"])
    checkpoint_root = Path(config["paths"]["checkpoints"])
    adapter_root = Path(config["paths"]["adapter"])
    checkpoint_root.mkdir(parents=True, exist_ok=True)
    adapter_root.mkdir(parents=True, exist_ok=True)
    if not (sft_root / "train.jsonl").is_file():
        raise RuntimeError("Thiếu SFT train.jsonl. Chạy build_sft_dataset.py trước.")

    compute_dtype = (
        torch.bfloat16
        if torch.cuda.is_available() and torch.cuda.is_bf16_supported()
        else torch.float16
    )
    tokenizer = AutoTokenizer.from_pretrained(
        settings["base_model"],
        trust_remote_code=True,
        use_fast=True,
    )
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"
    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=compute_dtype,
    )
    model = AutoModelForCausalLM.from_pretrained(
        settings["base_model"],
        quantization_config=quantization,
        device_map="auto",
        trust_remote_code=True,
        torch_dtype=compute_dtype,
    )
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(
        model,
        use_gradient_checkpointing=True,
    )
    lora = LoraConfig(
        r=int(settings["lora_rank"]),
        lora_alpha=int(settings["lora_alpha"]),
        lora_dropout=float(settings["lora_dropout"]),
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()
    train_dataset = ChatSupervisedDataset(
        sft_root / "train.jsonl",
        tokenizer,
        int(settings["max_length"]),
    )
    validation_path = sft_root / "validation.jsonl"
    validation_dataset = (
        ChatSupervisedDataset(
            validation_path,
            tokenizer,
            int(settings["max_length"]),
        )
        if validation_path.is_file()
        else None
    )
    arguments = TrainingArguments(
        output_dir=str(checkpoint_root),
        num_train_epochs=float(settings["epochs"]),
        learning_rate=float(settings["learning_rate"]),
        per_device_train_batch_size=int(settings["per_device_batch_size"]),
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=int(settings["gradient_accumulation_steps"]),
        warmup_ratio=float(settings["warmup_ratio"]),
        logging_steps=int(settings["logging_steps"]),
        save_steps=int(settings["save_steps"]),
        eval_steps=int(settings["eval_steps"]),
        eval_strategy="steps" if validation_dataset is not None else "no",
        save_strategy="steps",
        save_total_limit=int(settings["save_total_limit"]),
        load_best_model_at_end=validation_dataset is not None,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        gradient_checkpointing=True,
        fp16=compute_dtype == torch.float16,
        bf16=compute_dtype == torch.bfloat16,
        optim="paged_adamw_8bit",
        lr_scheduler_type="cosine",
        report_to="none",
        remove_unused_columns=False,
        dataloader_num_workers=0,
        seed=int(config["seed"]),
    )
    trainer = Trainer(
        model=model,
        args=arguments,
        train_dataset=train_dataset,
        eval_dataset=validation_dataset,
        data_collator=CompletionOnlyCollator(tokenizer),
    )
    if args.resume == "auto":
        resume = latest_checkpoint(checkpoint_root)
    elif args.resume.lower() == "none":
        resume = None
    else:
        resume = args.resume
    logger.info("Training rows=%s resume=%s", len(train_dataset), resume)
    trainer.train(resume_from_checkpoint=resume)
    trainer.save_model(str(adapter_root))
    tokenizer.save_pretrained(str(adapter_root))
    manifest = {
        "base_model": settings["base_model"],
        "adapter": str(adapter_root),
        "train_rows": len(train_dataset),
        "max_length": settings["max_length"],
        "lora_rank": settings["lora_rank"],
        "lora_alpha": settings["lora_alpha"],
    }
    (adapter_root / "hakkutsu_training_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("Adapter saved: %s", adapter_root)


if __name__ == "__main__":
    main()
