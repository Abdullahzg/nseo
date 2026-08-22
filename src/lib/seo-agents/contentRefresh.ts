// Content Refresh Agent (#10). Two entry points:
//   • manual — paste any URL → generate a refresh brief now (crawl + LLM). Works today.
//   • auto   — compare GSC clicks (last 28d vs prior 28d) to find decliners, then brief them.
// The brief is a structured, specific rewrite plan for the content team.
import PQueue from "p-queue";

import { searchAnalytics, isGscConfigured, daysAgo } from "../indexing/gsc";
import { fetchRendered, fetchRaw } from "../indexing/fetchRendered";
import { extractOnPage } from "../indexing/onpage";
import { toPath } from "../indexing/template";
import { llmChat, llmEnabled } from "./llm";

export interface RefreshBrief {
  url: string;
  path: string;
  title: string;
  wordCount: number;
  hasSchema: boolean;
  recentClicks?: number;
  priorClicks?: number;
  dropPct?: number;
  brief: string;
  note?: string;
}
export interface ContentRefreshReport {
  mode: "manual" | "auto";
  gscConfigured: boolean;
  briefs: RefreshBrief[];
  notes: string[];
  startedAt: string;
  finishedAt: string;
}

const BRIEF_SYSTEM =
  "You are a senior SEO content strategist. Given a page's current content, write a concise, specific refresh brief. Use exactly these markdown sections and keep each to 1–4 tight bullets: **Outdated or stale**, **Missing subtopics & entities**, **Intro assessment**, **FAQ / schema to add**, **Internal links to add**, **Priority rewrite checklist**. Be concrete about THIS page; no generic advice.";

async function briefFor(url: string, meta?: { recentClicks?: number; priorClicks?: number; dropPct?: number }): Promise<RefreshBrief> {
  const path = toPath(url);
  const rendered = await fetchRendered(url);
  const html = rendered?.ok ? rendered.html : (await fetchRaw(url))?.html;
  if (!html) {
    return { url, path, title: "", wordCount: 0, hasSchema: false, ...meta, brief: "", note: "Could not load this page." };
  }
  const sig = extractOnPage(html, url);
  let brief = "";
  let note: string | undefined;
  if (llmEnabled()) {
    const res = await llmChat({
      system: BRIEF_SYSTEM,
      maxTokens: 700,
      prompt: `Page: ${url}\nTitle: ${sig.title}\n\nCurrent content (truncated):\n${sig.text.slice(0, 3500)}`,
    });
    brief = res?.content?.trim() ?? "";
    if (!brief) note = "AI brief unavailable (LLM call failed) — showing on-page signals only.";
  } else {
    note = "OPENROUTER_API_KEY not set — showing on-page signals only, no AI brief.";
  }
  return { url, path, title: sig.title, wordCount: sig.wordCount, hasSchema: sig.hasJsonLd, ...meta, brief, note };
}

export interface ContentRefreshOptions {
  url?: string; // manual mode
  minPriorClicks?: number;
  minDropPct?: number;
  maxBriefs?: number;
}

export async function runContentRefresh(opts: ContentRefreshOptions = {}): Promise<ContentRefreshReport> {
  const startedAt = new Date();
  const notes: string[] = [];

  // ── Manual mode: brief a single URL now (no GSC needed) ──
  if (opts.url && opts.url.trim()) {
    const url = opts.url.startsWith("http") ? opts.url : `https://imagine.art${opts.url.startsWith("/") ? "" : "/"}${opts.url}`;
    const brief = await briefFor(url);
    return { mode: "manual", gscConfigured: isGscConfigured(), briefs: [brief], notes, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() };
  }

  // ── Auto mode: find decliners via GSC ──
  if (!isGscConfigured()) {
    notes.push("Connect Google Search Console (docs/GSC_SETUP.md) to auto-detect pages losing traffic. You can still paste a URL above to brief any page now.");
    return { mode: "auto", gscConfigured: false, briefs: [], notes, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() };
  }

  const minPriorClicks = opts.minPriorClicks ?? 10;
  const minDropPct = opts.minDropPct ?? 0.3;
  const maxBriefs = opts.maxBriefs ?? 5;

  const [recent, prior] = await Promise.all([
    searchAnalytics({ startDate: daysAgo(28), endDate: daysAgo(1), dimensions: ["page"], rowLimit: 5000 }),
    searchAnalytics({ startDate: daysAgo(56), endDate: daysAgo(29), dimensions: ["page"], rowLimit: 5000 }),
  ]);
  const recentClicks = new Map<string, number>();
  for (const r of recent) recentClicks.set(r.keys[0], r.clicks);
  const decliners: { url: string; recentClicks: number; priorClicks: number; dropPct: number }[] = [];
  for (const p of prior) {
    const url = p.keys[0];
    const rc = recentClicks.get(url) ?? 0;
    if (p.clicks < minPriorClicks) continue;
    const dropPct = (p.clicks - rc) / p.clicks;
    if (dropPct >= minDropPct) decliners.push({ url, recentClicks: rc, priorClicks: p.clicks, dropPct });
  }
  decliners.sort((a, b) => b.priorClicks - a.priorClicks - (a.recentClicks - b.recentClicks));

  if (decliners.length === 0) notes.push("No pages with a meaningful click decline in the last 28 days vs. the prior 28.");

  const queue = new PQueue({ concurrency: 2 });
  const briefs: RefreshBrief[] = [];
  await Promise.all(
    decliners.slice(0, maxBriefs).map((d) =>
      queue.add(async () => {
        briefs.push(await briefFor(d.url, { recentClicks: d.recentClicks, priorClicks: d.priorClicks, dropPct: d.dropPct }));
      }),
    ),
  );
  if (decliners.length > maxBriefs) notes.push(`Showing briefs for the top ${maxBriefs} of ${decliners.length} declining pages.`);

  return { mode: "auto", gscConfigured: true, briefs, notes, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() };
}
