"""TF-IDF (word + char n-grams) + logistic regression baseline."""
from __future__ import annotations

import json
import time

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion, Pipeline

from common import EVAL, PROCESSED, SEED
from metrics import binary_metrics, load_jsonl


def main() -> None:
    train = load_jsonl(PROCESSED / "train.jsonl")
    test = load_jsonl(PROCESSED / "test.jsonl")
    holdout = load_jsonl(PROCESSED / "holdout.jsonl")

    pipe = Pipeline([
        ("feats", FeatureUnion([
            ("word", TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True, lowercase=True)),
            ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), min_df=2, sublinear_tf=True)),
        ])),
        ("clf", LogisticRegression(C=10.0, max_iter=2000, class_weight="balanced", random_state=SEED)),
    ])
    t0 = time.time()
    pipe.fit([r["text"] for r in train], [r["label_id"] for r in train])
    fit_s = time.time() - t0

    results = {"model": "tfidf_word12_char25_logreg", "fit_seconds": round(fit_s, 1)}
    for name, rows in [("test", test), ("holdout", holdout)]:
        probs = pipe.predict_proba([r["text"] for r in rows])[:, 1]
        results[name] = binary_metrics(np.array([r["label_id"] for r in rows]), probs, rows)
        print(name, json.dumps(results[name], indent=None)[:400])
    EVAL.mkdir(exist_ok=True)
    with open(EVAL / "baseline_metrics.json", "w") as f:
        json.dump(results, f, indent=2)


if __name__ == "__main__":
    main()
