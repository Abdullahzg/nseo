// What the agent is allowed to agree to, and why — with the rule it comes from.
//
// This is the part of the product that stops a placement campaign from quietly becoming link spam.
// Google is explicit that "exchanging money for links, or posts that contain links" is link spam,
// AND equally explicit that buying and selling links is a normal part of the web economy "as long
// as they are qualified" with rel="sponsored" or rel="nofollow". So a paid placement is fine; a
// paid link that passes ranking credit is not. The agent therefore negotiates for a QUALIFIED link
// and a visible disclosure, and refuses the deal that would earn the owner a manual action.
//
// Nothing here is a model call. These are rules with citations, applied by code, so the same reply
// always produces the same verdict and the owner can read why.
//
// Sources (fetched 2026-10-15):
//   [G1] Google Search spam policies — link spam, incl. "Exchanging money for links, or posts that
//        contain links", "Sending someone a product in exchange for them writing about it and
//        including a link", advertorials that pass ranking credit, and "Requiring a link as part of
//        a Terms of Service, contract, or similar arrangement".
//        https://developers.google.com/search/docs/essentials/spam-policies
//   [G2] Google — Qualify your outbound links: rel="sponsored" for "advertisements or paid
//        placements (commonly called paid links)"; rel="nofollow" "is still an acceptable way to
//        flag them"; values may be combined.
//        https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links
//   [G3] Google — site reputation policy: third-party content published on a host site mainly
//        because of the host's established ranking signals. Editorial work is explicitly fine.
//        https://developers.google.com/search/blog/2024/11/site-reputation-abuse
//   [F1] FTC Endorsement Guides FAQ — a material connection (payment OR free product) must be
//        disclosed "clearly and conspicuously"; a disclosure behind a click is "easily avoidable".
//        https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking
//   [F2] FTC Disclosures 101 — put the disclosure with the endorsement; "Advertisement", "Ad" and
//        "Sponsored" are acceptable; an About-page disclosure is likely to be missed.
//        https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers
//   [F3] FTC fake-reviews rule (16 CFR Part 465) — buying reviews, or incentivising a specified
//        sentiment, is prohibited.

export type LinkRel = "sponsored" | "nofollow" | "sponsored nofollow" | "dofollow" | "unknown" | "none";
export type Consideration = "paid" | "gifted" | "none";
export type Verdict = "compliant" | "needs_change" | "refuse";

export interface Rule {
  id: string;
  /** One line the owner can read. */
  title: string;
  /** The authority, short. */
  source: string;
  url: string;
}

export const RULES: Record<string, Rule> = {
  paid_link_must_be_qualified: {
    id: "paid_link_must_be_qualified",
    title: "A link you paid for must carry rel=\"sponsored\" (or nofollow). Unqualified paid links are link spam.",
    source: "Google Search spam policies · Qualify your outbound links",
    url: "https://developers.google.com/search/docs/essentials/spam-policies",
  },
  gifted_counts_as_payment: {
    id: "gifted_counts_as_payment",
    title: "Sending a free product in exchange for coverage counts as payment — the link still has to be qualified.",
    source: "Google Search spam policies",
    url: "https://developers.google.com/search/docs/essentials/spam-policies",
  },
  disclosure_required: {
    id: "disclosure_required",
    title: "Paid or gifted coverage must be labelled clearly and conspicuously, next to the content — not behind a click.",
    source: "FTC Endorsement Guides",
    url: "https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking",
  },
  no_link_requirement: {
    id: "no_link_requirement",
    title: "A link must never be a contractual requirement of the arrangement.",
    source: "Google Search spam policies",
    url: "https://developers.google.com/search/docs/essentials/spam-policies",
  },
  no_sentiment_buying: {
    id: "no_sentiment_buying",
    title: "Never buy a rating, a review, or words the publisher must say about us.",
    source: "FTC rule on fake reviews and testimonials (16 CFR 465)",
    url: "https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials",
  },
  host_reputation_risk: {
    id: "host_reputation_risk",
    title: "A paid section parked on a strong domain to borrow its ranking is site reputation abuse — editorial coverage is not.",
    source: "Google site reputation policy",
    url: "https://developers.google.com/search/blog/2024/11/site-reputation-abuse",
  },
  editorial_is_clean: {
    id: "editorial_is_clean",
    title: "Unpaid editorial coverage the publisher chose to write carries no link conditions at all.",
    source: "Google site reputation policy (editorial work is explicitly fine)",
    url: "https://developers.google.com/search/blog/2024/11/site-reputation-abuse",
  },
};

export interface DealTerms {
  consideration: Consideration;
  linkRel: LinkRel;
  /** The publisher will visibly label the piece (Sponsored / Ad / Paid partnership). */
  disclosed: boolean | null;
  /** The publisher said the placement lives in a paid/partner section of a stronger domain. */
  hostedSection?: boolean;
}

export interface Assessment {
  verdict: Verdict;
  /** What the agent must do next, in one line. */
  action: string;
  rules: Rule[];
  /** Short explanation for the owner and the Compliance tab. */
  why: string;
}

/** The compliance verdict for a set of terms. Pure function — same terms, same answer. */
export function assess(terms: DealTerms): Assessment {
  const paid = terms.consideration !== "none";
  const qualified = terms.linkRel === "sponsored" || terms.linkRel === "nofollow" || terms.linkRel === "sponsored nofollow" || terms.linkRel === "none";

  if (!paid) {
    return {
      verdict: "compliant",
      action: "Nothing to qualify — unpaid editorial coverage.",
      rules: [RULES.editorial_is_clean],
      why: "The publisher is covering us on their own account, with no money and no product changing hands, so no link attribute or disclosure is required of them.",
    };
  }

  const rules: Rule[] = [terms.consideration === "gifted" ? RULES.gifted_counts_as_payment : RULES.paid_link_must_be_qualified, RULES.disclosure_required];
  if (terms.hostedSection) rules.push(RULES.host_reputation_risk);

  if (terms.linkRel === "dofollow") {
    return {
      verdict: "refuse",
      action: "Ask for rel=\"sponsored\" on the link. If they will not, this placement is not worth the risk — bring it to the owner.",
      rules,
      why: `We would be paying for a link that passes ranking credit, which Google lists as link spam and penalises on the buyer's side. The same placement is fine with rel="sponsored".`,
    };
  }

  if (terms.disclosed === false) {
    return {
      verdict: "refuse",
      action: `Ask for a visible "Sponsored" label. Undisclosed paid coverage is not something we can buy.`,
      rules,
      why: "The publisher is offering paid coverage with no disclosure. Under the FTC's endorsement rules that exposure lands on the advertiser - us - not only on them.",
    };
  }

  if (terms.linkRel === "unknown" || terms.disclosed == null) {
    return {
      verdict: "needs_change",
      action: [terms.linkRel === "unknown" ? "Confirm the link will be rel=\"sponsored\" (or nofollow)." : null, terms.disclosed == null ? "Confirm the piece will be visibly labelled as sponsored." : null].filter(Boolean).join(" "),
      rules,
      why: "A paid placement is fine, but it has to be marked as one — on the link and on the page. Neither is confirmed yet.",
    };
  }

  if (!qualified) {
    return { verdict: "needs_change", action: "Confirm the link attribute.", rules, why: "The link attribute is not one we can accept yet." };
  }

  return {
    verdict: "compliant",
    action: "Terms are clean: qualified link, visible label.",
    rules,
    why: `Paid placement, link marked ${terms.linkRel === "none" ? "with no link at all" : `rel="${terms.linkRel}"`}, and the piece carries a visible sponsorship label. This is the arrangement Google and the FTC both allow.`,
  };
}

// ── Reading the editor's words ───────────────────────────────────────────────────────────────────
// The editor says what they are offering in plain English. These patterns pull the terms out of it
// deterministically; the model is not asked to adjudicate compliance.

const DOFOLLOW_RE = /\b(do[\s-]?follow|follow(?:ed)?\s+link|passes?\s+(?:link\s+)?(?:juice|equity|authority|ranking)|no\s+nofollow)\b/i;
const NOFOLLOW_RE = /\bno[\s-]?follow(?:ed)?\b/i;
const SPONSORED_REL_RE = /\brel\s*=\s*["']?sponsored|sponsored\s+(?:attribute|tag|rel\b)/i;
const DISCLOSE_YES_RE = /\b(we|it|they|this|the\s+(?:post|article|piece|content|mention|placement|review|write[\s-]?up|feature))\s+(?:will\s+be|is|are|gets?|carries)\s+(?:clearly\s+)?(?:marked|labell?ed|tagged|flagged|disclosed)\b|\b(sponsored|paid\s+partnership|partner\s+content|advertorial|paid\s+post)\s+(?:label|tag|badge|disclosure|banner)\b|\bwe\s+disclose\b/i;
const DISCLOSE_NO_RE = /\b(no|without|skip|avoid|don'?t|do\s+not|never)\s+(?:any\s+)?(?:visible\s+)?(?:sponsored\s+)?(?:label|disclosure|disclaimer|tag|marking)\b|\bnot\s+(?:marked|labell?ed|disclosed)\b|\blooks?\s+(?:fully\s+)?editorial\b|\bindistinguishable\s+from\s+editorial\b/i;
const HOSTED_SECTION_RE = /\b(partner|sponsored|brand(?:ed)?|advertorial)\s+(?:content\s+)?(?:section|hub|channel|subfolder|subdirectory|subdomain)\b/i;
const GIFT_RE = /\b(send|ship|provide|give)\s+(?:us\s+)?(?:a\s+)?(?:free\s+)?(?:sample|unit|product|licence|license|subscription|account)\b|\bin\s+exchange\s+for\s+(?:a\s+)?(?:free|complimentary)\b/i;
const REVIEW_SENTIMENT_RE = /\b(guarantee|promise|ensure)\s+(?:a\s+)?(?:positive|5[\s-]?star|five[\s-]?star|glowing|favourable|favorable)\b|\bwe\s+(?:will\s+)?write\s+whatever\s+you\b|\byou\s+(?:can\s+)?(?:write|supply|provide)\s+the\s+(?:review|opinion|verdict)\b/i;
const LINK_REQUIRED_RE = /\blink\s+is\s+(?:a\s+)?(?:required|mandatory|condition)\b|\brequire[sd]?\s+(?:a\s+)?(?:back)?link\b/i;

export interface ReadTerms {
  linkRel: LinkRel;
  disclosed: boolean | null;
  consideration: Consideration | null;
  hostedSection: boolean;
  /** Something that can never be agreed to, whatever the price. */
  prohibited: Rule | null;
}

/** Pull the compliance-relevant terms out of what the editor actually wrote. */
export function readTerms(text: string): ReadTerms {
  const t = (text ?? "").replace(/\s+/g, " ");
  const sponsoredRel = SPONSORED_REL_RE.test(t);
  // "no nofollow" and "do-follow" both mean the link would pass credit.
  const nofollow = NOFOLLOW_RE.test(t) && !/\bno\s+nofollow\b/i.test(t);
  const dofollow = DOFOLLOW_RE.test(t) && !nofollow && !sponsoredRel;
  const linkRel: LinkRel = sponsoredRel ? "sponsored" : nofollow ? "nofollow" : dofollow ? "dofollow" : "unknown";
  const disclosed = DISCLOSE_NO_RE.test(t) ? false : DISCLOSE_YES_RE.test(t) ? true : null;
  const prohibited = REVIEW_SENTIMENT_RE.test(t) ? RULES.no_sentiment_buying : LINK_REQUIRED_RE.test(t) ? RULES.no_link_requirement : null;
  return {
    linkRel,
    disclosed,
    consideration: GIFT_RE.test(t) ? "gifted" : null,
    hostedSection: HOSTED_SECTION_RE.test(t),
    prohibited,
  };
}

/** The sentence the agent adds to a negotiation when money is on the table. */
export function complianceAsk(consideration: Consideration): string {
  if (consideration === "none") return "";
  return `One housekeeping point: since this is a paid placement, we need the link to us marked rel="sponsored" and the piece labelled as sponsored. That keeps it clean for both of us on Google's side, and it does not change what we are offering.`;
}

/** A short label for the deal row and the compliance tab. */
export function verdictLabel(v: Verdict): string {
  return v === "compliant" ? "Compliant" : v === "needs_change" ? "Needs a change" : "Cannot agree";
}
