// The deterministic policy: what is available per phase, when phases transition, the status
// sentence, and the tick interval. None of this may ever depend on a model.
import { describe, it, expect } from "vitest";
import { availableActions, nextPhase, statusSentence, nextTickDelayMs, poolTarget, type PolicyInput } from "@/lib/campaign/policy";
import type { Campaign } from "@/lib/campaign/types";

const camp = (over: Partial<Campaign> = {}): Campaign => ({
  id: "c1", owner_email: "o@x", guest_id: null, name: "T", website_url: "https://x", what_you_sell: "x", keywords: ["a", "b", "c"], desired_deals: 2, budget_total: 800, budget_used: 0, max_per_deal: 250, min_dr: 50, currency: "USD", demo_mode: true,
  phase: "monitoring", completion_reason: null, paused: false, paused_reason: null, tick_count: 0, ticks_today: 0, ticks_day: null, last_tick_at: null, next_tick_after: null, ultra_calls: 0, plan_text: null, plan: {}, seed_contacts: [], search_web: true, activity: null, created_at: "", updated_at: "", completed_at: null, ...over,
});
const input = (over: Partial<PolicyInput> = {}, c: Partial<Campaign> = {}): PolicyInput => ({ camp: camp(c), counts: {}, deals: 0, openInterventions: 0, unansweredReplies: 0, sendableReady: 0, actionableQualified: 0, ...over });

describe("availableActions", () => {
  it("planning/discovering with an empty pool offers discovery only", () => {
    const a = availableActions(input({}, { phase: "planning" }));
    expect(a.map((x) => x.key)).toEqual(["run_discovery"]);
  });
  it("discovering with a full pool and nothing to qualify offers nothing (no-op tick)", () => {
    const a = availableActions(input({ counts: { qualified: poolTarget(camp()) } }, { phase: "discovering" }));
    expect(a).toEqual([]);
  });
  it("qualifying offers qualify (bounded to 4) and contacts when both exist", () => {
    const a = availableActions(input({ counts: { discovered: 9 }, actionableQualified: 2 }, { phase: "qualifying" }));
    expect(a.map((x) => [x.key, x.size])).toEqual([["qualify", 4], ["resolve_contacts", 2]]);
  });
  it("monitoring in real mode offers nothing while emails are simply waiting for replies (no idle model calls)", () => {
    expect(availableActions(input({}, { phase: "monitoring", demo_mode: false }))).toEqual([]);
    expect(availableActions(input({ counts: { outreached: 3 } }, { phase: "monitoring", demo_mode: false }))).toEqual([]);
    expect(availableActions(input({ counts: { outreached: 3 }, dueFollowups: 2 }, { phase: "monitoring", demo_mode: false })).map((a) => a.key)).toEqual(["schedule_followups"]);
    expect(availableActions(input({ counts: { outreached: 3 }, unansweredReplies: 1 }, { phase: "monitoring", demo_mode: false })).map((a) => a.key)).toEqual(["handle_replies"]);
  });
  it("monitoring in demo mode offers handle_replies only when a scripted reply is due (no idle model calls)", () => {
    expect(availableActions(input({}, { phase: "monitoring" }))).toEqual([]);
    expect(availableActions(input({ dueDemoReplies: 2 }, { phase: "monitoring" })).map((x) => x.key)).toContain("handle_replies");
  });
  it("terminal phases offer nothing", () => {
    for (const phase of ["completed", "stopped", "failed", "draft"] as const) expect(availableActions(input({ counts: { discovered: 5 } }, { phase }))).toEqual([]);
  });
});

describe("nextPhase", () => {
  it("planning → discovering", () => expect(nextPhase(input({}, { phase: "planning" }))?.phase).toBe("discovering"));
  it("discovering → qualifying once the pool target is met", () => {
    expect(nextPhase(input({ counts: { discovered: 5 } }, { phase: "discovering", demo_mode: false }))).toBeNull();
    expect(nextPhase(input({ counts: { discovered: poolTarget(camp()) } }, { phase: "discovering", demo_mode: false }))?.phase).toBe("qualifying");
  });
  it("qualifying → resolving_contacts when nothing is left to evaluate", () => {
    expect(nextPhase(input({ counts: { discovered: 1, qualified: 3 } }, { phase: "qualifying" }))).toBeNull();
    expect(nextPhase(input({ counts: { discovered: 0, qualified: 3 } }, { phase: "qualifying" }))?.phase).toBe("resolving_contacts");
  });
  it("qualifying → completed when everything was rejected", () => {
    expect(nextPhase(input({ counts: { rejected: 4 } }, { phase: "qualifying" }))?.reason).toBe("nothing_qualified");
  });
  it("resolving_contacts → outreaching / monitoring / completed by what exists", () => {
    expect(nextPhase(input({ sendableReady: 2 }, { phase: "resolving_contacts" }))?.phase).toBe("outreaching");
    expect(nextPhase(input({ counts: { outreached: 2 } }, { phase: "resolving_contacts" }))?.phase).toBe("monitoring");
    expect(nextPhase(input({ counts: { rejected: 2 } }, { phase: "resolving_contacts" }))?.reason).toBe("no_contactable_prospects");
    expect(nextPhase(input({ actionableQualified: 1 }, { phase: "resolving_contacts" }))).toBeNull();
  });
  it("monitoring → completed on goal, or when the funnel is empty", () => {
    expect(nextPhase(input({ deals: 2 }, { phase: "monitoring" }))?.reason).toBe("goal_reached");
    expect(nextPhase(input({ counts: { outreached: 1 } }, { phase: "monitoring" }))).toBeNull();
    expect(nextPhase(input({ counts: { lost: 3 } }, { phase: "monitoring" }))?.reason).toBe("prospects_exhausted");
  });
});

describe("statusSentence", () => {
  it("is truthful about money, needs, and pauses", () => {
    expect(statusSentence({ ...input({ counts: { negotiating: 3 }, deals: 2, openInterventions: 0 }, { budget_used: 340 }) })).toBe("Negotiating with 3 editors. 2 deals agreed, $340 of $800 committed. Nothing needs you right now.");
    expect(statusSentence({ ...input({ counts: { negotiating: 1 }, deals: 0, openInterventions: 1 }) })).toContain("1 thing needs you.");
    expect(statusSentence({ ...input({}, { paused: true }), paused_reason: "daily tick cap" })).toBe("Paused — daily tick cap.");
    expect(statusSentence({ ...input({ deals: 2 }, { phase: "completed", budget_used: 240 }), completion_reason: "goal_reached" })).toBe("Goal reached. 2 deals agreed, $240 of $800 committed.");
  });
});

describe("nextTickDelayMs", () => {
  it("terminal phases never tick again; monitoring is slow; demo is fast", () => {
    expect(nextTickDelayMs(camp({ phase: "completed" }), true)).toBeNull();
    expect(nextTickDelayMs(camp({ phase: "monitoring", demo_mode: false }), true)).toBe(20 * 60_000);
    expect(nextTickDelayMs(camp({ phase: "qualifying", demo_mode: false }), true)).toBe(5 * 60_000);
    expect(nextTickDelayMs(camp({ phase: "qualifying", demo_mode: true }), true)).toBe(15_000);
  });
});

describe("seed-only real campaigns (no web search)", () => {
  it("offer discovery once, then treat the listed publications as the whole pool", () => {
    const empty = input({ canSearch: false }, { phase: "discovering", demo_mode: false });
    expect(availableActions(empty).map((a) => a.key)).toEqual(["run_discovery"]);
    const loaded = input({ canSearch: false, counts: { discovered: 1 } }, { phase: "discovering", demo_mode: false });
    expect(availableActions(loaded).map((a) => a.key)).toEqual(["qualify"]);
    expect(nextPhase(loaded)?.phase).toBe("qualifying");
  });
  it("a seed-only campaign whose only page was rejected does not reload forever", () => {
    const i = input({ canSearch: false, counts: { rejected: 1 } }, { phase: "discovering", demo_mode: false });
    expect(availableActions(i)).toEqual([]);
    expect(nextPhase(i)?.phase).toBe("qualifying");
    const q = input({ canSearch: false, counts: { rejected: 1 } }, { phase: "qualifying", demo_mode: false });
    expect(nextPhase(q)).toEqual({ phase: "completed", reason: "nothing_qualified" });
  });
  it("a searching real campaign still fills to the pool target", () => {
    const i = input({ canSearch: true, counts: { discovered: 1 } }, { phase: "discovering", demo_mode: false });
    expect(availableActions(i).map((a) => a.key)).toEqual(["run_discovery", "qualify"]);
    expect(nextPhase(i)).toBeNull();
  });
});

describe("platform hosts are never publications (code rule, no model call)", () => {
  it("rejects video, social, forum, Q&A and portal hosts; keeps real sites", async () => {
    const { isPlatformHost } = await import("@/lib/campaign/tools");
    for (const h of ["youtube.com", "www.reddit.com", "answers.microsoft.com", "community.adobe.com", "forum.example.org", "yahoo.com", "m.youtube.com"]) expect(isPlatformHost(h)).toBe(true);
    for (const h of ["shotkit.com", "petapixel.com", "letsenhance.io", "restorephotosapp.com"]) expect(isPlatformHost(h)).toBe(false);
  });
});
