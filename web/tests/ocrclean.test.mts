// The screenshot cleanup: phone chrome goes, the message text stays.
// Raw inputs below are real Tesseract.js 7 output for synthetic screenshots (light, dark,
// and with a blue sent bubble) of the kind in docs/sample-screenshot.png.
// Run via: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanOcrText } from "../src/ocrclean.ts";

const PARCEL = "PostLink: Your parcel is on hold due to an unpaid customs fee of $1.95. Pay within 24 hours to avoid return to sender: postlink-parcels.example/track/7Q2K";

test("light screenshot: status bar, contact header, labels, timestamp and icons are dropped", () => {
  const raw = "9:41 all LTE @=)\n@\n+1 (555) 014-2297\n\nText Message\n\nToday 10:24 AM\nPostLink: Your parcel is on hold\ndue to an unpaid customs fee of\n$1.95. Pay within 24 hours to avoid\nreturn to sender: postlink-\nparcels.example/track/7Q2K\n+\n";
  assert.equal(cleanOcrText(raw), PARCEL);
});

test("dark screenshot: glyph noise in the header is dropped", () => {
  const raw = "9:41 all LTE CO\nE an\n+1 (555) 014-2297\nText Message\nToday 10:24 AM\nPostLink: Your parcel is on hold\ndue to an unpaid customs fee of\n$1.95. Pay within 24 hours to avoid\nreturn to sender: postlink-\nparcels.example/track/7Q2K\n©\n";
  assert.equal(cleanOcrText(raw), PARCEL);
});

test("two bubbles, a misread capital I and a placeholder with noise", () => {
  const raw = "9:41 all LTE @=)\nE -\n+1 (555) 014-2297\nText Message\nToday 10:24 AM\nHi mum, | dropped my phone and\nthis is my new number. Can you\nmessage me back on WhatsApp?\n\nDelivered\nar Text Message\n";
  assert.equal(cleanOcrText(raw), "Hi mum, I dropped my phone and this is my new number. Can you message me back on WhatsApp?");
});

test("timestamps between bubbles split paragraphs", () => {
  const raw = "Yesterday 9:02 PM\nYour code is 482913.\nToday • 10:24\nRead 10:30 AM\nMon, Oct 14 at 9:02\nYour parcel is on hold.\n14/10/2026, 21:04\nThanks";
  assert.equal(cleanOcrText(raw), "Your code is 482913.\nYour parcel is on hold.\nThanks");
});

test("message text that looks like chrome is kept", () => {
  // A time inside a sentence, a phone number after the first line of text, short words in a
  // wrapped line, and a word that starts like a weekday are all message content.
  const raw = "Your table is booked for 7:30 PM tonight.\nCall us on\n+44 7700 900123\nif you are late or want to do it\nas we can. Monster Energy promo.\nSaturday";
  assert.equal(
    cleanOcrText(raw),
    "Your table is booked for 7:30 PM tonight. Call us on +44 7700 900123 if you are late or want to do it as we can. Monster Energy promo.",
  );
});

test("a dash that ends a sentence keeps its space; a hyphen inside a link closes up", () => {
  assert.equal(cleanOcrText("Pay now -\ndo not wait"), "Pay now - do not wait");
  assert.equal(cleanOcrText("https://example.com/\npay/now"), "https://example.com/pay/now");
});

test("empty or noise-only input gives an empty string", () => {
  assert.equal(cleanOcrText(""), "");
  assert.equal(cleanOcrText("9:41 LTE 87%\n@\n+\nText Message • SMS\n"), "");
});
