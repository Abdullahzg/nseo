import { getAuthorArticleUrls, getKnownEmailsByDomain, getStoredLinkedin } from "@/lib/db/queries";
import { scrapePageSignals, type PageSignals } from "./pageSignals";
import { findLinkedinUrl } from "./findLinkedin";
import { linkedinToEmail, blitzEnabled } from "./blitz";
import { resolveDomainPattern, type DomainPattern } from "./patternInfer";
import { aiScrapeEmail, aiScrapeEnabled } from "./aiScrape";
import { hermesEnabled, hermesScrape } from "@/lib/hermes/client";
import { isRoleEmail, isPlaceholderEmail } from "./personFilter";
import {
  findEmailHunter, domainSearchHunter, pickFromDomainSearch, hunterEnabled,
  type HunterDomainResult,
} from "./hunter";
import { findEmailEnrichSo, enrichSoEnabled } from "./enrichso";
import { verifyEmail } from "./verify";
import { registrableDomain } from "@/lib/util/domain";

export interface CascadeTarget { id: string; name: string; host: string; publication: string }
export interface CascadeResult {
  email: string;
  source: string;
  score?: number;
  /** Set ONLY when the address belongs to someone other than the author we were resolving — a Hunter
   *  domain-search alt contact. The pitch must greet this person, not the byline, or it goes out
   *  misaddressed. Null/undefined means "this is the author's own address", the normal case. */
  ownerName?: string | null;
  ownerPosition?: string | null;
}

// Upper bound on how many of an author's posts we scan for their LinkedIn. Scanning stops
// early the moment a LinkedIn (or direct email) is found, so most authors scan far fewer.
const MAX_POSTS_SCAN = 50;

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// Full per-person cascade. Emits onStep(detail) for the live verbose feed. Order:
//  1. scrape their recent article/author pages → direct email + social links
//  2. get LinkedIn (from those pages, or a DuckDuckGo name+company search)
//  3. LinkedIn → Blitz → email   ← the unlock (Blitz is unlimited)
//  4. scrape their socials/personal site for an email
//  5. domain email-pattern (from emails we already have)
//  6. AI-scan the site with your Claude key
//  7. Hunter domain-search — needs NO name, so it catches the prospects email-finder cannot
export async function resolveEmailCascade(
  t: CascadeTarget,
  ctx: {
    onStep: (detail: string) => void;
    // onIssue records a REAL provider failure (Blitz/Reoon/AI/search error) — distinct
    // from a clean "nothing found" — so the UI can say "couldn't complete" vs "no email".
    onIssue?: (detail: string) => void;
    // onLinkedin fires when a LinkedIn URL is discovered en route to the email — the caller
    // persists it so an email run ALSO harvests LinkedIns (even if no email is found).
    onLinkedin?: (url: string) => void;
    // onContact fires for EVERY contact signal seen on the way, whatever the email outcome.
    //
    // Before this the cascade collected socials in absorb() and then discarded them on `return null` —
    // so a prospect with a public X profile and a working contact form was recorded as having no way to
    // reach them at all. Roughly 13 of 15 prospects in a real campaign came back "no email", and most of
    // them were reachable by some other route we had already found and thrown away.
    //
    // An email is the best channel, not the only one. Storing the rest turns a dead prospect into a
    // manual one, which for backlink outreach is the difference between a lost link and a slower link.
    onContact?: (c: { type: "twitter" | "linkedin" | "instagram" | "mastodon" | "form" | "author_page"; value: string; confidence: number }) => void;
    patternCache: Map<string, DomainPattern | null>;
    // Hunter domain-search costs one credit per CALL regardless of how many addresses come back, and a
    // campaign routinely has several prospects at one publication. Cached per run so a 15-prospect
    // campaign across 6 domains spends 6 credits, not 15. `null` caches a miss so we don't retry it.
    hunterDomains?: Map<string, HunterDomainResult | null>;
    domainVerify: Map<string, "safe" | "catch_all" | "invalid" | "unknown">;
  },
): Promise<CascadeResult | null> {
  const { onStep } = ctx;
  // Fires on any provider failure: log it as a "!"-prefixed step AND record it as an issue.
  // The prefix is the wire format the step list styles on — see email-finder/page.tsx.
  const onFail = (provider: string) => (msg: string) => {
    onStep(`! ${provider} failed: ${msg}`);
    ctx.onIssue?.(`${provider}: ${msg}`);
  };
  const socials: PageSignals = { emails: [] };
  // Flush whatever was found to the caller. Called at every return path, because the path that matters
  // most is the one where no email turned up.
  const flushContacts = () => {
    const seen: Array<[string, string | undefined, number]> = [
      ["linkedin", socials.linkedin, 0.85],
      ["twitter", socials.twitter, 0.8],
      ["instagram", socials.instagram, 0.7],
      ["mastodon", socials.mastodon, 0.7],
      ["author_page", socials.personalSite, 0.6],
    ];
    for (const [type, value, confidence] of seen) {
      if (value) ctx.onContact?.({ type: type as never, value, confidence });
    }
  };
  const absorb = (sig: PageSignals | null) => {
    if (!sig) return;
    socials.linkedin ??= sig.linkedin;
    socials.twitter ??= sig.twitter;
    socials.instagram ??= sig.instagram;
    socials.mastodon ??= sig.mastodon;
    socials.personalSite ??= sig.personalSite;
  };

  // If we ALREADY have this author's LinkedIn on file (from the LinkedIn finder or a prior
  // email run), reuse it and skip the post scan + web search entirely — no wasted search.
  const stored = await getStoredLinkedin(t.id).catch(() => null);
  let linkedin: string | undefined = stored ?? undefined;
  let linkedinIsNew = false;

  if (linkedin) {
    onStep(`LinkedIn already on file (${linkedin.replace(/^https?:\/\//, "")}) — skipping search`);
  } else {
    // 1) Scan ALL their posts for a direct email + their LinkedIn (stop scanning once
    //    LinkedIn turns up — that's enough to get the email via Blitz).
    const urls = await getAuthorArticleUrls(t.id, MAX_POSTS_SCAN).catch(() => []);
    if (urls.length) {
      onStep(`scanning ${urls.length} post${urls.length === 1 ? "" : "s"} for email & LinkedIn…`);
      for (let i = 0; i < urls.length; i++) {
        onStep(`↳ post ${i + 1}/${urls.length}: ${hostOf(urls[i])}`);
        const sig = await scrapePageSignals(urls[i]);
        // A page footer/nav often lists a generic org mailbox (plus@shopify.com, press@…) that
        // is NOT the author's — take the first address that isn't a role/generic mailbox.
        const pem = sig?.emails.find((e) => !isRoleEmail(e));
        if (pem) { onStep(`found email on their page`); flushContacts(); return { email: pem, source: "page-scrape", score: 90 }; }
        absorb(sig);
        if (socials.linkedin) { onStep(`found LinkedIn on a post: ${socials.linkedin.replace("https://", "")}`); break; }
      }
    }

    // 2) No LinkedIn yet? Check their social profiles (bios often link LinkedIn + email).
    if (!socials.linkedin) {
      for (const [label, surl] of [["X", socials.twitter], ["Instagram", socials.instagram], ["site", socials.personalSite]] as const) {
        if (!surl || socials.linkedin) continue;
        onStep(`checking ${label} profile for LinkedIn/email…`);
        const sig = await scrapePageSignals(surl);
        const sem = sig?.emails.find((e) => !isRoleEmail(e));
        if (sem) { onStep(`found email on ${label}`); flushContacts(); return { email: sem, source: "social", score: 80 }; }
        absorb(sig);
        if (socials.linkedin) onStep(`found LinkedIn on ${label}: ${socials.linkedin.replace("https://", "")}`);
      }
    }

    // 3) Still no LinkedIn? Search the web by name + publication (the paid search).
    linkedin = socials.linkedin;
    if (!linkedin) {
      onStep(`searching the web for LinkedIn (${t.name} @ ${t.publication})…`);
      linkedin = (await findLinkedinUrl(t.name, t.publication, undefined, onFail("web search")).catch(() => null)) ?? undefined;
      if (linkedin) onStep(`found LinkedIn: ${linkedin.replace("https://", "")}`);
      else onStep(`no LinkedIn found anywhere`);
    }
    linkedinIsNew = !!linkedin;
  }

  // Harvest a NEWLY discovered LinkedIn (a stored one is already saved). LinkedIns are
  // higher-hit-rate and reusable (Blitz can convert them later).
  if (linkedin && linkedinIsNew) ctx.onLinkedin?.(linkedin);

  // 4) LinkedIn → Blitz → email (Blitz has unlimited credits and needs exactly this)
  if (linkedin && blitzEnabled()) {
    onStep(`Blitz: resolving email from LinkedIn…`);
    let blitzFailed = false;
    const email = (await linkedinToEmail(linkedin, (m) => { blitzFailed = true; onFail("Blitz")(m); }).catch(() => null))?.toLowerCase();
    if (email && !isRoleEmail(email)) { onStep(`Blitz returned an email`); return { email, source: "blitz-linkedin", score: 90 }; }
    if (!blitzFailed) onStep(email ? `Blitz email was generic — skipping` : `Blitz had no email for that profile`);
  }

  // 5) AI-scan the site for an email ACTUALLY on the page (not constructed) — your Claude key.
  if (aiScrapeEnabled()) {
    onStep(`AI-scanning ${t.host} for a contact email…`);
    const email = await aiScrapeEmail(t.name, t.host, onFail("AI-scan")).catch(() => null);
    if (email) { onStep(`AI found an email`); return { email, source: "ai-scrape", score: 75 }; }
  }

  // 5.5) Hermes stealth browser — the last attempt at a REAL address before we resort to guessing.
  //
  // Placed here on purpose. Steps 1-5 all use plain fetches, which publishers increasingly block;
  // when they fail we fall through to step 6 and construct an address from a domain pattern, and
  // those constructed guesses are where the bounces come from. A browser that can actually render
  // the page turns some of those guesses back into sourced addresses.
  //
  // Last resort rather than first, because a browser session per prospect is expensive — this only
  // runs when everything cheap has already failed. No-ops entirely when HERMES_BASE_URL is unset.
  if (hermesEnabled()) {
    onStep(`opening ${t.host} in a real browser…`);
    const hit = await hermesScrape({ url: `https://${t.host}`, want: "email" }).catch(() => null);
    if (hit?.ok && hit.value && !isRoleEmail(hit.value)) {
      onStep(`found an email with the browser`);
      flushContacts();
      return { email: hit.value, source: "hermes-browser", score: 88 };
    }
    if (hit && !hit.ok && hit.error) onStep(`! browser could not read ${t.host}: ${hit.error}`);
  }

  const mailDomain = registrableDomain(t.host);

  // 5.8) Hunter email-finder — name + domain.
  //
  // This is the gap that made the hit rate look like a dead end. Hunter has been configured the whole
  // time and had produced exactly ZERO emails, because findEmailHunter() is wired into
  // enrich/resolve.ts, which only the discovery pipeline calls. Backlink enrichment runs through this
  // cascade, which never reached it. Measured before the fix: 72 emails across 1,000 searched authors
  // (7.2%), 41 of them from Blitz alone, and 20 of the 72 were pattern guesses the send gate blocks.
  //
  // Placed here for the same reason as the other paid steps: after everything free has failed, before we
  // manufacture an address. A found address beats a constructed one every time.
  if (hunterEnabled() && t.name) {
    onStep(`Hunter: looking up ${t.name} at ${mailDomain}…`);
    const h = await findEmailHunter(t.name, mailDomain).catch(() => null);
    if (h?.email && !isRoleEmail(h.email)) {
      onStep(`Hunter found an address (${h.score}% confidence)`);
      flushContacts();
      return { email: h.email, source: "hunter-finder", score: h.score };
    }
    onStep(`Hunter had no match for that name`);
  }

  // 5.85) enrich.so — a second name+domain finder.
  //
  // Chained after Hunter rather than instead of it: these vendors cover overlapping but different slices
  // of the same market, so the first hit wins and a miss costs one failed lookup. Runs BEFORE
  // domain-search because it answers the same question Hunter's finder did — this person's address —
  // whereas domain-search widens to whoever is at the domain, which may be someone else entirely.
  if (enrichSoEnabled() && t.name) {
    onStep(`enrich.so: looking up ${t.name} at ${mailDomain}…`);
    const e = await findEmailEnrichSo(t.name, mailDomain).catch(() => null);
    if (e && !isRoleEmail(e.email) && !isPlaceholderEmail(e.email)) {
      // A catch-all domain accepts anything, so a hit there is not proof the mailbox exists — scored down
      // to sit below a confirmed find, and the step log says so.
      const catchAllNote = e.isCatchAll ? " (catch-all domain, so unconfirmed)" : "";
      onStep(`enrich.so found an address, ${e.confidence} confidence${catchAllNote}`);
      flushContacts();
      return {
        email: e.email,
        source: e.isCatchAll ? "enrichso-catchall" : "enrichso",
        score: e.isCatchAll ? Math.min(60, e.score) : e.score,
      };
    }
    onStep(`enrich.so had no match`);
  }

  // 5.9) Hunter domain-search — the last REAL source before we resort to constructing an address.
  //
  // Deliberately placed here, after every free attempt and before the pattern guess, for the same reason
  // the Hermes browser step sits at 5.5: it costs a credit, so it should only run when the cheap paths have
  // failed, but it must run BEFORE we manufacture a guess, because a guess is what produces bounces.
  //
  // Why this step exists at all: `email-finder` (in resolve.ts) requires a correct `full_name` and returns
  // nothing without one, so a prospect with a badly-scraped byline or a "Staff" credit finds no email.
  // Measured: a Film Studio campaign found emails for 2 of 15 prospects, while Hunter's browser extension
  // showed lion@filmcrux.com (Lion Aton, Founder, 99%) for one of the misses. domain-search needs no name,
  // which is exactly the gap.
  if (hunterEnabled()) {
    const cache = ctx.hunterDomains;
    let ds: HunterDomainResult | null | undefined = cache?.get(mailDomain);
    if (ds === undefined) {
      onStep(`asking Hunter who works at ${mailDomain}…`);
      ds = await domainSearchHunter(mailDomain).catch(() => null);
      cache?.set(mailDomain, ds);
      if (!ds) onFail("Hunter")("domain-search returned nothing");
    } else {
      onStep(`reusing Hunter's ${mailDomain} lookup from earlier in this run`);
    }

    // Hunter's detected pattern beats ours, which is inferred from whatever addresses we happen to have
    // seen. Seeded into the cache here so the fallback below builds on real evidence even when no usable
    // address came back — pattern quality is what decides whether that guess bounces.
    if (ds?.pattern && !ctx.patternCache.has(mailDomain)) {
      onStep(`Hunter says ${mailDomain} uses "${ds.pattern}"`);
    }

    if (ds) {
      const hit = pickFromDomainSearch(ds, t.name);
      if (hit && !isPlaceholderEmail(hit.person.email)) {
        const { person, matchedName } = hit;
        if (matchedName) {
          onStep(`Hunter matched ${t.name} at ${mailDomain} (${person.confidence}%)`);
          return { email: person.email, source: "hunter-domain", score: Math.max(80, person.confidence) };
        }
        // A DIFFERENT person at the same publication. Often the better contact for a link — an editor or
        // founder can place one where a freelance contributor cannot — but it is not who we set out to
        // reach, so it is tagged distinctly and scored below a name match. The UI must show who it is, or
        // the pitch gets addressed to the wrong person.
        if (person.type === "personal" && !isRoleEmail(person.email)) {
          const who = [person.firstName, person.lastName].filter(Boolean).join(" ") || person.email;
          const role = person.position ? `, ${person.position}` : "";
          onStep(`Hunter had no match for ${t.name}, but found ${who}${role} at ${mailDomain}`);
          return {
            email: person.email,
            source: "hunter-domain-alt",
            score: Math.min(75, person.confidence),
            // Carried so the pitch greets whoever this actually is. Without it the draft would open
            // "Hi <byline>," and be delivered to a different person — the one mistake a recipient
            // cannot un-see, and it burns the prospect permanently.
            ownerName: [person.firstName, person.lastName].filter(Boolean).join(" ") || null,
            ownerPosition: person.position ?? null,
          };
        }
      }
    }
  }

  // 6) Domain email pattern — CONSTRUCTED (a guess), tagged so it's never mistaken for a
  // sourced email. Built at the ORG's registrable mail domain (research.ibm.com →
  // ibm.com), inferred from emails there (or a known-publication fallback), verified once
  // per domain via Reoon; catch-all/unverified stay "guess".

  if (!ctx.patternCache.has(mailDomain)) {
    const known = await getKnownEmailsByDomain(t.host).catch(() => []);
    ctx.patternCache.set(mailDomain, resolveDomainPattern(mailDomain, known));
  }
  const pat = ctx.patternCache.get(mailDomain);
  if (pat) {
    const local = pat.format(t.name);
    if (local) {
      const candidate = `${local}@${mailDomain}`;
      onStep(`no source found — building from ${mailDomain} pattern (${pat.key})…`);
      // Verify once per domain (only cache the domain-level truths: safe / catch-all).
      let verdict = ctx.domainVerify.get(mailDomain);
      if (verdict === undefined) {
        onStep(`verifying pattern (Reoon)…`);
        verdict = (await verifyEmail(candidate, onFail("Reoon"))).status;
        if (verdict === "safe" || verdict === "catch_all") ctx.domainVerify.set(mailDomain, verdict);
        onStep(`Reoon: ${verdict === "catch_all" ? "catch-all (accepts anything)" : verdict}`);
      }
      // Always produce the pattern email (tagged as a guess) — like IBM/Fast Company. A
      // per-person "invalid"/"unknown" verdict just means we can't confirm, not that the
      // pattern is wrong, so we still return it (tagged), never a dead end.
      const source = verdict === "safe" ? "pattern-verified" : verdict === "catch_all" ? "pattern-catchall" : "pattern";
      const score = verdict === "safe" ? 95 : verdict === "catch_all" ? 65 : 55;
      flushContacts();
      return { email: candidate, source, score };
    }
  }

  flushContacts();
  return null;
}
