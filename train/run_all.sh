#!/usr/bin/env bash
# Reproduce the whole pipeline on CPU (fixed seed 42). From the repo root:
#   python3.11 -m venv .venv && .venv/bin/pip install -r train/requirements.txt
#   bash train/run_all.sh
set -euo pipefail
cd "$(dirname "$0")"
PY=../.venv/bin/python
$PY download.py
$PY prepare.py
$PY baseline.py
# Shipped model: MiniLM + modern supplement oversampled x8.
$PY finetune.py --oversample modern_train:6 --out checkpoints/minilm
# Control: legacy data only (measures generalisation from 2011-era SMS to modern scams).
$PY finetune.py --exclude-source modern_train --out checkpoints/legacy_only
$PY export_onnx.py --checkpoint checkpoints/minilm --out export
$PY evaluate.py --checkpoint checkpoints/minilm --export export --tag minilm
$PY evaluate.py --checkpoint checkpoints/legacy_only --tag legacy_only
$PY tokenizer_parity.py
$PY make_eval_table.py
cp export/model_int8.onnx export/model_meta.json export/vocab.txt ../web/public/model/
echo "done. model in web/public/model, metrics in train/eval"
