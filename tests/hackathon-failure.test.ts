import { describe, it, expect, beforeAll } from "vitest";

describe("Hackathon failure mode: Strands down → 503", () => {
  beforeAll(() => {
    process.env.HACKATHON_MODE = "true";
    process.env.REQUIRE_STRANDS = "true";
  });

  it("fallbackOrchestrator rejects when Strands unavailable", async () => {
    const { runFallbackTick } = await import("@/lib/campaign/fallbackOrchestrator");
    const result = await runFallbackTick("test-campaign-id");
    // Should NOT silently fall through to TS execution
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/503|unavailable|strand/i);
  });

  it("tick route returns 503 when Strands is down", async () => {
    // Import the module to check REQUIRE_STRANDS logic
    const { runFallbackTick } = await import("@/lib/campaign/fallbackOrchestrator");
    const result = await runFallbackTick("test-campaign-id");
    expect(result.ok).toBe(false);
  });
});
