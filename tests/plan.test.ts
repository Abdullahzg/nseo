// The editable plan: what the user can change before launch, clamped to sane bounds, defaults filled.
import { describe, it, expect } from "vitest";
import { normalizePlan, planWithDefaults } from "@/lib/campaign/plan";

describe("plan", () => {
  it("keeps only known fields, clamps numbers, trims angles", () => {
    const p = normalizePlan({ queries: [" best ai tools ", "", 42], pool_target: 999, min_dr: -5, tone: "rude", if_asked_for_call: "email_only", facts: "  40k visits  ", junk: 1 });
    expect(p).toEqual({ queries: ["best ai tools", "42"], pool_target: 60, min_dr: 0, if_asked_for_call: "email_only", facts: "40k visits" });
  });
  it("fills defaults the agents rely on", () => {
    const p = planWithDefaults({ auto_accept_below: 100 });
    expect(p.auto_accept_below).toBe(100); expect(p.human_approval_above).toBe(200); expect(p.tone).toBe("balanced"); expect(p.if_asked_about_traffic).toBe("ask_me");
  });
  it("tolerates garbage", () => { expect(normalizePlan(null)).toEqual({}); expect(normalizePlan("x")).toEqual({}); });
});
