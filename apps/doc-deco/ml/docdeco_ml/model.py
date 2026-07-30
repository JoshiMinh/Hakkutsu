from __future__ import annotations

import json
from pathlib import Path

import torch
from torch import nn
from transformers import AutoConfig, AutoModel


class ContextualRoleModel(nn.Module):
    """Paragraph text encoder fused with DOCX features and document context."""

    def __init__(
        self,
        encoder_name_or_path: str,
        *,
        num_labels: int,
        num_features: int,
        context_hidden: int = 384,
        context_layers: int = 2,
        context_heads: int = 6,
        dropout: float = .15,
    ):
        super().__init__()
        self.encoder = AutoModel.from_pretrained(encoder_name_or_path)
        encoder_hidden = int(self.encoder.config.hidden_size)
        self.layout_projection = nn.Sequential(
            nn.LayerNorm(num_features),
            nn.Linear(num_features, 128),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.fusion = nn.Sequential(
            nn.Linear(encoder_hidden + 128, context_hidden),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        layer = nn.TransformerEncoderLayer(
            d_model=context_hidden,
            nhead=context_heads,
            dim_feedforward=context_hidden * 4,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.context_encoder = nn.TransformerEncoder(layer, num_layers=context_layers)
        self.classifier = nn.Sequential(
            nn.LayerNorm(context_hidden),
            nn.Dropout(dropout),
            nn.Linear(context_hidden, num_labels),
        )
        self.artifact_config = {
            "num_labels": num_labels,
            "num_features": num_features,
            "context_hidden": context_hidden,
            "context_layers": context_layers,
            "context_heads": context_heads,
            "dropout": dropout,
        }

    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: torch.Tensor,
        structural_features: torch.Tensor,
        paragraph_mask: torch.Tensor,
    ) -> torch.Tensor:
        batch, sequence, tokens = input_ids.shape
        flat_ids = input_ids.reshape(batch * sequence, tokens)
        flat_attention = attention_mask.reshape(batch * sequence, tokens)
        encoded = self.encoder(input_ids=flat_ids, attention_mask=flat_attention).last_hidden_state[:, 0]
        encoded = encoded.reshape(batch, sequence, -1)
        layout = self.layout_projection(structural_features)
        fused = self.fusion(torch.cat([encoded, layout], dim=-1))
        contextual = self.context_encoder(fused, src_key_padding_mask=~paragraph_mask.bool())
        return self.classifier(contextual)

    def save_artifact(self, output_dir: Path, tokenizer, labels: list[str], feature_names: list[str]) -> None:
        output_dir.mkdir(parents=True, exist_ok=True)
        encoder_dir = output_dir / "encoder"
        tokenizer_dir = output_dir / "tokenizer"
        self.encoder.save_pretrained(encoder_dir)
        tokenizer.save_pretrained(tokenizer_dir)
        head_state = {
            key: value.detach().cpu()
            for key, value in self.state_dict().items()
            if not key.startswith("encoder.")
        }
        torch.save(head_state, output_dir / "document_heads.pt")
        config = {
            **self.artifact_config,
            "labels": labels,
            "feature_names": feature_names,
            "architecture": "docdeco_contextual_role_v1",
        }
        (output_dir / "config.json").write_text(
            json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    @classmethod
    def from_artifact(cls, artifact_dir: Path, device: torch.device | str = "cpu") -> "ContextualRoleModel":
        config = json.loads((artifact_dir / "config.json").read_text(encoding="utf-8"))
        model = cls(
            str(artifact_dir / "encoder"),
            num_labels=config["num_labels"],
            num_features=config["num_features"],
            context_hidden=config["context_hidden"],
            context_layers=config["context_layers"],
            context_heads=config["context_heads"],
            dropout=config["dropout"],
        )
        state = torch.load(artifact_dir / "document_heads.pt", map_location="cpu", weights_only=True)
        missing, unexpected = model.load_state_dict(state, strict=False)
        missing = [key for key in missing if not key.startswith("encoder.")]
        if missing or unexpected:
            raise RuntimeError(f"Invalid DocDeco artifact; missing={missing}, unexpected={unexpected}")
        return model.to(device)

