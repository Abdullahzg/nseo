// Money-Page Rank Watcher (#3). Uses GSC Search Analytics to find money-page queries stuck in
// positions 4–10 ("striking distance" — the highest-ROI SEO work), then attaches on-page fix
// recommendations from a live crawl. GSC-gated: no service account → graceful "connect GSC" note.
import PQueue from "p-queue";

import { searchAnalytics, isGscConfigured, daysAgo } from "../indexing/gsc";
import { fetchRendered, fetchRaw } from "../indexing/fetchRendered";
import { extractOnPage } from "../indexing/onpage";
import { isMoneyPage, toPath } from "../indexing/template";
import { topCompetitors, serperEnabled, type SerpCompetitor } from "./serpCompetitors";
import { countOpenInternalLinkOppsByTarget } from "../db/queries";

export interface StrikingQuery {
  query: string;
  position: number;
  impressions: number;
  ctr: number;
}
export interface StrikingPage {
  url: string;
  path: string;
  bestPosition: number;
  totalImpressions: number;
  opportunity: number;
  queries: StrikingQuery[];
  gaps: string[];
  /** Real SERP competitors outranking us for this page's top query (empty if none / no SERP key). */
  competitors: SerpCompetitor[];
  competitorQuery?: string;
  /** Open internal-link opportunities that point at this page (from the Internal Linking sweep). */
  inboundLinkOpportunities: number;
}
export interface RankWatcherReport {
  configured: boolean;
  pages: StrikingPage[];
  notes: string[];
  startedAt: string;
  finishedAt: string;
}

export interface RankWatcherOptions {
  minImpressions?: number;
  maxPagesToCrawl?: number;
}

export async function runRankWatcher(opts: RankWatcherOptions = {}): Promise<RankWatcherReport> {
  const startedAt = new Date();
  const notes: string[] = [];
  const minImpressions = opts.minImpressions ?? 10;
  const maxPagesToCrawl = opts.maxPagesToCrawl ?? 15;

  if (!isGscConfigured()) {
    notes.push("Connect Google Search Console (GSC_PROPERTY + GSC_SA_JSON — see docs/GSC_SETUP.md) to see which money pages are stuck in positions 4–10.");
    return { configured: false, pages: [], notes, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() };
  }

  // Pull the last 28 days by page + query.
  const rows = await searchAnalytics({
    startDate: daysAgo(28),
    endDate: daysAgo(1),
    dimensions: ["page", "query"],
    rowLimit: 5000,
  });

  // Keep money-page rows in striking distance (position 4–10) with real impressions.
  const byPage = new Map<string, StrikingQuery[]>();
  for (const r of rows) {
    const url = r.keys[0];
    const query = r.keys[1] ?? "";
    if (!url) continue;
    const path = toPath(url);
    if (!isMoneyPage(path)) continue;
    if (r.position < 4 || r.position > 10) continue;
    if (r.impressions < minImpressions) continue;
    const list = byPage.get(url) ?? byPage.set(url, []).get(url)!;
    list.push({ query, position: Math.round(r.position * 10) / 10, impressions: r.impressions, ctr: r.ctr });
  }

  const pages: StrikingPage[] = [...byPage.entries()].map(([url, queries]) => {
    queries.sort((a, b) => b.impressions - a.impressions);
    const totalImpressions = queries.reduce((s, q) => s + q.impressions, 0);
    const bestPosition = Math.min(...queries.map((q) => q.position));
    // Opportunity: impressions weighted by how far each query sits from the top 3.
    const opportunity = Math.round(queries.reduce((s, q) => s + q.impressions * Math.max(0, q.position - 3), 0));
    return { url, path: toPath(url), bestPosition, totalImpressions, opportunity, queries: queries.slice(0, 12), gaps: [], competitors: [], inboundLinkOpportunities: 0 };
  });
  pages.sort((a, b) => b.opportunity - a.opportunity);

  if (pages.length === 0) {
    notes.push("No money-page queries are currently in positions 4–10. (Either they rank top-3 already, or GSC has no data for the money-page patterns.)");
  }

  // For the top pages: crawl once for on-page gaps, count real inbound internal-link
  // opportunities (from the Internal Linking sweep), and pull the live SERP to see who
  // actually outranks us. Every recommendation below is data-backed — no stubs.
  const queue = new PQueue({ concurrency: 4 });
  await Promise.all(
    pages.slice(0, maxPagesToCrawl).map((p) =>
      queue.add(async () => {
        const rendered = await fetchRendered(p.url);
        const html = rendered?.ok ? rendered.html : (await fetchRaw(p.url))?.html;
        const gaps: string[] = [];
        if (html) {
          const sig = extractOnPage(html, p.url);
          if (!sig.hasJsonLd) gaps.push("Add structured data (JSON-LD schema).");
          if (sig.h1Count !== 1) gaps.push(sig.h1Count === 0 ? "Add a clear H1 heading." : "Reduce to a single H1.");
          if (!sig.hasMetaDescription) gaps.push("Add a meta description.");
          if (sig.wordCount < 400) gaps.push(`Expand the content (only ~${sig.wordCount} words — likely too thin to beat top-3).`);
        }
        // Real internal-link rec: how many pages the sweep already found that should link here.
        p.inboundLinkOpportunities = await countOpenInternalLinkOppsByTarget(p.path).catch(() => 0);
        if (p.inboundLinkOpportunities > 0) {
          gaps.push(`${p.inboundLinkOpportunities} page${p.inboundLinkOpportunities === 1 ? "" : "s"} could link here — add internal links (see Internal Links).`);
        }
        // Real competitors: who ranks above us for this page's highest-impression query.
        const topQuery = p.queries[0];
        if (topQuery) {
          const comps = await topCompetitors(topQuery.query, { ourPosition: topQuery.position }).catch(() => null);
          if (comps && comps.length) { p.competitors = comps; p.competitorQuery = topQuery.query; }
        }
        p.gaps = gaps;
      }),
    ),
  );

  if (!serperEnabled()) notes.push("Add SERPER_API_KEY to show who outranks each page (live Google SERP).");

  return { configured: true, pages, notes, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() };
}
