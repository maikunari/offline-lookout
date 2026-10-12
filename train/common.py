"""Shared constants for the Offline Lookout training pipeline."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
TEMPLATES = ROOT / "templates"
CHECKPOINTS = ROOT / "checkpoints"
EXPORT = ROOT / "export"
EVAL = ROOT / "eval"

SEED = 42
MAX_SEQ_LEN = 128

BASE_MODEL = "microsoft/MiniLM-L12-H384-uncased"
FALLBACK_MODEL = "distilbert-base-uncased"

# Binary labels
LABELS = ["ham", "scam"]

# Scam-type taxonomy for the optional second head. Index 0 is reserved for
# "none" (used for ham). Legacy datasets have no type labels; we weak-label
# them with keyword rules in prepare.py and mask anything unmatched (-1).
SCAM_TYPES = [
    "none",          # 0: not a scam
    "delivery",      # 1: parcel fee / customs / redelivery
    "banking",       # 2: fraud alert / card frozen / verify payment
    "prize",         # 3: prize, reward, giveaway, too-good-to-be-true money offer
    "impersonation", # 4: "hi mum", boss, friend in trouble, wrong-number lure
    "government",    # 5: tax refund, toll, fine, benefit, visa
    "account",       # 6: subscription / password / storage / SIM / tech-support lure
]
TYPE_TO_ID = {t: i for i, t in enumerate(SCAM_TYPES)}

_URL = re.compile(r"(https?://|www\.)\S+|\b[\w-]+\.(com|net|org|co|uk|io|xyz|info|ly|me|app|link|click|top)\b/?\S*", re.I)

def normalize_for_dedupe(text: str) -> str:
    """Aggressive normalisation used only to detect duplicates across sources."""
    t = text.lower()
    t = _URL.sub(" <url> ", t)
    t = re.sub(r"\d+", "0", t)
    t = re.sub(r"[^a-z0<>]+", " ", t)
    return t.strip()


def clean_text(text: str) -> str:
    """Light cleaning applied to all training text (keeps case/punctuation)."""
    t = text.replace("�", "'")  # replacement chars from bad encodings
    t = re.sub(r"\s+", " ", t).strip()
    return t
