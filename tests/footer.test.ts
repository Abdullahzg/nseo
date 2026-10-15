import { describe, it, expect } from "vitest";
import { unsubscribeToken, readUnsubscribeToken, outreachFooter, unsubscribeHeaders, contextLine } from "@/lib/compliance/footer";

describe("unsubscribe tokens", () => {
  it("round-trips the address and campaign", () => {
    const t = unsubscribeToken("Editor@Example.com", "camp-1");
    expect(readUnsubscribeToken(t)).toEqual({ email: "editor@example.com", campaignId: "camp-1" });
  });
  it("refuses a token it did not sign", () => {
    const t = unsubscribeToken("editor@example.com", "camp-1");
    const [body] = t.split(".");
    expect(readUnsubscribeToken(`${body}.AAAAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
    expect(readUnsubscribeToken("nonsense")).toBeNull();
    expect(readUnsubscribeToken("")).toBeNull();
  });
  it("will not let one address unsubscribe as another", () => {
    const mine = unsubscribeToken("a@example.com", "camp-1");
    const theirs = unsubscribeToken("b@example.com", "camp-1");
    expect(readUnsubscribeToken(`${theirs.split(".")[0]}.${mine.split(".")[1]}`)).toBeNull();
  });
});

describe("the footer a commercial email has to carry", () => {
  const sender = { name: "Abdullah", email: "me@example.com", company: "Restoria", postalAddress: "12 Example St, London N1 1AA" };
  it("names the sender, the business, the postal address and a one-click opt-out", () => {
    const f = outreachFooter(sender, "https://app.example/api/u/tok", contextLine("shotkit.com", "Best AI photo tools"));
    expect(f.text).toContain("Restoria");
    expect(f.text).toContain("12 Example St");
    expect(f.text).toContain("https://app.example/api/u/tok");
    expect(f.text).toContain("shotkit.com");
    expect(f.missing).toEqual([]);
  });
  it("reports a missing postal address rather than inventing one", () => {
    const f = outreachFooter({ ...sender, postalAddress: null }, "https://app.example/u/x", "because");
    expect(f.missing).toEqual(["postal address"]);
    expect(f.text).not.toContain("null");
  });
  it("sets both headers one-click unsubscribe needs", () => {
    const h = unsubscribeHeaders("https://app.example/api/u/tok", "me@example.com");
    expect(h["List-Unsubscribe"]).toBe("<https://app.example/api/u/tok>, <mailto:me@example.com?subject=unsubscribe>");
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});
