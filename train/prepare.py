"""Merge, clean, dedupe, weak-label and split the data.

Outputs (JSONL, one object per line: text, label, label_id, type, type_id, source):
  data/processed/train.jsonl   legacy train split (+ modern_train supplement)
  data/processed/val.jsonl     legacy validation split (used for early stopping / calibration)
  data/processed/test.jsonl    legacy held-out test split
  data/processed/holdout.jsonl hand-written modern holdout (never seen in training)
  data/processed/stats.json    counts for the README / model card
"""
from __future__ import annotations

import csv
import json
import random
import re
from collections import Counter, defaultdict

from common import (PROCESSED, RAW, SEED, TEMPLATES, TYPE_TO_ID, clean_text,
                    normalize_for_dedupe)

# Weak-label rules for legacy scam messages (no type labels in UCI / Mendeley).
# First matching rule wins; unmatched scam -> type_id = -1 (masked in the loss).
WEAK_RULES = [
    ("delivery", r"\b(parcel|package|deliver|courier|shipment|customs|post office|redeliver)"),
    ("government", r"\b(tax|hmrc|irs|revenue|toll|fine|penalty|court|council|benefit|visa|licen[cs]e|dvla|dmv|government|gov\b)"),
    ("banking", r"\b(bank|card|debit|credit|account.*(block|lock|suspend|frozen|verify|unusual)|transaction|payment.*(declin|fail)|kyc|paypal|wallet|fraud)"),
    ("impersonation", r"\b(hi mum|hi mom|hi dad|its me|it's me|new number|new phone|boss|ceo|manager|wrong number|soldier|widow)"),
    ("account", r"\b(password|login|log in|sign[- ]?in|suspend|deactivat|verify your (account|email|number)|subscription|netflix|apple id|icloud|sim|voicemail|virus|antivirus|storage|expire[sd]?\b)"),
    ("prize", r"\b(won|win|winner|prize|award|claim|free|cash|reward|bonus|lottery|draw|congrat|selected|voucher|gift|guaranteed|urgent|offer|discount|txt|text \w+ to \d|call \d|earn|job|invest|crypto|loan)"),
]
_WEAK = [(t, re.compile(p, re.I)) for t, p in WEAK_RULES]


def weak_type(text: str) -> str | None:
    for t, rx in _WEAK:
        if rx.search(text):
            return t
    return None


def load_uci():
    rows = []
    with open(RAW / "uci" / "SMSSpamCollection", encoding="utf-8", errors="replace") as f:
        for line in f:
            lab, txt = line.rstrip("\n").split("\t", 1)
            rows.append({"text": txt, "label": "scam" if lab == "spam" else "ham", "source": "uci"})
    return rows


def load_mendeley():
    rows = []
    with open(RAW / "mendeley" / "Dataset_5971.csv", encoding="utf-8", errors="replace", newline="") as f:
        for r in csv.DictReader(f):
            lab = r["LABEL"].strip().lower()
            if lab not in {"ham", "spam", "smishing"}:
                continue
            rows.append({"text": r["TEXT"], "label": "ham" if lab == "ham" else "scam",
                         "source": "mendeley", "mendeley_label": lab})
    return rows


def load_templates(name: str):
    rows = []
    with open(TEMPLATES / name, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            rows.append({"text": r["text"], "label": r["label"], "type": r["type"],
                         "tags": r.get("tags", []), "source": name.replace(".jsonl", "")})
    return rows


def finalize(r: dict) -> dict:
    text = clean_text(r["text"])
    label = r["label"]
    if "type" in r and r["type"]:
        t = r["type"]
    elif label == "ham":
        t = "none"
    else:
        t = weak_type(text)  # may be None
    out = {
        "text": text,
        "label": label,
        "label_id": 1 if label == "scam" else 0,
        "type": t if t else "unknown",
        "type_id": TYPE_TO_ID[t] if t else -1,
        "source": r["source"],
    }
    if r.get("tags"):
        out["tags"] = r["tags"]
    return out


def main() -> None:
    random.seed(SEED)
    PROCESSED.mkdir(parents=True, exist_ok=True)

    legacy = load_uci() + load_mendeley()
    stats = {"raw": {"uci": sum(1 for r in legacy if r["source"] == "uci"),
                     "mendeley": sum(1 for r in legacy if r["source"] == "mendeley")}}

    # Dedupe across both legacy sources on normalised text. Keep the first
    # occurrence; if the same text carries conflicting labels, drop it.
    seen: dict[str, dict] = {}
    labels_for: defaultdict[str, set] = defaultdict(set)
    for r in legacy:
        k = normalize_for_dedupe(r["text"])
        if len(k) < 3:
            continue
        labels_for[k].add(r["label"])
        if k not in seen:
            seen[k] = r
    conflicts = {k for k, v in labels_for.items() if len(v) > 1}
    legacy_unique = [finalize(r) for k, r in seen.items() if k not in conflicts]
    stats["legacy_conflicting_dropped"] = len(conflicts)
    stats["legacy_unique"] = len(legacy_unique)
    stats["legacy_label_counts"] = dict(Counter(r["label"] for r in legacy_unique))
    stats["legacy_scam_weak_types"] = dict(Counter(r["type"] for r in legacy_unique if r["label"] == "scam"))

    # Stratified 80/10/10 split of legacy data.
    by_label = defaultdict(list)
    for r in legacy_unique:
        by_label[r["label"]].append(r)
    train, val, test = [], [], []
    for lab, rows in by_label.items():
        random.shuffle(rows)
        n = len(rows)
        n_val, n_test = int(0.1 * n), int(0.1 * n)
        val += rows[:n_val]
        test += rows[n_val:n_val + n_test]
        train += rows[n_val + n_test:]

    # Modern hand-written data. The holdout must never leak into training.
    holdout = [finalize(r) for r in load_templates("modern_holdout.jsonl")]
    modern_train = [finalize(r) for r in load_templates("modern_train.jsonl")]
    ho_keys = {normalize_for_dedupe(r["text"]) for r in holdout}
    leaks = [r for r in modern_train + train + val + test if normalize_for_dedupe(r["text"]) in ho_keys]
    assert not leaks, f"holdout leakage: {leaks[:3]}"
    train += modern_train

    random.shuffle(train)
    for name, rows in [("train", train), ("val", val), ("test", test), ("holdout", holdout)]:
        with open(PROCESSED / f"{name}.jsonl", "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        stats[name] = {"n": len(rows), "labels": dict(Counter(r["label"] for r in rows)),
                       "types": dict(Counter(r["type"] for r in rows))}
        print(f"{name:8s} n={len(rows):5d} {dict(Counter(r['label'] for r in rows))}")
    with open(PROCESSED / "stats.json", "w") as f:
        json.dump(stats, f, indent=2)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
