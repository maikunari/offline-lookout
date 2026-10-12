"""Export the fine-tuned dual-head model to ONNX and quantize to int8 with Optimum.

Produces in --out (default export/):
  model.onnx            fp32 graph (not committed; large)
  model_int8.onnx       dynamic int8 (committed to web/public/model/ when < 50 MB)
  tokenizer.json, tokenizer_config.json, special_tokens_map.json, vocab.txt
  model_meta.json       labels, scam types, temperature, max_seq_len, sizes
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from optimum.onnxruntime import AutoQuantizationConfig, ORTQuantizer
from transformers import AutoTokenizer

from common import CHECKPOINTS, EXPORT
from model import DualHeadClassifier


class Wrapper(torch.nn.Module):
    def __init__(self, m):
        super().__init__(); self.m = m

    def forward(self, input_ids, attention_mask, token_type_ids):
        return self.m(input_ids, attention_mask, token_type_ids)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default=str(CHECKPOINTS / "minilm"))
    ap.add_argument("--out", default=str(EXPORT))
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()
    ckpt, out = Path(args.checkpoint), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # Eager attention: the SDPA path drops the attention mask from the traced graph
    # when the trace example has no padding, which silently breaks batched inference.
    model = DualHeadClassifier.load(ckpt, attn_implementation="eager")
    tok = AutoTokenizer.from_pretrained(ckpt)
    meta = json.loads((ckpt / "model_meta.json").read_text())

    # Trace with a padded batch so the mask is a real dynamic input.
    enc = tok(["Your parcel is waiting, pay the fee now: http://example.com", "ok see you at 5"],
              return_tensors="pt", padding=True, truncation=True)
    model.config.save_pretrained(out)
    fp32 = out / "model.onnx"
    wrapper = Wrapper(model).eval()
    torch.onnx.export(
        wrapper, (enc["input_ids"], enc["attention_mask"], enc["token_type_ids"]), str(fp32),
        input_names=["input_ids", "attention_mask", "token_type_ids"],
        output_names=["logits", "type_logits"],
        dynamic_axes={k: {0: "batch", 1: "sequence"} for k in ["input_ids", "attention_mask", "token_type_ids"]}
        | {"logits": {0: "batch"}, "type_logits": {0: "batch"}},
        opset_version=args.opset, do_constant_folding=True, dynamo=False,
    )
    print(f"fp32 onnx: {fp32.stat().st_size/1e6:.1f} MB")

    # Dynamic int8 quantization via Optimum (weights int8, activations quantized at runtime).
    quantizer = ORTQuantizer.from_pretrained(out, file_name="model.onnx")
    qconfig = AutoQuantizationConfig.avx512_vnni(is_static=False, per_channel=True)
    qdir = out / "tmp"
    quantizer.quantize(save_dir=qdir, quantization_config=qconfig, file_suffix="int8")
    int8 = out / "model_int8.onnx"
    shutil.move(str(qdir / "model_int8.onnx"), int8)
    shutil.rmtree(qdir, ignore_errors=True)
    print(f"int8 onnx: {int8.stat().st_size/1e6:.1f} MB")

    tok.save_pretrained(out)
    (out / "config.json").unlink(missing_ok=True)  # not needed by the web app

    # Parity check: torch vs fp32 onnx vs int8 onnx on a few sentences.
    texts = ["Your parcel is held, pay 1.99 at http://pl-fee.example", "Your code is 118 294. Expires in 10 minutes.",
             "Hi mum, new number, can you send 300?", "Running late, be there in 10"]
    e = tok(texts, return_tensors="np", padding=True, truncation=True, max_length=meta["max_seq_len"])
    feeds = {k: e[k].astype(np.int64) for k in ["input_ids", "attention_mask", "token_type_ids"]}
    model.eval()  # the exporter restores the wrapper's original (training) mode; force eval for the reference
    with torch.no_grad():
        tl, _ = model(**{k: torch.tensor(v) for k, v in feeds.items()})
    tl = tl.numpy()
    parity = {}
    for name, path in [("fp32", fp32), ("int8", int8)]:
        sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        ol = sess.run(["logits"], feeds)[0]
        parity[name] = float(np.abs(ol - tl).max())
        print(f"max |logit diff| torch vs {name}: {parity[name]:.4f}")

    meta.update({
        "onnx_opset": args.opset,
        "quantization": "dynamic int8 (Optimum ORTQuantizer, avx512_vnni config, per_channel)",
        "size_bytes": {"fp32": fp32.stat().st_size, "int8": int8.stat().st_size},
        "logit_parity_max_abs_diff": parity,
        "inputs": ["input_ids", "attention_mask", "token_type_ids"],
        "outputs": ["logits", "type_logits"],
    })
    (out / "model_meta.json").write_text(json.dumps(meta, indent=2))
    print("wrote", out / "model_meta.json")


if __name__ == "__main__":
    main()
