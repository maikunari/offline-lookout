// OCR worker entry. Reports every load in this worker that reaches the network to the
// page's privacy counter (src/netwatch.ts), then starts the stock Tesseract.js worker.
// Loads the service worker answers from its cache have transferSize 0 and are not reported.
const net = new BroadcastChannel("lookout-netwatch");
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.transferSize > 0) net.postMessage(e.name);
  }).observe({ type: "resource", buffered: true });
} catch {
  /* unsupported */
}
importScripts("worker.min.js");
