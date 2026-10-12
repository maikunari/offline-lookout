/**
 * Occlusion explainability, entirely on device: drop each word in turn, re-run
 * the model in one batch, and attribute the change in the scam log-odds to that
 * word. Log-odds (not probability) so that a saturated 98% verdict still shows
 * which words carry it.
 */
import type { ScamModel } from "./model";

export interface WordAttribution {
  word: string;
  /** Change in scam log-odds when the word is removed. Positive = the word pushes toward "scam". */
  delta: number;
  /** 0..1 relative to the strongest word in the message. */
  strength: number;
}

const MAX_WORDS = 48;
/** Below this many nats of log-odds change a word is not highlighted at all. */
const MIN_EFFECT = 0.25;

function logit(p: number): number {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return Math.log(q / (1 - q));
}

export async function explain(model: ScamModel, text: string, pOrig: number): Promise<WordAttribution[]> {
  const words = text.split(/(\s+)/); // keep whitespace tokens so we can rebuild faithfully
  const idx = words.map((w, i) => (w.trim() ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return [];
  const base = logit(pOrig);

  // Multi-scale occlusion in one batch: single words, 3-word spans, and thirds of the
  // message. Scam evidence is often redundant ("fee", "pay now" and the link all say the
  // same thing), so removing one word changes nothing while removing the whole clause
  // flips the verdict. Each word takes the strongest effect of any span containing it.
  const span1 = Math.max(1, Math.ceil(idx.length / MAX_WORDS));
  const groups: number[][] = [];
  for (let i = 0; i < idx.length; i += span1) groups.push(idx.slice(i, i + span1));
  if (idx.length >= 4) for (let i = 0; i < idx.length; i += 3) groups.push(idx.slice(i, i + 3));
  if (idx.length >= 9) {
    const third = Math.ceil(idx.length / 3);
    for (let i = 0; i < idx.length; i += third) groups.push(idx.slice(i, i + third));
  }

  const variants = groups.map((g) => words.filter((_, i) => !g.includes(i)).join("").replace(/\s+/g, " ").trim() || "[empty]");
  const preds = await model.predictBatch(variants);

  const deltas = new Map<number, number>();
  groups.forEach((g, k) => {
    // Normalise by sqrt(span length) so a decisive single word and a decisive
    // clause compete on equal terms, instead of large spans always winning.
    const d = (base - logit(preds[k].pScam)) / Math.sqrt(g.length);
    for (const i of g) {
      const cur = deltas.get(i) ?? 0;
      if (Math.abs(d) > Math.abs(cur)) deltas.set(i, d);
    }
  });
  const maxAbs = Math.max(MIN_EFFECT, ...Array.from(deltas.values(), (d) => Math.abs(d)));

  return words.map((w, i) => {
    const d = deltas.get(i) ?? 0;
    const strength = w.trim() && Math.abs(d) >= MIN_EFFECT ? Math.abs(d) / maxAbs : 0;
    return { word: w, delta: d, strength };
  });
}
