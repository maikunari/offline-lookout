import "./style.css";
import { registerSW } from "virtual:pwa-register";
import { ScamModel, TOTAL_BYTES, type LoadProgress, type Prediction, type ScamType } from "./model";
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

/** Hero illustration: the beam from the logo sweeping across an incoming message. Inline, no requests. */
const HERO_ART = `<svg class="hero-art" viewBox="0 0 132 120" aria-hidden="true" focusable="false">
  <defs>
    <clipPath id="ha-bubble"><path d="M40 18h74a12 12 0 0 1 12 12v34a12 12 0 0 1-12 12H48l-14 12V76a12 12 0 0 1-6-10V30a12 12 0 0 1 12-12Z"/></clipPath>
  </defs>
  <g class="hero-beam"><path d="M18 102 L92 2 L126 30 Z" fill="#ffc857" opacity="0.92"/></g>
  <path d="M40 18h74a12 12 0 0 1 12 12v34a12 12 0 0 1-12 12H48l-14 12V76a12 12 0 0 1-6-10V30a12 12 0 0 1 12-12Z" fill="#182030" stroke="#34405a"/>
  <g clip-path="url(#ha-bubble)" class="hero-beam"><path d="M18 102 L92 2 L126 30 Z" fill="#ffc857" opacity="0.16"/></g>
  <rect x="42" y="32" width="62" height="7" rx="3.5" fill="#9aa6ba" opacity="0.55"/>
  <rect x="42" y="46" width="34" height="7" rx="3.5" fill="#ff5d5d" opacity="0.85"/>
  <rect x="82" y="46" width="26" height="7" rx="3.5" fill="#9aa6ba" opacity="0.55"/>
  <rect x="42" y="60" width="48" height="7" rx="3.5" fill="#ff5d5d" opacity="0.6"/>
  <circle cx="18" cy="102" r="9" fill="#f2f4f8"/><circle cx="18" cy="102" r="3.4" fill="#0a0d13"/>
</svg>`;

/** A static example verdict shown before the first check, so the page never opens on a bare form. */
const GHOST = `
  <div class="ghost-tag">Example verdict</div>
  <div class="thread">
    <div class="bubble"><p class="hl">PostLink: your parcel could not be delivered due to an <mark class="run" style="--mk:var(--scam);--a:30%">unpaid customs fee of $2.99.</mark> <mark class="run" style="--mk:var(--scam);--a:46%">Pay now to avoid return:</mark> <mark class="run" style="--mk:var(--scam);--a:40%">https://postlink-redeliver.example/p/48213</mark></p></div>
  </div>
  <div class="verdict">
    <div class="verdict-head"><div class="verdict-word">Likely a scam</div></div><div class="verdict-type">Parcel / delivery scam</div>
    <div class="strip" aria-hidden="true"><div class="strip-bar"></div><span class="strip-tick" style="left:35%"></span><span class="strip-tick" style="left:70%"></span><span class="strip-lbl" data-at="0">0 · ok</span><span class="strip-lbl mid" style="left:35%">35 · suspicious</span><span class="strip-lbl mid" style="left:70%">70 · scam</span><span class="strip-lbl" data-at="100">100</span><span class="strip-marker" style="--p:0.97"></span></div>
    <div class="verdict-num"><b><span>97</span><small>%</small></b><span>scam probability</span></div>
  </div>`;

app.innerHTML = `
  <header class="top">
    <a class="brand" href="${import.meta.env.BASE_URL}">
      ${LOGO}
      <h1>Offline Lookout<small>On-device scam-text detector</small></h1>
    </a>
    <div id="netbadge" class="readout" role="status" title="Counts network requests made after the model is ready.">
      <span class="lamp"></span><span id="nettext" class="long">Loading model…</span><span id="netshort" class="short">Loading…</span>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="hero-text">
        <h2 class="hero-h">Is this text a scam? <span>Checked on your phone, never sent anywhere.</span></h2>
      </div>
      ${HERO_ART}
    </section>

    <div id="loader" class="loader" role="status" aria-live="polite">
      <svg class="ring" viewBox="0 0 40 40" aria-hidden="true">
        <circle class="ring-bg" cx="20" cy="20" r="16"/>
        <circle id="ringfg" class="ring-fg" cx="20" cy="20" r="16" pathLength="100"/>
        <path class="ring-check" d="M13 20.5l4.6 4.6L27.5 15"/>
      </svg>
      <div class="loader-text">
        <b id="loadtitle">Downloading once, then works offline</b>
        <span id="loadsub"><span id="loadmb">0</span> of ${(TOTAL_BYTES / 1e6).toFixed(0)} MB · model + runtime</span>
      </div>
    </div>

    <section class="compose" aria-labelledby="msg-label">
      <label for="msg" id="msg-label" class="field-label">Message to check</label>
      <textarea id="msg" rows="4" placeholder="Paste a text message here…" spellcheck="false"></textarea>
      <div class="actions">
        <button id="check" class="action" disabled><span class="spin" aria-hidden="true"></span><span id="checklbl">Check message</span></button>
        <button id="clear" class="quiet">Clear</button>
      </div>
      <p id="err" class="err" hidden></p>
      <div class="samples"><span class="samples-l">Try one</span>
        <button class="bubble-btn" data-sample="parcel">Parcel fee</button>
        <button class="bubble-btn" data-sample="otp">OTP code</button>
        <button class="bubble-btn" data-sample="mum">“Hi mum”</button>
        <button class="bubble-btn" data-sample="bank">Bank receipt</button>
      </div>
    </section>
    <p id="status" class="sr-only" aria-live="polite"></p>

    <section id="ghost" class="result ghost level-scam" aria-hidden="true">${GHOST}</section>
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
    <details class="how">
      <summary>How it works</summary>
      <div class="how-body">
        <p id="specs" class="specs">Loading model details…</p>
        <ul>
          <li><strong>Verdict.</strong> A small MiniLM text classifier, fine-tuned on scam and legitimate texts, quantised to int8 and run with onnxruntime-web (WebAssembly) inside this tab. The probability is temperature-calibrated; the two thresholds printed on the strip (35 suspicious, 70 scam) are the real ones.</li>
          <li><strong>Highlights.</strong> An occlusion test: each word and short span is removed in turn and the message re-scored. Words whose removal moves the verdict most are marked red (toward scam) or green (toward safe).</li>
          <li><strong>Rule chips.</strong> Plain regular expressions for links, lookalike domains, money, urgency and requests for codes or details. They are evidence, not AI, and never change the score.</li>
          <li><strong>Privacy.</strong> After the model is ready the header counter watches every fetch, XHR and resource load. It should stay at zero: nothing you paste is sent anywhere.</li>
        </ul>
        <div class="row">
          <button id="exportfb" class="quiet small">Export feedback (local JSON)</button>
          <span id="fbcount"></span>
        </div>
      </div>
    </details>
    <p class="fine">Verdicts can be wrong. When in doubt, contact the organisation using a number or address you already trust. Model, data and licence notes are in the project README.</p>
  </footer>

  <div id="dock" class="dock" hidden><button id="dockcheck" class="action" disabled>Check message</button></div>
`;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const msgEl = $<HTMLTextAreaElement>("#msg");
const checkBtn = $<HTMLButtonElement>("#check");
const dockBtn = $<HTMLButtonElement>("#dockcheck");
const checkLbl = $("#checklbl");
const statusEl = $("#status");
const errEl = $("#err");
const resultEl = $("#result");
const ghostEl = $("#ghost");
const loaderEl = $("#loader");
const netText = $("#nettext");
const netShort = $("#netshort");
const netBadge = $("#netbadge");

const net = new NetWatch();
const model = new ScamModel();
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
let lastRun: { text: string; pred: Prediction } | null = null;
let running = false;

function renderNet() {
  const s = net.snapshot();
  if (!s.armed) return;
  const n = s.requestsSinceReady;
  netBadge.className = `readout ${n === 0 ? "readout-ok" : "readout-bad"}`;
  netText.textContent = `${n} network request${n === 1 ? "" : "s"} since ready · ${s.online ? "online" : "offline"}${s.swControlled ? " · cached" : ""}`;
  netShort.textContent = `${n} request${n === 1 ? "" : "s"} · ${s.swControlled ? "offline-ready" : s.online ? "online" : "offline"}`;
}
net.onChange(renderNet);

registerSW({ immediate: true, onOfflineReady: () => renderNet(), onRegistered: () => renderNet() });

// ---- First load as a feature: a ring driven by real bytes, ending on "Ready · works offline" ----
function renderLoad(p: LoadProgress) {
  const frac = Math.min(1, p.received / p.total);
  $("#ringfg").style.setProperty("--frac", String(frac));
  if (p.stage === "download") $("#loadmb").textContent = (p.received / 1e6).toFixed(1);
  if (p.stage === "compile") {
    $("#loadtitle").textContent = "Downloaded · starting the model";
    $("#loadsub").textContent = `${(p.total / 1e6).toFixed(0)} MB cached on this device`;
  }
  if (p.stage === "ready") {
    loaderEl.classList.add("ready");
    $("#loadtitle").textContent = "Ready · works offline";
    $("#loadsub").textContent = `${(p.total / 1e6).toFixed(0)} MB cached on this device · nothing you paste is sent anywhere`;
  }
}

(async () => {
  try {
    await model.load(renderLoad);
    statusEl.textContent = "Model ready.";
    checkBtn.disabled = false;
    dockBtn.disabled = false;
    $<HTMLButtonElement>("#batchrun").disabled = false;
    const m = model.meta;
    const mb = m.size_bytes ? (m.size_bytes.int8 / 1e6).toFixed(1) : "?";
    $("#specs").innerHTML = `<strong>${m.base_model}</strong> fine-tuned · ${(m.parameters / 1e6).toFixed(0)}M params · int8 ONNX ${mb} MB · onnxruntime-web (wasm) · calibrated with temperature ${m.temperature.toFixed(2)} · <span id="lat">no inference yet</span>`;
    // Warm up so the first real check is fast, then arm the network counter.
    await model.predict("warm up");
    net.arm();
    renderNet();
    handleShareTarget();
  } catch (e) {
    loaderEl.classList.add("failed");
    $("#loadtitle").textContent = "Could not load the model";
    $("#loadsub").textContent = (e as Error).message;
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

/**
 * Highlights as continuous runs: adjacent words that push the same way are painted as one
 * mark (whitespace included), so a flagged clause reads as one marker stroke, not a row of
 * pills with gaps. Each run carries its index so the CSS can sweep them in, in reading order.
 */
function renderHighlights(attr: WordAttribution[]): string {
  const MIN = 0.15;
  const dirOf = (a: WordAttribution) => (!a.word.trim() || a.strength < MIN ? "" : a.delta > 0 ? "scam" : "safe");
  const dirs = attr.map(dirOf);
  // Whitespace joins a run when both neighbours are in the same run.
  for (let i = 0; i < attr.length; i++) {
    if (!attr[i].word.trim() && i > 0 && i < attr.length - 1 && dirs[i - 1] && dirs[i - 1] === dirs[i + 1]) dirs[i] = dirs[i - 1];
  }
  let html = "";
  let run = 0;
  for (let i = 0; i < attr.length; ) {
    const d = dirs[i];
    if (!d) {
      html += esc(attr[i].word);
      i++;
      continue;
    }
    let j = i;
    let strength = 0;
    let delta = 0;
    while (j < attr.length && dirs[j] === d) {
      if (attr[j].strength > strength) {
        strength = attr[j].strength;
        delta = attr[j].delta;
      }
      j++;
    }
    const text = attr
      .slice(i, j)
      .map((a) => a.word)
      .join("");
    const mk = d === "scam" ? "var(--scam)" : "var(--ok)";
    const alpha = Math.round(14 + 34 * strength);
    html += `<mark class="run" style="--mk:${mk};--a:${alpha}%;--i:${run++}" title="Removing this shifts the scam log-odds by ${delta.toFixed(2)} (toward ${d})">${esc(text)}</mark>`;
    i = j;
  }
  return html;
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

/** On a safe verdict the chips are context, not alarms: they render neutral, never red. */
function renderChips(chips: Chip[], safe: boolean): string {
  if (!chips.length) return `<span class="chip chip-none">${icon("none")}No rule-based red flags</span>`;
  return chips.map((c) => `<span class="chip ${safe ? "chip-neutral" : `chip-${c.weight}`}" title="${esc(c.detail)}">${icon(c.id)}${esc(c.label)}</span>`).join("");
}

const LEVEL_CLASS = { green: "ok", yellow: "sus", red: "scam" } as const;

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

const TICK = `<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l4.8 4.8L19.5 7"/></svg>`;

/**
 * Marker and number are driven from one eased value in the same animation frame, so they can
 * never disagree mid-flight (the marker has no CSS transition of its own).
 */
function animateVerdict(p: number, delayMs: number) {
  const marker = $("#marker");
  const num = $("#pnum");
  const target = Math.round(p * 100);
  const settle = () => {
    marker.style.setProperty("--p", String(p));
    num.textContent = String(target);
  };
  if (REDUCED.matches) return settle();
  const dur = 600;
  const start = () => {
    const t0 = performance.now();
    const tick = (t: number) => {
      const x = Math.min(1, (t - t0) / dur);
      const e = x >= 1 ? 1 : 1 - Math.pow(2, -10 * x); // exponential ease-out
      marker.style.setProperty("--p", String(p * e));
      num.textContent = String(Math.round(p * 100 * e));
      if (x < 1) requestAnimationFrame(tick);
      else settle();
    };
    requestAnimationFrame(tick);
  };
  window.setTimeout(start, delayMs);
}

function setBusy(busy: boolean, label = "Check message") {
  running = busy;
  checkBtn.disabled = busy || !model.ready;
  dockBtn.disabled = busy || !model.ready;
  checkBtn.classList.toggle("busy", busy);
  checkLbl.textContent = label;
}

function showError(msg: string) {
  errEl.textContent = msg;
  errEl.hidden = false;
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/**
 * The verdict moment, staged: the bubble is scanned while the model and the occlusion test
 * run; then highlights sweep in word by word, the strip fills as the number counts up, the
 * signal word lands, and the evidence follows. About 1.3 s after compute; instant when the
 * user prefers reduced motion.
 */
async function run() {
  const text = msgEl.value.trim();
  if (!text || !model.ready || running) return;
  setBusy(true, "Checking…");
  errEl.hidden = true;
  statusEl.textContent = "Analysing on device…";
  ghostEl.classList.add("hidden");
  loaderEl.classList.add("hidden");

  const reduced = REDUCED.matches;
  resultEl.className = `result card scanning${reduced ? " no-anim" : ""}`;
  resultEl.innerHTML = `
    <div class="thread">
      <div class="bubble"><p id="hl" class="hl">${esc(text)}</p><span class="scan" aria-hidden="true"></span></div>
      <p class="legend" id="legend">Reading on device…</p>
    </div>
    <div class="reveal"><div class="reveal-inner" id="reveal"></div></div>`;
  resultEl.classList.remove("hidden");
  const r = resultEl.getBoundingClientRect();
  if (r.top > window.innerHeight * 0.45 || r.top < 0) resultEl.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });

  try {
    const pred = await model.predict(text);
    lastRun = { text, pred };
    const v = verdictFor(pred.pScam);
    const level = LEVEL_CLASS[v.level];
    const safe = v.level === "green";
    const chips = detectChips(text);
    let type: ScamType = "none";
    let typeConf = 0;
    let hinted = false;
    if (!safe) {
      const rt = resolveType(text, pred.topType, pred.typeProbs[pred.topType]);
      type = rt.type;
      hinted = rt.hinted;
      typeConf = pred.typeProbs[type];
    }
    const tips = TIPS[type];
    $("#lat").textContent = `last inference ${pred.ms.toFixed(0)} ms`;

    // The type line describes the *type* guess only; the verdict itself is the number.
    const typeLine = type === "none"
      ? "No scam pattern detected"
      : `${TYPE_LABEL[type]} <span class="hint">${hinted ? "· type from wording" : `· type ${pct(typeConf)} sure`}</span>`;

    $("#reveal").innerHTML = `
      <div class="verdict">
        <div class="verdict-head"><div class="verdict-word">${safe ? TICK : ""}${v.title}</div></div>
        <div class="verdict-type">${typeLine}</div>
        ${renderStrip(pred.pScam)}
        <div class="verdict-num" aria-label="Scam probability ${pct(pred.pScam)}"><b><span id="pnum" aria-hidden="true">0</span><small>%</small></b><span>scam probability</span></div>
      </div>
      <div class="detail">
        <div class="evidence"><h2>${safe ? "Patterns noticed · common in legitimate texts too" : "Evidence from plain rules"}</h2><div class="chips">${renderChips(chips, safe)}</div></div>
        <div class="tips"><h2>What to do</h2><ul>${tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
        <div class="fb"><span>Was this right?</span>
          <button class="quiet small" data-fb="correct">Yes</button>
          <button class="quiet small" data-fb="wrong">No, it's ${safe ? "a scam" : "legit"}</button>
        </div>
      </div>`;
    resultEl.classList.add(`level-${level}`);

    // Highlights first (they are the scan), but never hold the verdict hostage to a slow device.
    statusEl.textContent = "Explaining…";
    const explaining = explain(model, text, pred.pScam).then((attr) => {
      $("#hl").innerHTML = renderHighlights(attr);
      $("#legend").innerHTML = `Highlights are an on-device occlusion test: removing a word pushes the verdict <i class="sw sw-scam" aria-hidden="true"></i> toward scam or <i class="sw sw-safe" aria-hidden="true"></i> toward safe.`;
    });
    await Promise.race([explaining, sleep(2500)]);
    explaining.catch((e) => {
      $("#legend").textContent = "Highlights unavailable for this message.";
      console.error(e);
    });

    resultEl.classList.remove("scanning");
    resultEl.classList.add("landed");
    animateVerdict(pred.pScam, reduced ? 0 : 450);
    statusEl.textContent = `${v.title}. Scam probability ${pct(pred.pScam)}.`;
    await explaining.catch(() => undefined);
  } catch (e) {
    showError(`Error: ${(e as Error).message}`);
    console.error(e);
  } finally {
    setBusy(false);
    renderNet();
  }
}

checkBtn.addEventListener("click", () => void run());
dockBtn.addEventListener("click", () => void run());
msgEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void run();
});
$("#clear").addEventListener("click", () => {
  msgEl.value = "";
  resultEl.classList.add("hidden");
  ghostEl.classList.remove("hidden");
  errEl.hidden = true;
  msgEl.focus();
});
document.querySelectorAll<HTMLButtonElement>("[data-sample]").forEach((b) =>
  b.addEventListener("click", () => {
    msgEl.value = SAMPLES[b.dataset.sample!];
    void run();
  }),
);

// ---- Sticky Check on phones: a docked button appears once the inline one scrolls away ----
const dock = $("#dock");
const narrow = window.matchMedia("(max-width: 639px)");
let actionsVisible = true;
const updateDock = () => {
  const show = narrow.matches && !actionsVisible;
  dock.hidden = !show;
  document.body.classList.toggle("docked", show);
};
new IntersectionObserver(
  (entries) => {
    actionsVisible = entries[0].isIntersecting;
    updateDock();
  },
  { threshold: 0.4 },
).observe($(".compose .actions"));
narrow.addEventListener("change", updateDock);

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
