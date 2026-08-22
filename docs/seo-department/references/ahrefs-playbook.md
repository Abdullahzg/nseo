# Ahrefs playbook for this skill

All of these are MCP tools on the Ahrefs connector. Tool names in this file are the short form; the actual
MCP tool name is `mcp__<connector-id>__<short-name>`, found via ToolSearch if not already loaded (search
`select:<short-name>` or a keyword like "ahrefs keyword"). Always call the `doc` tool for a given endpoint
once per session if you're unsure of valid `select` columns or `where` fields — the params below are
confirmed working as of this writing, but Ahrefs adds columns over time.

Every call costs Ahrefs API units — don't fetch more `select` columns or `limit` than you need, and prefer
targeted `where` filters over pulling everything and filtering client-side (some endpoints return so many
rows the tool truncates to a file instead of returning content inline).

## 1. Dedupe check: does imagine.art already have this page?

```json
// site-explorer-crawled-pages
{
  "select": "url,title,http_code",
  "target": "imagine.art",
  "mode": "subdomains",
  "where": "{\"and\":[{\"field\":\"http_code\",\"is\":[\"eq\",200]},{\"field\":\"url\",\"is\":[\"isubstring\",\"<product-or-keyword-term>\"]}]}",
  "limit": 200
}
```

`mode` must be `subdomains` for a bare domain like `imagine.art` — `mode: domain` silently excludes
`www.imagine.art`, `help.imagine.art`, etc., which is most of the site. Pick a `where` substring narrow
enough to return a manageable list (e.g. `"ltx studio"` or `"film-studio"`, not just `"studio"` — that one
alone returns 140+ rows because Music Studio has 100+ sub-pages).

Back this up with a plain web search: `site:imagine.art "<exact term>"` — Ahrefs' crawl can lag a page that
shipped in the last few days.

## 2. Opportunity discovery

**Competitor gap** — see what a named competitor ranks for that imagine.art doesn't:

```json
// site-explorer-organic-keywords (on the competitor's domain)
{ "select": "keyword,volume,keyword_difficulty,best_position", "target": "<competitor-domain>", "mode": "subdomains", "date": "<today, YYYY-MM-DD>", "order_by": "volume:desc", "limit": 50 }
```

**Keyword expansion** off a seed term:

```json
// keywords-explorer-related-terms
{ "select": "keyword,volume,difficulty", "keywords": "<seed term>", "terms": "also_rank_for", "country": "us", "order_by": "volume:desc", "limit": 15 }
```

`terms` takes the enum `also_rank_for` / `also_talk_about` / `all` — it is NOT the keyword itself (easy
mistake; the keyword goes in `keywords`). Run it twice (once per `terms` value) if you want both angles.

Also useful: `keywords-explorer-search-suggestions` for autocomplete-style long-tail variants off the same
seed.

## 3. Keyword research (the numbers that go in the Notion row)

```json
// keywords-explorer-overview
{ "select": "keyword,volume,difficulty,parent_topic,parent_volume", "keywords": "<candidate 1>,<candidate 2>,<candidate 3>", "country": "us" }
```

Batch every candidate you're considering for a given row into one call (comma-separated `keywords`) rather
than one call per keyword — cheaper and faster. `parent_topic`/`parent_volume` tell you if a keyword is
really just a variant of a bigger topic you should target directly instead.

`volume` is monthly search volume (US by default — change `country` if the request is for another market).
`difficulty` (KD) is 0-100; it can be `null` for very low-volume/emerging terms — report that as `KD: N/A`,
don't invent a number.

## Common mistakes to avoid

- Passing the actual keyword string into `terms` on `related-terms` instead of `keywords` (see above).
- Using `mode: domain` when you mean `subdomains` on `site-explorer-*` tools, silently missing most of the
  site.
- Requesting a `where` filter so broad the crawled-pages result exceeds the tool's inline output limit —
  narrow the substring first.
- Forgetting `country` on `keywords-explorer-overview` / `related-terms` — it's required.
- Rounding or estimating volume/KD instead of reporting exactly what Ahrefs returned.
