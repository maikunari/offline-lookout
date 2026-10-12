/** Deterministic, no-AI signal detectors shown as chips next to the verdict. */

export interface Chip {
  id: string;
  label: string;
  detail: string;
  /** How strongly this signal is associated with scams on its own. */
  weight: "low" | "medium" | "high";
}

const URL_RX = /\b(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|co|uk|io|xyz|info|ly|me|app|link|click|top|site|online|shop|live|icu|cc|tk|ml|ga|cf|gq|example)\b(?:\/[^\s<>"']*)?/gi;
const SHORTENERS = /\b(?:bit\.ly|tinyurl(?:\.[a-z]+)+|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rb\.gy|cutt\.ly|shorturl\.at|tiny\.cc|qrco\.de|rebrand\.ly|s\.id|v\.gd|lnkd\.in)\b/i;
const SUSPICIOUS_TLD = /\.(?:xyz|top|click|link|icu|tk|ml|ga|cf|gq|cc|site|online|live|shop|buzz|rest|cyou|cfd|sbs)\b/i;
const PHONE_RX = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}\b|\b0\d{3}\s?\d{3}\s?\d{3,4}\b/g;
const MONEY_RX = /(?:[$£€¥₹]\s?\d[\d,]*(?:\.\d{1,2})?)|(?:\b\d[\d,]*(?:\.\d{1,2})?\s?(?:usd|gbp|eur|dollars?|pounds?|euros?|rs|inr|quid|bucks)\b)|\b(?:fee|charge|payment|pay|refund|tax|duty|fine|penalty|cash|prize|voucher|gift ?card|invoice|transfer|deposit)\b/i;
const URGENCY_RX = /\b(?:urgent(?:ly)?|immediately|right now|asap|within \d+\s?(?:h|hrs?|hours?|minutes?|mins?|days?)|in the next \d+|today|tonight|by midnight|final (?:notice|reminder|warning)|last chance|2nd (?:notice|attempt)|expires?|expiring|suspend(?:ed|sion)?|deactivat|locked|frozen|blocked|avoid (?:a |the )?(?:fine|penalty|fee|charge|cancellation|return|suspension|court|arrest)|will be (?:deleted|destroyed|cancelled|canceled|returned|closed)|don'?t tell|keep this between us|do not call)\b/i;
const CREDENTIAL_RX = /\b(?:pin|password|passcode|otp|one[- ]time|verification code|cvv|card number|sort code|account number|national insurance|ssn|date of birth|login details|log ?in|sign ?in|verify your (?:identity|account|card|details)|confirm your (?:identity|account|card|details))\b/i;
const BRANDISH = /\b(?:bank|post|parcel|courier|delivery|customs|revenue|tax|toll|court|police|gov|council|benefits?|pension|netflix|apple|google|microsoft|amazon|paypal|whatsapp|telegram|facebook|instagram|royal ?mail|dhl|fedex|ups|usps|hermes|evri|dpd|hmrc|irs|dvla|nhs)\b/i;

function hostOf(url: string): string | null {
  try {
    const u = new URL(url.match(/^https?:\/\//i) ? url : `http://${url}`);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Heuristics for lookalike / impersonating domains. Never network. */
function lookalike(host: string): string | null {
  const labels = host.split(".");
  const registrable = labels.slice(-2).join(".");
  const sub = labels.slice(0, -2).join(".");
  if (/\d/.test(registrable.replace(/\.[a-z]+$/, "")) && /[a-z]/.test(registrable))
    if (/[0-9]/.test(registrable) && /(0|1|3|5)/.test(registrable)) return "digits mixed into the domain name";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return "raw IP address instead of a domain";
  if (SUSPICIOUS_TLD.test("." + labels[labels.length - 1])) return `unusual top-level domain .${labels[labels.length - 1]}`;
  if (sub && BRANDISH.test(sub) && !BRANDISH.test(registrable)) return "brand word hidden in a subdomain";
  if (/-/.test(registrable) && BRANDISH.test(registrable)) return "brand word joined with hyphens";
  if (labels.length >= 4) return "many nested subdomains";
  return null;
}

export function detectChips(text: string): Chip[] {
  const chips: Chip[] = [];
  const urls = Array.from(text.matchAll(URL_RX)).map((m) => m[0]);
  if (urls.length) {
    chips.push({ id: "url", label: urls.length > 1 ? `${urls.length} links` : "Link", detail: urls.join(", "), weight: "medium" });
    if (urls.some((u) => SHORTENERS.test(u)))
      chips.push({ id: "short", label: "Short link", detail: "Shortened links hide the real destination.", weight: "high" });
    for (const u of urls) {
      const h = hostOf(u);
      const why = h && lookalike(h);
      if (why) {
        chips.push({ id: "lookalike", label: "Lookalike domain", detail: `${h}: ${why}`, weight: "high" });
        break;
      }
    }
  }
  const phones = Array.from(text.matchAll(PHONE_RX)).map((m) => m[0].trim()).filter((p) => p.replace(/\D/g, "").length >= 7);
  if (phones.length) chips.push({ id: "phone", label: "Phone number", detail: `Asks you to call or text ${phones[0]}. Scammers prefer numbers they control.`, weight: "low" });
  const money = text.match(MONEY_RX);
  if (money) chips.push({ id: "money", label: "Money", detail: `Mentions "${money[0]}". Real notices rarely ask for small, odd fees by text.`, weight: "medium" });
  const urg = text.match(URGENCY_RX);
  if (urg) chips.push({ id: "urgency", label: "Urgency", detail: `"${urg[0]}": pressure to act fast is the classic scam lever.`, weight: "medium" });
  const cred = text.match(CREDENTIAL_RX);
  if (cred) chips.push({ id: "credentials", label: "Asks for details", detail: `Mentions "${cred[0]}". Nobody legitimate needs your PIN, password, or one-time code.`, weight: "high" });
  return chips;
}
