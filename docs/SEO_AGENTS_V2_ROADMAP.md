# SEO Agents — v2+ Roadmap

Extends the v1 **Page Health Check** (indexing + Core Web Vitals) toward the full 12-agent brief.
Remaining agents are shipped **2 per version**, grouped so each version shares one data dependency —
so a version either works entirely with what the app already has, or lights up the moment one
credential is added.

| Version | Agents | Shared dependency | Status |
|---|---|---|---|
| v1 (shipped) | GSC Error, Sitemap QA, Core Web Vitals | crawler + PageSpeed | ✅ merged to `v1` |
| **v2 (this)** | **#8 Internal Linking**, **#9 GEO Citation** | crawler + OpenRouter (already present) | 🟢 building now |
| v3 | #3 Money-Page Rank Watcher, #10 Content Refresh | Google Search Console (Search Analytics) | ⏳ needs GSC service account |
| v4 | #4 Backlink Targeting, #5 Author/Publisher Scoring | web search + domain-authority API | ⏳ needs search + DA keys |

---

## v2 — Internal Linking + GEO Citation (build now)

Both are **report-only + act-on-click**, exactly like v1: the agent computes and shows findings;
a human clicks to create a Linear task or post to Slack. Nothing is auto-applied.

### #8 Internal Linking Agent
**Goal:** when a page needs more internal links, find the existing pages that *should* link to it,
with the exact anchor text — and turn each into a task.

**How it works (no external data needed — just our crawler):**
1. Crawl a sample of the site (fast raw fetches), extracting each page's main text + the internal
   links it already has.
2. For a chosen **target page** (e.g. `/ai-image-generator`), find source pages that (a) are
   topically relevant (keyword overlap with the target), and (b) don't already link to it.
3. Suggest a natural **anchor phrase** for each (heuristic; refined by the LLM when available).
4. Rank by relevance; each suggestion → a one-click **Linear task** ("Add link from X to target,
   anchor: '…'"). Later re-runs detect whether the link now exists (closes the loop).

### #9 GEO Citation Agent
**Goal:** see where ImagineArt vs competitors show up in AI answers, and which sources AI cites.

**How it works (uses the existing OpenRouter key):**
1. Run a set of buyer-intent prompts (e.g. "best AI image generator") through an AI-answer model
   with citations (Perplexity Sonar via OpenRouter).
2. Per prompt, detect whether **ImagineArt** and each **competitor** is mentioned, and collect the
   **domains the AI cited**.
3. Aggregate into: brand **share-of-voice**, competitor share-of-voice, a **cited-domain
   leaderboard**, and **source gaps** (domains competitors get cited from that we don't).
4. Source gaps → a one-click Slack post / task, feeding the outreach + content agents later.

**Known limit:** Google "AI Overview" specifically isn't available via any API — it needs a SERP
provider (deferred). Perplexity/ChatGPT-style engines are covered.

---

## v3 — Rank Watcher + Content Refresh (needs GSC)
- **#3 Rank Watcher:** pull GSC Search Analytics, surface money pages stuck in positions 4–10
  ("striking distance"), and recommend fixes (internal links via #8, schema/content gaps via the
  v1 crawler). Competitor-outranking analysis needs a SERP API (partial without it).
- **#10 Content Refresh:** find pages losing clicks over time (GSC), generate a refresh brief
  (outdated sections, missing entities, weak intro, FAQ/schema, internal links) via the crawler + LLM.
- **Unblock:** finish `docs/GSC_SETUP.md` (service account on the imagine.art property).

## v4 — Backlink Targeting + Author Scoring (needs search + DA)
- **#4 Backlink Targeting:** for a specific money page, find articles that could link *to that page*
  (reuses the existing web-search/discovery infra; Tavily key already present).
- **#5 Author/Publisher Scoring:** score each prospect on relevance, freshness, outbound-link
  quality, spam risk, and likely reply rate. Domain-authority needs a key (`OPEN_PAGE_RANK_API_KEY`
  or Ahrefs) — the rest is heuristic.

---

## Blockers summary (what stops each version being fully live)
- **v2:** none — ships working today.
- **v3:** GSC service account (one-time, ~15 min — `docs/GSC_SETUP.md`).
- **v4:** a domain-authority key for full author scoring; a SERP API for competitor rank analysis.
  Backlink targeting itself works on the existing Tavily key.
