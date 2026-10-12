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
app.innerHTML = `
  <header class="top">
    <div class="brand">
      <img src="${import.meta.env.BASE_URL}icons/icon.svg" alt="" width="36" height="36" />
      <div>
        <h1>Offline Lookout</h1>
        <p class="tagline">Scam-text detector that runs on your device. Nothing you paste leaves it.</p>
      </div>
    </div>
    <div id="netbadge" class="badge badge-wait" title="Counts network requests made after the model is ready.">
      <span class="dot"></span><span id="nettext">Loading model…</span>
    </div>
  </header>

  <main>
    <section class="card input-card">
      <label for="msg" class="sr-only">Message to check</label>
      <textarea id="msg" rows="4" placeholder="Paste a text message here…" spellcheck="false"></textarea>
      <div class="row">
        <button id="check" class="primary" disabled>Check message</button>
        <button id="clear" class="ghost">Clear</button>
        <span class="samples">Try: 
          <button class="link" data-sample="parcel">parcel fee</button> ·
          <button class="link" data-sample="otp">OTP code</button> ·
          <button class="link" data-sample="mum">"hi mum"</button> ·
          <button class="link" data-sample="bank">bank receipt</button>
        </span>
      </div>
      <p id="status" class="status" aria-live="polite"></p>
    </section>

    <section id="result" class="result hidden" aria-live="polite"></section>

    <section class="card batch-card">
      <details>
        <summary>Check many messages at once (chat export)</summary>
        <p class="muted">Paste one message per line, or drop a .txt export. Every line is scored on device.</p>
        <textarea id="batch" rows="5" placeholder="One message per line…"></textarea>
        <div class="row">
          <button id="batchrun" class="primary" disabled>Check all</button>
          <input id="batchfile" type="file" accept=".txt,.csv,text/plain" />
          <button id="batchcsv" class="ghost hidden">Download CSV</button>
        </div>
        <div id="batchout"></div>
      </details>
    </section>
  </main>

  <footer class="foot">
    <div id="specs" class="specs"></div>
    <div class="row">
      <button id="exportfb" class="ghost small">Export feedback (local JSON)</button>
      <span id="fbcount" class="muted small"></span>
    </div>
    <p class="muted small">Model, data and license notes are in the project README. Rule chips are plain regexes, not AI. Verdicts can be wrong: when in doubt, contact the organisation using a number or address you already trust.</p>
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
  netBadge.className = `badge ${n === 0 ? "badge-ok" : "badge-bad"}`;
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

function renderHighlights(attr: WordAttribution[], level: string): string {
  return attr
    .map((a) => {
      if (!a.word.trim()) return esc(a.word);
      if (a.strength < 0.15) return `<span>${esc(a.word)}</span>`;
      const toward = a.delta > 0 ? "scam" : "safe";
      const alpha = (0.15 + 0.6 * a.strength).toFixed(2);
      const color = toward === "scam" ? `rgba(239, 68, 68, ${alpha})` : `rgba(34, 197, 94, ${alpha})`;
      return `<mark style="background:${color}" title="Removing this word shifts the scam log-odds by ${a.delta.toFixed(2)} (${toward})">${esc(a.word)}</mark>`;
    })
    .join("") + (level === "green" ? "" : "");
}

function renderChips(chips: Chip[]): string {
  if (!chips.length) return `<span class="chip chip-none">No rule-based red flags</span>`;
  return chips.map((c) => `<span class="chip chip-${c.weight}" title="${esc(c.detail)}">${esc(c.label)}</span>`).join("");
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

    resultEl.className = `result level-${v.level}`;
    resultEl.innerHTML = `
      <div class="verdict">
        <div class="verdict-main">
          <div class="verdict-title">${v.title}</div>
          <div class="verdict-sub">${type === "none" ? "No scam pattern detected" : `${TYPE_LABEL[type]} <span class="muted">${hinted ? "(keyword hint; model unsure)" : `(${pct(typeConf)} of scam types)`}</span>`}</div>
        </div>
        <div class="gauge" aria-label="Scam probability ${pct(pred.pScam)}">
          <div class="gauge-num">${pct(pred.pScam)}</div>
          <div class="gauge-lbl">scam<br/>probability</div>
        </div>
      </div>
      <div class="chips">${renderChips(chips)}</div>
      <div class="highlight-box"><div class="muted small">Words driving the verdict (on-device occlusion test):</div><p id="hl" class="hl">${esc(text)}</p></div>
      <div class="tips"><div class="tips-h">What to do</div><ul>${tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
      <div class="row fb"><span class="muted small">Was this right?</span>
        <button class="ghost small" data-fb="correct">Yes</button>
        <button class="ghost small" data-fb="wrong">No, it's ${v.level === "green" ? "a scam" : "legit"}</button>
      </div>`;
    resultEl.classList.remove("hidden");
    statusEl.textContent = "Explaining…";
    const attr = await explain(model, text, pred.pScam);
    $("#hl").innerHTML = renderHighlights(attr, v.level);
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
  b.parentElement!.innerHTML = `<span class="muted small">Thanks. Saved locally only.</span>`;
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
  out.innerHTML = `<p class="muted">Scoring ${lines.length} messages…</p>`;
  batchRows = [];
  for (let i = 0; i < lines.length; i += 16) {
    const preds = await model.predictBatch(lines.slice(i, i + 16));
    preds.forEach((p, k) => batchRows.push({ text: lines[i + k], p: p.pScam, type: verdictFor(p.pScam).level === "green" ? "none" : p.topType }));
  }
  batchRows.sort((a, b) => b.p - a.p);
  const flagged = batchRows.filter((r) => r.p >= 0.35).length;
  out.innerHTML = `<p><strong>${flagged}</strong> of ${batchRows.length} look suspicious or worse.</p><table class="batch"><thead><tr><th>Score</th><th>Type</th><th>Message</th></tr></thead><tbody>${batchRows
    .map((r) => `<tr class="level-${verdictFor(r.p).level}"><td>${pct(r.p)}</td><td>${r.type === "none" ? "" : esc(TYPE_LABEL[r.type])}</td><td>${esc(r.text)}</td></tr>`)
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
