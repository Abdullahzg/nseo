// Code-owned negotiation rules: the strong-cue escalations, and the three policy closings that
// never call a model. Everything else in agent.ts requires Nebius and is covered by the ledger run.
import { describe, it, expect } from "vitest";
import { strongCue, draftNegotiationReply, sanitizeBody, greetingName, shapeEmail } from "@/lib/negotiation/agent";
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
    ["we could include you for $220 if you send two before/after examples we can publish", "asset_request"],
  ])("%s → %s", (text, type) => { expect(strongCue(text.toLowerCase())?.type).toBe(type); });
  it("a plain price counter trips no cue", () => { expect(strongCue("our rate is $280 for a feature")).toBeNull(); });
  it("an attachment is a cue even when the model read the reply as a decline", () => {
    expect(["legal_contract", "inbound_attachment"]).toContain(strongCue("agreement attached, please sign and return. our rate is $150.")?.type);
  });
  it("stating a link type is a price term, not a question for the owner", () => {
    expect(strongCue("our rate is $140, which includes a do-follow link. shall i go ahead?")).toBeNull();
    expect(strongCue("$280 for a permanent placement with a do-follow link.")).toBeNull();
    expect(strongCue("are you expecting a do-follow link?")?.type).toBe("factual_question");
    expect(strongCue("what kind of monthly traffic does your site get")?.type).toBe("factual_question");
  });
  it("shapes a model draft: code-owned greeting, sign-off on its own lines", () => {
    expect(shapeEmail("Hi LetsEnhance, thanks for the number. $180 is high. Could we do $130? Best, Abdullah", "there")).toBe("Hi there,\n\nThanks for the number. $180 is high. Could we do $130?\n\nBest,\nAbdullah");
    expect(shapeEmail("Hi there,\n\nSure thing.\n\nBest,\nAbdullah", "Sarah")).toBe("Hi Sarah,\n\nSure thing.\n\nBest,\nAbdullah");
  });
  it("greets a person, never a site name or a generic byline", () => {
    expect(greetingName("Sarah Mitchell")).toBe("Sarah");
    expect(greetingName("yahoo.com Editorial")).toBe("there");
    expect(greetingName("Editorial Team")).toBe("there");
    expect(greetingName(null)).toBe("there");
    expect(greetingName("RestorePhotosApp", "restorephotosapp.com")).toBe("there");
    expect(greetingName("Pixels Photo Art", "pixelsphotoart.com")).toBe("there");
    expect(greetingName("Amy Lee", "everpresent.com")).toBe("Amy");
  });
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
  it("a named price at or under auto_accept_below and the ceiling → agreed at THEIR number, no model call", async () => {
    const d = await draftNegotiationReply({ ...base, lastIntent: "counter_offer", theirPrice: 120 });
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
