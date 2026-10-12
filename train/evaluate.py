"""Evaluate the fine-tuned model (PyTorch + ONNX int8) and write the eval table.

Writes eval/metrics.json and eval/EVAL.md.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from transformers import AutoTokenizer

from common import CHECKPOINTS, EVAL, EXPORT, PROCESSED, SCAM_TYPES
from metrics import binary_metrics, load_jsonl
from model import DualHeadClassifier


def softmax(x):
    x = x - x.max(-1, keepdims=True)
    e = np.exp(x)
    return e / e.sum(-1, keepdims=True)


def torch_predict(model, tok, rows, max_len, bs=64):
    out_b, out_t = [], []
    with torch.no_grad():
        for i in range(0, len(rows), bs):
            enc = tok([r["text"] for r in rows[i:i+bs]], return_tensors="pt", padding=True,
                      truncation=True, max_length=max_len)
            b, t = model(**enc)
            out_b.append(b.numpy()); out_t.append(t.numpy())
    return np.concatenate(out_b), np.concatenate(out_t)


def onnx_predict(sess, tok, rows, max_len, bs=64):
    out_b, out_t = [], []
    for i in range(0, len(rows), bs):
        e = tok([r["text"] for r in rows[i:i+bs]], return_tensors="np", padding=True,
                truncation=True, max_length=max_len)
        feeds = {k: e[k].astype(np.int64) for k in ["input_ids", "attention_mask", "token_type_ids"]}
        b, t = sess.run(["logits", "type_logits"], feeds)
        out_b.append(b); out_t.append(t)
    return np.concatenate(out_b), np.concatenate(out_t)


def latency(sess, tok, rows, max_len, n=200, threads_note=""):
    times = []
    for r in rows[:n]:
        e = tok([r["text"]], return_tensors="np", truncation=True, max_length=max_len)
        feeds = {k: e[k].astype(np.int64) for k in ["input_ids", "attention_mask", "token_type_ids"]}
        t0 = time.perf_counter(); sess.run(["logits", "type_logits"], feeds); times.append(time.perf_counter() - t0)
    t = np.array(times) * 1000
    return {"n": len(t), "p50_ms": float(np.percentile(t, 50)), "p95_ms": float(np.percentile(t, 95)), "note": threads_note}


def type_metrics(tlogits, rows):
    """6-way scam-type accuracy among true scams with a known type."""
    idx = [i for i, r in enumerate(rows) if r["label_id"] == 1 and r.get("type_id", -1) > 0]
    if not idx:
        return None
    pred = tlogits[idx][:, 1:].argmax(-1) + 1  # exclude "none"
    true = np.array([rows[i]["type_id"] for i in idx])
    per = {}
    for t in range(1, len(SCAM_TYPES)):
        m = true == t
        if m.any():
            per[SCAM_TYPES[t]] = {"n": int(m.sum()), "acc": float((pred[m] == t).mean())}
    return {"n": len(idx), "accuracy": float((pred == true).mean()), "per_type": per}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default=str(CHECKPOINTS / "minilm"))
    ap.add_argument("--export", default=str(EXPORT))
    ap.add_argument("--tag", default="minilm")
    ap.add_argument("--threads", type=int, default=1, help="ORT intra-op threads for latency")
    args = ap.parse_args()
    ckpt, exp = Path(args.checkpoint), Path(args.export)
    torch.set_num_threads(8)

    meta = json.loads((ckpt / "model_meta.json").read_text())
    T, max_len = meta["temperature"], meta["max_seq_len"]
    tok = AutoTokenizer.from_pretrained(ckpt)
    model = DualHeadClassifier.load(ckpt)
    test = load_jsonl(PROCESSED / "test.jsonl")
    holdout = load_jsonl(PROCESSED / "holdout.jsonl")

    results = {"tag": args.tag, "base_model": meta["base_model"], "parameters": meta["parameters"],
               "temperature": T, "best_epoch": meta.get("best_epoch"), "splits": {}}
    sessions = {}
    for name in ["model_int8.onnx", "model.onnx"]:
        p = exp / name
        if p.exists():
            so = ort.SessionOptions(); so.intra_op_num_threads = args.threads
            sessions[name] = ort.InferenceSession(str(p), so, providers=["CPUExecutionProvider"])
            results.setdefault("sizes_mb", {})[name] = round(p.stat().st_size / 1e6, 1)

    for split, rows in [("test", test), ("holdout", holdout)]:
        y = np.array([r["label_id"] for r in rows])
        bl, tl = torch_predict(model, tok, rows, max_len)
        p_cal = softmax(bl / T)[:, 1]
        p_raw = softmax(bl)[:, 1]
        entry = {"pytorch": binary_metrics(y, p_cal, rows), "pytorch_uncalibrated_ece": binary_metrics(y, p_raw)["ece"],
                 "scam_type": type_metrics(tl, rows)}
        for name, sess in sessions.items():
            ob, ot = onnx_predict(sess, tok, rows, max_len)
            entry[name] = binary_metrics(y, softmax(ob / T)[:, 1], rows)
            entry[name]["scam_type"] = type_metrics(ot, rows)
        results["splits"][split] = entry
        print(split, "pytorch f1", round(entry["pytorch"]["f1"], 4), "auc", round(entry["pytorch"]["roc_auc"], 4),
              *[f"{n} f1 {round(entry[n]['f1'],4)}" for n in sessions])

    if "model_int8.onnx" in sessions:
        results["latency"] = {
            f"int8_cpu_{args.threads}thread": latency(sessions["model_int8.onnx"], tok, holdout, max_len,
                                                    threads_note=f"onnxruntime CPU, intra_op_threads={args.threads}, single message, no batching")
        }
        print("latency", results["latency"])

    EVAL.mkdir(exist_ok=True)
    (EVAL / f"{args.tag}_metrics.json").write_text(json.dumps(results, indent=2))
    print("wrote", EVAL / f"{args.tag}_metrics.json")


if __name__ == "__main__":
    main()
