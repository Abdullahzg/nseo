// Reply classification + negotiation drafting on Nemotron.
//
// Division of labour (the whole point of the design):
//   MODEL  decides what the editor meant (intent, price, what they're asking for) and writes the
//          words of a counter-offer.
//   CODE   owns every number and every safety rule: ceilings/floors, the strong-cue escalations
//          (a call, an NDA, an invoice → a human), the fabrication guard, thread length, and the
//          three "policy closings" (decline politely, accept an in-bounds price, wind down).
//
// Nothing here has a fallback. A failed model call throws NebiusError and the caller records it.
import type { NegotiationSettings } from "./settings";
import { json as nebiusJson, text as nebiusText, type LLMMeta } from "@/lib/ai/nebius";
import { MODELS, NEGOTIATION_ULTRA_CAP } from "@/lib/ai/models";

export function sanitizeBody(s: string): string {
  return s
    .replace(/\s+[‐‑‒–—―−－]+\s+/g, ", ")
    .replace(/^[‐‑‒–—―−－]+\s+/g, "")
    .replace(/\s+[‐‑‒–—―−－]+$/g, "")
    .replace(/(?<![a-zA-Z])[‐‑‒–—―−－]+(?![a-zA-Z])/g, ", ")
    .replace(/[–—―]+/g, ", ")
    .replace(/ ,/g, ",").replace(/,\s*,/g, ",").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const AGGRESSION: Record<string, string> = {
  gentle: "Be gentle. Move up slowly and only if they push, prefer settling below the ceiling, and lean toward a free or editorial inclusion if they hesitate on price.",
  balanced: "Be balanced. Move in modest steps and aim to land comfortably under the ceiling.",
  firm: "Be firm. Hold close to your opening number, concede minimally and slowly, and only approach the ceiling when the placement is clearly high value.",
};

export type ReplyIntent = "interested" | "counter_offer" | "accept" | "question" | "hard_no" | "unsubscribe" | "auto" | "irrelevant" | "needs_human";
export const REPLY_INTENTS: ReplyIntent[] = ["interested", "counter_offer", "accept", "question", "hard_no", "unsubscribe", "auto", "irrelevant", "needs_human"];

export type InterventionType =
  | "asset_request" | "identity_verification" | "sync_contact" | "scheduling" | "redirect" | "process_portal"
  | "legal_contract" | "payment_details" | "factual_question" | "over_policy" | "inbound_attachment" | "other_channel" | "other";
export const INTERVENTION_TYPES: InterventionType[] = ["asset_request", "identity_verification", "sync_contact", "scheduling", "redirect", "process_portal", "legal_contract", "payment_details", "factual_question", "over_policy", "inbound_attachment", "other_channel", "other"];

export interface ReplyClassification {
  intent: ReplyIntent;
  priceMentioned: number | null;
  reason: string;
  sentiment: "positive" | "neutral" | "negative";
  interventionType?: InterventionType;
  interventionAsk?: string;
  assistable?: boolean;
  /** How the final label was reached — the model's answer, or a code rule that overrode it. */
  decided_by: "model" | "policy:strong_cue" | "policy:price_demotion";
  llm: LLMMeta;
}

const CLASSIFY_SCHEMA = {
  name: "reply_classification",
  schema: {
    type: "object",
    properties: {
      intent: { type: "string", enum: REPLY_INTENTS },
      priceMentioned: { type: ["number", "null"] },
      reason: { type: "string" },
      sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
      interventionType: { type: ["string", "null"], enum: [...INTERVENTION_TYPES, null] },
      interventionAsk: { type: ["string", "null"] },
      assistable: { type: ["boolean", "null"] },
    },
    required: ["intent", "priceMentioned", "reason", "sentiment", "interventionType", "interventionAsk", "assistable"],
    additionalProperties: false,
  },
};

interface ClassifyOut { intent: ReplyIntent; priceMentioned: number | null; reason: string; sentiment: "positive" | "neutral" | "negative"; interventionType: InterventionType | null; interventionAsk: string | null; assistable: boolean | null }
const isClassifyOut = (v: unknown): v is ClassifyOut => {
  const o = v as any;
  return !!o && REPLY_INTENTS.includes(o.intent) && (o.priceMentioned === null || typeof o.priceMentioned === "number") && typeof o.reason === "string" && ["positive", "neutral", "negative"].includes(o.sentiment);
};

/** Classify an inbound reply. Nano, thinking off, json_schema. Throws on model failure. */
export async function classifyReplyIntent(replyText: string, subject = ""): Promise<ReplyClassification> {
  const text = `${subject}\n${replyText}`.trim().slice(0, 4000);
  const r = await nebiusJson<ClassifyOut>({
    role: "fast", thinking: false, max_tokens: 300, schema: CLASSIFY_SCHEMA, validate: isClassifyOut,
    messages: [
      { role: "system", content: "You classify replies to a media-outreach email on behalf of an email-only AI agent that cannot attach files, join calls, share calendars, sign contracts, or state facts it was not given. Answer with JSON only." },
      { role: "user", content: `Classify this inbound reply.

intent, one of:
- interested: open to featuring/including us, positive, wants to talk.
- counter_offer: names their own price or terms.
- accept: agrees to our proposal/price.
- question: a simple question answerable from the negotiation itself (not a factual company stat).
- hard_no: clearly declines / not interested.
- unsubscribe: asks to stop emailing.
- auto: automated out-of-office / autoresponder.
- irrelevant: spam or unrelated.
- needs_human: asks for something an EMAIL-ONLY AI cannot do or must not invent. Priority label when it applies. Then set interventionType: asset_request (send a file/deck/media kit), identity_verification (LinkedIn/proof), sync_contact (a call/Zoom/meeting/"tell me more about your tool on a call"), scheduling (availability/calendar link), redirect (email someone else), process_portal (submit via form/portal), legal_contract (NDA/contract), payment_details (invoice/PO/bank), factual_question (traffic/DAU/do-follow/turnaround facts), over_policy (retainer/exclusivity/long-term), inbound_attachment (they attached a file), other_channel (WhatsApp/phone), other. interventionAsk = what they literally asked for (<=15 words). assistable = true if a human's one-line answer lets the AI continue.

priceMentioned: the number they named in currency, else null. reason: <=12 words. sentiment: their tone.

Reply:
"""${text}"""` },
    ],
  });
  const j = r.data;
  const base: ReplyClassification = {
    intent: j.intent, priceMentioned: j.priceMentioned, reason: j.reason.slice(0, 120), sentiment: j.sentiment, decided_by: "model", llm: r.meta,
  };
  const cue = strongCue(text.toLowerCase());
  if (j.intent === "needs_human") {
    if (!cue && j.priceMentioned != null) {
      // Policy: a reply that names a price and trips no capability cue is a normal negotiation turn.
      return { ...base, intent: "counter_offer", decided_by: "policy:price_demotion", reason: `demoted from needs_human/${j.interventionType ?? "other"}: no capability cue` };
    }
    return {
      ...base,
      interventionType: cue?.type ?? (j.interventionType && INTERVENTION_TYPES.includes(j.interventionType) ? j.interventionType : "other"),
      interventionAsk: cue?.ask ?? (j.interventionAsk?.slice(0, 140) || "asked for something the AI cannot do"),
      assistable: cue ? cue.assistable : j.assistable !== false,
    };
  }
  if (cue && ["interested", "question", "counter_offer", "accept"].includes(j.intent)) {
    // Policy: an unambiguous "AI literally cannot do this" cue always parks the thread.
    return { ...base, intent: "needs_human", decided_by: "policy:strong_cue", interventionType: cue.type, interventionAsk: cue.ask, assistable: cue.assistable, reason: `strong cue: ${cue.type}` };
  }
  return base;
}

/** Deterministic escalation cues. These are safety rules, not a classifier substitute. */
export function strongCue(t: string): { type: InterventionType; ask: string; assistable: boolean } | null {
  const R: Array<[RegExp, InterventionType, string, boolean]> = [
    [/\b(call|zoom|google meet|g[- ]?meet|hop on|jump on|phone call|dial|ring you)\b/i, "sync_contact", "wants a call / video meeting", false],
    [/\b(whatsapp|telegram|\bsms\b|text me|signal app|dm me)\b/i, "other_channel", "wants to move to another channel", false],
    [/\b(nda|contract|agreement|msa|docusign|terms (and|&) conditions)\b/i, "legal_contract", "wants a contract / NDA signed", false],
    [/\b(invoice|purchase order|\bpo\b|\bw-?9\b|tax (form|id)|bank (details|account)|iban|swift|billing (details|info))\b/i, "payment_details", "wants invoice / PO / bank / tax details", true],
    [/\b(submit (via|through|using|our)|fill (out|in) (this|the) form|vendor portal|create an account|submission (system|portal))\b/i, "process_portal", "wants submission via a form/portal", false],
    [/\b(attach(ed|ing)|see the (attached|doc)|find (attached|enclosed)|pfa)\b/i, "inbound_attachment", "sent a file for us to review", false],
    [/\b(do-?follow|nofollow|permanent link|monthly traffic|how (much|many) (traffic|visitors|readers)|\bdau\b|\bmau\b|domain (rating|authority))\b/i, "factual_question", "asks a fact about your site the agent must not invent", true],
    [/\b(retainer|long[- ]?term (deal|contract)|per month|monthly fee|exclusiv(e|ity))\b/i, "over_policy", "wants terms beyond a one-off placement", true],
  ];
  for (const [re, type, ask, assistable] of R) if (re.test(t)) return { type, ask, assistable };
  return null;
}

export interface ThreadMessage { from: "us" | "them"; body: string }

export interface DraftInput {
  settings: NegotiationSettings;
  thread: ThreadMessage[];
  authorName: string;
  publication: string;
  ceiling: number | null;
  floor: number;
  lastIntent: ReplyIntent;
  theirPrice?: number | null;
  senderName?: string;
  productName?: string;
  assistInput?: string | null;
  /** Ultra calls already spent on this campaign — past NEGOTIATION_ULTRA_CAP we draft on Super. */
  ultraCallsUsed?: number;
}

export interface DraftResult {
  body: string;
  suggestedOffer: number | null;
  shouldStop: boolean;
  statusHint: "negotiating" | "agreed" | "declined" | "stalled";
  needsHuman?: boolean;
  interventionType?: InterventionType;
  interventionAsk?: string;
  /** "model" when Nemotron wrote it; "policy" for the three deterministic closings. */
  engine: "model" | "policy";
  llm: LLMMeta | null;
}

const FABRICATION_RE = /\b(attach(ed|ing|ment)?|enclosed|i(?:'ve| have|'ll| will) (attached|enclosed|sent|share[d]?|include[d]?)|one[- ]?pager|media[- ]?kit|deck|slide[- ]?deck|pitch deck|hop on|jump on|(schedule|set ?up|arrange) a (call|meeting|zoom)|calendar|calendly|cal\.com|linkedin|our (portfolio|case stud))/i;

export async function draftNegotiationReply(input: DraftInput): Promise<DraftResult> {
  const { settings, thread, authorName, publication, ceiling, floor, lastIntent } = input;
  const first = (authorName || "there").trim().split(/\s+/)[0] || "there";
  const signer = input.senderName || "the team";
  const product = input.productName || "our product";
  const usCount = thread.filter((m) => m.from === "us").length;
  const overLength = usCount >= settings.max_thread_length;
  const theirPrice = input.theirPrice ?? null;

  // Policy closing 1: they said no. Nothing to negotiate; a polite, fixed sign-off.
  if (lastIntent === "hard_no" || lastIntent === "unsubscribe") {
    return { body: sanitizeBody(`Hi ${first},\n\nTotally understand, thanks for letting me know and no worries at all. I will not follow up. Wishing you well.\n\nBest,\n${signer}`), suggestedOffer: null, shouldStop: true, statusHint: "declined", engine: "policy", llm: null };
  }
  // Policy closing 2: they accepted a price inside our bounds. Confirm at THEIR number.
  if (lastIntent === "accept" && theirPrice != null && theirPrice >= floor && (ceiling == null || theirPrice <= ceiling)) {
    return { body: sanitizeBody(`Hi ${first},\n\nPerfect, ${settings.currency} ${theirPrice} works. I'll follow up shortly with a short blurb and everything you need from our side. Thanks ${first}, glad to be included.\n\nBest,\n${signer}`), suggestedOffer: theirPrice, shouldStop: true, statusHint: "agreed", engine: "policy", llm: null };
  }
  if (lastIntent === "accept" && theirPrice == null) {
    let lastKnownPrice: number | null = null;
    for (let i = thread.length - 1; i >= 0; i--) { const m = thread[i].body.match(/\$\s?(\d[\d,]{1,6})/); if (m) { lastKnownPrice = Number(m[1].replace(/,/g, "")); break; } }
    if (lastKnownPrice != null && lastKnownPrice >= floor && (ceiling == null || lastKnownPrice <= ceiling)) {
      return { body: sanitizeBody(`Hi ${first},\n\nPerfect, ${settings.currency} ${lastKnownPrice} works. I'll follow up shortly with a short blurb and everything you need from our side. Thanks ${first}, glad to be included.\n\nBest,\n${signer}`), suggestedOffer: lastKnownPrice, shouldStop: true, statusHint: "agreed", engine: "policy", llm: null };
    }
    return { body: sanitizeBody(`Hi ${first},\n\nGreat, glad it works! Just to confirm, could you let me know your rate for this placement so I can get things moving on our end?\n\nBest,\n${signer}`), suggestedOffer: null, shouldStop: false, statusHint: "negotiating", engine: "policy", llm: null };
  }
  // Policy closing 3: thread too long. Wind down rather than nag.
  if (overLength) {
    return { body: sanitizeBody(`Hi ${first},\n\nThanks for the back-and-forth, I think we've explored this enough for now. I'll keep the door open and check in if things change on our end. Wishing you well.\n\nBest,\n${signer}`), suggestedOffer: null, shouldStop: true, statusHint: "stalled", engine: "policy", llm: null };
  }

  const convo = thread.map((m) => `${m.from === "us" ? "US" : (publication || "THEM").toUpperCase()}: ${m.body}`).join("\n\n===\n\n");
  const aggr = AGGRESSION[settings.aggressiveness] ?? AGGRESSION.balanced;
  const priceGuidance = ceiling == null
    ? `This site is below our paid tiers, so DO NOT offer or mention money. Push for a free or editorial inclusion only.`
    : theirPrice == null
      ? `We have NOT heard their pricing yet, so DO NOT propose, name, or hint at any amount. Naturally ASK what they typically charge for this kind of placement. (Internal cap, NEVER reveal: ${settings.currency} ${ceiling}.)`
      : `They named ${settings.currency} ${theirPrice}. You may go up to ${settings.currency} ${ceiling} MAXIMUM, never more, and never below ${settings.currency} ${floor}. If their number is at or under the cap, negotiate gently DOWN from it; if above, counter down toward the cap without exceeding it. ${aggr} ${settings.anti_highball}`;
  const assist = input.assistInput?.trim();
  const assistBlock = assist ? `\nASSIST CONTEXT (human-provided, real, safe to quote verbatim): ${assist}\nUse it to answer the writer's request truthfully.\n` : "";

  // A counter-offer against a named price is the one place "serious reasoning" pays: Ultra, capped.
  const useUltra = theirPrice != null && (input.ultraCallsUsed ?? 0) < NEGOTIATION_ULTRA_CAP;
  const model = useUltra ? MODELS.negotiation : MODELS.negotiation_fallback;

  const r = await nebiusText({
    role: "negotiation", model, thinking: true, max_tokens: 3000, temperature: 0.4, timeout_ms: 60_000,
    messages: [
      { role: "system", content: `You are negotiating on behalf of ${product} via email. Write ONLY the next email body (a reply in an ongoing thread, so do not re-introduce yourself fully).` },
      { role: "user", content: `NEGOTIATION BRIEF (obey): ${settings.handbook}
TONE: ${settings.tone}
PRICING: ${priceGuidance}
${assistBlock}
HARD RULES:
- Start with "Hi ${first},". End with "Best,\n${signer}".
- ${settings.style_rules}
- 2 to 5 sentences. Human, specific, not pushy.
- Never promise anything above the ${settings.currency} ${ceiling ?? 0} ceiling or below ${settings.currency} ${floor}.
- Never promise to attach or send a file, share a LinkedIn or calendar link, schedule a call, or state a specific traffic/turnaround/exclusivity fact, UNLESS it is in an ASSIST CONTEXT block above.

CONVERSATION SO FAR:
${convo}

After the email, on a NEW last line, output exactly: <<META offer=NUMBER_OR_none status=negotiating|agreed|declined|stalled>>` },
    ],
  });
  let body = r.text;
  let suggestedOffer: number | null = null;
  let statusHint: DraftResult["statusHint"] = "negotiating";
  const meta = body.match(/<<META\s+offer=(\S+)\s+status=(\w+)\s*>>/i);
  if (meta) {
    body = body.slice(0, meta.index).trim();
    if (!/^none$/i.test(meta[1])) { const n = Number(meta[1].replace(/[^\d.]/g, "")); if (!isNaN(n)) suggestedOffer = n; }
    if (["negotiating", "agreed", "declined", "stalled"].includes(meta[2].toLowerCase())) statusHint = meta[2].toLowerCase() as any;
  }
  // Code owns the numbers: clamp whatever the model said.
  if (suggestedOffer != null && ceiling != null) suggestedOffer = Math.min(suggestedOffer, ceiling);
  if (suggestedOffer != null) suggestedOffer = Math.max(suggestedOffer, floor);
  // The model may only declare "agreed" at a price inside bounds that the editor actually named.
  if (statusHint === "agreed" && !(theirPrice != null && theirPrice >= floor && (ceiling == null || theirPrice <= ceiling))) statusHint = "negotiating";
  body = sanitizeBody(body);
  if (!assist && FABRICATION_RE.test(body)) {
    return { body: "", suggestedOffer: null, shouldStop: true, statusHint: "stalled", needsHuman: true, interventionType: "other", interventionAsk: "reply would require an asset/call/link the AI cannot provide", engine: "model", llm: r.meta };
  }
  return { body, suggestedOffer, shouldStop: statusHint !== "negotiating", statusHint, engine: "model", llm: r.meta };
}
