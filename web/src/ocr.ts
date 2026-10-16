/**
 * Screenshot check: on-device OCR with Tesseract.js (LSTM engine, English). Nothing here runs
 * until the user supplies an image: the library chunk, the worker, the wasm core and the
 * traineddata load on first use. All of them are self-hosted under ocr/ and precached by the
 * service worker (see vite.config.ts), so reading an image never touches the network.
 */
import type { Worker as TesseractWorker } from "tesseract.js";
import { cleanOcrText } from "./ocrclean";

export interface OcrProgress {
  stage: "loading" | "reading";
  /** 0..1 within the stage. */
  progress: number;
}

const OCR_DIR = new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href;
/** Large photos are scaled down to this longest side; phone screenshots stay at full size. */
const MAX_SIDE = 3000;

let onProgress: ((p: OcrProgress) => void) | null = null;
let worker: Promise<TesseractWorker> | null = null;

function getWorker(): Promise<TesseractWorker> {
  worker ??= (async () => {
    const { createWorker, OEM } = await import("tesseract.js");
    return createWorker("eng", OEM.LSTM_ONLY, {
      // Our wrapper reports any network load to the privacy counter, then starts the stock worker.
      workerPath: `${OCR_DIR}lookout-worker.js`,
      workerBlobURL: false,
      corePath: `${OCR_DIR}tesseract-core-simd-lstm.js`,
      langPath: OCR_DIR.replace(/\/$/, ""),
      // The service worker already caches the traineddata; no second copy in IndexedDB.
      cacheMethod: "none",
      logger: (m) => {
        const stage = m.status === "recognizing text" ? "reading" : "loading";
        onProgress?.({ stage, progress: m.progress ?? 0 });
      },
    });
  })();
  worker.catch(() => (worker = null));
  return worker;
}

/** Decode with the browser (so any format it can show works) and cap the size. */
async function toCanvas(image: Blob): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(image);
  } catch {
    throw new Error("That image could not be opened. Try a PNG or JPEG screenshot.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas;
}

/** Reads the text in a screenshot, on device, and returns it cleaned up for the message box. */
export async function readScreenshot(image: Blob, progress?: (p: OcrProgress) => void): Promise<string> {
  onProgress = progress ?? null;
  try {
    const [canvas, w] = await Promise.all([toCanvas(image), getWorker()]);
    const { data } = await w.recognize(canvas);
    return cleanOcrText(data.text);
  } finally {
    onProgress = null;
  }
}
