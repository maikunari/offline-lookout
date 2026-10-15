/**
 * On-device inference: a built-in BERT WordPiece tokenizer + an onnxruntime-web
 * (wasm) session over the dual-head int8 MiniLM. No network is touched after the
 * assets are loaded, and after the first visit the service worker serves them.
 *
 * The three downloads (vocabulary, wasm runtime, int8 weights) are streamed so the
 * UI can show real bytes received against the known total.
 */
import * as ort from "onnxruntime-web/wasm";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { WordPieceTokenizer } from "./tokenizer";
import { decodePredictions } from "./predict";

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

export interface LoadProgress {
  /** Bytes received so far across every asset. */
  received: number;
  /** Bytes expected in total (measured at build time from the real files). */
  total: number;
  stage: "download" | "compile" | "ready";
}

const BASE = import.meta.env.BASE_URL;
/** Byte sizes of the three big assets, injected by vite.config.ts from the files on disk. */
export const ASSET_BYTES = __ASSET_BYTES__;
export const TOTAL_BYTES = ASSET_BYTES.wasm + ASSET_BYTES.model + ASSET_BYTES.vocab;

/** fetch() that reports every chunk as it arrives, so progress is real bytes, not a timer. */
async function fetchBytes(url: string, onChunk: (n: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onChunk(buf.byteLength);
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.byteLength;
    onChunk(value.byteLength);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

export class ScamModel {
  private tok!: WordPieceTokenizer;
  private session!: ort.InferenceSession;
  meta!: ModelMeta;
  ready = false;

  async load(onProgress?: (p: LoadProgress) => void): Promise<void> {
    this.meta = await (await fetch(`${BASE}model/model_meta.json`)).json();

    ort.env.wasm.numThreads = 1; // GitHub Pages has no COOP/COEP headers, so no SharedArrayBuffer
    ort.env.wasm.proxy = false;

    let received = 0;
    const report = (stage: LoadProgress["stage"]) => onProgress?.({ received, total: TOTAL_BYTES, stage });
    const onChunk = (n: number) => {
      received += n;
      report("download");
    };
    report("download");
    // All three in parallel: on first visit this is one combined download, afterwards
    // the service worker answers every one of them from the cache.
    const [vocab, wasm, weights] = await Promise.all([
      fetchBytes(`${BASE}model/vocab.txt`, onChunk),
      fetchBytes(ortWasmUrl, onChunk),
      fetchBytes(`${BASE}model/model_int8.onnx`, onChunk),
    ]);
    received = TOTAL_BYTES;
    report("compile");

    this.tok = new WordPieceTokenizer(new TextDecoder().decode(vocab));
    ort.env.wasm.wasmBinary = wasm; // already downloaded: ORT must not fetch it again
    this.session = await ort.InferenceSession.create(weights, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    this.ready = true;
    report("ready");
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
    const ms = performance.now() - t0;
    return decodePredictions(logits, tlogits, n, this.meta, ms);
  }

  async predict(text: string): Promise<Prediction> {
    return (await this.predictBatch([text]))[0];
  }
}
