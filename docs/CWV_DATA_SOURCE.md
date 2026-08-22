# Core Web Vitals — data source (no Google Search Console needed)

**Decision: we do NOT use Google Search Console for Core Web Vitals.** GSC's CWV report is just a
view over Google's public **CrUX** (Chrome User Experience Report) field data — and we read that
data directly. This needs **one free Google Cloud API key**, and **no site ownership / no Search
Console verification**.

## How the tool gets CWV now

For each template's representative URL:

1. **CrUX API** (`chromeuxreport.googleapis.com`) — the field p75 for LCP / INP / CLS. Tried at the
   **URL level** first; if that URL doesn't have enough real-user traffic, it falls back to the
   **origin level** (whole-site) so you still get a reading. The UI tags origin-level readings
   "whole-site data".
2. **PageSpeed Insights** (`pagespeedonline`) — called **only when a metric isn't "good"**, to run
   Lighthouse and explain *why* (the LCP element, long JS tasks, layout-shift sources). Skipped for
   healthy pages, which keeps scans fast.

Both APIs use the same key: `GOOGLE_API_KEY` (or the legacy `PAGESPEED_API_KEY` — either works).

```
# .env.local (and the deployment env)
GOOGLE_API_KEY=AIza...        # Google Cloud → enable "Chrome UX Report API" + "PageSpeed Insights API"
```

To get the key: Google Cloud Console → APIs & Services → Enable **Chrome UX Report API** and
**PageSpeed Insights API** → Credentials → Create API key. No billing required for normal volume.

## Free/cheap CWV options, ranked by how directly they replace GSC's CWV report

1. **CrUX API** *(what we use for the verdict)* — same data GSC's report is built from, per-URL and
   per-origin, any site, no ownership. Fast, high quota. Most direct replacement.
2. **PageSpeed Insights API** *(what we use for the "why")* — CrUX field data **plus** a Lighthouse
   lab audit per URL, so it also diagnoses causes. Slower (runs Lighthouse), lower quota.
3. **CrUX on BigQuery** *(not wired — future option)* — monthly historical CrUX for any origin via
   SQL. Best for trend history + competitor benchmarking over time; needs a BigQuery project. We can
   add this later if you want month-over-month CWV history.

## What this does NOT replace

CrUX/PSI only cover **performance** (Core Web Vitals). They do **not** provide indexation status or
keyword rankings — so the features that were GSC-powered for *those* (the Rankings agent, live
"Google says: indexed?" verification, and Content Refresh's auto traffic-decline mode) still need a
ranking/index data source. Since GSC is off the table, the options there are a paid API (Ahrefs /
Semrush) or leaving those on the tool's own prediction. That's a separate decision from CWV.
