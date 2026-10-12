"""Verify the browser tokenizer (web/src/tokenizer.ts) matches the HF tokenizer exactly."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from transformers import AutoTokenizer

from common import BASE_MODEL, MAX_SEQ_LEN, PROCESSED, ROOT
from metrics import load_jsonl

EDGE = ["Café naïve résumé – “quotes” … 東京 ¥500 😀 ok", "a" * 150, "   ", "http://x.example/a?b=1&c=2",
        "Tab\tseparated\nlines\r\n", "ÀÉÎÕÜ ß ø", "﷽ long ligature", "mixed123numbers456", "#!$%^&*()[]{}"]


def main() -> int:
    tok = AutoTokenizer.from_pretrained(BASE_MODEL)
    texts = [r["text"] for f in ["holdout", "test", "val"] for r in load_jsonl(PROCESSED / f"{f}.jsonl")] + EDGE
    enc = tok(texts, truncation=True, max_length=MAX_SEQ_LEN)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump([{"text": t, "ids": i} for t, i in zip(texts, enc["input_ids"])], f)
        path = f.name
    script = ROOT.parent / "web" / "scripts" / "tokenizer-parity.mts"
    return subprocess.call(["node", str(script), path])


if __name__ == "__main__":
    sys.exit(main())
