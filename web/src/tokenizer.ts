/**
 * Minimal BERT WordPiece tokenizer (uncased), matching the Hugging Face
 * BertTokenizer used to train the model: lower-case, strip accents, split on
 * punctuation and CJK characters, greedy longest-match WordPiece with "##".
 * Parity with the Python tokenizer is checked in train/tokenizer_parity.py.
 */

export interface Encoded {
  input_ids: number[];
  attention_mask: number[];
}


function isAsciiPunct(cp: number): boolean {
  return (cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126);
}
function isPunct(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if (isAsciiPunct(cp)) return true;
  return /\p{P}/u.test(ch);
}
function isCJK(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) || (cp >= 0x2b740 && cp <= 0x2b81f) || (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x2f800 && cp <= 0x2fa1f)
  );
}
function isControl(ch: string): boolean {
  if (ch === "\t" || ch === "\n" || ch === "\r") return false;
  return /[\p{Cc}\p{Cf}]/u.test(ch);
}
function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || /\p{Zs}/u.test(ch);
}

export class WordPieceTokenizer {
  private vocab = new Map<string, number>();
  readonly clsId: number;
  readonly sepId: number;
  readonly padId: number;
  readonly unkId: number;

  constructor(vocabText: string) {
    vocabText.split(/\r?\n/).forEach((tok, i) => {
      if (tok.length || i === 0) this.vocab.set(tok, i);
    });
    this.clsId = this.vocab.get("[CLS]")!;
    this.sepId = this.vocab.get("[SEP]")!;
    this.padId = this.vocab.get("[PAD]")!;
    this.unkId = this.vocab.get("[UNK]")!;
  }

  get vocabSize() {
    return this.vocab.size;
  }

  /** BasicTokenizer: clean, split CJK, lower-case + strip accents, split punctuation. */
  private basicTokenize(text: string): string[] {
    let out = "";
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0 || cp === 0xfffd || isControl(ch)) continue;
      if (isWhitespace(ch)) out += " ";
      else if (isCJK(cp)) out += ` ${ch} `;
      else out += ch;
    }
    const tokens: string[] = [];
    for (const raw of out.split(" ")) {
      if (!raw) continue;
      const lowered = raw.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
      let cur = "";
      for (const ch of lowered) {
        if (isPunct(ch)) {
          if (cur) tokens.push(cur);
          tokens.push(ch);
          cur = "";
        } else cur += ch;
      }
      if (cur) tokens.push(cur);
    }
    return tokens;
  }

  private wordPiece(token: string): number[] {
    const chars = Array.from(token);
    if (chars.length > 100) return [this.unkId];
    const ids: number[] = [];
    let start = 0;
    while (start < chars.length) {
      let end = chars.length;
      let found: number | undefined;
      while (start < end) {
        const sub = (start > 0 ? "##" : "") + chars.slice(start, end).join("");
        const id = this.vocab.get(sub);
        if (id !== undefined) {
          found = id;
          break;
        }
        end--;
      }
      if (found === undefined) return [this.unkId];
      ids.push(found);
      start = end;
    }
    return ids;
  }

  /** Token ids for one text, with [CLS]/[SEP], truncated to maxLen. */
  encode(text: string, maxLen = 128): number[] {
    const ids: number[] = [this.clsId];
    for (const tok of this.basicTokenize(text)) {
      for (const id of this.wordPiece(tok)) {
        ids.push(id);
        if (ids.length >= maxLen - 1) break;
      }
      if (ids.length >= maxLen - 1) break;
    }
    ids.push(this.sepId);
    return ids;
  }

  /** Batch-encode with right padding. */
  encodeBatch(texts: string[], maxLen = 128): { ids: number[][]; mask: number[][]; length: number } {
    const encoded = texts.map((t) => this.encode(t, maxLen));
    const L = Math.max(1, ...encoded.map((e) => e.length));
    const ids = encoded.map((e) => e.concat(new Array(L - e.length).fill(this.padId)));
    const mask = encoded.map((e) => new Array(e.length).fill(1).concat(new Array(L - e.length).fill(0)));
    return { ids, mask, length: L };
  }
}
