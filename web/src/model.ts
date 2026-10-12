/**
 * On-device inference: a built-in BERT WordPiece tokenizer + an onnxruntime-web
 * (wasm) session over the dual-head int8 MiniLM. No network is touched after the
 * assets are loaded, and after the first visit the service worker serves them.
 */
import * as ort from "onnxruntime-web/wasm";
import { WordPieceTokenizer } from "./tokenizer";

export type ScamType = "none" | "delivery" | "banking" | "prize" | "impersonation" | "government" | "account";

export interface ModelMeta {
  base_model: string;
  parameters: number;
  temperature: number;
  max_seq_len: number;
  labels: string[];
  scam_types: ScamType[];
  size_bytes?: { fp32: number; int8: number };
}

export interface Prediction {
  pScam: number; // calibrated P(scam)
  typeProbs: Record<ScamType, number>;
  topType: ScamType;
  ms: number;
}

const BASE = import.meta.env.BASE_URL;

function softmax(x: Float32Array | number[]): number[] {
  const m = Math.max(...x);
  const e = Array.from(x, (v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

export class ScamModel {
  private tok!: WordPieceTokenizer;
  private session!: ort.InferenceSession;
  meta!: ModelMeta;
  ready = false;

  async load(onProgress?: (msg: string) => void): Promise<void> {
    onProgress?.("Loading model metadata");
    this.meta = await (await fetch(`${BASE}model/model_meta.json`)).json();

    ort.env.wasm.numThreads = 1; // GitHub Pages has no COOP/COEP headers, so no SharedArrayBuffer
    ort.env.wasm.proxy = false;

    onProgress?.("Loading tokenizer vocabulary");
    this.tok = new WordPieceTokenizer(await (await fetch(`${BASE}model/vocab.txt`)).text());

    onProgress?.("Loading int8 ONNX weights");
    const buf = await (await fetch(`${BASE}model/model_int8.onnx`)).arrayBuffer();
    onProgress?.("Creating inference session");
    this.session = await ort.InferenceSession.create(buf, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    this.ready = true;
    onProgress?.("Ready");
  }

  /** Run a batch of texts through the model. Returns calibrated scam probabilities and type distributions. */
  async predictBatch(texts: string[]): Promise<Prediction[]> {
    const t0 = performance.now();
    const enc = this.tok.encodeBatch(texts, this.meta.max_seq_len);
    const n = texts.length;
    const L = enc.length;
    const ids = new BigInt64Array(n * L);
    const mask = new BigInt64Array(n * L);
    const tt = new BigInt64Array(n * L);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < L; j++) {
        ids[i * L + j] = BigInt(enc.ids[i][j]);
        mask[i * L + j] = BigInt(enc.mask[i][j]);
      }
    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor("int64", ids, [n, L]),
      attention_mask: new ort.Tensor("int64", mask, [n, L]),
      token_type_ids: new ort.Tensor("int64", tt, [n, L]),
    };
    const out = await this.session.run(feeds);
    const logits = out.logits.data as Float32Array;
    const tlogits = out.type_logits.data as Float32Array;
    const T = this.meta.temperature;
    const types = this.meta.scam_types;
    const ms = performance.now() - t0;
    const res: Prediction[] = [];
    for (let i = 0; i < n; i++) {
      const b = softmax([logits[i * 2] / T, logits[i * 2 + 1] / T]);
      const tp = softmax(tlogits.subarray(i * types.length, (i + 1) * types.length));
      const typeProbs = {} as Record<ScamType, number>;
      let best: ScamType = "delivery";
      let bestP = -1;
      types.forEach((t, k) => {
        typeProbs[t] = tp[k];
        if (t !== "none" && tp[k] > bestP) {
          bestP = tp[k];
          best = t;
        }
      });
      res.push({ pScam: b[1], typeProbs, topType: best, ms });
    }
    return res;
  }

  async predict(text: string): Promise<Prediction> {
    return (await this.predictBatch([text]))[0];
  }
}
