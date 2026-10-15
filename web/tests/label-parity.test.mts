// Regression: the single-check path and the batch table must give every message the same
// verdict and type label. Runs the real int8 model under Node (onnxruntime-web, wasm).
// Run via: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-web/wasm";
import { WordPieceTokenizer } from "../src/tokenizer.ts";
import { decodePredictions } from "../src/predict.ts";
import { classify, TYPE_LABEL } from "../src/tips.ts";
import { SAMPLES } from "../src/samples.ts";
import type { ModelMeta, Prediction, ScamType } from "../src/model.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "..", "public", "model");
const meta: ModelMeta = JSON.parse(readFileSync(join(pub, "model_meta.json"), "utf8"));
const tok = new WordPieceTokenizer(readFileSync(join(pub, "vocab.txt"), "utf8"));
const require = createRequire(import.meta.url);

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmBinary = readFileSync(require.resolve("onnxruntime-web/ort-wasm-simd-threaded.wasm"));
const session = await ort.InferenceSession.create(readFileSync(join(pub, "model_int8.onnx")), { executionProviders: ["wasm"] });

/** Same feeds as ScamModel.predictBatch, minus the browser-only loading. */
async function predictBatch(texts: string[]): Promise<Prediction[]> {
  const enc = tok.encodeBatch(texts, meta.max_seq_len);
  const n = texts.length;
  const L = enc.length;
  const ids = new BigInt64Array(n * L);
  const mask = new BigInt64Array(n * L);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < L; j++) {
      ids[i * L + j] = BigInt(enc.ids[i][j]);
      mask[i * L + j] = BigInt(enc.mask[i][j]);
    }
  const out = await session.run({
    input_ids: new ort.Tensor("int64", ids, [n, L]),
    attention_mask: new ort.Tensor("int64", mask, [n, L]),
    token_type_ids: new ort.Tensor("int64", new BigInt64Array(n * L), [n, L]),
  });
  return decodePredictions(out.logits.data as Float32Array, out.type_logits.data as Float32Array, n, meta, 0);
}

const label = (text: string, p: Prediction) => {
  const c = classify(text, p);
  return { level: c.level, type: c.type, text: c.type === "none" ? "" : TYPE_LABEL[c.type] };
};

// Every bundled sample, plus the message that exposed the bug (single check said
// "Account or subscription scam", the batch table said "Parcel / delivery scam").
const MESSAGES = [...Object.values(SAMPLES), "Chase Alert: your account is locked. Verify now at chase-secure-login.co"];

test("every bundled sample is labelled identically by the single check and the batch table", async () => {
  const batch = await predictBatch(MESSAGES);
  for (let i = 0; i < MESSAGES.length; i++) {
    const single = (await predictBatch([MESSAGES[i]]))[0];
    assert.deepEqual(label(MESSAGES[i], batch[i]), label(MESSAGES[i], single), `label mismatch for: ${MESSAGES[i]}`);
  }
});

test("the reported messages get the label the single check shows", async () => {
  const [parcel, chase] = await predictBatch([SAMPLES.parcel, MESSAGES[MESSAGES.length - 1]]);
  assert.equal(label(SAMPLES.parcel, parcel).text, "Parcel / delivery scam");
  assert.equal(label(MESSAGES[MESSAGES.length - 1], chase).text, "Account or subscription scam");
});

test("a low-confidence type head defers to the wording hints on the batch path too", () => {
  // The model's raw top type is "delivery" at 0.4; the wording says account. Both paths must say account.
  const typeProbs = { none: 0.05, delivery: 0.4, banking: 0.2, prize: 0.05, impersonation: 0.1, government: 0.1, account: 0.1 } as Record<ScamType, number>;
  const pred: Prediction = { pScam: 0.9, typeProbs, topType: "delivery", ms: 0 };
  const text = "Your account is locked. Verify now at chase-secure-login.co";
  assert.equal(classify(text, pred).type, "account");
  assert.equal(TYPE_LABEL[classify(text, pred).type], "Account or subscription scam");
});
