# Agent Honesty & UX Fixes — Plan

Fixes for the issues found in the live audit (real-Chrome test against the running app +
line-level code audit). Goal: no output should claim to be live data when it's a heuristic,
a stub, or a template; every "measured" number should be real or clearly labelled an estimate;
production should run on the same live data as local; and the UX should surface real problems
loudly and stubs never.

Grouped by dependency so we can ship the safe wins immediately and gate the rest on your input.

---

## Group A — Quick honesty + UX fixes (no keys, low risk)

### A1. Promote own-domain 5xx to an urgent "broken" finding
**Problem:** dozens of imagine.art `/apps/*` pages return HTTP 500 but are downgraded to the
grey "Couldn't verify" list — a real outage-level signal is hidden.
**Fix:** in `src/lib/linkaudit/run.ts` `checkLink()` (the branch that classifies non-OK
statuses, ~`:336-389`), when `status >= 500` **and** the link host is a first-party domain
(`imagine.art` / `*.imagine.art`), classify as broken with reason `http-5xx` instead of
`unreachable`. Add `http-5xx` to `REASON_LABEL` in `BrokenLinksPanel.tsx`. Third-party 5xx/403
stay in "Couldn't verify" (those are usually bot-blocks, not our bug).

### A2. Remove Rank Watcher stub lines
**Problem:** every one of 143 cards prints `"Competitors outranking & why: needs a SERP API
(not connected)"` and an always-appended `"Add internal links pointing here."`
**Fix:** `src/lib/seo-agents/rankWatcher.ts` — delete the hardcoded competitor line (`:101`)
and the unconditional internal-links string (`:93`). Replace the internal-links rec with a
**real** one (see B3). Competitor analysis becomes real only if a SERP key is provided (C1);
otherwise the line simply doesn't render. Keep the schema-gap and thin-content recs (already
real, crawl-derived).

### A3. Rankings list: filter / sort / top-N
**Problem:** 143 rows, no controls; also surfaces NSFW-adjacent real queries mixed in.
**Fix:** `src/app/seo-agents/page.tsx` RankWatcher section — add a search box (filter by
path/query), a sort toggle (opportunity ▸ best-position ▸ impressions), a "show top N / show
all" control, and an optional "hide adult-term pages" checkbox (client-side term filter,
default off). Pure client-side over the already-fetched list.

### A4. Site Audit run model + empty-tabs-on-load
**Problem:** one "Run audit" fires both the ~60s page scan and the ~1,500-page link crawl with
no way to run just one; detail tabs are empty on first load while the tiles already show
last-run numbers.
**Fix:** `src/app/site-audit/page.tsx` — (a) split the button into "Run audit" (both) with a
small caret menu / secondary buttons "Pages only" and "Links only"; (b) on mount, auto-load
the most recent persisted page-health run into the report (call `openHistoryRun(history[0].id)`
once history loads) so Indexability/Speed/Page-types are populated on arrival, matching the
tiles.

### A5. Honesty labels on heuristic scores
**Problem:** "reply likelihood: high", relevance %, spam risk read as measured stats.
**Fix:** in the Backlinks/Author-scoring UI (`src/app/seo-agents/page.tsx` + `/backlinks`
prospect table) tag heuristic fields with a small "est." pill + tooltip ("estimated from
on-page signals, not a measured rate"). Mark Domain Rating as the one live signal (Ahrefs).
No scoring math changes — just truthful labelling.

### A6. Close the outreach auth hole
**Problem:** `POST /api/workflows/[id]/generate-emails` has no auth guard.
**Fix:** add the same `authorized()` (CRON_SECRET-or-session) guard used by the other routes.

---

## Group B — Real feature builds (no new keys; use existing OpenRouter)

### B1. Reply Handling intent taxonomy
**Problem:** classification is regex reply/bounce/auto + sentiment only — not the spec's
interested / asks-price / wants-topic / not-interested / follow-up-later.
**Fix:** add an LLM intent classifier (OpenRouter, existing key) in `src/lib/email/inbox.ts`
alongside `analyzeSentiment` — one call returning `{ intent, confidence }` over the reply body.
Persist `reply_intent` on `outreach_emails` (small migration) and surface it in the Inbox with
an "assign to human when deal is real" flag (auto-route only `interested`/`asks-price` to a
human queue). Reuse the existing sentiment plumbing.

### B2. GSC "soft 404" class + raise inspection cap
**Problem:** indexing coverage has no soft-404 class; live GSC enriches only the first 40 URLs.
**Fix:** (a) add a `soft_404` signal to the indexing classifier (`src/lib/indexing/classify.ts`
/ `gate.ts`) using the same heuristic Link Audit already uses (200 + not-found wording / thin
error-shell) — port from `linkaudit/run.ts` soft-404 detection. (b) Make the GSC inspection cap
a parameter (default up to ~200; GSC quota is 2,000/day) in `src/lib/indexing/run.ts:217-224`.
(c) Document in-code that GSC has **no bulk index-coverage API** — per-URL inspection is the
only real source, so "daily coverage pull" = nightly crawl + inspection, by design.

### B3. Rank Watcher real internal-link rec (reuse the sweep)
**Problem:** internal-links rec was a static string.
**Fix:** in `rankWatcher.ts`, query `internal_link_opportunities` (already populated nightly by
the Internal Linking sweep) for `target_path = this page`; if N open opportunities exist, show
"**N** pages could link here — open Internal Links" linking to the sweep backlog filtered to
that target. Real, data-backed, and ties two agents together. Omit the line when N = 0.

### B4. Personalized Outreach — actually read the article
**Problem:** the opener is written from **stored** article metadata, not a live read; the UI
implies a live read.
**Fix (recommended):** in `generate-emails/route.ts` `generateOpener()`, fetch the prospect's
article URL live (reuse `fetchRaw` + readability extract) and feed the current article text to
the LLM, falling back to stored metadata on fetch failure. Makes the claim true. Adds ~1 fetch
per email (bounded, cached per URL for the run). *Alternative if you'd rather not add latency:*
soften the UI copy to "personalized from the article's topic" — cheaper, still honest.
→ **Needs your call (see question 3).**

---

## Group C — Bigger builds / need a key or your go-ahead

### C1. Real competitor analysis + AI Overviews (needs a SERP API key)
Rank Watcher's "competitors outranking & why" and GEO's Google-AI-Overviews check both need
live SERP data, which requires a SERP API. The codebase already has an **empty
`SERPER_API_KEY` slot** (`.env.local`) and Serper support wired in `webSearch.ts`.
**With a Serper key** I can: (a) pull the live top-10 for each striking-distance query, list
who outranks us and their on-page signals ("why"), and (b) capture Google AI-Overview citations
for GEO. **Without it**, these lines stay hidden (A2) rather than stubbed.
→ **Needs a `SERPER_API_KEY` (see question 1).** (~$50/mo for 50k queries, or the free 2,500
one-time tier to trial.)

### C2. GEO multi-engine fan-out
**Problem:** GEO queries one engine (Perplexity Sonar).
**Fix:** turn the single call into a fan-out over the engines we can actually get citations
from: Perplexity Sonar (have it), plus Gemini and a GPT web-search model **if reachable via
OpenRouter with citation annotations** (I'll verify which expose sources); Google AI Overviews
via Serper (C1). Show a per-engine SoV breakdown and label exactly which engines were checked
(no faking an engine we can't query). Some engines may end up "not available via API" — I'll
label that honestly rather than stub it.

### C3. #11 Programmatic Page Quality agent (net-new)
**Problem:** doesn't exist. Nothing scores generated/localized pages before publish.
**Fix:** new `src/lib/seo-agents/pageQuality.ts` + route + a Growth Agents tab. For a given
URL (or batch): unique-content score (reuse the jaccard/shingle uniqueness from `run.ts`),
thin-content risk (word count), template-completeness (title/meta/h1/schema via `onpage.ts`),
duplicate risk vs siblings, and — for localized pages — an LLM localization-quality check
(fluency / untranslated-string detection). Verdict: **publish / noindex / hold**. Reuses
existing gate + uniqueness + LLM; no new key.
→ **Confirm you want this built now (see question 2).**

### C4. #2 Sitemap QA as a real pre-publish gate (net-new surface)
**Problem:** the gate checks exist but only run report-only on already-live pages.
**Fix:** new `POST /api/sitemap-qa` that accepts a list of candidate URLs (or fetches a
draft/candidate sitemap), runs the existing `evaluateGate()` on each, and returns
pass/block per URL with reasons — the thing a publish pipeline calls to keep bad URLs out.
Add a small UI to paste/upload URLs and see pass/block. (A true CI/CMS hook that *blocks*
publish still needs to be called from wherever sitemaps are generated — out of this repo — but
this gives the callable gate + a manual UI.)
→ **Confirm you want this built now (see question 2).**

---

## D — Your actions (I can't do these from here)

### D1. Add env vars to Vercel (production runs blind without this)
The nightly cron on Vercel lacks the live-data keys, so automated Page Health / Rank Watcher /
Content Refresh fall back to predictions in production. Add these to the Vercel project's
Environment Variables (Production), same values as local `.env.local`:
- `GSC_PROPERTY` = `sc-domain:imagine.art`
- `GSC_SA_JSON` = (the service-account JSON, one line)
- `GOOGLE_API_KEY` = (CrUX/PageSpeed key)
- `AHREFS_API_KEY` (optional; the free endpoint needs a key from 2026-08-10)
- `STRAPI_URL`, `STRAPI_API_TOKEN`, `STRAPI_BLOG_TYPE`, `STRAPI_CATEGORY_TYPE` (for the blog composer)
- `SERPER_API_KEY` (if we do C1)
Then redeploy. I'll verify the next nightly run shows real "Google says:" data.

---

## Suggested sequencing
1. **Group A** (safe, immediate) — ship first, one commit.
2. **Group B** (real features, no keys) — second commit.
3. **Group C** — after you confirm the Serper key (C1/C2) and the two net-new agents (C3/C4).
4. **D1** in parallel on your side.

## Decisions (locked)
- **SERPER_API_KEY added** ✅ → C1 (real competitor analysis) + AI-Overviews in GEO are ON.
- **Build both net-new agents** ✅ → C3 Programmatic Page Quality + C4 Sitemap QA gate.
- **B4 dropped** — leave Personalized Outreach exactly as-is (no logic or copy change).
- **GEO → all four engines** (revised C2): fan out to **ChatGPT, Perplexity, Gemini, Google AI
  Overviews**, real citations per engine, per-engine SoV, honest labels for any engine without a
  key. Keys the user will add: `OPENAI_API_KEY` (ChatGPT), `GEMINI_API_KEY` (Gemini);
  Perplexity uses existing `OPENROUTER_API_KEY`; AI Overviews uses `SERPER_API_KEY`.
- **You add the Vercel env vars** (D1) — needed for production to stop running blind. Add
  `OPENAI_API_KEY`, `GEMINI_API_KEY`, `SERPER_API_KEY` to that list too.
