import type { Prediction, ScamType } from "./model";

export const TYPE_LABEL: Record<ScamType, string> = {
  none: "Not a scam",
  delivery: "Parcel / delivery scam",
  banking: "Bank or payment scam",
  prize: "Prize, reward or too-good-to-be-true offer",
  impersonation: "Impersonation (family, boss, official)",
  government: "Government, tax or toll scam",
  account: "Account or subscription scam",
};

export const TIPS: Record<ScamType, string[]> = {
  none: [
    "Looks fine, but stay alert: never share one-time codes, and never pay a 'fee' from a text.",
  ],
  delivery: [
    "Don't pay. Real couriers don't collect small 'release' or 'customs' fees by text link.",
    "Check the parcel on the courier's official app or site, typed in yourself. Not the link in the message.",
    "If you weren't expecting anything, delete it.",
  ],
  banking: [
    "Don't click, don't call the number in the text. Call the number printed on the back of your card.",
    "Your bank will never ask you to move money to a 'safe account' or to read out a one-time code.",
    "If you already entered details, call your bank now and change your password.",
  ],
  prize: [
    "You can't win a draw you never entered. Delete it.",
    "Never pay a 'processing fee', 'shipping' or 'tax' to receive a prize, loan or job.",
    "Guaranteed returns do not exist. Anyone promising them is lying.",
  ],
  impersonation: [
    "Stop. Call the person on the number you already have for them, not the new one.",
    "Ask a question only they could answer, or wait for a voice or video call.",
    "Never buy gift cards or send money because a text told you to, however urgent it sounds.",
  ],
  government: [
    "Tax offices, courts and toll operators don't demand instant payment by text link.",
    "Look up the agency's official site yourself and check there. Don't use the link in the message.",
    "Threats of arrest or fines to make you pay now are a scam signature.",
  ],
  account: [
    "Open the app or type the site address yourself. Never log in through a link in a text.",
    "Suspension threats with a 24-hour deadline are designed to panic you. Real services give notice.",
    "If you did log in via the link, change that password now and turn on two-factor authentication.",
  ],
};

export function verdictFor(p: number): { level: "green" | "yellow" | "red"; title: string } {
  if (p >= 0.7) return { level: "red", title: "Likely a scam" };
  if (p >= 0.35) return { level: "yellow", title: "Suspicious" };
  return { level: "green", title: "Looks OK" };
}

/**
 * Keyword hints for the scam-type label. The model's type head is the primary
 * source; a hint only replaces it when the head's confidence is low (< 0.6).
 */
const TYPE_HINTS: Array<[ScamType, RegExp]> = [
  ["delivery", /\b(parcel|package|deliver|courier|shipment|customs|redeliver|postage|depot)\b/i],
  ["government", /\b(tax|toll|fine|penalty|court|council|benefit|visa|licen[cs]e|revenue|customs & border|pension|census|voter)\b/i],
  ["impersonation", /\b(hi mum|hi mom|hi dad|it'?s me|its me|new number|temp(?:orary)? number|gift cards?|officer|grandma|gran\b|boss|ceo|hr\b|wrong number)\b/i],
  ["banking", /\b(bank|card|debit|wire|transfer|payee|transaction|fraud|overdraft|loan)\b/i],
  ["account", /\b(password|subscription|membership|storage|sim\b|voicemail|virus|antivirus|2fa|two-factor|sign[- ]?in|login|log in|account (?:is|has been) (?:suspended|limited|flagged|on hold))\b/i],
  ["prize", /\b(won|win|winner|prize|reward|giveaway|voucher|cashback|lottery|congratulations|earn|invest|crypto|free)\b/i],
];

export function resolveType(text: string, modelType: ScamType, modelConf: number): { type: ScamType; hinted: boolean } {
  if (modelConf >= 0.6) return { type: modelType, hinted: false };
  for (const [t, rx] of TYPE_HINTS) if (rx.test(text)) return { type: t, hinted: t !== modelType };
  return { type: modelType, hinted: false };
}

/**
 * The one place a prediction becomes a verdict and a type label. The single check
 * and the batch table both call this, so they cannot disagree about a message.
 */
export function classify(text: string, pred: Prediction): { level: "green" | "yellow" | "red"; title: string; type: ScamType; hinted: boolean; typeConf: number } {
  const v = verdictFor(pred.pScam);
  if (v.level === "green") return { ...v, type: "none", hinted: false, typeConf: 0 };
  const rt = resolveType(text, pred.topType, pred.typeProbs[pred.topType]);
  return { ...v, type: rt.type, hinted: rt.hinted, typeConf: pred.typeProbs[rt.type] };
}
