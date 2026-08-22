// Programmatic Page Quality Agent (#11). Auto-generated / template pages (apps/[slug],
// features/[slug], tool landing pages, locales) are where thin + duplicate + placeholder
// content quietly piles up and drags a whole template's rankings down. This agent crawls a
// template's pages and, for each, scores unique-content, thin-content, template-completeness,
// duplicate risk, and (via LLM) whether the visible text actually reads as publish-quality —
// then gives a verdict: publish / noindex / hold. Report-only; suggestions, no writes.
//
// Reuses the indexing crawler's primitives (discover + fetchRawAndRendered + extractOnPage +
// render-mode diff) so "quality" here uses the SAME rendered text the indexability gate sees.
import PQueue from "p-queue";

import { discover } from "@/lib/indexing/discover";
import { fetchRawAndRendered, playwrightEnabled } from "@/lib/indexing/fetchRendered";
import { extractOnPage, type OnPageSignals } from "@/lib/indexing/onpage";
import { classifyRenderMode } from "@/lib/indexing/renderMode";
import { inferTemplate, toPath } from "@/lib/indexing/template";
import { llmChat, llmEnabled } from "./llm";
import type { LlmQuality, PageQualityResult, PageQualityReport, PageQualityVerdict } from "./types";

// Thresholds — tuned for marketing/programmatic pages (short-but-fine hero pages exist, so
// "thin" is conservative; "hold" is near-empty).
const HOLD_WORDS = 60;   // below this there's essentially no page → don't publish
const THIN_WORDS = 150;  // below this it's thin → noindex until fleshed out
const DUP_UNIQ = 0.4;    // uniqueness below this = near-duplicate of a sibling

// ── uniqueness (mirror indexing/run.ts) ──
function shingles(text: string, k = 3, maxWords = 400): Set<string> {
  const w = text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, maxWords);
  const s = new Set<string>();
  for (let i = 0; i + k <= w.length; i += 1) s.add(w.slice(i, i + k).join(" "));
  return s;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export interface PageQualityOptions {
  domain?: string;
  /** Template key (e.g. "apps/[slug]") or path prefix — restricts the sitemap crawl. */
  template?: string;
  /** Explicit URLs to check instead of discovering from the sitemap. */
  urls?: string[];
  limit?: number;
  /** Run the LLM text-quality read (default true when a key is configured). */
  llm?: boolean;
  abortSignal?: AbortSignal;
}

interface Fetched {
  url: string;
  path: string;
  template: string;
  httpStatus: number;
  sig: OnPageSignals | null;
  jsGated: boolean;
  error?: string;
}

// Best-effort LLM read of whether visible text is genuinely publish-quality (catches
// placeholder/boilerplate, untranslated/mixed-language, and auto-generated filler that the
// word-count + uniqueness heuristics miss).
async function readQuality(title: string, text: string): Promise<{ quality: LlmQuality; issue?: string } | null> {
  const sample = text.slice(0, 1600);
  if (!sample.trim()) return null;
  const res = await llmChat({
    prompt: `You are auditing an auto-generated (programmatic/template) web page before it goes live.
Given the page title and a sample of its VISIBLE text, judge whether the text is publish-quality.
Answer on the FIRST line with exactly one word:
good  = genuinely useful, specific, well-written content
weak  = readable but generic/thin/repetitive
bad   = placeholder or boilerplate-only, untranslated or mixed-language, or obvious auto-generated filler/gibberish
On a SECOND line, give a short reason (max 12 words).

Title: ${title || "(none)"}
Text sample:
"""${sample}"""`,
    maxTokens: 40,
    temperature: 0,
    timeoutMs: 20_000,
  });
  if (!res) return null;
  const lines = res.content.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const first = (lines[0] ?? "").toLowerCase();
  const quality: LlmQuality = first.includes("bad") ? "bad" : first.includes("weak") ? "weak" : first.includes("good") ? "good" : "weak";
  const issue = lines[1]?.replace(/^reason:\s*/i, "").slice(0, 120) || undefined;
  return { quality, issue };
}

export async function runPageQuality(opts: PageQualityOptions = {}): Promise<PageQualityReport> {
  const startedAt = new Date();
  const domain = opts.domain ?? "imagine.art";
  const limit = Math.min(opts.limit ?? 30, 80);
  const useLlm = (opts.llm ?? true) && llmEnabled();
  const notes: string[] = [];

  if (!playwrightEnabled()) {
    notes.push("PLAYWRIGHT_ENABLED is not 'true' — quality is scored on raw HTML only; js-gated content can't be detected.");
  }
  if ((opts.llm ?? true) && !llmEnabled()) {
    notes.push("OPENROUTER_API_KEY not set — the text-quality read (placeholder / untranslated / filler detection) is off; scoring uses word-count + uniqueness only.");
  }

  // 1. resolve the URL set — explicit list, or discover by template/prefix.
  let urls: string[] = [];
  if (opts.urls?.length) {
    urls = [...new Set(opts.urls.map((u) => u.trim()).filter(Boolean))].slice(0, limit);
  } else {
    const disc = await discover({ domain, template: opts.template, limit });
    urls = disc.urls;
    notes.push(...disc.notes);
    if (urls.length === 0) notes.push(`No pages found${opts.template ? ` for template "${opts.template}"` : ""} in the sitemap.`);
  }

  if (urls.length === 0) {
    const finishedAt = new Date();
    return {
      domain, template: opts.template, crawled: 0,
      counts: { publish: 0, noindex: 0, hold: 0 }, avgUniqueness: 0, thin: 0, duplicates: 0,
      llmChecked: false, results: [], notes, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
    };
  }

  // 2. crawl (raw + rendered) per URL.
  const queue = new PQueue({ concurrency: 4 });
  const fetched: Fetched[] = [];
  await Promise.all(
    urls.map((url) =>
      queue.add(async () => {
        const path = toPath(url);
        const template = inferTemplate(url);
        try {
          const { raw, rendered } = await fetchRawAndRendered(url, opts.abortSignal);
          const rawSig = raw?.ok ? extractOnPage(raw.html, url) : null;
          const renderedSig = rendered?.ok ? extractOnPage(rendered.html, rendered.finalUrl) : null;
          const mode = classifyRenderMode(rawSig, renderedSig);
          fetched.push({
            url, path, template,
            httpStatus: raw?.status ?? rendered?.status ?? 0,
            sig: renderedSig ?? rawSig,
            jsGated: mode.jsGated,
            error: !raw && !rendered ? "fetch failed" : undefined,
          });
        } catch (e: any) {
          fetched.push({ url, path, template, httpStatus: 0, sig: null, jsGated: false, error: e?.message ?? "error" });
        }
      }),
    ),
  );

  // 3. within-template uniqueness (are these template pages dupes of each other?).
  const byTemplate = new Map<string, Fetched[]>();
  for (const f of fetched) (byTemplate.get(f.template) ?? byTemplate.set(f.template, []).get(f.template)!).push(f);
  const uniqueness = new Map<string, number>();
  const nearest = new Map<string, string>();
  for (const [, group] of byTemplate) {
    const sigs = group.map((f) => shingles(f.sig?.text ?? ""));
    group.forEach((f, i) => {
      let maxSim = 0;
      let who = "";
      for (let j = 0; j < group.length; j += 1) {
        if (i === j) continue;
        const sim = jaccard(sigs[i], sigs[j]);
        if (sim > maxSim) { maxSim = sim; who = group[j].path; }
      }
      uniqueness.set(f.url, group.length > 1 ? 1 - maxSim : 1);
      if (who) nearest.set(f.url, who); // nearest sibling (used when this page is a near-duplicate)
    });
  }

  // 4. optional LLM quality read (only on pages that fetched OK with real text).
  const llmByUrl = new Map<string, { quality: LlmQuality; issue?: string }>();
  if (useLlm) {
    const llmQueue = new PQueue({ concurrency: 2 });
    await Promise.all(
      fetched
        .filter((f) => f.httpStatus === 200 && (f.sig?.wordCount ?? 0) >= HOLD_WORDS)
        .map((f) =>
          llmQueue.add(async () => {
            const q = await readQuality(f.sig?.title ?? "", f.sig?.text ?? "").catch(() => null);
            if (q) llmByUrl.set(f.url, q);
          }),
        ),
    );
  }

  // 5. score + verdict per page.
  const results: PageQualityResult[] = fetched.map((f) => {
    const sig = f.sig;
    const words = sig?.wordCount ?? 0;
    const uniq = uniqueness.get(f.url) ?? 1;
    const llm = llmByUrl.get(f.url) ?? null;
    const title = sig?.hasTitle ?? false;
    const metaDescription = sig?.hasMetaDescription ?? false;
    const h1 = (sig?.h1Count ?? 0) >= 1;
    const singleH1 = (sig?.h1Count ?? 0) === 1;
    const jsonLd = sig?.hasJsonLd ?? false;
    const present = [title, metaDescription, h1, singleH1, jsonLd].filter(Boolean).length;
    const completeness = { title, metaDescription, h1, singleH1, jsonLd, score: present / 5 };

    const flags: string[] = [];
    if (f.error || f.httpStatus !== 200) flags.push(f.error ? "unreachable" : `http ${f.httpStatus}`);
    if (words < THIN_WORDS) flags.push("thin");
    if (uniq < DUP_UNIQ) flags.push("near-duplicate");
    if (!title) flags.push("missing title");
    if (!metaDescription) flags.push("missing meta description");
    if (!h1) flags.push("missing H1");
    else if (!singleH1) flags.push("multiple H1s");
    if (!jsonLd) flags.push("missing schema");
    if (f.jsGated) flags.push("content only after JS");
    if (llm?.quality === "bad") flags.push("low-quality text");
    else if (llm?.quality === "weak") flags.push("generic text");

    // Verdict.
    let verdict: PageQualityVerdict;
    let reason: string;
    if (f.error || f.httpStatus !== 200) {
      verdict = "hold"; reason = f.error ? "Page couldn't be fetched." : `Returns HTTP ${f.httpStatus}.`;
    } else if (words < HOLD_WORDS) {
      verdict = "hold"; reason = "Almost no visible content — not ready to publish.";
    } else if (llm?.quality === "bad") {
      verdict = "noindex"; reason = `Low-quality text${llm.issue ? ` — ${llm.issue}` : " (placeholder/filler/untranslated)"}.`;
    } else if (uniq < DUP_UNIQ) {
      verdict = "noindex"; reason = `Near-duplicate of ${nearest.get(f.url) ?? "a sibling page"} (${Math.round(uniq * 100)}% unique).`;
    } else if (words < THIN_WORDS) {
      verdict = "noindex"; reason = `Thin content (${words} words) — flesh it out or noindex.`;
    } else if (!title && !h1) {
      verdict = "noindex"; reason = "Missing both title and H1 — no clear topic for search.";
    } else {
      verdict = "publish";
      reason = flags.length ? `Publishable; minor gaps: ${flags.join(", ")}.` : "Clears every quality check.";
    }

    return {
      url: f.url, path: f.path, template: f.template, httpStatus: f.httpStatus, words,
      uniqueness: uniq, duplicateOf: uniq < DUP_UNIQ ? nearest.get(f.url) : undefined,
      completeness, jsGated: f.jsGated,
      llmQuality: llm?.quality ?? null, llmIssue: llm?.issue,
      flags, verdict, reason, error: f.error,
    };
  });

  // Worst first: hold, then noindex, then publish; within a verdict, least-unique first.
  const order: Record<PageQualityVerdict, number> = { hold: 0, noindex: 1, publish: 2 };
  results.sort((a, b) => order[a.verdict] - order[b.verdict] || a.uniqueness - b.uniqueness);

  const counts: Record<PageQualityVerdict, number> = { publish: 0, noindex: 0, hold: 0 };
  for (const r of results) counts[r.verdict] += 1;
  const okPages = results.filter((r) => !r.error && r.httpStatus === 200);
  const avgUniqueness = okPages.length ? okPages.reduce((s, r) => s + r.uniqueness, 0) / okPages.length : 0;

  const finishedAt = new Date();
  return {
    domain, template: opts.template, crawled: results.length, counts, avgUniqueness,
    thin: results.filter((r) => r.flags.includes("thin")).length,
    duplicates: results.filter((r) => r.flags.includes("near-duplicate")).length,
    llmChecked: useLlm && llmByUrl.size > 0,
    results, notes, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
  };
}
