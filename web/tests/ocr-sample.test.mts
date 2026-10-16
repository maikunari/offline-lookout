// End to end on the demo screenshot: the same Tesseract.js version, wasm core and English
// traineddata the app ships, read from local files only (no CDN, no network), then the
// app's cleanup. The result must be exactly the scam text in the bubble.
// Run via: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker, OEM } from "tesseract.js";
import { cleanOcrText } from "../src/ocrclean.ts";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const sample = readFileSync(join(here, "..", "..", "docs", "sample-screenshot.png"));
const langPath = dirname(require.resolve("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"));

test("the sample screenshot reads back as the message in its bubble", async () => {
  const worker = await createWorker("eng", OEM.LSTM_ONLY, { langPath, cacheMethod: "none" });
  try {
    const { data } = await worker.recognize(sample);
    assert.equal(
      cleanOcrText(data.text),
      "PostLink: Your parcel is on hold due to an unpaid customs fee of $1.95. Pay within 24 hours to avoid return to sender: postlink-parcels.example/track/7Q2K",
    );
  } finally {
    await worker.terminate();
  }
});
