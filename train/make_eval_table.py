"""Render train/eval/*_metrics.json into the markdown eval table (train/eval/EVAL.md)."""
from __future__ import annotations

import json
from pathlib import Path

from common import EVAL


def pct(x):
    return "–" if x is None else f"{100*x:.1f}%"


def f3(x):
    return "–" if x is None else f"{x:.3f}"


def main() -> None:
    base = json.loads((EVAL / "baseline_metrics.json").read_text())
    runs = {p.stem.replace("_metrics", ""): json.loads(p.read_text()) for p in EVAL.glob("*_metrics.json") if p.stem != "baseline_metrics"}
    main_run = runs.get("minilm")
    lines = ["# Evaluation", ""]
    lines.append("All numbers are produced by `train/evaluate.py` and `train/baseline.py` with seed 42 on CPU. "
                 "`test` is the held-out 10% of the de-duplicated UCI + Mendeley data (586 messages). "
                 "`modern holdout` is 300 hand-written 2026-style messages never seen in training: 180 scams across six types "
                 "and 120 hard negatives (one-time passcodes, delivery notices, bank receipts, reminders, personal texts). "
                 "Threshold 0.5 on the calibrated probability.")
    lines.append("")
    lines.append("## Binary scam detection")
    lines.append("")
    lines.append("| Model | Split | Precision | Recall | F1 | ROC-AUC | FPR | ECE | Confusion (tn/fp/fn/tp) |")
    lines.append("|---|---|---|---|---|---|---|---|---|")

    def row(name, split, m):
        c = m["confusion"]
        lines.append(f"| {name} | {split} | {pct(m['precision'])} | {pct(m['recall'])} | {f3(m['f1'])} | {f3(m['roc_auc'])} | {pct(m['fpr'])} | {f3(m['ece'])} | {c['tn']}/{c['fp']}/{c['fn']}/{c['tp']} |")

    for split in ["test", "holdout"]:
        row("TF-IDF + LogReg baseline", split if split == "test" else "modern holdout", base[split])
    for tag, r in sorted(runs.items()):
        label = {"minilm": "MiniLM-L12 fine-tuned (shipped, PyTorch fp32)",
                 "legacy_only": "MiniLM-L12 trained on legacy data only (control)"}.get(tag, tag)
        for split in ["test", "holdout"]:
            row(label, split if split == "test" else "modern holdout", r["splits"][split]["pytorch"])
        if "model_int8.onnx" in r["splits"]["test"]:
            for split in ["test", "holdout"]:
                row(label.replace("PyTorch fp32", "int8 ONNX, what the browser runs"), split if split == "test" else "modern holdout", r["splits"][split]["model_int8.onnx"])
    lines.append("")

    if main_run:
        m = main_run["splits"]["holdout"]["model_int8.onnx"]
        lines.append("## False-positive rate on hard negatives (modern holdout, int8 ONNX)")
        lines.append("")
        lines.append("| Hard-negative group | n | False positives | FPR |")
        lines.append("|---|---|---|---|")
        for k, v in m.get("hard_negative_fpr", {}).items():
            lines.append(f"| {k} | {v['n']} | {v['fp']} | {pct(v['fpr'])} |")
        lines.append("")
        lines.append("## Recall by scam type (modern holdout, int8 ONNX, binary head)")
        lines.append("")
        lines.append("| Scam type | n | Recall |")
        lines.append("|---|---|---|")
        for k, v in m.get("recall_by_scam_type", {}).items():
            lines.append(f"| {k} | {v['n']} | {pct(v['recall'])} |")
        lines.append("")
        st = m.get("scam_type")
        if st:
            lines.append("## Scam-type head (6-way, among true scams in the modern holdout, int8 ONNX)")
            lines.append("")
            lines.append(f"Overall accuracy: **{pct(st['accuracy'])}** (n={st['n']}).")
            lines.append("")
            lines.append("| Type | n | Accuracy |")
            lines.append("|---|---|---|")
            for k, v in st["per_type"].items():
                lines.append(f"| {k} | {v['n']} | {pct(v['acc'])} |")
            lines.append("")
        lat = main_run.get("latency", {})
        sizes = main_run.get("sizes_mb", {})
        lines.append("## Size and latency")
        lines.append("")
        lines.append("| Item | Value |")
        lines.append("|---|---|")
        lines.append(f"| Parameters | {main_run['parameters']/1e6:.1f}M |")
        if "model.onnx" in sizes:
            lines.append(f"| ONNX fp32 | {sizes['model.onnx']} MB (not shipped) |")
        if "model_int8.onnx" in sizes:
            lines.append(f"| ONNX int8 (shipped) | {sizes['model_int8.onnx']} MB |")
        for k, v in lat.items():
            lines.append(f"| Latency, {v['note']} | p50 {v['p50_ms']:.1f} ms, p95 {v['p95_ms']:.1f} ms (n={v['n']}) |")
        lines.append(f"| Calibration temperature (fit on val) | {main_run['temperature']:.2f} |")
        lines.append(f"| Best epoch (by val F1) | {main_run.get('best_epoch')} |")
        lines.append("")
    (EVAL / "EVAL.md").write_text("\n".join(lines))
    print("\n".join(lines))
    if main_run:
        inject_headline(base, main_run, runs.get("legacy_only"))


def inject_headline(base, main_run, control):
    """Write the headline table between <!-- EVAL:START --> markers in README.md and MODEL_CARD.md."""
    hs = main_run["splits"]["holdout"]
    ts = main_run["splits"]["test"]
    int8_h = hs["model_int8.onnx"]; int8_t = ts["model_int8.onnx"]
    lat = next(iter(main_run.get("latency", {}).values()), None)
    sizes = main_run.get("sizes_mb", {})
    rows = [
        "## Evaluation (headline)", "",
        "Seed 42, CPU. `test` = held-out 10% of the de-duplicated UCI + Mendeley data (586 messages). "
        "`modern holdout` = 300 hand-written 2026-style messages never used in training (180 scams, 120 hard negatives such as OTP codes, delivery notices and bank receipts). "
        "Full table: [`train/eval/EVAL.md`](train/eval/EVAL.md).", "",
        "| Model | Split | P | R | F1 | ROC-AUC | FPR |", "|---|---|---|---|---|---|---|",
    ]
    def r(name, split, m):
        rows.append(f"| {name} | {split} | {pct(m['precision'])} | {pct(m['recall'])} | {f3(m['f1'])} | {f3(m['roc_auc'])} | {pct(m['fpr'])} |")
    r("TF-IDF + LogReg baseline", "test", base["test"]); r("TF-IDF + LogReg baseline", "modern holdout", base["holdout"])
    if control:
        r("MiniLM, legacy data only (control)", "test", control["splits"]["test"]["pytorch"])
        r("MiniLM, legacy data only (control)", "modern holdout", control["splits"]["holdout"]["pytorch"])
    r("**MiniLM int8 ONNX (shipped)**", "test", int8_t); r("**MiniLM int8 ONNX (shipped)**", "modern holdout", int8_h)
    rows.append("")
    hn = int8_h.get("hard_negative_fpr", {})
    if hn:
        rows.append("Hard-negative FPR on the modern holdout (shipped model): " + ", ".join(f"{k} {v['fp']}/{v['n']}" for k, v in hn.items()) + ".")
    st = int8_h.get("scam_type")
    if st:
        rows.append(f"Scam-type head accuracy on modern holdout scams: {pct(st['accuracy'])} (6-way).")
    rows.append(f"Calibration ECE on modern holdout: {f3(int8_h['ece'])}. Confusion (tn/fp/fn/tp): "
                f"{int8_h['confusion']['tn']}/{int8_h['confusion']['fp']}/{int8_h['confusion']['fn']}/{int8_h['confusion']['tp']}.")
    if lat:
        rows.append(f"Latency ({lat['note']}): p50 {lat['p50_ms']:.1f} ms, p95 {lat['p95_ms']:.1f} ms. "
                    f"Size: int8 ONNX {sizes.get('model_int8.onnx', '?')} MB (fp32 {sizes.get('model.onnx', '?')} MB, not shipped).")
    block = "<!-- EVAL:START -->\n" + "\n".join(rows) + "\n<!-- EVAL:END -->"
    import re
    for doc in [EVAL.parent.parent / "README.md", EVAL.parent.parent / "MODEL_CARD.md"]:
        txt = doc.read_text()
        new = re.sub(r"<!-- EVAL:START -->.*?<!-- EVAL:END -->", lambda _: block, txt, flags=re.S)
        doc.write_text(new)
        print("injected eval table into", doc.name)


if __name__ == "__main__":
    main()
