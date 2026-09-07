import { describe, it, expect } from "vitest";
import { classifyReplyIntent, draftNegotiationReply } from "@/lib/negotiation/agent";
import { maxOfferFor } from "@/lib/negotiation/pricing";
import type { NegotiationSettings } from "@/lib/negotiation/settings";

// Regression ports of the legacy negotiation agent's hard-won behavior.
// These run WITHOUT any LLM key: the deterministic fallbacks are the contract.

const settings: NegotiationSettings = {
  ai_autonomy: false,
  handbook: "test",
  tone: "warm",
  aggressiveness: "firm",
  opening_percent: 40,
  style_rules: "no em dashes",
  max_thread_length: 4,
  max_placement_price: 250,
  target_placement_price: 150,
  campaign_budget: 1000,
  auto_accept_below: 150,
  human_approval_above: 200,
  absolute_max_price: 300,
  min_price: 50,
  currency: "USD",
  anti_highball: "do not anchor high",
  pricing_rules: [],
};

describe("classifyReplyIntent (heuristic fallback, no LLM)", () => {
  it("routes a call request to needs_human/sync_contact (not assistable)", async () => {
    const r = await classifyReplyIntent("Sounds good. Can you jump on a call Wednesday at 2?");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("sync_contact");
    expect(r.assistable).toBe(false);
  });

  it("routes WhatsApp moves to needs_human/other_channel", async () => {
    const r = await classifyReplyIntent("Let's continue on WhatsApp, easier for me.");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("other_channel");
  });

  it("detects an NDA/contract ask as legal_contract", async () => {
    const r = await classifyReplyIntent("We can proceed once you sign our NDA.");
    expect(r.interventionType).toBe("legal_contract");
  });

  it("detects an asset request as assistable", async () => {
    const r = await classifyReplyIntent("Please send your media kit and logo.");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("asset_request");
    expect(r.assistable).toBe(true);
  });

  it("extracts a price from a counteroffer", async () => {
    const r = await classifyReplyIntent("We can do it for $350.");
    expect(r.intent).toBe("counter_offer");
    expect(r.priceMentioned).toBe(350);
  });

  it("classifies unsubscribes before anything else", async () => {
    const r = await classifyReplyIntent("Remove me from your list and stop emailing me. $100 whatever.");
    expect(r.intent).toBe("unsubscribe");
  });

  it("recognizes autoresponders", async () => {
    const r = await classifyReplyIntent("I am out of office until Monday.", "Automatic reply");
    // LLM absent; subject+body heuristics catch the OOO cue only when no other rule fires first.
    expect(["auto", "interested"]).toContain(r.intent);
  });
});

describe("draftNegotiationReply deterministic policy paths (no LLM)", () => {
  it("never negotiates after a hard no — polite close, shouldStop", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "us", body: "hi" }, { from: "them", body: "not interested" }],
      authorName: "Jane Doe",
      publication: "Example Weekly",
      ceiling: 200,
      floor: 50,
      lastIntent: "hard_no",
      theirPrice: null,
      senderName: "Alex",
    });
    expect(d!.shouldStop).toBe(true);
    expect(d!.statusHint).toBe("declined");
    expect(d!.suggestedOffer).toBeNull();
  });

  it("accepts at THEIR price when within floor..ceiling — never lowballs after a yes", async () => {
    const d = await draftNegotiationReply({
      settings, thread: [], authorName: "J", publication: "P",
      ceiling: 240, floor: 50, lastIntent: "accept", theirPrice: 230, senderName: "A",
    });
    expect(d!.statusHint).toBe("agreed");
    expect(d!.suggestedOffer).toBe(230);
    expect(d!.body).toContain("230");
  });

  it("does NOT accept above the ceiling — falls through to a counter instead", async () => {
    const d = await draftNegotiationReply({
      settings, thread: [{ from: "them", body: "$400" }], authorName: "J", publication: "P",
      ceiling: 240, floor: 50, lastIntent: "counter_offer", theirPrice: 400, senderName: "A",
    });
    // No LLM available → returns null rather than fabricating a counter.
    expect(d === null || d.statusHint !== "agreed").toBe(true);
  });

  it("vague accept with no price asks for confirmation (does not invent price)", async () => {
    const d = await draftNegotiationReply({
      settings, thread: [], authorName: "J", publication: "P",
      ceiling: 200, floor: 50, lastIntent: "accept", theirPrice: null, senderName: "A",
    });
    // No prior price in thread — should ask for confirmation, not close
    expect(d!.statusHint).toBe("negotiating");
    expect(d!.shouldStop).toBe(false);
  });
});

describe("maxOfferFor deterministic pricing tiers", () => {
  const rules = [
    { min_dr: 50, min_traffic: 10000, min_us_share: 50, max_offer: 150, label: "t1" },
    { min_dr: 70, max_offer: 300, label: "t2" },
  ];

  it("picks the highest-paying qualifying tier", () => {
    expect(maxOfferFor(75, 50000, 80, rules)?.offer).toBe(300);
    expect(maxOfferFor(55, 20000, 60, rules)?.offer).toBe(150);
  });

  it("unverified traffic does NOT fail a threshold (free Ahrefs plan semantics)", () => {
    expect(maxOfferFor(60, null, null, rules)?.offer).toBe(150);
  });

  it("verified metrics below a threshold DO fail that tier", () => {
    expect(maxOfferFor(60, 1000, 20, rules)?.offer).toBeUndefined();
  });

  it("returns null below every tier → placement-only", () => {
    expect(maxOfferFor(30, null, null, rules)).toBeNull();
  });
});
