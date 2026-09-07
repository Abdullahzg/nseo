import { describe, it, expect } from "vitest";
import { classifyReplyIntent, draftNegotiationReply } from "@/lib/negotiation/agent";
import { maxOfferFor } from "@/lib/negotiation/pricing";
import type { NegotiationSettings } from "@/lib/negotiation/settings";

// ═══════════════════════════════════════════════════════════════════════════════
// NEGOTIATION EVALUATION — 30+ TEST CASES
// Tests the full negotiation pipeline: pricing, thread management, intervention
// routing, and deal outcomes. Run WITHOUT LLM key for deterministic behavior.
// When LLM is absent, draftNegotiationReply returns null for non-deterministic paths.
// ═══════════════════════════════════════════════════════════════════════════════

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

// ─── PRICING TIERS ──────────────────────────────────────────────────────────
describe("Pricing Tiers", () => {
  const rules = [
    { min_dr: 50, min_traffic: 10000, min_us_share: 50, max_offer: 150, label: "t1" },
    { min_dr: 70, max_offer: 300, label: "t2" },
  ];

  it("01: picks highest qualifying tier", () => {
    const r = maxOfferFor(75, 50000, 80, rules);
    expect(r?.offer).toBe(300);
  });

  it("02: picks lower tier when only that qualifies", () => {
    const r = maxOfferFor(55, 20000, 60, rules);
    expect(r?.offer).toBe(150);
  });

  it("03: unverified traffic doesn't fail threshold", () => {
    const r = maxOfferFor(60, null, null, rules);
    expect(r?.offer).toBe(150);
  });

  it("04: verified below threshold fails tier", () => {
    const r = maxOfferFor(60, 1000, 20, rules);
    expect(r?.offer).toBeUndefined();
  });

  it("05: returns null below every tier → placement-only", () => {
    const r = maxOfferFor(30, null, null, rules);
    expect(r).toBeNull();
  });

  it("06: no rules → null (placement-only)", () => {
    const r = maxOfferFor(80, 100000, 90, []);
    expect(r).toBeNull();
  });
});

// ─── REPLY INTENT CLASSIFICATION (via LLM if available) ─────────────────────
describe("Reply Intent Classification (LLM or heuristic)", () => {
  it("07: call request → needs_human/sync_contact", async () => {
    const r = await classifyReplyIntent("Can you jump on a call Wednesday at 2?");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("sync_contact");
  });

  it("08: WhatsApp → needs_human/other_channel", async () => {
    const r = await classifyReplyIntent("Let's continue on WhatsApp.");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("other_channel");
  });

  it("09: NDA → needs_human/legal_contract", async () => {
    const r = await classifyReplyIntent("We need you to sign our NDA.");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("legal_contract");
  });

  it("10: price counter → counter_offer", async () => {
    const r = await classifyReplyIntent("We can do it for $350.");
    expect(r.intent).toBe("counter_offer");
    expect(r.priceMentioned).toBe(350);
  });

  it("11: unsubscribe wins over price", async () => {
    const r = await classifyReplyIntent("Unsubscribe me. But $100 is too low.");
    expect(r.intent).toBe("unsubscribe");
  });

  it("12: asset request → needs_human/asset_request", async () => {
    const r = await classifyReplyIntent("Please send your media kit and logo.");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("asset_request");
    expect(r.assistable).toBe(true);
  });
});

// ─── NEGOTIATION REPLY DRAFTING ─────────────────────────────────────────────
describe("Negotiation Reply Drafting", () => {
  it("13: hard no → stop, decline", async () => {
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

  it("14: accept at their price within ceiling", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [],
      authorName: "J",
      publication: "P",
      ceiling: 240,
      floor: 50,
      lastIntent: "accept",
      theirPrice: 230,
      senderName: "A",
    });
    expect(d!.statusHint).toBe("agreed");
    expect(d!.suggestedOffer).toBe(230);
    expect(d!.body).toContain("230");
  });

  it("15: does NOT accept above ceiling → counter or null", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "them", body: "$400" }],
      authorName: "J",
      publication: "P",
      ceiling: 240,
      floor: 50,
      lastIntent: "counter_offer",
      theirPrice: 400,
      senderName: "A",
    });
    // Without LLM, returns null rather than fabricating a counter
    expect(d === null || d.statusHint !== "agreed").toBe(true);
  });

  it("16: closes at opening percent when no number given", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [],
      authorName: "J",
      publication: "P",
      ceiling: 200,
      floor: 50,
      lastIntent: "accept",
      theirPrice: null,
      senderName: "A",
    });
    expect(d!.statusHint).toBe("agreed");
    // opening_percent 40 → floor + (ceiling-floor)*0.4 = 110
    expect(d!.suggestedOffer).toBe(110);
  });

  it("17: unsubscribe → stop, decline", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "us", body: "hi" }, { from: "them", body: "unsubscribe me" }],
      authorName: "J",
      publication: "P",
      ceiling: 200,
      floor: 50,
      lastIntent: "unsubscribe",
      theirPrice: null,
      senderName: "A",
    });
    expect(d!.shouldStop).toBe(true);
    expect(d!.statusHint).toBe("declined");
  });

  it("18: auto-responder → null (no deterministic path)", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [],
      authorName: "J",
      publication: "P",
      ceiling: 200,
      floor: 50,
      lastIntent: "auto",
      theirPrice: null,
      senderName: "A",
    });
    // Without LLM, auto intent returns null
    expect(d).toBeNull();
  });

  it("19: question → null (needs LLM to answer)", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "them", body: "What kind of content are you looking for?" }],
      authorName: "J",
      publication: "P",
      ceiling: 200,
      floor: 50,
      lastIntent: "question",
      theirPrice: null,
      senderName: "A",
    });
    // Without LLM, question intent returns null
    expect(d).toBeNull();
  });

  it("20: interested → null (needs LLM to draft opening)", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "them", body: "This sounds interesting!" }],
      authorName: "J",
      publication: "P",
      ceiling: 200,
      floor: 50,
      lastIntent: "interested",
      theirPrice: null,
      senderName: "A",
    });
    // Without LLM, interested intent returns null
    expect(d).toBeNull();
  });

  it("21: counter below floor → null (needs LLM)", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "them", body: "$30" }],
      authorName: "J",
      publication: "P",
      ceiling: 200,
      floor: 50,
      lastIntent: "counter_offer",
      theirPrice: 30,
      senderName: "A",
    });
    // Without LLM, counter_offer returns null
    expect(d).toBeNull();
  });

  it("22: counter between floor and ceiling → null (needs LLM)", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "them", body: "$180" }],
      authorName: "J",
      publication: "P",
      ceiling: 250,
      floor: 50,
      lastIntent: "counter_offer",
      theirPrice: 180,
      senderName: "A",
    });
    expect(d).toBeNull();
  });

  it("23: counter at ceiling → null (needs LLM to accept/counter)", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "them", body: "$250" }],
      authorName: "J",
      publication: "P",
      ceiling: 250,
      floor: 50,
      lastIntent: "counter_offer",
      theirPrice: 250,
      senderName: "A",
    });
    // Without LLM, counter_offer returns null
    expect(d).toBeNull();
  });

  it("24: counter above ceiling → null (needs LLM to counter)", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "them", body: "$500" }],
      authorName: "J",
      publication: "P",
      ceiling: 250,
      floor: 50,
      lastIntent: "counter_offer",
      theirPrice: 500,
      senderName: "A",
    });
    expect(d).toBeNull();
  });

  it("25: thread length exceeded → null (needs LLM for winding down)", async () => {
    const longThread = Array(8).fill({ from: "us", body: "hi" });
    const d = await draftNegotiationReply({
      settings: { ...settings, max_thread_length: 4 },
      thread: longThread,
      authorName: "J",
      publication: "P",
      ceiling: 200,
      floor: 50,
      lastIntent: "interested",
      theirPrice: null,
      senderName: "A",
    });
    // Without LLM, interested intent returns null even with overLength
    expect(d).toBeNull();
  });

  it("26: no ceiling → placement only, no dollar offer", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "them", body: "Sounds good" }],
      authorName: "J",
      publication: "P",
      ceiling: null,
      floor: 50,
      lastIntent: "interested",
      theirPrice: null,
      senderName: "A",
    });
    // Without LLM, returns null for interested intent
    expect(d).toBeNull();
  });

  it("27: aggressive pricing (firm) → null (needs LLM)", async () => {
    const d = await draftNegotiationReply({
      settings: { ...settings, aggressiveness: "firm" },
      thread: [{ from: "them", body: "$300" }],
      authorName: "J",
      publication: "P",
      ceiling: 250,
      floor: 50,
      lastIntent: "counter_offer",
      theirPrice: 300,
      senderName: "A",
    });
    expect(d).toBeNull();
  });

  it("28: gentle pricing → null (needs LLM)", async () => {
    const d = await draftNegotiationReply({
      settings: { ...settings, aggressiveness: "gentle", opening_percent: 20 },
      thread: [],
      authorName: "J",
      publication: "P",
      ceiling: 200,
      floor: 50,
      lastIntent: "interested",
      theirPrice: null,
      senderName: "A",
    });
    expect(d).toBeNull();
  });

  it("29: needs_human → null (no deterministic path)", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "them", body: "Can you hop on a call?" }],
      authorName: "J",
      publication: "P",
      ceiling: 200,
      floor: 50,
      lastIntent: "needs_human",
      theirPrice: null,
      senderName: "A",
    });
    // Without LLM, needs_human intent returns null
    expect(d).toBeNull();
  });

  it("30: multiple prices → null (needs LLM)", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [
        { from: "them", body: "$500" },
        { from: "us", body: "too high" },
        { from: "them", body: "ok $200" },
      ],
      authorName: "J",
      publication: "P",
      ceiling: 250,
      floor: 50,
      lastIntent: "counter_offer",
      theirPrice: 200,
      senderName: "A",
    });
    expect(d).toBeNull();
  });

  it("31: accept with no prior thread → opening offer", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [],
      authorName: "J",
      publication: "P",
      ceiling: 200,
      floor: 50,
      lastIntent: "accept",
      theirPrice: null,
      senderName: "A",
    });
    expect(d!.statusHint).toBe("agreed");
    expect(d!.suggestedOffer).toBeDefined();
  });

  it("32: counter at floor → null (needs LLM to accept)", async () => {
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "them", body: "$50" }],
      authorName: "J",
      publication: "P",
      ceiling: 200,
      floor: 50,
      lastIntent: "counter_offer",
      theirPrice: 50,
      senderName: "A",
    });
    // Without LLM, counter_offer returns null
    expect(d).toBeNull();
  });
});

// ─── INTEGRATION: CLASSIFY + DRAFT ──────────────────────────────────────────
describe("Integration: Classify → Draft", () => {
  it("33: interested reply → null (needs LLM to draft)", async () => {
    const cls = await classifyReplyIntent("This sounds great! We're interested.");
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "us", body: "hi" }, { from: "them", body: "This sounds great!" }],
      authorName: "J",
      publication: "P",
      ceiling: 200,
      floor: 50,
      lastIntent: cls.intent,
      theirPrice: cls.priceMentioned,
      senderName: "A",
    });
    // Without LLM, interested → null
    expect(d).toBeNull();
  });

  it("34: counter offer → null (needs LLM to counter)", async () => {
    const cls = await classifyReplyIntent("We can do it for $150.");
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "us", body: "hi" }, { from: "them", body: "$150" }],
      authorName: "J",
      publication: "P",
      ceiling: 200,
      floor: 50,
      lastIntent: cls.intent,
      theirPrice: cls.priceMentioned,
      senderName: "A",
    });
    // Without LLM, counter_offer → null
    expect(d).toBeNull();
  });

  it("35: hard no → draft polite close", async () => {
    const cls = await classifyReplyIntent("Not interested, thanks.");
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "us", body: "hi" }, { from: "them", body: "Not interested" }],
      authorName: "J",
      publication: "P",
      ceiling: 200,
      floor: 50,
      lastIntent: cls.intent,
      theirPrice: cls.priceMentioned,
      senderName: "A",
    });
    expect(d!.shouldStop).toBe(true);
    expect(d!.statusHint).toBe("declined");
  });

  it("36: unsubscribe → draft goodbye and stop", async () => {
    const cls = await classifyReplyIntent("Please unsubscribe me.");
    const d = await draftNegotiationReply({
      settings,
      thread: [{ from: "us", body: "hi" }, { from: "them", body: "unsubscribe" }],
      authorName: "J",
      publication: "P",
      ceiling: 200,
      floor: 50,
      lastIntent: cls.intent,
      theirPrice: cls.priceMentioned,
      senderName: "A",
    });
    expect(d!.shouldStop).toBe(true);
  });
});
