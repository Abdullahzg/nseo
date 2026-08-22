# SEO Agents v4 — Backlink Targeting (#4) + Author/Publisher Scoring (#5)

Fourth slice of the 12-agent brief — the "get links to the right page" pair. Both work off web
search + a live crawl, so #4 runs today on the existing Tavily key; #5 is fully functional except
the domain-authority number, which needs one key.

Same rules as v1–v3: **report-only, act-on-click.** Surfaced together in one **Backlinks** tab
(find prospects → score them), since scoring operates on targeting output.

---

## #4 — Backlink Targeting Agent

**The point:** don't just "find prospects" — decide *which page needs links* and find articles that
can link **to that specific page** (e.g. `/ai-image-generator`), not the homepage.

**Logic:**
1. Take a target money page. Derive its topic from the title/slug (e.g. "AI image generator").
2. Build buyer-intent link queries (`best <topic>`, `<topic> tools list`, `<topic> alternatives`,
   `<topic> review`) and run them through the existing web-search layer (Tavily today; Google/
   Brave/Serper if keyed).
3. Collect result URLs, drop our own domain, dedupe by domain, and rank by how often + how
   relevantly they appear. Listicles / comparisons / roundups score highest (they're the pages
   most likely to add a tool).
4. Score the top candidates with the #5 agent (below) so the output is a *ranked, qualified* list
   tied to that page — each with a suggested outreach angle.

**Output:** for the target page, a ranked prospect list (domain, article, why, angle, score).
Dispatch: share to Slack or open a Linear task. (Feeding these straight into the existing outreach
tool's campaigns is a natural later integration.)

---

## #5 — Author/Publisher Scoring Agent

**The point:** qualify each prospect so outreach time goes to the ones worth it.

**Per prospect (crawl + heuristics + LLM):**
| Signal | Source | Notes |
|---|---|---|
| Topical relevance | crawl + keyword overlap with the target topic | works today |
| Recent publishing activity | dates in page/meta | best-effort from the page |
| Outbound link quality | external-link analysis | ratio + spammy-link detection |
| Spam risk | heuristics (thin, keyword-stuffed, spammy TLD/terms) | works today |
| Likely reply rate | composite heuristic | derived from the above |
| Best outreach angle | LLM reads the page | e.g. "suggest adding ImagineArt to their 'best AI image generators' list" |
| **Domain authority** | **OpenPageRank / Ahrefs API** | **gated** — shows n/a without a key |
| **Composite score** | weighted blend | DA folded in when available |

---

## Technical shape (mirrors v1–v3)

```
src/lib/seo-agents/authorScoring.ts    scoreProspect(url, topicTerms) + scoreMany()
src/lib/seo-agents/backlinkTargets.ts  runBacklinkTargets(targetPage, {score})
src/app/api/seo-agents/backlinks/route.ts
src/app/seo-agents/page.tsx            + "Backlinks" tab (find + score, plus a "score any URL" box)
```

- External candidate pages are fetched with a plain raw request (they're normal SSR sites — no need
  for headless Chromium; faster and cheaper).
- Report-only, in-memory; dispatch reuses `/api/indexing/ticket` + `/api/indexing/slack`.
- No new DB tables for the MVP.

---

## Success criteria
- Backlink Targeting returns real, topic-matched articles for a given money page **today** (Tavily),
  each with a score and an outreach angle.
- Author Scoring produces a defensible per-signal breakdown for any URL today; the DA column
  populates the moment a domain-authority key is added.

## Blockers
- **Domain-authority key** — free `OPEN_PAGE_RANK_API_KEY` (openpagerank.com) or Ahrefs — for the
  DA signal + a DA-weighted composite. Everything else works without it.
- Web search already works on the existing **Tavily** key; adding `GOOGLE_CSE_KEY`/`SERPER_API_KEY`
  would broaden coverage but isn't required.
