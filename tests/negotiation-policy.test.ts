// Code-owned negotiation rules: the strong-cue escalations, and the three policy closings that
// never call a model. Everything else in agent.ts requires Nebius and is covered by the ledger run.
import { describe, it, expect } from "vitest";
import { strongCue, draftNegotiationReply, sanitizeBody } from "@/lib/negotiation/agent";
import { maxOfferFor } from "@/lib/negotiation/pricing";
import { DEFAULT_NEGOTIATION_SETTINGS } from "@/lib/negotiation/settings";

describe("strongCue (deterministic escalations)", () => {
  it.each([
    ["can we hop on a quick 15-minute call?", "sync_contact"],
    ["send me the NDA and we can proceed", "legal_contract"],
    ["please share an invoice with your VAT number", "payment_details"],
    ["what's your monthly traffic and is the link do-follow?", "factual_question"],
    ["we only do retainer deals, $500 per month", "over_policy"],
    ["see the attached rate card", "inbound_attachment"],
  ])("%s → %s", (text, type) => { expect(strongCue(text.toLowerCase())?.type).toBe(type); });
  it("a plain price counter trips no cue", () => { expect(strongCue("our rate is $280 for a feature")).toBeNull(); });
});

describe("policy closings (no model call)", () => {
  const base = { settings: DEFAULT_NEGOTIATION_SETTINGS, thread: [{ from: "us" as const, body: "hi" }], authorName: "Sarah Mitchell", publication: "x", ceiling: 250, floor: 0, senderName: "Abdullah" };
  it("hard no → polite decline, engine=policy", async () => {
    const d = await draftNegotiationReply({ ...base, lastIntent: "hard_no" });
    expect(d.engine).toBe("policy"); expect(d.statusHint).toBe("declined"); expect(d.body).toMatch(/^Hi Sarah,/);
  });
  it("accept at an in-bounds price → agreed at THEIR number", async () => {
    const d = await draftNegotiationReply({ ...base, lastIntent: "accept", theirPrice: 120 });
    expect(d.statusHint).toBe("agreed"); expect(d.suggestedOffer).toBe(120); expect(d.engine).toBe("policy");
  });
  it("accept with no price on record → asks for the rate, stays negotiating", async () => {
    const d = await draftNegotiationReply({ ...base, lastIntent: "accept", theirPrice: null });
    expect(d.statusHint).toBe("negotiating"); expect(d.suggestedOffer).toBeNull();
  });
  it("thread over max length → winds down, stalled", async () => {
    const thread = Array.from({ length: DEFAULT_NEGOTIATION_SETTINGS.max_thread_length }, () => ({ from: "us" as const, body: "x" }));
    const d = await draftNegotiationReply({ ...base, thread, lastIntent: "interested" });
    expect(d.statusHint).toBe("stalled"); expect(d.engine).toBe("policy");
  });
});

describe("pricing tiers + sanitizer", () => {
  it("unverified metrics never fail a tier; DR below every tier → no paid offer", () => {
    const rules = [{ min_dr: 50, min_traffic: 10000, max_offer: 250 }];
    expect(maxOfferFor(60, null, null, rules)?.offer).toBe(250);
    expect(maxOfferFor(31, null, null, rules)).toBeNull();
    expect(maxOfferFor(null, null, null, rules)?.offer).toBe(250);
  });
  it("sanitizeBody removes em dashes and tidies whitespace", () => {
    expect(sanitizeBody("Hi — thanks  for this\n\n\n\nBest")).toBe("Hi, thanks for this\n\nBest");
  });
});
