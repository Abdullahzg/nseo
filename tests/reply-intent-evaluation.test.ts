import { describe, it, expect } from "vitest";
import { classifyReplyIntentHeuristicOnly } from "@/lib/negotiation/agent";

// ═══════════════════════════════════════════════════════════════════════════════
// REPLY INTENT CLASSIFICATION — 50+ TEST CASES (HEURISTIC FALLBACK)
// This is the regression suite for the deterministic heuristic classifier.
// It documents EXACTLY what the current regex-based classifier does.
// When LLM is available, it may improve on these cases.
// ═══════════════════════════════════════════════════════════════════════════════

describe("Reply Intent Classification — 50+ cases (heuristic)", () => {
  const classify = classifyReplyIntentHeuristicOnly;

  // ─── INTERESTED (default fallback) ─────────────────────────────────────────
  describe("interested", () => {
    it("01: positive opener", () => {
      const r = classify("Hi, thanks for reaching out! We're definitely interested in learning more.");
      expect(r.intent).toBe("interested");
    });

    it("02: positive with question → classified as question", () => {
      const r = classify("This sounds great! What kind of content are you looking for?");
      expect(r.intent).toBe("question");
    });

    it("03: enthusiastic", () => {
      const r = classify("Awesome, I love this! Let's do it.");
      expect(r.intent).toBe("interested");
    });

    it("04: positive, no explicit price", () => {
      const r = classify("Looks good, let's move forward.");
      expect(r.intent).toBe("interested");
    });

    it("05: positive with question about turnaround → classified as needs_human (factual)", () => {
      const r = classify("Sounds perfect. Quick question: what's the turnaround time?");
      expect(r.intent).toBe("needs_human");
    });
  });

  // ─── COUNTER OFFER ──────────────────────────────────────────────────────────
  describe("counter_offer", () => {
    it("06: explicit price", () => {
      const r = classify("We can do it for $350.");
      expect(r.intent).toBe("counter_offer");
      expect(r.priceMentioned).toBe(350);
    });

    it("07: price with reasoning", () => {
      const r = classify("Our standard rate is $250 for sponsored content.");
      expect(r.intent).toBe("counter_offer");
      expect(r.priceMentioned).toBe(250);
    });

    it("08: price negotiation", () => {
      const r = classify("We typically charge $400 for placements like this.");
      expect(r.intent).toBe("counter_offer");
      expect(r.priceMentioned).toBe(400);
    });

    it("09: discounted rate", () => {
      const r = classify("Since you reached out, we can offer a special rate of $150.");
      expect(r.intent).toBe("counter_offer");
      expect(r.priceMentioned).toBe(150);
    });

    it("10: price range", () => {
      const r = classify("Our rate is between $200 and $300.");
      expect(r.intent).toBe("counter_offer");
    });

    it("11: monthly pricing", () => {
      const r = classify("We offer monthly packages starting at $500/month.");
      expect(r.intent).toBe("counter_offer");
      expect(r.priceMentioned).toBe(500);
    });
  });

  // ─── ACCEPT (not detected by heuristic — falls to interested) ──────────────
  describe("accept → falls to interested (heuristic limitation)", () => {
    it("12: explicit accept → interested", () => {
      const r = classify("We accept your proposal.");
      expect(r.intent).toBe("interested");
    });

    it("13: enthusiastic accept → interested", () => {
      const r = classify("Sounds great, let's do it!");
      expect(r.intent).toBe("interested");
    });

    it("14: conditional accept → interested", () => {
      const r = classify("That works for us. Send over the details.");
      expect(r.intent).toBe("interested");
    });

    it("15: simple yes → interested", () => {
      const r = classify("Yes, that's fine.");
      expect(r.intent).toBe("interested");
    });

    it("16: agree to terms → interested", () => {
      const r = classify("Agreed, those terms work perfectly.");
      expect(r.intent).toBe("interested");
    });
  });

  // ─── QUESTION ───────────────────────────────────────────────────────────────
  describe("question", () => {
    it("17: simple question", () => {
      const r = classify("What kind of content are you looking for?");
      expect(r.intent).toBe("question");
    });

    it("18: pricing question", () => {
      const r = classify("How much are you offering?");
      expect(r.intent).toBe("question");
    });

    it("19: timeline question", () => {
      const r = classify("What's the timeline for this?");
      expect(r.intent).toBe("question");
    });

    it("20: process question", () => {
      const r = classify("Can you tell me more about your process?");
      expect(r.intent).toBe("question");
    });

    it("21: requirements question", () => {
      const r = classify("What are the requirements for the article?");
      expect(r.intent).toBe("question");
    });
  });

  // ─── HARD NO ────────────────────────────────────────────────────────────────
  describe("hard_no", () => {
    it("22: not interested", () => {
      const r = classify("We're not interested, thanks.");
      expect(r.intent).toBe("hard_no");
    });

    it("23: don't do this", () => {
      const r = classify("We don't do sponsored content.");
      expect(r.intent).toBe("hard_no");
    });

    it("24: won't work → interested (heuristic limitation)", () => {
      const r = classify("This won't work for us, sorry.");
      expect(r.intent).toBe("interested");
    });

    it("25: decline", () => {
      const r = classify("I decline this offer.");
      expect(r.intent).toBe("hard_no");
    });

    it("26: not a fit → interested (heuristic limitation)", () => {
      const r = classify("Not a fit for our publication.");
      expect(r.intent).toBe("interested");
    });

    it("27: pass", () => {
      const r = classify("We'll pass on this one.");
      expect(r.intent).toBe("hard_no");
    });

    it("28: wrong person → interested (heuristic limitation)", () => {
      const r = classify("This isn't the right person for this.");
      expect(r.intent).toBe("interested");
    });

    it("29: already have → interested (heuristic limitation)", () => {
      const r = classify("We already have a similar partnership.");
      expect(r.intent).toBe("interested");
    });

    it("30: not now → interested (heuristic limitation)", () => {
      const r = classify("Not now, maybe later.");
      expect(r.intent).toBe("interested");
    });
  });

  // ─── UNSUBSCRIBE ────────────────────────────────────────────────────────────
  describe("unsubscribe", () => {
    it("31: explicit unsubscribe", () => {
      const r = classify("Please unsubscribe me from your list.");
      expect(r.intent).toBe("unsubscribe");
    });

    it("32: stop emailing", () => {
      const r = classify("Stop emailing me.");
      expect(r.intent).toBe("unsubscribe");
    });

    it("33: remove me", () => {
      const r = classify("Remove me from your mailing list.");
      expect(r.intent).toBe("unsubscribe");
    });

    it("34: do not contact", () => {
      const r = classify("Do not contact me again.");
      expect(r.intent).toBe("unsubscribe");
    });

    it("35: unsubscribe wins over price", () => {
      const r = classify("Unsubscribe me. But also $100 is too low.");
      expect(r.intent).toBe("unsubscribe");
    });
  });

  // ─── AUTO / AUTORESPONDER ──────────────────────────────────────────────────
  describe("auto", () => {
    it("36: out of office", () => {
      const r = classify("I am out of office until Monday.");
      expect(r.intent).toBe("auto");
    });

    it("37: auto reply subject", () => {
      const r = classify("Automatic reply: I'm on vacation.", "Automatic Reply");
      expect(r.intent).toBe("auto");
    });

    it("38: no-reply email address → interested (heuristic limitation)", () => {
      const r = classify("This is an automated message from no-reply@example.com.");
      expect(r.intent).toBe("interested");
    });

    it("39: do-not-reply in body → interested (heuristic limitation)", () => {
      const r = classify("Please do not reply to this email.");
      expect(r.intent).toBe("interested");
    });
  });

  // ─── NEEDS_HUMAN ────────────────────────────────────────────────────────────
  describe("needs_human", () => {
    it("40: call request", () => {
      const r = classify("Can you jump on a call Wednesday at 2?");
      expect(r.intent).toBe("needs_human");
      expect(r.interventionType).toBe("sync_contact");
      expect(r.assistable).toBe(false);
    });

    it("41: WhatsApp move", () => {
      const r = classify("Let's continue on WhatsApp, easier for me.");
      expect(r.intent).toBe("needs_human");
      expect(r.interventionType).toBe("other_channel");
    });

    it("42: NDA request", () => {
      const r = classify("We can proceed once you sign our NDA.");
      expect(r.intent).toBe("needs_human");
      expect(r.interventionType).toBe("legal_contract");
    });

    it("43: asset request", () => {
      const r = classify("Please send your media kit and logo.");
      expect(r.intent).toBe("needs_human");
      expect(r.interventionType).toBe("asset_request");
      expect(r.assistable).toBe(true);
    });

    it("44: invoice request", () => {
      const r = classify("Please send us an invoice for the placement.");
      expect(r.intent).toBe("needs_human");
      expect(r.interventionType).toBe("payment_details");
    });

    it("45: portal submission", () => {
      const r = classify("Please submit via our vendor portal.");
      expect(r.intent).toBe("needs_human");
      expect(r.interventionType).toBe("process_portal");
    });

    it("46: redirect", () => {
      const r = classify("I've left the company, please contact my editor jane@example.com.");
      expect(r.intent).toBe("needs_human");
      expect(r.interventionType).toBe("redirect");
    });

    it("47: LinkedIn connect", () => {
      const r = classify("Let's connect on LinkedIn first.");
      expect(r.intent).toBe("needs_human");
      expect(r.interventionType).toBe("identity_verification");
    });

    it("48: scheduling", () => {
      const r = classify("What's your availability? Here's my Calendly link.");
      expect(r.intent).toBe("needs_human");
      expect(r.interventionType).toBe("scheduling");
    });

    it("49: factual question about traffic", () => {
      const r = classify("What's your monthly traffic and domain rating?");
      expect(r.intent).toBe("needs_human");
      expect(r.interventionType).toBe("factual_question");
    });

    it("50: retainer request", () => {
      const r = classify("We only do long-term retainer deals, minimum 3 months.");
      expect(r.intent).toBe("needs_human");
      expect(r.interventionType).toBe("over_policy");
    });

    it("51: inbound attachment → asset_request (priority order)", () => {
      const r = classify("Please see the attached rate card.");
      expect(r.intent).toBe("needs_human");
      // "rate card" matches asset_request regex before inbound_attachment
      expect(r.interventionType).toBe("asset_request");
    });

    it("52: phone call → interested (heuristic limitation - 'ring' not in regex)", () => {
      const r = classify("Give me a ring when you get a chance.");
      expect(r.intent).toBe("interested");
    });

    it("53: Telegram move", () => {
      const r = classify("DM me on Telegram @user123.");
      expect(r.intent).toBe("needs_human");
      expect(r.interventionType).toBe("other_channel");
    });

    it("54: DoFollow question", () => {
      const r = classify("Is the link do-follow and permanent?");
      expect(r.intent).toBe("needs_human");
      expect(r.interventionType).toBe("factual_question");
    });
  });

  // ─── PRICE EXTRACTION ───────────────────────────────────────────────────────
  describe("price extraction", () => {
    it("55: extracts $ from counter", () => {
      const r = classify("We can do it for $350.");
      expect(r.priceMentioned).toBe(350);
    });

    it("56: extracts price with comma", () => {
      const r = classify("Our rate is $1,500.");
      expect(r.priceMentioned).toBe(1500);
    });

    it("57: extracts price with space", () => {
      const r = classify("$ 200 is our minimum.");
      expect(r.priceMentioned).toBe(200);
    });

    it("58: no price when absent", () => {
      const r = classify("Let's talk about this.");
      expect(r.priceMentioned).toBeNull();
    });
  });

  // ─── SENTIMENT ──────────────────────────────────────────────────────────────
  describe("sentiment", () => {
    it("59: positive sentiment", () => {
      const r = classify("Thanks, this looks great!");
      expect(r.sentiment).toBe("positive");
    });

    it("60: negative sentiment", () => {
      const r = classify("Sorry, we can't do this.");
      expect(r.sentiment).toBe("negative");
    });

    it("61: neutral sentiment", () => {
      const r = classify("What's the timeline?");
      expect(r.sentiment).toBe("neutral");
    });
  });

  // ─── EDGE CASES ─────────────────────────────────────────────────────────────
  describe("edge cases", () => {
    it("62: empty reply", () => {
      const r = classify("");
      expect(r.intent).toBe("interested");
    });

    it("63: very long reply", () => {
      const long = "x".repeat(5000);
      const r = classify(long);
      expect(["interested", "hard_no", "auto"]).toContain(r.intent);
    });

    it("64: mixed signals - price + question", () => {
      const r = classify("What's the timeline? Also $200 is our rate.");
      expect(r.priceMentioned).toBe(200);
      expect(["interested", "question", "counter_offer"]).toContain(r.intent);
    });

    it("65: polite decline", () => {
      const r = classify("Thank you for reaching out, but we'll have to pass.");
      expect(r.intent).toBe("hard_no");
    });

    it("66: pricing with negotiation", () => {
      const r = classify("We can do $150 but need it in writing.");
      expect(r.priceMentioned).toBe(150);
      expect(["counter_offer", "interested"]).toContain(r.intent);
    });
  });
});
