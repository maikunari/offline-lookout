# Model card: Offline Lookout scam-text classifier

## Summary

A fine-tuned `microsoft/MiniLM-L12-H384-uncased` (33.2M parameters) that
classifies a short text message as **scam** or **not scam**, and, when it is a
scam, into one of six families. Shipped as a 34 MB dynamic-int8 ONNX file and
run entirely in the browser with onnxruntime-web. Built for the Ryze AI Hack:
Small Models, October 2026.

## Intended use

- Personal, on-device triage of suspicious SMS / chat messages in English.
- Not a security product. It assists a human decision; it must not block or
  delete messages automatically.

## Architecture

- Encoder: MiniLM-L12-H384 (12 layers, hidden 384, 12 heads), BERT WordPiece
  uncased vocabulary (30,522). Pooler dropped; the `[CLS]` hidden state is used.
- Heads: `Linear(384, 2)` for scam / ham and `Linear(384, 7)` for scam type
  (`none, delivery, banking, prize, impersonation, government, account`).
- Loss: cross-entropy on the binary head (scam class weight 1.5) plus 0.5 x
  cross-entropy on the type head with inverse-square-root class weights;
  examples without a type label are masked out of the type loss.
- Max sequence length 128 tokens; dynamic padding.

## Training data

See `DATA_LICENSES.md` for sources and licenses.

| Split | Messages | Scam | Ham | Notes |
|---|---|---|---|---|
| train (legacy) | 4,704 | 735 | 3,969 | 80% of de-duplicated UCI + Mendeley |
| train (modern supplement) | 227 (x6 oversampled) | 80 | 147 | hand-written, disjoint from the holdout; mostly legitimate automated notices |
| val | 586 | 91 | 495 | 10% legacy; model selection + temperature |
| test | 586 | 91 | 495 | 10% legacy |
| modern holdout | 300 | 180 | 120 | hand-written, never trained on |

De-duplication is on a normalised form of the text (lower-cased, URLs and
digits collapsed), because the Mendeley set contains most of the UCI set.
Scam types for the legacy spam come from keyword rules (`train/prepare.py`,
`WEAK_RULES`); unmatched legacy scams carry no type label.

## Training procedure

- Hardware: CPU only (8 cores), no GPU. ~25 minutes per run.
- Optimiser: AdamW, lr 5e-5, weight decay 0.01, linear warm-up 6%, 4 epochs,
  batch 32, gradient clipping 1.0, seed 42.
- Model selection: best validation F1 (ties broken by ROC-AUC).
- Calibration: single temperature fit on the validation logits by grid search
  on NLL.
- Export: `torch.onnx.export` (opset 17, eager attention so the attention mask
  stays a real input), then Optimum `ORTQuantizer` dynamic int8 (per-channel
  weights, `avx512_vnni` config). Per-channel was chosen because per-tensor
  quantisation flipped 12 of 886 test+holdout decisions versus fp32; per-channel
  flipped none.

## Evaluation

<!-- EVAL:START -->
## Evaluation (headline)

Seed 42, CPU. `test` = held-out 10% of the de-duplicated UCI + Mendeley data (586 messages). `modern holdout` = 300 hand-written 2026-style messages never used in training (180 scams, 120 hard negatives such as OTP codes, delivery notices and bank receipts). Full table: [`train/eval/EVAL.md`](train/eval/EVAL.md).

| Model | Split | P | R | F1 | ROC-AUC | FPR |
|---|---|---|---|---|---|---|
| TF-IDF + LogReg baseline | test | 97.8% | 95.6% | 0.967 | 0.998 | 0.4% |
| TF-IDF + LogReg baseline | modern holdout | 91.5% | 90.0% | 0.908 | 0.945 | 12.5% |
| MiniLM, legacy data only (control) | test | 95.7% | 97.8% | 0.967 | 0.996 | 0.8% |
| MiniLM, legacy data only (control) | modern holdout | 70.9% | 86.7% | 0.780 | 0.696 | 53.3% |
| **MiniLM int8 ONNX (shipped)** | test | 95.7% | 98.9% | 0.973 | 0.996 | 0.8% |
| **MiniLM int8 ONNX (shipped)** | modern holdout | 96.8% | 99.4% | 0.981 | 0.986 | 5.0% |

Hard-negative FPR on the modern holdout (shipped model): bank 0/15, delivery 1/26, otp 0/25, personal 3/20, reminder 0/15, service 2/20.
Scam-type head accuracy on modern holdout scams: 66.1% (6-way).
Calibration ECE on modern holdout: 0.016. Confusion (tn/fp/fn/tp): 114/6/1/179.
Latency (onnxruntime CPU, intra_op_threads=1, single message, no batching): p50 7.0 ms, p95 8.7 ms. Size: int8 ONNX 34.0 MB (fp32 133.1 MB, not shipped).
<!-- EVAL:END -->

The full table with confusion matrices, per-group hard-negative false-positive
rates, per-type recall and latency is in `train/eval/EVAL.md`.

## Known failure modes

- Legitimate messages that look like 2011-era spam (all caps, "FREE", phone
  numbers to call) can score high.
- Impersonation scams with no link, no money and no urgency rely entirely on
  the model's reading of phrases such as "new number"; paraphrases far from the
  training data may slip through.
- The scam-type head is trained on weak labels for legacy data and 72 real
  modern examples; it is an aid, not a classifier you should rely on.
- Non-English text is out of scope and will be tokenised into fragments.

## Ethical considerations

- All hand-written training and test messages use fictional numbers, domains
  and brands.
- No user text is transmitted anywhere. Feedback is stored in `localStorage`
  only and exported manually by the user.
- False positives can cause people to ignore real notices (for example a real
  bank alert). The UI therefore shows calibrated probabilities, highlights the
  evidence and always recommends verifying through a trusted channel.
