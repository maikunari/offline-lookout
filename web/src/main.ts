import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { ScamModel, type Prediction, type ScamType } from "./model";
import { explain, type WordAttribution } from "./explain";
import { detectChips, type Chip } from "./rules";
import { TIPS, TYPE_LABEL, resolveType, verdictFor } from "./tips";
import { NetWatch } from "./netwatch";

const SAMPLES: Record<string, string> = {
  parcel: "PostLink: your parcel could not be delivered due to an unpaid customs fee of $2.99. Pay now to avoid return: https://postlink-redeliver.example/p/48213",
  otp: "Your verification code is 482913. It expires in 10 minutes. Do not share this code with anyone.",
  mum: "Hi mum, I dropped my phone in the sink and this is my new number. Can you save it and message me back? x",
  bank: "Nordbank: 42.00 paid to GROCERY CO using card ending 4412. Balance available in the app.",
};

const app = document.querySelector<HTMLDivElement>("#app")!;
const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><defs><clipPath id="lg-t"><rect width="64" height="64" rx="14"/></clipPath></defs><rect width="64" height="64" rx="14" fill="#0a0d13"/><g clip-path="url(#lg-t)"><path d="M18 46 L70 -10 L86 22 Z" fill="#ffc857"/><path d="M33 29.9 A22 22 0 0 1 38.7 38.7" fill="none" stroke="#0a0d13" stroke-width="2.4" stroke-linecap="round"/><path d="M41.1 21.1 A34 34 0 0 1 50.1 34.7" fill="none" stroke="#0a0d13" stroke-width="2.4" stroke-linecap="round"/></g><circle cx="18" cy="46" r="7" fill="#f2f4f8"/><circle cx="18" cy="46" r="2.6" fill="#0a0d13"/></svg>`;

app.innerHTML = `
  <header class="top">
    <a class="brand" href="${import.meta.env.BASE_URL}">
      ${LOGO}
      <h1>Offline Lookout<small>On-device scam-text detector</small></h1>
    </a>
    <div id="netbadge" class="readout" role="status" title="Counts network requests made after the model is ready.">
      <span class="lamp"></span><span id="nettext">Loading model…</span>
    </div>
  </header>

  <main>
    <p class="lede">Paste a text that feels off. The verdict is computed <strong>on this device</strong>: nothing you paste leaves it, and after the first visit it works with the network off.</p>

    <section class="compose" aria-labelledby="msg-label">
      <label for="msg" id="msg-label" class="field-label">Message to check</label>
      <textarea id="msg" rows="4" placeholder="Paste a text message here…" spellcheck="false"></textarea>
      <div class="actions">
        <button id="check" class="action" disabled>Check message</button>
        <button id="clear" class="quiet">Clear</button>
        <p id="status" class="status" aria-live="polite"></p>
      </div>
      <div class="samples"><span class="samples-l">Try one</span>
        <button class="bubble-btn" data-sample="parcel">Parcel fee</button>
        <button class="bubble-btn" data-sample="otp">OTP code</button>
        <button class="bubble-btn" data-sample="mum">“Hi mum”</button>
        <button class="bubble-btn" data-sample="bank">Bank receipt</button>
      </div>
    </section>

    <section id="result" class="result hidden" aria-live="polite"></section>

    <details class="batch">
      <summary>Check many messages at once</summary>
      <div class="batch-body">
        <p>Paste one message per line, or upload a chat export (.txt). Every line is scored on device.</p>
        <label for="batch" class="sr-only">Messages, one per line</label>
        <textarea id="batch" rows="5" placeholder="One message per line…"></textarea>
        <div class="actions">
          <button id="batchrun" class="action" disabled>Check all</button>
          <input id="batchfile" type="file" accept=".txt,.csv,text/plain" aria-label="Upload a chat export" />
          <button id="batchcsv" class="quiet hidden">Download CSV</button>
        </div>
        <div id="batchout"></div>
      </div>
    </details>
  </main>

  <footer class="foot">
    <div id="specs" class="specs"></div>
    <div class="row">
      <button id="exportfb" class="quiet small">Export feedback (local JSON)</button>
      <span id="fbcount"></span>
    </div>
    <p class="fine">Model, data and license notes are in the project README. Rule chips are plain regexes, not AI. Verdicts can be wrong: when in doubt, contact the organisation using a number or address you already trust.</p>
  </footer>
`;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const msgEl = $<HTMLTextAreaElement>("#msg");
const checkBtn = $<HTMLButtonElement>("#check");
const statusEl = $("#status");
const resultEl = $("#result");
const netText = $("#nettext");
const netBadge = $("#netbadge");

const net = new NetWatch();
const model = new ScamModel();
let lastRun: { text: string; pred: Prediction } | null = null;

function renderNet() {
  const s = net.snapshot();
  if (!s.armed) return;
  const n = s.requestsSinceReady;
  netBadge.className = `readout ${n === 0 ? "readout-ok" : "readout-bad"}`;
  netText.textContent = `${n} network request${n === 1 ? "" : "s"} since ready · ${s.online ? "online" : "offline"}${s.swControlled ? " · cached" : ""}`;
}
net.onChange(renderNet);

registerSW({ immediate: true, onOfflineReady: () => renderNet(), onRegistered: () => renderNet() });

(async () => {
  try {
    await model.load((m) => (statusEl.textContent = m));
    statusEl.textContent = "";
    checkBtn.disabled = false;
    $<HTMLButtonElement>("#batchrun").disabled = false;
    const m = model.meta;
    const mb = m.size_bytes ? (m.size_bytes.int8 / 1e6).toFixed(1) : "?";
    $("#specs").innerHTML = `<strong>${m.base_model}</strong> fine-tuned · ${(m.parameters / 1e6).toFixed(0)}M params · int8 ONNX ${mb} MB · runs in onnxruntime-web (wasm) · calibrated with temperature ${m.temperature.toFixed(2)} · <span id="lat"></span>`;
    // Warm up so the first real check is fast, then arm the network counter.
    await model.predict("warm up");
    net.arm();
    renderNet();
    handleShareTarget();
  } catch (e) {
    statusEl.textContent = `Could not load the model: ${(e as Error).message}`;
    console.error(e);
  }
})();

function handleShareTarget() {
  const q = new URLSearchParams(location.search);
  const shared = [q.get("text"), q.get("title"), q.get("url")].filter(Boolean).join(" ").trim();
  if (shared) {
    msgEl.value = shared;
    history.replaceState(null, "", location.pathname);
    void run();
  }
}

function pct(p: number) {
  return `${Math.round(p * 100)}%`;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function renderHighlights(attr: WordAttribution[]): string {
  return attr
    .map((a) => {
      if (!a.word.trim()) return esc(a.word);
      if (a.strength < 0.15) return `<span>${esc(a.word)}</span>`;
      const toward = a.delta > 0 ? "scam" : "safe";
      const mk = toward === "scam" ? "var(--scam)" : "var(--ok)";
      const alpha = Math.round(12 + 34 * a.strength);
      return `<mark style="--mk:${mk};--a:${alpha}%" title="Removing this word shifts the scam log-odds by ${a.delta.toFixed(2)} (${toward})">${esc(a.word)}</mark>`;
    })
    .join("");
}

const ICON: Record<string, string> = {
  url: '<path d="M6.5 8.5a3 3 0 0 0 4.2 0l1.8-1.8a3 3 0 0 0-4.2-4.2L7.2 3.6"/><path d="M7.5 5.5a3 3 0 0 0-4.2 0L1.5 7.3a3 3 0 0 0 4.2 4.2l1.1-1.1"/>',
  short: '<path d="M1.5 7h5"/><path d="M4.5 4.5 7 7l-2.5 2.5"/><path d="M12.5 7h-4"/><path d="M11 4.5 8.5 7l2.5 2.5"/>',
  lookalike: '<rect x="1.5" y="1.5" width="8" height="8" rx="1"/><path d="M4.5 12.5h8v-8"/>',
  phone: '<path d="M3 1.5h2.5l1.2 3-1.6 1a7 7 0 0 0 3.4 3.4l1-1.6 3 1.2V11a1.5 1.5 0 0 1-1.5 1.5A9.5 9.5 0 0 1 1.5 3 1.5 1.5 0 0 1 3 1.5Z"/>',
  money: '<rect x="1.5" y="3.5" width="11" height="7" rx="1"/><circle cx="7" cy="7" r="1.8"/>',
  urgency: '<circle cx="7" cy="7" r="5.5"/><path d="M7 4v3.2l2 1.3"/>',
  credentials: '<circle cx="4.5" cy="9.5" r="3"/><path d="M6.6 7.4 12.5 1.5"/><path d="M10 4l1.5 1.5"/><path d="M8.5 5.5 10 7"/>',
  none: '<circle cx="7" cy="7" r="5.5"/><path d="m4.5 7 1.8 1.8L9.8 5.2"/>',
};
function icon(id: string): string {
  const d = ICON[id] ?? ICON.none;
  return `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

function renderChips(chips: Chip[]): string {
  if (!chips.length) return `<span class="chip chip-none">${icon("none")}No rule-based red flags</span>`;
  return chips.map((c) => `<span class="chip chip-${c.weight}" title="${esc(c.detail)}">${icon(c.id)}${esc(c.label)}</span>`).join("");
}

const LEVEL_CLASS = { green: "ok", yellow: "sus", red: "scam" } as const;
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");

/** The reading strip: 0-100 with the two real thresholds printed on it. */
function renderStrip(p: number): string {
  const pc = Math.round(p * 100);
  const where = pc >= 70 ? "above the 70% scam threshold" : pc >= 35 ? "between the 35% suspicious and 70% scam thresholds" : "below the 35% suspicious threshold";
  return `<div class="strip" role="img" aria-label="Scam probability ${pc}%, ${where}">
      <div class="strip-bar"></div>
      <span class="strip-tick" style="left:35%"></span><span class="strip-tick" style="left:70%"></span>
      <span class="strip-lbl" data-at="0">0 · ok</span>
      <span class="strip-lbl mid" style="left:35%">35 · suspicious</span>
      <span class="strip-lbl mid" style="left:70%">70 · scam</span>
      <span class="strip-lbl" data-at="100">100</span>
      <span id="marker" class="strip-marker" style="--p:0"></span>
    </div>`;
}

/** One authored moment: the marker slides and the number counts up to the verdict. */
function animateVerdict(p: number) {
  const marker = $("#marker");
  const num = $("#pnum");
  const target = Math.round(p * 100);
  if (REDUCED.matches) {
    marker.style.setProperty("--p", String(p));
    num.textContent = String(target);
    return;
  }
  const t0 = performance.now();
  const dur = 650;
  requestAnimationFrame(() => marker.style.setProperty("--p", String(p)));
  const tick = (t: number) => {
    const x = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(2, -10 * x); // exponential ease-out, matches the CSS curve closely enough
    num.textContent = String(Math.round(target * (x >= 1 ? 1 : e)));
    if (x < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function run() {
  const text = msgEl.value.trim();
  if (!text || !model.ready) return;
  checkBtn.disabled = true;
  statusEl.textContent = "Analysing on device…";
  try {
    const pred = await model.predict(text);
    lastRun = { text, pred };
    const v = verdictFor(pred.pScam);
    const chips = detectChips(text);
    let type: ScamType = "none";
    let typeConf = 0;
    let hinted = false;
    if (v.level !== "green") {
      const r = resolveType(text, pred.topType, pred.typeProbs[pred.topType]);
      type = r.type;
      hinted = r.hinted;
      typeConf = pred.typeProbs[type];
    }
    const tips = TIPS[type];
    $("#lat").textContent = `last inference ${pred.ms.toFixed(0)} ms`;

    resultEl.className = `result level-${LEVEL_CLASS[v.level]}`;
    resultEl.innerHTML = `
      <div class="thread">
        <div class="bubble"><p id="hl" class="hl">${esc(text)}</p></div>
        <p class="bubble-note">Highlights come from an on-device occlusion test: removing the word pushes the verdict<i class="toward-scam"></i>toward scam or<i class="toward-safe"></i>toward safe.</p>
      </div>
      <div class="verdict">
        <div>
          <div class="verdict-word">${v.title}</div>
          <div class="verdict-type">${type === "none" ? "No scam pattern detected" : `${TYPE_LABEL[type]} <span class="hint">${hinted ? "· keyword hint, model unsure" : `· ${pct(typeConf)} of scam types`}</span>`}</div>
        </div>
        <div class="verdict-num" aria-label="Scam probability ${pct(pred.pScam)}"><b><span id="pnum" aria-hidden="true">0</span><small>%</small></b><span>scam probability</span></div>
      </div>
      ${renderStrip(pred.pScam)}
      <div class="evidence"><h2>Evidence from plain rules</h2><div class="chips">${renderChips(chips)}</div></div>
      <div class="tips"><h2>What to do</h2><ul>${tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
      <div class="fb"><span>Was this right?</span>
        <button class="quiet small" data-fb="correct">Yes</button>
        <button class="quiet small" data-fb="wrong">No, it's ${v.level === "green" ? "a scam" : "legit"}</button>
      </div>`;
    resultEl.classList.remove("hidden");
    animateVerdict(pred.pScam);
    statusEl.textContent = "Explaining…";
    const attr = await explain(model, text, pred.pScam);
    $("#hl").innerHTML = renderHighlights(attr);
    statusEl.textContent = "";
  } catch (e) {
    statusEl.textContent = `Error: ${(e as Error).message}`;
    console.error(e);
  } finally {
    checkBtn.disabled = false;
    renderNet();
  }
}

checkBtn.addEventListener("click", () => void run());
msgEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void run();
});
$("#clear").addEventListener("click", () => {
  msgEl.value = "";
  resultEl.classList.add("hidden");
  msgEl.focus();
});
document.querySelectorAll<HTMLButtonElement>("[data-sample]").forEach((b) =>
  b.addEventListener("click", () => {
    msgEl.value = SAMPLES[b.dataset.sample!];
    void run();
  }),
);

// ---- Local-only feedback (never uploaded; user can export a JSON file) ----
const FB_KEY = "offline-lookout.feedback";
function loadFb(): any[] {
  try {
    return JSON.parse(localStorage.getItem(FB_KEY) || "[]");
  } catch {
    return [];
  }
}
function renderFb() {
  const n = loadFb().length;
  $("#fbcount").textContent = n ? `${n} item${n === 1 ? "" : "s"} stored on this device` : "";
}
renderFb();
resultEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-fb]");
  if (!b || !lastRun) return;
  const items = loadFb();
  items.push({ at: new Date().toISOString(), text: lastRun.text, p_scam: lastRun.pred.pScam, top_type: lastRun.pred.topType, user_says: b.dataset.fb });
  localStorage.setItem(FB_KEY, JSON.stringify(items));
  b.parentElement!.innerHTML = `<span>Thanks. Saved locally only.</span>`;
  renderFb();
});
$("#exportfb").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(loadFb(), null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "offline-lookout-feedback.json" });
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---- Batch / chat export check ----
const batchEl = $<HTMLTextAreaElement>("#batch");
let batchRows: Array<{ text: string; p: number; type: ScamType }> = [];
$<HTMLInputElement>("#batchfile").addEventListener("change", async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) batchEl.value = await f.text();
});
$("#batchrun").addEventListener("click", async () => {
  const lines = batchEl.value.split(/\r?\n/).map((l) => l.replace(/^\[?\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4},? \d{1,2}:\d{2}(?::\d{2})?\]?\s*(?:-\s*)?[^:]{0,40}:\s*/, "").trim()).filter(Boolean);
  if (!lines.length) return;
  const out = $("#batchout");
  out.innerHTML = `<p>Scoring ${lines.length} messages…</p>`;
  batchRows = [];
  for (let i = 0; i < lines.length; i += 16) {
    const preds = await model.predictBatch(lines.slice(i, i + 16));
    preds.forEach((p, k) => batchRows.push({ text: lines[i + k], p: p.pScam, type: verdictFor(p.pScam).level === "green" ? "none" : p.topType }));
  }
  batchRows.sort((a, b) => b.p - a.p);
  const flagged = batchRows.filter((r) => r.p >= 0.35).length;
  out.innerHTML = `<p><strong>${flagged}</strong> of ${batchRows.length} look suspicious or worse.</p><table class="scores"><thead><tr><th>Score</th><th>Type</th><th>Message</th></tr></thead><tbody>${batchRows
    .map((r) => `<tr class="level-${LEVEL_CLASS[verdictFor(r.p).level]}"><td>${pct(r.p)}</td><td>${r.type === "none" ? "" : esc(TYPE_LABEL[r.type])}</td><td>${esc(r.text)}</td></tr>`)
    .join("")}</tbody></table>`;
  $("#batchcsv").classList.remove("hidden");
  renderNet();
});
$("#batchcsv").addEventListener("click", () => {
  const csv = ["score,type,message", ...batchRows.map((r) => `${r.p.toFixed(4)},${r.type},"${r.text.replace(/"/g, '""')}"`)].join("\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "offline-lookout-batch.csv" });
  a.click();
  URL.revokeObjectURL(a.href);
});
