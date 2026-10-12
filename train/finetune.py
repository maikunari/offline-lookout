"""Fine-tune MiniLM with a binary scam head and a 7-way scam-type head on CPU.

Usage:
  python finetune.py                      # default: MiniLM, all training data
  python finetune.py --exclude-source modern_train --out checkpoints/legacy_only
  python finetune.py --oversample modern_train:6 --out checkpoints/minilm   # shipped config
  python finetune.py --base distilbert-base-uncased --out checkpoints/distilbert
"""
from __future__ import annotations

import argparse
import json
import math
import random
import time

import numpy as np
import torch
import torch.nn.functional as F
from sklearn.metrics import f1_score, roc_auc_score
from torch.utils.data import DataLoader
from transformers import AutoTokenizer, get_linear_schedule_with_warmup

from common import BASE_MODEL, CHECKPOINTS, MAX_SEQ_LEN, PROCESSED, SCAM_TYPES, SEED
from metrics import load_jsonl
from model import DualHeadClassifier


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


class Collator:
    def __init__(self, tok, max_len):
        self.tok, self.max_len = tok, max_len

    def __call__(self, batch):
        enc = self.tok([b["text"] for b in batch], truncation=True, max_length=self.max_len,
                       padding=True, return_tensors="pt")
        enc["labels"] = torch.tensor([b["label_id"] for b in batch])
        enc["type_labels"] = torch.tensor([b["type_id"] for b in batch])
        return enc


@torch.no_grad()
def predict(model, loader):
    model.eval()
    logits, tlogits, ys = [], [], []
    for enc in loader:
        y = enc.pop("labels"); enc.pop("type_labels")
        b, t = model(**enc)
        logits.append(b); tlogits.append(t); ys.append(y)
    return torch.cat(logits), torch.cat(tlogits), torch.cat(ys)


def fit_temperature(logits: torch.Tensor, y: torch.Tensor) -> float:
    """Single-parameter temperature scaling on the validation set (binary head)."""
    best_t, best_nll = 1.0, float("inf")
    for t in np.linspace(0.5, 5.0, 91):
        nll = F.cross_entropy(logits / t, y).item()
        if nll < best_nll:
            best_t, best_nll = float(t), nll
    return best_t


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE_MODEL)
    ap.add_argument("--out", default=str(CHECKPOINTS / "minilm"))
    ap.add_argument("--epochs", type=int, default=4)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--lr", type=float, default=5e-5)
    ap.add_argument("--type-loss-weight", type=float, default=0.5)
    ap.add_argument("--max-len", type=int, default=MAX_SEQ_LEN)
    ap.add_argument("--exclude-source", action="append", default=[])
    ap.add_argument("--oversample", action="append", default=[],
                    help="SOURCE:K repeats rows from SOURCE K times (e.g. modern_train:8)")
    ap.add_argument("--scam-weight-cap", type=float, default=1.5,
                    help="cap on the binary class weight for 'scam' (sqrt of the ham:scam ratio, capped)")
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--seed", type=int, default=SEED)
    args = ap.parse_args()

    torch.set_num_threads(args.threads)
    set_seed(args.seed)
    out = __import__("pathlib").Path(args.out)

    train = [r for r in load_jsonl(PROCESSED / "train.jsonl") if r["source"] not in args.exclude_source]
    for spec in args.oversample:
        src, k = spec.split(":")
        extra = [r for r in train if r["source"] == src]
        train += extra * (int(k) - 1)
        print(f"oversampled {src}: {len(extra)} rows x{k}")
    val = load_jsonl(PROCESSED / "val.jsonl")
    print(f"train={len(train)} val={len(val)} base={args.base} excluded={args.exclude_source}")

    tok = AutoTokenizer.from_pretrained(args.base)
    col = Collator(tok, args.max_len)
    g = torch.Generator().manual_seed(args.seed)
    train_dl = DataLoader(train, batch_size=args.batch_size, shuffle=True, collate_fn=col, generator=g)
    val_dl = DataLoader(val, batch_size=64, shuffle=False, collate_fn=col)

    model = DualHeadClassifier(args.base)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"parameters: {n_params/1e6:.1f}M")

    # Mild class weighting for the binary head (ham:scam ~ 5:1 in legacy data).
    n_scam = sum(r["label_id"] for r in train); n_ham = len(train) - n_scam
    w = torch.tensor([1.0, min(args.scam_weight_cap, math.sqrt(n_ham / max(1, n_scam)))])
    print(f"binary class weights: {w.tolist()}")
    # Type head: inverse-sqrt-frequency weights so "none" (all ham) and "prize"
    # (most legacy spam) don't drown out the rarer modern scam types.
    type_counts = torch.tensor([max(1, sum(1 for r in train if r["type_id"] == t)) for t in range(len(SCAM_TYPES))], dtype=torch.float)
    tw = (1.0 / type_counts.sqrt()); tw = tw / tw.mean()
    print(f"type class weights: {[round(x, 2) for x in tw.tolist()]}")

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    total = args.epochs * len(train_dl)
    sched = get_linear_schedule_with_warmup(opt, int(0.06 * total), total)

    best = {"f1": -1.0}
    history = []
    t_start = time.time()
    for epoch in range(1, args.epochs + 1):
        model.train()
        running, steps, t0 = 0.0, 0, time.time()
        for enc in train_dl:
            y = enc.pop("labels"); ty = enc.pop("type_labels")
            b_logits, t_logits = model(**enc)
            loss = F.cross_entropy(b_logits, y, weight=w)
            if (ty >= 0).any():
                loss = loss + args.type_loss_weight * F.cross_entropy(t_logits, ty, weight=tw, ignore_index=-1)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step(); sched.step(); opt.zero_grad()
            running += loss.item(); steps += 1
            if steps % 25 == 0:
                print(f"  epoch {epoch} step {steps}/{len(train_dl)} loss {running/steps:.4f} "
                      f"({(time.time()-t0)/steps:.2f}s/step)", flush=True)
        logits, tlogits, ys = predict(model, val_dl)
        p = torch.softmax(logits, -1)[:, 1].numpy()
        f1 = f1_score(ys.numpy(), (p >= 0.5).astype(int))
        auc = roc_auc_score(ys.numpy(), p)
        rec = {"epoch": epoch, "train_loss": running / max(1, steps), "val_f1": float(f1),
               "val_auc": float(auc), "epoch_seconds": round(time.time() - t0, 1)}
        history.append(rec)
        print(f"epoch {epoch}: {rec}", flush=True)
        if f1 > best["f1"] or (f1 == best["f1"] and auc > best.get("auc", 0)):
            temperature = fit_temperature(logits, ys)
            best = {"f1": float(f1), "auc": float(auc), "epoch": epoch, "temperature": temperature}
            model.save(out, extra={
                "temperature": temperature, "max_seq_len": args.max_len, "parameters": n_params,
                "best_epoch": epoch, "val_f1": float(f1), "val_auc": float(auc),
                "train_args": vars(args), "seed": args.seed,
            })
            tok.save_pretrained(out)
            print(f"  saved best (T={temperature:.2f})", flush=True)

    (out / "train_history.json").write_text(json.dumps(
        {"history": history, "best": best, "total_seconds": round(time.time() - t_start, 1)}, indent=2))
    print("best:", best, f"total {time.time()-t_start:.0f}s")


if __name__ == "__main__":
    main()
