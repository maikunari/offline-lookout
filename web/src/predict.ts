import type { ModelMeta, Prediction, ScamType } from "./model";

function softmax(x: Float32Array | number[]): number[] {
  const m = Math.max(...x);
  const e = Array.from(x, (v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

/** Turn the raw ONNX outputs for `n` texts into calibrated predictions. Pure, so it is testable without a browser. */
export function decodePredictions(logits: Float32Array, tlogits: Float32Array, n: number, meta: ModelMeta, ms: number): Prediction[] {
  const T = meta.temperature;
  const types = meta.scam_types;
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
