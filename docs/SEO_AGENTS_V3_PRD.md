# SEO Agents v3 — Money-Page Rank Watcher (#3) + Content Refresh (#10)

Third slice of the 12-agent brief. Both agents run on **Google Search Console Search Analytics**
(the ranking + click data GSC already collects for imagine.art), so they share one dependency and
light up together the moment the GSC service account from `docs/GSC_SETUP.md` is connected.

Same product rules as v1/v2: **report-only, act-on-click, a human decides.** Nothing is auto-applied.

---

## Why these two

- **Rank Watcher** answers "which money pages are *almost* winning, and what would push them over?"
  Pages ranking positions **4–10** ("striking distance") are the highest-ROI SEO work — small,
  targeted pushes turn page-2/low-page-1 into top-3 traffic.
- **Content Refresh** answers "which pages are *losing* traffic, and what specifically to rewrite?"
  Decay is the silent killer of programmatic sites; catching it early and shipping a precise brief
  is far cheaper than rewriting blindly.

Both reuse machinery we already built: the v1 crawler (on-page/schema signals), the v2 Internal
Linking agent (link recommendations), and the shared LLM helper (brief writing).

---

## #3 — Money-Page Rank Watcher

**Input:** GSC Search Analytics (last 28 days), dimensions `page` + `query`.

**Logic:**
1. Pull query rows for the site; keep those whose **URL is a money page** (v1 money-page patterns)
   and whose **average position is 4.0–10.0** with meaningful impressions (default ≥ 20/mo).
2. Group by page → each money page gets its list of striking-distance queries (position, impressions,
   CTR), sorted by opportunity (impressions × distance-to-top-3).
3. For each page, attach **recommendations**, computed from data we already have:
   - **Internal links needed** — reuse the v2 Internal Linking agent for that page.
   - **Schema gap / content gap** — crawl the page (v1 crawler): missing JSON-LD, thin content,
     missing H1/meta.
   - **Competitors outranking + why** — *needs a SERP API* (deferred; shown as "not available"
     until a SERP key is added). This is the one partial in v3.
4. Output per page: the queries it's close on, the estimated traffic upside, and a checklist of
   fixes → each fix dispatches to a Linear ticket (reusing the v1 ticket endpoint).

**Entry point:** fully automatic once GSC is connected. No manual mode (the whole point is the rank data).

---

## #10 — Content Refresh Agent

**Two entry points** (so it's useful even before GSC is on):
- **Auto (needs GSC):** compare clicks in the last 28 days vs the prior 28 days; flag pages with a
  meaningful **click decline** (default ≥ 30% drop, min 10 prior clicks).
- **Manual (works today):** paste any URL → generate a refresh brief directly, no GSC needed.

**Brief generation (crawler + LLM):** for a chosen page, crawl the rendered content and produce a
structured brief:
- outdated sections / stale references,
- missing entities & subtopics vs. the query intent,
- weak intro assessment,
- FAQ / schema additions,
- internal links to add (reuse v2 Internal Linking),
- a short prioritized rewrite checklist.

**Output:** the brief, dispatchable as a Linear ticket for the content team.

---

## Technical shape (mirrors v1/v2)

```
src/lib/indexing/gsc.ts        + searchAnalytics(dateRange, dims)   ← new method on existing client
src/lib/seo-agents/rankWatcher.ts        runRankWatcher()
src/lib/seo-agents/contentRefresh.ts     runContentRefresh({url?} | auto)
src/app/api/seo-agents/rank-watcher/route.ts
src/app/api/seo-agents/content-refresh/route.ts
src/app/seo-agents/page.tsx    + two tabs: "Rankings" and "Content Refresh"
```

- Both call `isGscConfigured()`; without it, return a report with a clear "connect Google Search
  Console" note (same graceful pattern as the v1 live monitor). Content Refresh's manual mode still
  works.
- No new DB tables required for the MVP (report-only, in-memory). Persistence/history can be added
  later reusing the v1 pattern.
- Ticket/Slack dispatch reuses the existing `/api/indexing/ticket` and `/api/indexing/slack` routes.

---

## Success criteria

- Rank Watcher lists every money-page query in positions 4–10 with an opportunity score, and a
  fix checklist per page — verified against real GSC data once connected.
- Content Refresh produces a usable, specific brief for any URL **today** (manual mode), and
  auto-detects decliners once GSC is connected.

## Blockers

- **GSC service account** (one-time, ~15 min — `docs/GSC_SETUP.md`) — required for Rank Watcher and
  for Content Refresh's auto-decliner mode. Content Refresh manual mode needs nothing new.
- **SERP API** (e.g. Serper/Ahrefs) — only for Rank Watcher's "competitors outranking & why"
  section. Everything else in Rank Watcher works on GSC alone.
- **PLAYWRIGHT_ENABLED=true** in the run environment (same as v1/v2) so the crawler reads JS-rendered
  content for the recommendation/brief steps.
