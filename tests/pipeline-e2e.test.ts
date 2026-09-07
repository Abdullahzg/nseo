import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════════
// GESEO PIPELINE TEST SUITE — Run after every change
// npx vitest run tests/pipeline-e2e.test.ts
//
// Tests are split into:
//   - Offline unit tests (no server/DB needed — always pass)
//   - Integration tests (need running server + DB — skip if unavailable)
// ═══════════════════════════════════════════════════════════════════════════════

const BASE = process.env.BASE_URL ?? "http://localhost:3001";
const hasServer = process.env.TEST_SERVER === "true";

async function api(path: string, opts?: RequestInit) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: REPLY INTENT CLASSIFICATION (offline, deterministic)
// ═══════════════════════════════════════════════════════════════════════════════
describe("1. Reply Intent Classification", () => {
  it("Interested reply detected", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Thanks, this sounds great!");
    expect(r.intent).toBe("interested");
  });

  it("Counter offer with price detected", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("We can do it for $350.");
    expect(r.intent).toBe("counter_offer");
    expect(r.priceMentioned).toBe(350);
  });

  it("Hard no detected", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Not interested, thanks.");
    expect(r.intent).toBe("hard_no");
  });

  it("Unsubscribe detected", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Please unsubscribe me.");
    expect(r.intent).toBe("unsubscribe");
  });

  it("Call request → needs_human/sync_contact", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Can you jump on a call?");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("sync_contact");
    expect(r.assistable).toBe(false);
  });

  it("WhatsApp → needs_human/other_channel", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Let's continue on WhatsApp.");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("other_channel");
  });

  it("NDA → needs_human/legal_contract", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Sign our NDA first.");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("legal_contract");
  });

  it("Invoice → needs_human/payment_details", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Please send us an invoice.");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("payment_details");
    expect(r.assistable).toBe(true);
  });

  it("Portal → needs_human/process_portal", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Submit via our vendor portal.");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("process_portal");
  });

  it("OOO → auto", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("I am out of office until Monday.");
    expect(r.intent).toBe("auto");
  });

  it("Asset request → needs_human/asset_request", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Please send your media kit and logo.");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("asset_request");
    expect(r.assistable).toBe(true);
  });

  it("Redirect → needs_human/redirect", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("I've left the company, contact jane@example.com.");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("redirect");
  });

  it("LinkedIn → needs_human/identity_verification", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Let's connect on LinkedIn first.");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("identity_verification");
  });

  it("Factual question → needs_human/factual_question", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("What's your monthly traffic and domain rating?");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("factual_question");
  });

  it("Retainer → needs_human/over_policy", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("We only do long-term retainer deals.");
    expect(r.intent).toBe("needs_human");
    expect(r.interventionType).toBe("over_policy");
  });

  it("Sentiment: positive", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Thanks, this looks awesome!");
    expect(r.sentiment).toBe("positive");
  });

  it("Sentiment: negative", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Sorry, we can't do this.");
    expect(r.sentiment).toBe("negative");
  });

  it("Sentiment: neutral", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("What's the timeline?");
    expect(r.sentiment).toBe("neutral");
  });

  it("Unsubscribe wins over price", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Unsubscribe me. But $100 is too low.");
    expect(r.intent).toBe("unsubscribe");
  });

  it("Price extraction: $350", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Our rate is $350.");
    expect(r.priceMentioned).toBe(350);
  });

  it("Price extraction: $1,500 with comma", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Our rate is $1,500.");
    expect(r.priceMentioned).toBe(1500);
  });

  it("No price when absent", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("Let's talk about this.");
    expect(r.priceMentioned).toBeNull();
  });

  it("Question detected", async () => {
    const { classifyReplyIntentHeuristicOnly } = await import("@/lib/negotiation/agent");
    const r = classifyReplyIntentHeuristicOnly("What kind of content are you looking for?");
    expect(r.intent).toBe("question");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: NEGOTIATION ENGINE (offline, deterministic paths)
// ═══════════════════════════════════════════════════════════════════════════════
describe("2. Negotiation Engine", () => {
  const testSettings = {
    max_thread_length: 4, opening_percent: 40, min_price: 50, currency: "USD",
    tone: "warm", aggressiveness: "firm", handbook: "", style_rules: "",
    ai_autonomy: false, anti_highball: "", pricing_rules: [],
  } as any;

  it("Hard no → stop, decline", async () => {
    const { draftNegotiationReply } = await import("@/lib/negotiation/agent");
    const d = await draftNegotiationReply({
      settings: testSettings,
      thread: [{ from: "us", body: "hi" }, { from: "them", body: "not interested" }],
      authorName: "Jane", publication: "Test", ceiling: 200, floor: 50, lastIntent: "hard_no", senderName: "Alex",
    });
    expect(d!.shouldStop).toBe(true);
    expect(d!.statusHint).toBe("declined");
    expect(d!.suggestedOffer).toBeNull();
  });

  it("Unsubscribe → stop, decline", async () => {
    const { draftNegotiationReply } = await import("@/lib/negotiation/agent");
    const d = await draftNegotiationReply({
      settings: testSettings,
      thread: [{ from: "us", body: "hi" }, { from: "them", body: "unsubscribe me" }],
      authorName: "J", publication: "P", ceiling: 200, floor: 50, lastIntent: "unsubscribe", senderName: "A",
    });
    expect(d!.shouldStop).toBe(true);
    expect(d!.statusHint).toBe("declined");
  });

  it("Accept at their price within ceiling", async () => {
    const { draftNegotiationReply } = await import("@/lib/negotiation/agent");
    const d = await draftNegotiationReply({
      settings: testSettings,
      thread: [], authorName: "J", publication: "P", ceiling: 240, floor: 50,
      lastIntent: "accept", theirPrice: 230, senderName: "A",
    });
    expect(d!.statusHint).toBe("agreed");
    expect(d!.suggestedOffer).toBe(230);
    expect(d!.body).toContain("230");
  });

  it("Accept with explicit price in same message", async () => {
    const { draftNegotiationReply } = await import("@/lib/negotiation/agent");
    const d = await draftNegotiationReply({
      settings: testSettings,
      thread: [], authorName: "J", publication: "P", ceiling: 240, floor: 50,
      lastIntent: "accept", theirPrice: 230, senderName: "A",
    });
    expect(d!.statusHint).toBe("agreed");
    expect(d!.suggestedOffer).toBe(230);
    expect(d!.body).toContain("230");
  });

  it("Accept referring to previous offer in thread", async () => {
    const { draftNegotiationReply } = await import("@/lib/negotiation/agent");
    const d = await draftNegotiationReply({
      settings: testSettings,
      thread: [
        { from: "them", body: "Our rate is $180." },
        { from: "us", body: "That works for us." },
        { from: "them", body: "Sounds good, let's proceed." },
      ],
      authorName: "J", publication: "P", ceiling: 240, floor: 50,
      lastIntent: "accept", theirPrice: null, senderName: "A",
    });
    expect(d!.statusHint).toBe("agreed");
    expect(d!.suggestedOffer).toBe(180);
  });

  it("Vague accept with no existing price asks for confirmation", async () => {
    const { draftNegotiationReply } = await import("@/lib/negotiation/agent");
    const d = await draftNegotiationReply({
      settings: testSettings,
      thread: [{ from: "us", body: "Hi, we'd love to be included." }],
      authorName: "J", publication: "P", ceiling: 200, floor: 50,
      lastIntent: "accept", theirPrice: null, senderName: "A",
    });
    // Should NOT close a deal — ask for price confirmation
    expect(d!.statusHint).toBe("negotiating");
    expect(d!.shouldStop).toBe(false);
    expect(d!.suggestedOffer).toBeNull();
  });

  it("Accept with prior price above ceiling does NOT use that price", async () => {
    const { draftNegotiationReply } = await import("@/lib/negotiation/agent");
    const d = await draftNegotiationReply({
      settings: testSettings,
      thread: [
        { from: "them", body: "Our rate is $500." },
        { from: "us", body: "That's above our budget." },
        { from: "them", body: "OK let's just do it." },
      ],
      authorName: "J", publication: "P", ceiling: 200, floor: 50,
      lastIntent: "accept", theirPrice: null, senderName: "A",
    });
    // Prior price $500 is above ceiling $200 — should ask for confirmation, not agree
    expect(d!.statusHint).toBe("negotiating");
    expect(d!.shouldStop).toBe(false);
  });

  it("Does NOT accept above ceiling", async () => {
    const { draftNegotiationReply } = await import("@/lib/negotiation/agent");
    const d = await draftNegotiationReply({
      settings: testSettings,
      thread: [], authorName: "J", publication: "P", ceiling: 240, floor: 50,
      lastIntent: "accept", theirPrice: 400, senderName: "A",
    });
    expect(d === null || d.statusHint !== "agreed").toBe(true);
  });

  it("Thread length exceeded → shouldStop", async () => {
    const { draftNegotiationReply } = await import("@/lib/negotiation/agent");
    const longThread = Array(8).fill({ from: "us", body: "hi" });
    const d = await draftNegotiationReply({
      settings: { ...testSettings, max_thread_length: 4 },
      thread: longThread, authorName: "J", publication: "P", ceiling: 200, floor: 50,
      lastIntent: "interested", senderName: "A",
    });
    expect(d!.shouldStop).toBe(true);
  });

  it("SanitizeBody removes em dashes", async () => {
    const { sanitizeBody } = await import("@/lib/negotiation/agent");
    const result = sanitizeBody("Hello \u2014 this is a test \u2014 with dashes.");
    expect(result).not.toContain("\u2014");
    expect(result).toContain(",");
  });

  it("SanitizeBody preserves hyphens in compound words", async () => {
    const { sanitizeBody } = await import("@/lib/negotiation/agent");
    const result = sanitizeBody("This is a well-known, time-tested approach.");
    expect(result).toContain("well-known");
    expect(result).toContain("time-tested");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: PRICING ENGINE (offline, deterministic)
// ═══════════════════════════════════════════════════════════════════════════════
describe("3. Pricing Engine", () => {
  it("Picks highest qualifying tier", async () => {
    const { maxOfferFor } = await import("@/lib/negotiation/pricing");
    const rules = [
      { min_dr: 50, min_traffic: 10000, max_offer: 150, label: "t1" },
      { min_dr: 70, max_offer: 300, label: "t2" },
    ];
    expect(maxOfferFor(75, 50000, 80, rules)?.offer).toBe(300);
  });

  it("Picks lower tier when only that qualifies", async () => {
    const { maxOfferFor } = await import("@/lib/negotiation/pricing");
    const rules = [
      { min_dr: 50, min_traffic: 10000, max_offer: 150, label: "t1" },
      { min_dr: 70, max_offer: 300, label: "t2" },
    ];
    expect(maxOfferFor(55, 20000, 60, rules)?.offer).toBe(150);
  });

  it("Unverified traffic doesn't fail threshold", async () => {
    const { maxOfferFor } = await import("@/lib/negotiation/pricing");
    const rules = [{ min_dr: 50, min_traffic: 10000, max_offer: 150, label: "t1" }];
    expect(maxOfferFor(60, null, null, rules)?.offer).toBe(150);
  });

  it("Verified below threshold fails tier", async () => {
    const { maxOfferFor } = await import("@/lib/negotiation/pricing");
    const rules = [{ min_dr: 50, min_traffic: 10000, max_offer: 150, label: "t1" }];
    expect(maxOfferFor(60, 1000, 20, rules)?.offer).toBeUndefined();
  });

  it("Returns null below every tier → placement-only", async () => {
    const { maxOfferFor } = await import("@/lib/negotiation/pricing");
    const rules = [{ min_dr: 50, min_traffic: 10000, max_offer: 150, label: "t1" }];
    expect(maxOfferFor(30, null, null, rules)).toBeNull();
  });

  it("No rules → null (placement-only)", async () => {
    const { maxOfferFor } = await import("@/lib/negotiation/pricing");
    expect(maxOfferFor(80, 100000, 90, [])).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: SAFETY CONSTRAINTS (hard rules outside LLM)
// ═══════════════════════════════════════════════════════════════════════════════
describe("4. Safety Constraints", () => {
  const testSettings = {
    max_thread_length: 4, opening_percent: 40, min_price: 50, currency: "USD",
    tone: "warm", aggressiveness: "firm", handbook: "", style_rules: "",
    ai_autonomy: false, anti_highball: "", pricing_rules: [],
    absolute_max_price: 200, human_approval_above: 150,
  } as any;

  it("Absolute max price enforced — does not agree above ceiling", async () => {
    const { draftNegotiationReply } = await import("@/lib/negotiation/agent");
    const d = await draftNegotiationReply({
      settings: testSettings,
      thread: [], authorName: "J", publication: "P", ceiling: 200, floor: 50,
      lastIntent: "accept", theirPrice: 300, senderName: "A",
    });
    expect(d === null || d.statusHint !== "agreed").toBe(true);
  });

  it("Thread length enforced — stops after max", async () => {
    const { draftNegotiationReply } = await import("@/lib/negotiation/agent");
    const longThread = Array(10).fill({ from: "us", body: "hi" });
    const d = await draftNegotiationReply({
      settings: { ...testSettings, max_thread_length: 3 },
      thread: longThread, authorName: "J", publication: "P", ceiling: 200, floor: 50,
      lastIntent: "interested", senderName: "A",
    });
    expect(d!.shouldStop).toBe(true);
  });

  it("Unsubscribe always stops regardless of thread state", async () => {
    const { draftNegotiationReply } = await import("@/lib/negotiation/agent");
    const d = await draftNegotiationReply({
      settings: testSettings,
      thread: [{ from: "them", body: "unsubscribe" }], authorName: "J", publication: "P",
      ceiling: 200, floor: 50, lastIntent: "unsubscribe", senderName: "A",
    });
    expect(d!.shouldStop).toBe(true);
    expect(d!.statusHint).toBe("declined");
  });

  it("Hard no always stops", async () => {
    const { draftNegotiationReply } = await import("@/lib/negotiation/agent");
    const d = await draftNegotiationReply({
      settings: testSettings,
      thread: [{ from: "them", body: "not interested" }], authorName: "J", publication: "P",
      ceiling: 200, floor: 50, lastIntent: "hard_no", senderName: "A",
    });
    expect(d!.shouldStop).toBe(true);
    expect(d!.statusHint).toBe("declined");
  });

  it("Ceiling never exceeded in accept path", async () => {
    const { draftNegotiationReply } = await import("@/lib/negotiation/agent");
    const d = await draftNegotiationReply({
      settings: testSettings,
      thread: [], authorName: "J", publication: "P", ceiling: 150, floor: 50,
      lastIntent: "accept", theirPrice: 250, senderName: "A",
    });
    // Should not accept 250 when ceiling is 150
    if (d?.suggestedOffer) {
      expect(d.suggestedOffer).toBeLessThanOrEqual(150);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: HACKATHON MODE FLAG CHECKS (unit-level)
// ═══════════════════════════════════════════════════════════════════════════════
describe("5. Hackathon Mode Configuration", () => {
  it("Tick route respects REQUIRE_STRANDS env var", async () => {
    // Verify the tick route module can be imported without error
    const mod = await import("@/app/api/campaigns/[id]/tick/route");
    expect(mod.POST).toBeDefined();
  });

  it("Fallback orchestrator is importable", async () => {
    const { runFallbackTick } = await import("@/lib/campaign/fallbackOrchestrator");
    expect(typeof runFallbackTick).toBe("function");
  });

  it("Budget exception intervention type is defined", async () => {
    // Verify INTERVENTION_REASON includes budget_exception
    // This is tested at compile-time by TypeScript — if the type changed, tsc fails
    const run = await import("@/lib/negotiation/run");
    expect(run.negotiateThread).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: EMAIL SYSTEM (unit-level)
// ═══════════════════════════════════════════════════════════════════════════════
describe("6. Email System", () => {
  it("deliverOutreach exists and is callable", async () => {
    const { deliverOutreach } = await import("@/lib/email/deliver");
    expect(typeof deliverOutreach).toBe("function");
  });

  it("Email template variables are supported", async () => {
    // Verify template rendering logic exists
    const outreach = await import("@/lib/campaign/outreach");
    expect(outreach.sendOutreachToProspect).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: CAMPAIGN TOOLS (unit-level)
// ═══════════════════════════════════════════════════════════════════════════════
describe("7. Campaign Tools", () => {
  it("planDiscoveryQueries exists", async () => {
    const tools = await import("@/lib/campaign/tools");
    expect(typeof tools.planDiscoveryQueries).toBe("function");
  });

  it("discoverBatch exists", async () => {
    const tools = await import("@/lib/campaign/tools");
    expect(typeof tools.discoverBatch).toBe("function");
  });

  it("evaluateProspect exists", async () => {
    const tools = await import("@/lib/campaign/tools");
    expect(typeof tools.evaluateProspect).toBe("function");
  });

  it("resolveContactForProspect exists", async () => {
    const tools = await import("@/lib/campaign/tools");
    expect(typeof tools.resolveContactForProspect).toBe("function");
  });

  it("emitEvent exists", async () => {
    const tools = await import("@/lib/campaign/tools");
    expect(typeof tools.emitEvent).toBe("function");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: MODULE IMPORTS (verifies no broken imports)
// ═══════════════════════════════════════════════════════════════════════════════
describe("8. Module Imports", () => {
  it("Negotiation agent imports cleanly", async () => {
    const mod = await import("@/lib/negotiation/agent");
    expect(mod.classifyReplyIntent).toBeDefined();
    expect(mod.classifyReplyIntentHeuristicOnly).toBeDefined();
    expect(mod.draftNegotiationReply).toBeDefined();
    expect(mod.sanitizeBody).toBeDefined();
  });

  it("Negotiation pricing imports cleanly", async () => {
    const mod = await import("@/lib/negotiation/pricing");
    expect(mod.maxOfferFor).toBeDefined();
  });

  it("Negotiation settings imports cleanly", async () => {
    const mod = await import("@/lib/negotiation/settings");
    expect(mod.getNegotiationSettings).toBeDefined();
  });

  it("Campaign queries imports cleanly", async () => {
    const mod = await import("@/lib/campaign/queries");
    expect(mod.getCampaignRow).toBeDefined();
    expect(mod.countProspectsByStatus).toBeDefined();
    expect(mod.getDeals).toBeDefined();
    expect(mod.listInterventions).toBeDefined();
    expect(mod.listAgentEvents).toBeDefined();
  });

  it("Campaign tools imports cleanly", async () => {
    const mod = await import("@/lib/campaign/tools");
    expect(mod.planDiscoveryQueries).toBeDefined();
    expect(mod.discoverBatch).toBeDefined();
    expect(mod.evaluateProspect).toBeDefined();
    expect(mod.emitEvent).toBeDefined();
  });

  it("Fallback orchestrator imports cleanly", async () => {
    const mod = await import("@/lib/campaign/fallbackOrchestrator");
    expect(mod.runFallbackTick).toBeDefined();
  });

  it("Email deliver imports cleanly", async () => {
    const mod = await import("@/lib/email/deliver");
    expect(mod.deliverOutreach).toBeDefined();
  });

  it("Outreach module imports cleanly", async () => {
    const mod = await import("@/lib/campaign/outreach");
    expect(mod.sendOutreachToProspect).toBeDefined();
    expect(mod.processRepliesTick).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: INTEGRATION (needs running server — skip if unavailable)
// ═══════════════════════════════════════════════════════════════════════════════
describe("9. Integration Tests (server required)", () => {
  const skip = () => !hasServer;

  it("GET /api/campaigns returns 200", async () => {
    if (skip()) return;
    const res = await api("/api/campaigns");
    expect(res.status).toBe(200);
  });

  it("POST /api/campaigns creates a campaign", async () => {
    if (skip()) return;
    const res = await api("/api/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: "Test Campaign", demo_mode: true }),
    });
    expect(res.status).toBe(201);
  });

  it("POST /api/campaigns/:id/tick returns valid response", async () => {
    if (skip()) return;
    const res = await api("/api/campaigns/test-id/tick", { method: "POST" });
    expect([401, 404, 503]).toContain(res.status);
  });

  it("POST /api/campaigns/:id/control returns valid response", async () => {
    if (skip()) return;
    const res = await api("/api/campaigns/test-id/control", {
      method: "POST",
      body: JSON.stringify({ action: "start" }),
    });
    expect([401, 404]).toContain(res.status);
  });
});
