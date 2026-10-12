// Checks the browser WordPiece tokenizer against token ids produced by the
// Hugging Face tokenizer. Run via: python train/tokenizer_parity.py
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WordPieceTokenizer } from "../src/tokenizer.ts";

const here = dirname(fileURLToPath(import.meta.url));
const vocab = readFileSync(join(here, "..", "public", "model", "vocab.txt"), "utf8");
const cases: Array<{ text: string; ids: number[] }> = JSON.parse(readFileSync(process.argv[2], "utf8"));
const tok = new WordPieceTokenizer(vocab);
let bad = 0;
for (const c of cases) {
  const ids = tok.encode(c.text, 128);
  if (ids.length !== c.ids.length || ids.some((v, i) => v !== c.ids[i])) {
    bad++;
    if (bad <= 5) console.log("MISMATCH", JSON.stringify(c.text.slice(0, 90)), "\n  js:", ids.join(" "), "\n  py:", c.ids.join(" "));
  }
}
console.log(`tokenizer parity: ${cases.length - bad}/${cases.length} exact`);
process.exit(bad ? 1 : 0);
