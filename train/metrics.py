"""Metric helpers shared by the baseline and the fine-tuned model evaluation."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.metrics import (confusion_matrix, f1_score, precision_score,
                             recall_score, roc_auc_score)


def load_jsonl(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def expected_calibration_error(y: np.ndarray, p: np.ndarray, bins: int = 10) -> float:
    edges = np.linspace(0, 1, bins + 1)
    ece = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (p > lo) & (p <= hi)
        if m.any():
            ece += m.mean() * abs(y[m].mean() - p[m].mean())
    return float(ece)


def binary_metrics(y: np.ndarray, p: np.ndarray, rows: list[dict] | None = None, thr: float = 0.5) -> dict:
    pred = (p >= thr).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    out = {
        "n": int(len(y)),
        "threshold": thr,
        "accuracy": float((pred == y).mean()),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "f1": float(f1_score(y, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y, p)) if len(set(y.tolist())) > 1 else None,
        "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "fpr": float(fp / (fp + tn)) if (fp + tn) else None,
        "ece": expected_calibration_error(y, p),
    }
    if rows is not None and any("tags" in r for r in rows):
        # Hard-negative breakdown: false-positive rate per ham tag group.
        groups: dict[str, list[int]] = {}
        for i, r in enumerate(rows):
            if r["label_id"] == 0:
                for t in r.get("tags", ["untagged"]):
                    groups.setdefault(t, []).append(i)
        out["hard_negative_fpr"] = {
            t: {"n": len(ix), "fp": int(pred[ix].sum()), "fpr": float(pred[ix].mean())}
            for t, ix in sorted(groups.items())
        }
    if rows is not None and any(r.get("type_id", -1) > 0 for r in rows):
        # Recall per scam type (binary head).
        per_type: dict[str, list[int]] = {}
        for i, r in enumerate(rows):
            if r["label_id"] == 1 and r.get("type") not in (None, "unknown", "none"):
                per_type.setdefault(r["type"], []).append(i)
        out["recall_by_scam_type"] = {
            t: {"n": len(ix), "recall": float(pred[ix].mean())} for t, ix in sorted(per_type.items())
        }
    return out
