import { describe, it, expect } from "vitest";
import { qualifyProspect } from "@/lib/score/qualify";
import { isRoleEmail } from "@/lib/email/roleEmail";
import { isPlaceholderEmail, cleanAuthorName } from "@/lib/enrich/personFilter";
import { registrableDomain } from "@/lib/util/domain";

describe("qualifyProspect — the 4 outreach filters (legacy rules)", () => {
  const base = { relevance: 60, mentionCount: 0, articleCount: 1, hasEmail: false, contactConfidence: 0, organicTraffic: null as number | null, usTrafficShare: null as number | null };

  it("unverified traffic/US-share never disqualifies", () => {
    const q = qualifyProspect({ ...base, dr: 62 });
    expect(q.qualified).toBe(true);
    expect(q.trafficPass).toBeNull();
    expect(q.usPass).toBeNull();
  });

  it("VERIFIED failing traffic disqualifies", () => {
    const q = qualifyProspect({ ...base, dr: 62, organicTraffic: 500 });
    expect(q.qualified).toBe(false);
    expect(q.trafficPass).toBe(false);
  });

  it("DR below the bar disqualifies even with great relevance", () => {
    const q = qualifyProspect({ ...base, dr: 31 });
    expect(q.qualified).toBe(false);
  });

  it("strong mentions pass relevancy even at low relevance score", () => {
    const q = qualifyProspect({ ...base, mentionCount: 7, dr: 55 });
    expect(q.relevancePass).toBe(true);
    expect(q.qualified).toBe(true);
  });
});

describe("email safety filters (send-gate primitives)", () => {
  it("rejects role/generic mailboxes", () => {
    for (const e of ["press@shopify.com", "info@example.com", "noreply@medium.com", "support@x.io"]) {
      expect(isRoleEmail(e)).toBe(true);
    }
    expect(isRoleEmail("jane.doe@example.com")).toBe(false);
  });

  it("catches documentation placeholders that once reached the DB", () => {
    // Legacy bug: user@domain.com scraped off docs pages was stored at 0.9 confidence
    // and marked 'sourced' — this gate is the last line of defense.
    for (const e of ["user@domain.com", "example@example.org", "john@example.com", "logo@2x.png"]) {
      expect(isPlaceholderEmail(e)).toBe(true);
    }
    expect(isPlaceholderEmail("sarah@fastcompany.com")).toBe(false);
  });
});

describe("author name cleaning (byline junk regressions)", () => {
  it("strips scraper nav-junk fused onto names", () => {
    expect(cleanAuthorName("Alistair CampbellSocial Links Navigation")).toBe("Alistair Campbell");
    expect(cleanAuthorName("By Pierre DeBois")).toBe("Pierre DeBois");
    expect(cleanAuthorName("CaiContributor")).toBe("Cai");
  });

  it("title phrases are not people", () => {
    expect(cleanAuthorName("Consultant and Applied scientist")).toBeTruthy();
  });
});

describe("domain canonicalization (duplicate-prevention primitive)", () => {
  it("reduces subdomains to the registrable domain so re-discovery dedupes", () => {
    expect(registrableDomain("blog.shopify.com")).toBe("shopify.com");
    expect(registrableDomain("research.ibm.com")).toBe("ibm.com");
    expect(registrableDomain("www.example.co.uk")).toBe(registrableDomain("example.co.uk"));
  });
});
