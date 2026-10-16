/**
 * Live proof of offline operation: counts resources that actually hit the
 * network (transferSize > 0) and every fetch/XHR issued after the model is ready,
 * plus any network load the OCR worker reports (public/ocr/lookout-worker.js).
 */
export class NetWatch {
  private baseline = 0;
  private armed = false;
  private fetchCount = 0;
  private xhrCount = 0;
  private workerCount = 0;
  private listeners: Array<() => void> = [];

  constructor() {
    const origFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      if (this.armed) {
        this.fetchCount++;
        this.emit();
      }
      return origFetch(...args);
    };
    const origOpen = XMLHttpRequest.prototype.open;
    const self = this;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: any[]) {
      if (self.armed) {
        self.xhrCount++;
        self.emit();
      }
      return (origOpen as any).apply(this, args);
    };
    try {
      new PerformanceObserver(() => this.emit()).observe({ type: "resource", buffered: true });
    } catch {
      /* unsupported */
    }
    try {
      new BroadcastChannel("lookout-netwatch").onmessage = () => {
        if (!this.armed) return;
        this.workerCount++;
        this.emit();
      };
    } catch {
      /* unsupported */
    }
    window.addEventListener("online", () => this.emit());
    window.addEventListener("offline", () => this.emit());
  }

  /** Call once the model is loaded: everything after this point should be zero. */
  arm() {
    this.baseline = this.networkResources();
    this.armed = true;
    this.emit();
  }

  private networkResources(): number {
    return performance
      .getEntriesByType("resource")
      .filter((e) => (e as PerformanceResourceTiming).transferSize > 0).length;
  }

  snapshot() {
    const sinceArm = this.armed ? Math.max(0, this.networkResources() - this.baseline) + this.fetchCount + this.xhrCount + this.workerCount : 0;
    return {
      armed: this.armed,
      requestsSinceReady: sinceArm,
      online: navigator.onLine,
      swControlled: !!navigator.serviceWorker?.controller,
    };
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}
