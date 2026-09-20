// Bring-your-own-keys: per-request key resolution. An owner's saved key beats the platform key;
// a guest's demo runs on the platform key; PLATFORM_KEY_FOR_OWNERS=false makes an owner's key mandatory.
import { describe, it, expect } from "vitest";
import { withKeys, resolveNebiusKey, resolveTavilyKey, currentKeys } from "@/lib/ai/context";

describe("key context", () => {
  it("is empty outside a request", () => { expect(currentKeys()).toEqual({}); });
  it("owner keys win over the platform key inside withKeys", async () => {
    await withKeys({ nebius: "owner-nebius", tavily: "owner-tavily", owner: "o@x" }, async () => {
      expect(resolveNebiusKey()).toBe("owner-nebius");
      expect(resolveTavilyKey()).toBe("owner-tavily");
    });
  });
  it("falls back to the platform key when the owner has none", async () => {
    const platform = process.env.NEBIUS_API_KEY?.trim() || null;
    await withKeys({ nebius: null, tavily: null, owner: "o@x" }, async () => { expect(resolveNebiusKey()).toBe(platform); });
    await withKeys({ nebius: null, tavily: null, owner: null }, async () => { expect(resolveNebiusKey()).toBe(platform); });
  });
  it("does not leak keys between concurrent requests", async () => {
    await Promise.all([
      withKeys({ nebius: "a" }, async () => { await new Promise((r) => setTimeout(r, 5)); expect(resolveNebiusKey()).toBe("a"); }),
      withKeys({ nebius: "b" }, async () => { expect(resolveNebiusKey()).toBe("b"); }),
    ]);
  });
});
