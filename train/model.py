"""Dual-head sequence classifier: binary scam/ham + 7-way scam type."""
from __future__ import annotations

import json
from pathlib import Path

import torch
import torch.nn as nn
from transformers import AutoConfig, AutoModel

from common import LABELS, SCAM_TYPES


class DualHeadClassifier(nn.Module):
    def __init__(self, base_model: str, dropout: float = 0.1, attn_implementation: str | None = None):
        super().__init__()
        self.config = AutoConfig.from_pretrained(base_model)
        kw = {"config": self.config}
        if attn_implementation:
            kw["attn_implementation"] = attn_implementation  # "eager" for a faithful ONNX trace
        if self.config.model_type == "bert":
            kw["add_pooling_layer"] = False
        self.encoder = AutoModel.from_pretrained(base_model, **kw)
        h = self.config.hidden_size
        self.dropout = nn.Dropout(dropout)
        self.binary_head = nn.Linear(h, len(LABELS))
        self.type_head = nn.Linear(h, len(SCAM_TYPES))

    def forward(self, input_ids, attention_mask, token_type_ids=None):
        kw = {"input_ids": input_ids, "attention_mask": attention_mask}
        if token_type_ids is not None and self.config.model_type == "bert":
            kw["token_type_ids"] = token_type_ids
        out = self.encoder(**kw)
        cls = out.last_hidden_state[:, 0]
        cls = self.dropout(cls)
        return self.binary_head(cls), self.type_head(cls)

    def save(self, path: Path, extra: dict | None = None):
        path.mkdir(parents=True, exist_ok=True)
        torch.save(self.state_dict(), path / "pytorch_model.bin")
        meta = {"base_model": self.config._name_or_path, "model_type": self.config.model_type,
                "labels": LABELS, "scam_types": SCAM_TYPES}
        if extra:
            meta.update(extra)
        (path / "model_meta.json").write_text(json.dumps(meta, indent=2))

    @classmethod
    def load(cls, path: Path, base_model: str | None = None, attn_implementation: str | None = None) -> "DualHeadClassifier":
        meta = json.loads((path / "model_meta.json").read_text())
        m = cls(base_model or meta["base_model"], attn_implementation=attn_implementation)
        m.load_state_dict(torch.load(path / "pytorch_model.bin", map_location="cpu"))
        m.eval()
        return m
