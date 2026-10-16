# Data and model licenses

Every dataset and model used by Offline Lookout, with the license verified at
the source before use. Nothing here requires a login to obtain.

## Datasets

### 1. SMS Spam Collection (UCI Machine Learning Repository)

- **Source:** https://archive.ics.uci.edu/dataset/228/sms+spam+collection
- **Authors:** Tiago A. Almeida and José María Gómez Hidalgo
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0), as
  stated on the UCI dataset page (verified 2026-10-12).
- **Contents:** 5,574 English SMS messages labelled `ham` / `spam`
  (4,827 ham, 747 spam). Collected 2011 from Grumbletext, the NUS SMS Corpus,
  Caroline Tagg's PhD thesis and the SMS Spam Corpus v.0.1 Big.
- **Citation:** Almeida, T.A., Gómez Hidalgo, J.M., Yamakami, A. "Contributions
  to the Study of SMS Spam Filtering: New Collection and Results." Proceedings
  of the 2011 ACM Symposium on Document Engineering (DOCENG'11), 2011.
- **Changes made:** labels renamed `spam` → `scam`; whitespace normalised;
  duplicates removed (see `train/prepare.py`).

### 2. SMS Phishing Dataset for Machine Learning and Pattern Recognition (Mendeley Data)

- **Source:** https://data.mendeley.com/datasets/f45bkkt8pr/1
  (DOI 10.17632/f45bkkt8pr.1)
- **Authors:** Sandhya Mishra and Devpriya Soni, Jaypee Institute of
  Information Technology
- **License:** CC BY 4.0, as stated in the dataset record on Mendeley Data
  (verified 2026-10-12 via the public page and the public files API). Download
  requires no login (file `Dataset_5971.zip`, sha256
  `9bbf3188fdad81495d8e82825648b9b63b53fc86841a3d26c02629990b233cc3`).
- **Contents:** 5,971 SMS messages labelled `ham` / `spam` / `Smishing` with
  URL / email / phone flags. Roughly 5,100 of the texts are shared with the UCI
  collection above; after de-duplication it contributes about 880 additional
  messages, around 420 of them smishing or spam.
- **Citation:** Mishra, S., Soni, D. "SMS Phishing Dataset for Machine Learning
  and Pattern Recognition", Mendeley Data, V1, 2022.
- **Changes made:** `spam` and `Smishing` merged into `scam`; whitespace and
  encoding artefacts normalised; de-duplicated against the UCI collection.

### 3. Hand-written modern templates and hard negatives (this repository)

- **Files:** `train/templates/modern_holdout.jsonl` (300 messages: 180 scams
  across six types, 120 hard-negative legitimate messages such as one-time
  passcodes, delivery notices, bank receipts and personal texts) and
  `train/templates/modern_train.jsonl` (227 messages with disjoint wording, used
  as a training supplement: 80 scams and 147 legitimate messages, mostly
  automated notices such as tracking updates, statements and OTP codes).
- **Author:** written for this project in October 2026. All phone numbers,
  domains, brands and amounts are fictional (`.example` domains, reserved
  drama/fiction phone ranges, invented company names).
- **License:** MIT, the same as the code (see `LICENSE`).

## Models

### microsoft/MiniLM-L12-H384-uncased (base model)

- **Source:** https://huggingface.co/microsoft/MiniLM-L12-H384-uncased
- **License:** MIT
- **Size:** 12 layers, hidden size 384, 33.4M parameters (33.2M after dropping
  the unused pooler), uncased BERT WordPiece vocabulary (30,522 tokens).
- **Citation:** Wang, W. et al. "MiniLM: Deep Self-Attention Distillation for
  Task-Agnostic Compression of Pre-Trained Transformers." NeurIPS 2020.
- **Use here:** fine-tuned end-to-end with a binary scam head and a 7-way
  scam-type head; exported to ONNX and quantised to dynamic int8 with Optimum.

### Fine-tuned Offline Lookout model (this repository)

- **Files:** `web/public/model/model_int8.onnx`, `web/public/model/vocab.txt`,
  `web/public/model/model_meta.json`
- **License:** MIT. Derived from the MIT-licensed base model and the CC BY 4.0
  datasets above; attribution for those datasets is given here and in the README.

### Tesseract English LSTM model (screenshot reader)

- **Source:** `eng.traineddata` from the Tesseract `tessdata_best` integer
  models (`4.0.0_best_int`), as packaged by `@tesseract.js-data/eng` 1.0.0
  (https://github.com/naptha/tessdata).
- **License:** Apache-2.0 (tessdata); the npm package is MIT.
- **Size:** 2.95 MB gzipped; the LSTM network inside is 1.49 MB of int8
  weights, so under 1.5M parameters.
- **Use here:** unchanged; self-hosted at `ocr/eng.traineddata.gz` and run with
  Tesseract.js in the browser to read screenshots of messages.

## Runtime libraries (not data, listed for completeness)

- onnxruntime-web (MIT), Tesseract.js and tesseract.js-core (Apache-2.0), Vite (MIT), vite-plugin-pwa / Workbox (MIT),
  PyTorch (BSD-3), Hugging Face Transformers and Optimum (Apache-2.0),
  scikit-learn (BSD-3).
