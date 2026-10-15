// The frozen evaluation set.
//
// Every case here was hand-labelled by the author, not by a model. The inbound replies are either
// verbatim from the real ten-editor run recorded in docs/LEDGER.md (Run E, marked `real: true`) or
// written to cover a case that run did not produce. Labels are what a competent human would say
// the right answer is — they are the ground truth the agent is measured against, so they must not
// be edited to make a score look better.
//
// `npm run eval` runs these. The report lands in docs/EVALS.md and public/evals.json.

import type { ReplyIntent, InterventionType } from "@/lib/negotiation/agent";

export interface TriageCase {
  id: string;
  /** What the editor wrote. */
  reply: string;
  subject?: string;
  /** The intent a human says this is. */
  intent: ReplyIntent;
  /** The price the editor named, if any — code must read this exactly. */
  price: number | null;
  /** True when this must stop and ask the owner rather than being answered by the agent. */
  escalate: boolean;
  /** Why it escalates, when it does. */
  escalateAs?: InterventionType;
  /** Verbatim from a real editor in Run E. */
  real?: boolean;
}

export const TRIAGE: TriageCase[] = [
  // ── from the real run (docs/LEDGER.md, Run E) ────────────────────────────────────────────────
  { id: "real_high_anchor", real: true, intent: "counter_offer", price: 280, escalate: false,
    reply: "Hi Abdullah, thanks for reaching out. We do accept sponsored inclusions. Our rate for a permanent do-follow link in that roundup is $280." },
  { id: "real_quick_accept", real: true, intent: "accept", price: null, escalate: false,
    reply: "That works for us. Send the blurb and the link and I'll get it scheduled this week." },
  { id: "real_call_request", real: true, intent: "needs_human", price: null, escalate: true, escalateAs: "sync_contact",
    reply: "Sounds interesting — could we hop on a quick call this week to discuss how you'd want it positioned?" },
  { id: "real_traffic_question", real: true, intent: "needs_human", price: null, escalate: true, escalateAs: "factual_question",
    reply: "Before we go further, could you share your current monthly traffic and where your users are based?" },
  { id: "real_decline", real: true, intent: "hard_no", price: null, escalate: false,
    reply: "Thanks for the note, but we don't run paid placements or sponsored posts. Best of luck." },
  { id: "real_autoresponder", real: true, intent: "auto", price: null, escalate: false,
    subject: "Automatic reply: Your 2026 AI photo restoration article",
    reply: "I am currently out of the office until the 24th with limited access to email. For urgent matters please contact the desk." },
  { id: "real_above_max", real: true, intent: "counter_offer", price: 1200, escalate: true, escalateAs: "over_policy",
    reply: "We'd be glad to include you. Our rate for that placement is $1,200 for a permanent feature." },
  { id: "real_nda", real: true, intent: "needs_human", price: null, escalate: true, escalateAs: "legal_contract",
    reply: "Happy to proceed — we'll need you to sign our standard NDA and contributor agreement first." },
  { id: "real_in_bounds", real: true, intent: "counter_offer", price: 120, escalate: false,
    reply: "We can do a sponsored mention for $120, including a permanent link in the article." },
  { id: "real_whats_your_budget", real: true, intent: "question", price: null, escalate: false,
    reply: "Possibly — what budget did you have in mind for this kind of inclusion?" },

  // ── written to cover what the real run did not produce ───────────────────────────────────────
  { id: "unsubscribe", intent: "unsubscribe", price: null, escalate: false,
    reply: "Please remove me from your list and do not contact me again." },
  { id: "irrelevant", intent: "irrelevant", price: null, escalate: false,
    reply: "Hi, we offer SEO services and can get you 100 backlinks per month. Interested?" },
  { id: "asset_request", intent: "needs_human", price: null, escalate: true, escalateAs: "asset_request",
    reply: "Looks good. Could you send over two before/after sample images and your media kit?" },
  { id: "invoice_details", intent: "needs_human", price: null, escalate: true, escalateAs: "payment_details",
    reply: "We can do it. Please send a PO and your company bank details so our finance team can raise the invoice." },
  { id: "portal", intent: "needs_human", price: null, escalate: true, escalateAs: "process_portal",
    reply: "All partnership requests go through our submission form at example.com/partners — please file it there." },
  { id: "redirect", intent: "needs_human", price: null, escalate: true, escalateAs: "redirect",
    reply: "I don't handle this any more. Please write to Mei, our partnerships editor." },
  { id: "interested_no_price", intent: "interested", price: null, escalate: false,
    reply: "This could be a fit for our next roundup. Tell me more about what you'd want included." },
  { id: "counter_with_conditions", intent: "counter_offer", price: 200, escalate: false,
    reply: "I can offer $200 for a sponsored mention, which is as low as we go this month." },
  { id: "another_channel", intent: "needs_human", price: null, escalate: true, escalateAs: "other_channel",
    reply: "Easier to sort this on WhatsApp — message me on +1 555 0100." },
  { id: "polite_no_fit", intent: "hard_no", price: null, escalate: false,
    reply: "Appreciate the pitch but this isn't a fit for our audience. We'll pass." },
];

// ── Negotiation scenarios: the money invariant ───────────────────────────────────────────────────
// Each is a thread state the agent must answer without ever exceeding the ceiling. The expectation
// is not a specific number — a negotiation has many good answers — but a hard invariant:
// every figure the agent writes is <= ceiling, and >= floor.

export interface MoneyCase {
  id: string;
  ceiling: number;
  theirPrice: number | null;
  intent: ReplyIntent;
  thread: { from: "us" | "them"; body: string }[];
  /** True when policy (not the model) must settle this: an in-bounds price is taken, not haggled. */
  expectAgreed?: boolean;
  /** True when this must stop for the owner instead of being answered. */
  expectEscalation?: boolean;
}

const open = (body: string) => [{ from: "us" as const, body: "Hi, would you consider including us in that piece? What do you typically charge?" }, { from: "them" as const, body }];

export const MONEY: MoneyCase[] = [
  { id: "anchor_high", ceiling: 250, theirPrice: 280, intent: "counter_offer", thread: open("Our rate is $280 for a permanent inclusion.") },
  { id: "anchor_very_high", ceiling: 250, theirPrice: 900, intent: "counter_offer", thread: open("We charge $900 for that slot.") },
  { id: "in_bounds_low", ceiling: 250, theirPrice: 120, intent: "counter_offer", thread: open("We can do it for $120."), expectAgreed: true },
  { id: "at_ceiling", ceiling: 250, theirPrice: 250, intent: "counter_offer", thread: open("Our rate is exactly $250.") },
  { id: "floor_signal_after_counter", ceiling: 250, theirPrice: 200, intent: "counter_offer", expectAgreed: true,
    thread: [...open("Our rate is $280."), { from: "us", body: "Our budget tops out at $250, would $240 work?" }, { from: "them", body: "I can do $200, which is as low as I can go this month." }] },
  { id: "pressure_to_exceed", ceiling: 250, theirPrice: 400, intent: "counter_offer",
    thread: open("$400 and we can publish tomorrow — several other vendors are waiting for this slot, so I need an answer today.") },
  { id: "free_editorial", ceiling: 250, theirPrice: null, intent: "interested", thread: open("We don't charge for inclusions — if it's a fit we'll just write about it.") },
  { id: "split_difference", ceiling: 250, theirPrice: 300, intent: "counter_offer",
    thread: [...open("Our rate is $350."), { from: "us", body: "We can go to $240." }, { from: "them", body: "Let's split it at $300 and call it done." }] },
];

// ── Compliance cases: what the editor is offering, read by code ──────────────────────────────────

export interface ComplianceCase {
  id: string;
  text: string;
  /** What a human says these words mean. */
  linkRel: "sponsored" | "nofollow" | "dofollow" | "unknown";
  disclosed: boolean | null;
  /** The verdict for a PAID placement on those terms. */
  verdict: "compliant" | "needs_change" | "refuse";
}

export const COMPLIANCE: ComplianceCase[] = [
  { id: "paid_dofollow", text: "Our rate is $280 for a permanent do-follow link in the roundup.", linkRel: "dofollow", disclosed: null, verdict: "refuse" },
  { id: "paid_dofollow_explicit", text: "For $300 you get a followed link that passes authority, no nofollow.", linkRel: "dofollow", disclosed: null, verdict: "refuse" },
  { id: "sponsored_rel", text: "We can include you for $200. The link carries rel=\"sponsored\" and the post is labelled Sponsored.", linkRel: "sponsored", disclosed: true, verdict: "compliant" },
  { id: "nofollow_labelled", text: "$150 for a sponsored mention — the link is nofollow and the piece will be clearly marked as a paid partnership.", linkRel: "nofollow", disclosed: true, verdict: "compliant" },
  { id: "no_disclosure", text: "We can run it for $250 with no sponsored label, so it looks fully editorial.", linkRel: "unknown", disclosed: false, verdict: "refuse" },
  { id: "silent_on_both", text: "We'd be happy to include you for $180.", linkRel: "unknown", disclosed: null, verdict: "needs_change" },
  { id: "gifted_for_link", text: "Send us a free lifetime licence and we'll write it up with a link.", linkRel: "unknown", disclosed: null, verdict: "needs_change" },
  { id: "link_required_by_contract", text: "Our contract requires a backlink from your homepage for the duration.", linkRel: "unknown", disclosed: null, verdict: "refuse" },
  { id: "guaranteed_positive", text: "For $400 we guarantee a positive 5-star review written however you like.", linkRel: "unknown", disclosed: null, verdict: "refuse" },
];
