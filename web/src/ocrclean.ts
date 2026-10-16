/**
 * Light cleanup of text read from a phone screenshot: drops the status bar, the contact
 * header, lone timestamps, app labels ("Text Message", "Delivered") and stray icon glyphs,
 * then rejoins the lines a chat bubble wrapped. Anything it is unsure about is kept; the
 * user sees and can edit the result before the check runs.
 */

const CLOCK = String.raw`\d{1,2}[:.]\d{2}(?:\s?[AaPp]\.?[Mm]\.?)?`;
const DAY = String.raw`(?:Today|Yesterday|Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:rs?|rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)`;
const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`;
const DATE = String.raw`(?:${DAY},?|${MONTH}\.? \d{1,2},?(?: \d{4},?)?|\d{1,2} ${MONTH}\.?,?(?: \d{4},?)?|\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4},?)`;

/** A line that is only a date and/or time, e.g. "Today 10:24 AM", "Mon, Oct 14 at 9:02", "10:24". */
const TIMESTAMP = new RegExp(String.raw`^(?:${DATE}(?: ${DATE})*(?: at)?(?: ${CLOCK})?|${CLOCK})$`, "i");
/** Delivery receipts: "Delivered", "Read 10:30 AM", "Seen". */
const RECEIPT = new RegExp(String.raw`^(?:Delivered|Sent|Seen|Read)(?: (?:at )?(?:${DATE} )?${CLOCK})?$`, "i");
/** Messaging-app labels that surround the bubbles. */
const APP_LABEL = /\b(?:Text Message|iMessage|SMS\/MMS|RCS (?:message|chat))\b/i;
/** Status-bar words that are not glyph noise. */
const STATUS_WORD = /^(?:LTE|VoLTE|[345]G\+?|5GE|Wi-?Fi|SOS|\d{1,3}%)$/i;
/** A line holding only a phone number (the contact header of an unknown sender). */
const PHONE_ONLY = /^\+?[\d\s().-]{7,}$/;

const words = (line: string) => line.split(/\s+/).filter(Boolean);
const letters = (s: string) => (s.match(/[\p{L}\p{N}]/gu) ?? []).length;

/** Icon glyphs read as letters: under two letters, or one or two fragments of two or fewer. */
function isGlyphNoise(line: string): boolean {
  const w = words(line);
  return letters(line) < 2 || (w.length <= 2 && w.every((x) => letters(x) <= 2));
}

/** "9:41 all LTE @=)": a clock followed only by network names, battery and signal glyphs. */
function isStatusBar(line: string): boolean {
  const m = line.match(new RegExp(String.raw`^${CLOCK}\s*(.*)$`));
  if (!m) return false;
  return words(m[1]).every((w) => STATUS_WORD.test(w) || letters(w) <= 3);
}

/** An app label alone ("Text Message • SMS"), or with only glyph noise around it ("ar Text Message"). */
function isAppLabel(line: string): boolean {
  if (/^(?:SMS|MMS|RCS)$/i.test(line)) return true;
  if (!APP_LABEL.test(line)) return false;
  const rest = line
    .replace(new RegExp(APP_LABEL.source, "gi"), " ")
    .replace(/\b(?:SMS|MMS|RCS)\b|[•·|]/g, " ")
    .trim();
  return !rest || isGlyphNoise(rest);
}

/** Lines a bubble wrapped are rejoined; a break right after a hyphen or slash (inside a link) closes up. */
function joinWrapped(lines: string[]): string {
  let out = "";
  for (const l of lines) out += !out ? l : /[\p{L}\p{N}][-/]$/u.test(out) ? l : ` ${l}`;
  return out;
}

export function cleanOcrText(raw: string): string {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) =>
      l
        .replace(/[ \t]+/g, " ")
        .trim()
        // Tesseract's usual misread of a lone capital I.
        .replace(/(^| )\|(?= )/g, "$1I"),
    );

  // Each dropped or blank line ends a paragraph (usually a bubble).
  const paras: string[][] = [[]];
  let seenText = false;
  for (const line of lines) {
    const drop =
      !line ||
      TIMESTAMP.test(line.replace(/ ?[•·] ?/g, " ")) ||
      RECEIPT.test(line) ||
      isAppLabel(line) ||
      isGlyphNoise(line) ||
      (!seenText && (isStatusBar(line) || PHONE_ONLY.test(line)));
    if (drop) {
      if (paras.at(-1)!.length) paras.push([]);
      continue;
    }
    paras.at(-1)!.push(line);
    seenText = true;
  }
  return paras
    .filter((p) => p.length)
    .map(joinWrapped)
    .join("\n");
}
