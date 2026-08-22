// Backlink Targeting Agent (#4). For a specific money page, finds articles that could link TO
// THAT page (not the homepage): derives the page's topic, runs buyer-intent link queries through
// the existing web-search layer (Tavily today), dedupes to editorial candidates, and scores the
// best ones with the #5 Author/Publisher Scoring agent. Runs today on the existing Tavily key.
import { webSearch, searchEnabled } from "../search/webSearch";
import { fetchRendered, fetchRaw } from "../indexing/fetchRendered";
import { extractOnPage } from "../indexing/onpage";
import { toPath } from "../indexing/template";
import { scoreMany, type ProspectScore } from "./authorScoring";

export interface BacklinkReport {
  target: string;
  targetPath: string;
  topicLabel: string;
  queries: string[];
  candidatesFound: number;
  prospects: ProspectScore[];
  notes: string[];
  startedAt: string;
  finishedAt: string;
}

const STOP = new Set(["the", "and", "for", "with", "best", "free", "online", "top", "your", "imagineart", "imagine", "art", "create", "make"]);
// Social / marketplace / video hosts are not editorial link targets — drop them.
const NON_EDITORIAL = /(^|\.)(youtube|twitter|x|facebook|instagram|pinterest|tiktok|linkedin|amazon|reddit|quora|google|apple|play\.google)\.com$/i;

function topicFromTitle(title: string, path: string): string {
  const cleaned = title.split(/[|–—\-]/)[0].trim();
  if (cleaned && cleaned.length >= 3 && cleaned.length <= 60) return cleaned;
  const slug = path.split("/").filter(Boolean).pop() ?? "";
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function topicTerms(label: string): string[] {
  return [...new Set(label.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)))];
}
function domainOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, "").toLowerCase(); } catch { return url; }
}

export interface BacklinkOptions {
  target: string;
  domain?: string;
  maxProspects?: number;
  score?: boolean;
}

export async function runBacklinkTargets(opts: BacklinkOptions): Promise<BacklinkReport> {
  const startedAt = new Date();
  const domain = opts.domain ?? "imagine.art";
  const maxProspects = opts.maxProspects ?? 10;
  const notes: string[] = [];
  const targetPath = toPath(opts.target.startsWith("http") ? opts.target : `https://${domain}${opts.target}`);
  const targetUrl = `https://${domain}${targetPath}`;

  if (!searchEnabled()) {
    notes.push("No web-search key configured (set TAVILY_API_KEY). Can't find backlink prospects without it.");
    return { target: targetUrl, targetPath, topicLabel: "", queries: [], candidatesFound: 0, prospects: [], notes, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() };
  }

  // Derive the target page's topic (our site is JS-gated → render, fall back to raw).
  const rendered = await fetchRendered(targetUrl);
  const html = rendered?.ok ? rendered.html : (await fetchRaw(targetUrl))?.html;
  const title = html ? extractOnPage(html, targetUrl).title : "";
  const topicLabel = topicFromTitle(title, targetPath);
  const terms = topicTerms(topicLabel);
  const year = new Date().getFullYear();

  const queries = [
    `best ${topicLabel}`,
    `${topicLabel} tools`,
    `top ${topicLabel} ${year}`,
    `${topicLabel} alternatives`,
  ];

  // Run the queries, tally each candidate URL by how many queries surfaced it.
  const freq = new Map<string, { url: string; title: string; snippet: string; hits: number }>();
  for (const q of queries) {
    const results = await webSearch(q, 8, undefined, (m) => notes.push(`search: ${m}`));
    for (const r of results) {
      const d = domainOf(r.url);
      if (d === domain.replace(/^www\./, "") || NON_EDITORIAL.test(d)) continue;
      const existing = freq.get(r.url);
      if (existing) existing.hits += 1;
      else freq.set(r.url, { url: r.url, title: r.title, snippet: r.snippet, hits: 1 });
    }
  }

  // Keep one best URL per domain; rank by (query frequency + listicle bonus).
  const byDomain = new Map<string, { url: string; title: string; hits: number; score: number }>();
  for (const c of freq.values()) {
    const d = domainOf(c.url);
    const listicle = /(best|top|tools|vs|alternative|review|roundup|compare)/i.test(`${c.title} ${c.url}`);
    const score = c.hits + (listicle ? 1.5 : 0);
    const cur = byDomain.get(d);
    if (!cur || score > cur.score) byDomain.set(d, { url: c.url, title: c.title, hits: c.hits, score });
  }
  const ranked = [...byDomain.values()].sort((a, b) => b.score - a.score);
  const candidatesFound = ranked.length;

  if (candidatesFound === 0) {
    notes.push("No editorial candidates found — try a different target page or add more search coverage.");
    return { target: targetUrl, targetPath, topicLabel, queries, candidatesFound: 0, prospects: [], notes, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() };
  }

  // Score the top candidates (unless disabled).
  const topUrls = ranked.slice(0, maxProspects).map((r) => r.url);
  const prospects = opts.score === false
    ? ranked.slice(0, maxProspects).map((r) => ({
        url: r.url, domain: domainOf(r.url), title: r.title, relevance: 0, freshnessYear: null,
        freshness: "unknown" as const, outboundQuality: 0, spamRisk: "medium" as const,
        domainAuthority: null, replyLikelihood: "medium" as const, isListicle: true, angle: "", composite: 0,
      }))
    : await scoreMany(topUrls, terms, topicLabel);

  return { target: targetUrl, targetPath, topicLabel, queries, candidatesFound, prospects, notes, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() };
}
