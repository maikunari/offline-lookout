# Evaluation

All numbers are produced by `train/evaluate.py` and `train/baseline.py` with seed 42 on CPU. `test` is the held-out 10% of the de-duplicated UCI + Mendeley data (586 messages). `modern holdout` is 300 hand-written 2026-style messages never seen in training: 180 scams across six types and 120 hard negatives (one-time passcodes, delivery notices, bank receipts, reminders, personal texts). Threshold 0.5 on the calibrated probability.

## Binary scam detection

| Model | Split | Precision | Recall | F1 | ROC-AUC | FPR | ECE | Confusion (tn/fp/fn/tp) |
|---|---|---|---|---|---|---|---|---|
| TF-IDF + LogReg baseline | test | 97.8% | 95.6% | 0.967 | 0.998 | 0.4% | 0.024 | 493/2/4/87 |
| TF-IDF + LogReg baseline | modern holdout | 91.5% | 90.0% | 0.908 | 0.945 | 12.5% | 0.057 | 105/15/18/162 |
| MiniLM-L12 trained on legacy data only (control) | test | 95.7% | 97.8% | 0.967 | 0.996 | 0.8% | 0.014 | 491/4/2/89 |
| MiniLM-L12 trained on legacy data only (control) | modern holdout | 70.9% | 86.7% | 0.780 | 0.696 | 53.3% | 0.274 | 56/64/24/156 |
| MiniLM-L12 fine-tuned (shipped, PyTorch fp32) | test | 95.7% | 98.9% | 0.973 | 0.995 | 0.8% | 0.011 | 491/4/1/90 |
| MiniLM-L12 fine-tuned (shipped, PyTorch fp32) | modern holdout | 96.7% | 98.9% | 0.978 | 0.990 | 5.0% | 0.011 | 114/6/2/178 |
| MiniLM-L12 fine-tuned (shipped, int8 ONNX, what the browser runs) | test | 95.7% | 98.9% | 0.973 | 0.996 | 0.8% | 0.012 | 491/4/1/90 |
| MiniLM-L12 fine-tuned (shipped, int8 ONNX, what the browser runs) | modern holdout | 96.8% | 99.4% | 0.981 | 0.986 | 5.0% | 0.016 | 114/6/1/179 |
| v1_unweighted | test | 91.8% | 97.8% | 0.947 | 0.990 | 1.6% | 0.018 | 487/8/2/89 |
| v1_unweighted | modern holdout | 74.7% | 95.0% | 0.836 | 0.851 | 48.3% | 0.182 | 62/58/9/171 |

## False-positive rate on hard negatives (modern holdout, int8 ONNX)

| Hard-negative group | n | False positives | FPR |
|---|---|---|---|
| bank | 15 | 0 | 0.0% |
| delivery | 26 | 1 | 3.8% |
| otp | 25 | 0 | 0.0% |
| personal | 20 | 3 | 15.0% |
| reminder | 15 | 0 | 0.0% |
| service | 20 | 2 | 10.0% |

## Recall by scam type (modern holdout, int8 ONNX, binary head)

| Scam type | n | Recall |
|---|---|---|
| account | 30 | 100.0% |
| banking | 30 | 100.0% |
| delivery | 30 | 96.7% |
| government | 30 | 100.0% |
| impersonation | 30 | 100.0% |
| prize | 30 | 100.0% |

## Scam-type head (6-way, among true scams in the modern holdout, int8 ONNX)

Overall accuracy: **66.1%** (n=180).

| Type | n | Accuracy |
|---|---|---|
| delivery | 30 | 46.7% |
| banking | 30 | 86.7% |
| prize | 30 | 86.7% |
| impersonation | 30 | 90.0% |
| government | 30 | 60.0% |
| account | 30 | 26.7% |

## Size and latency

| Item | Value |
|---|---|
| Parameters | 33.2M |
| ONNX fp32 | 133.1 MB (not shipped) |
| ONNX int8 (shipped) | 34.0 MB |
| Latency, onnxruntime CPU, intra_op_threads=1, single message, no batching | p50 7.0 ms, p95 8.7 ms (n=200) |
| Calibration temperature (fit on val) | 1.10 |
| Best epoch (by val F1) | 2 |
