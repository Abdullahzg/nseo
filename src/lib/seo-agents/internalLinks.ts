// Internal Linking Agent (#8). Crawls a sample of the site (rendered — imagine.art is JS-gated),
// then finds pages that are topically relevant to a target but don't yet link to it, and proposes
// a GROUNDED anchor: the exact sentence on the source page to edit, and the verbatim phrase to
// wrap in a link (or, when no good phrase exists, an LLM-drafted sentence to add). Two entry
// points share the crawl+match core: runInternalLinks (one target) and runInternalLinksSweep
// (every money page in a single pass — one run covers the whole site).
import * as cheerio from "cheerio";
import PQueue from "p-queue";

import { fetchRaw, fetchRendered } from "../indexing/fetchRendered";
import { discover } from "../indexing/discover";
import { toPath, isMoneyPage } from "../indexing/template";
import { llmChat, llmEnabled } from "./llm";
import type { InternalLinkReport, LinkSuggestion, InternalLinkSweepReport, SweepOpportunity } from "./types";

// Generic + brand words that carry no topical signal. Topical words like "generator", "video",
// "image", "editor" are deliberately KEPT — they're what connects related pages.
const STOP = new Set([
  "the", "and", "for", "with", "your", "you", "our", "are", "that", "this", "from", "into", "can",
  "will", "how", "what", "why", "when", "who", "best", "top", "free", "online", "app", "apps",
  "tool", "tools", "make", "made", "get", "use", "using", "all", "any", "new", "more", "most",
  "imagineart", "imagine", "create", "creating", "generate",
]);

interface CrawledPage {
  url: string;
  path: string;
  title: string;
  text: string;
  links: Set<string>; // internal paths this page links to
}

// Utility/boilerplate pages that shouldn't be link sources or targets.
const UTILITY = /\/(privacy|terms|affiliate|login|sign-?in|sign-?up|refund|dmca|cookie|contact|careers?|about|pricing|status|blog-sitemap|sitemap)\b/i;

function extractPage(html: string, url: string, domain: string): CrawledPage {
  const $ = cheerio.load(html);
  const title = ($("head > title").first().text() || $("h1").first().text() || "").trim();
  // Collect internal links BEFORE stripping chrome (nav links are real links too).
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const u = new URL(href, url);
      if (u.host.replace(/^www\./, "") === domain.replace(/^www\./, "")) links.add(toPath(u.toString()));
    } catch {
      /* ignore */
    }
  });
  // Strip site chrome so topical matching reflects MAIN content, not the shared nav/footer
  // (otherwise every page "matches" on footer taglines like "edit smarter").
  $("script, style, noscript, svg, nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo]").remove();
  $('[class*="nav" i],[class*="menu" i],[class*="footer" i],[class*="header" i],[id*="footer" i],[id*="nav" i]').remove();
  // cheerio's .text() concatenates adjacent blocks with NO separator, gluing a heading onto the
  // next paragraph ("…Video GeneratorByteDance's…"). Insert boundary whitespace first so
  // sentence-splitting and verbatim anchor extraction see real word boundaries.
  $("br").replaceWith(" ");
  $("h1,h2,h3,h4,h5,h6,p,li,div,section,article,td,th,figcaption,blockquote,tr").append(" ");
  const main = $("main").text() || $("article").text() || $('[role="main"]').text() || $("body").text();
  const text = (main || "").replace(/\s+/g, " ").trim();
  return { url, path: toPath(url), title, text, links };
}

/** Key terms of the target page: unigrams from title + headings, stopwords removed. */
function targetTerms(title: string, headings: string): string[] {
  const words = `${title} ${headings}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  return [...new Set(words)].slice(0, 12);
}

/** Human phrase for the target (title minus brand/pipe, else humanized slug). */
function targetPhrase(title: string, path: string): string {
  // Split only on SPACED separators (" | ", " - ", " – ") so intra-word hyphens like
  // "T-Shirt" stay intact — otherwise "AI T-Shirt Video Generator" becomes "AI T".
  const cleaned = title.split(/\s+[|–—-]\s+/)[0].trim();
  if (cleaned && cleaned.length >= 3) return cleaned;
  const slug = path.split("/").filter(Boolean).pop() ?? "";
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Anchor grounding ─────────────────────────────────────────────────────────
// The distinctive words of the target phrase (drop stopwords + very short words like "AI").
// These are what we hunt for, verbatim, inside the source page's sentences.
function coreTerms(phrase: string): string[] {
  return [
    ...new Set(
      phrase.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)),
    ),
  ];
}

// Two words share a stem if they're equal, or (for words ≥5 chars) share a ≥5-char prefix —
// so "generator" matches "generation", "image" matches "images". Below 5 chars, exact only.
function stemEq(a: string, b: string): boolean {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  if (n < 5) return false;
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i >= 5;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 400);
}

interface Grounding {
  placement: "linkify" | "new_sentence";
  sentence: string;
  anchor: string;
}

/**
 * Find where to place the link on the source page. Scans the source's sentences for the best
 * verbatim phrase that covers the target's core terms; that phrase becomes the anchor and its
 * sentence becomes the edit site (placement=linkify). If nothing on the page is a natural
 * anchor, returns the most topical sentence as context with placement=new_sentence.
 */
function groundAnchor(sourceText: string, core: string[], fallbackAnchor: string): Grounding {
  const sentences = splitSentences(sourceText);
  if (core.length === 0 || sentences.length === 0) {
    return { placement: "new_sentence", sentence: sentences[0] ?? "", anchor: fallbackAnchor };
  }
  const needed = Math.min(2, core.length); // cover ≥2 core terms (or the 1 it has)

  let bestSentence = "";
  let bestSentenceHits = 0;

  for (const sentence of sentences) {
    // Tokenize with offsets so we can slice the exact substring back out.
    const tokens: { w: string; start: number; end: number }[] = [];
    const re = /[A-Za-z0-9]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sentence))) tokens.push({ w: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });

    const hitCoreOf = (w: string) => core.filter((c) => stemEq(w, c));
    // Track the most topical sentence overall as the new_sentence fallback context.
    const sentenceHits = new Set(tokens.flatMap((t) => hitCoreOf(t.w))).size;
    if (sentenceHits > bestSentenceHits) { bestSentenceHits = sentenceHits; bestSentence = sentence; }

    // Slide a window to find the SHORTEST span covering `needed` distinct core terms.
    let best: { start: number; end: number; span: number } | null = null;
    for (let i = 0; i < tokens.length; i++) {
      const covered = new Set<string>();
      for (let j = i; j < tokens.length && j < i + 8; j++) {
        for (const c of hitCoreOf(tokens[j].w)) covered.add(c);
        if (covered.size >= needed) {
          const span = j - i;
          if (!best || span < best.span) best = { start: tokens[i].start, end: tokens[j].end, span };
          break; // shortest window starting at i
        }
      }
    }
    if (best) {
      const anchor = sentence.slice(best.start, best.end).trim();
      // Accept only clean anchors: sane length, and no lowercase→uppercase "glue" (e.g.
      // "GeneratorByteDance") that signals two DOM nodes ran together without a space.
      if (anchor.length >= 3 && anchor.length <= 60 && !/[a-z][A-Z]/.test(anchor)) {
        return { placement: "linkify", sentence, anchor };
      }
    }
  }

  return { placement: "new_sentence", sentence: bestSentence || sentences[0] || "", anchor: fallbackAnchor };
}

// ── Matching core (shared by single-target + sweep) ───────────────────────────
/** Build grounded suggestions for ONE target from an already-crawled page set. */
function suggestionsForTarget(
  targetPage: CrawledPage,
  pages: CrawledPage[],
  maxSuggestions: number,
): { suggestions: LinkSuggestion[]; alreadyLinking: number } {
  const terms = targetTerms(targetPage.title, targetPage.text.slice(0, 1500));
  const phrase = targetPhrase(targetPage.title, targetPage.path);
  const core = coreTerms(phrase);
  const alreadyLinking = pages.filter((p) => p.path !== targetPage.path && p.links.has(targetPage.path)).length;

  const scored: LinkSuggestion[] = [];
  for (const p of pages) {
    if (p.path === targetPage.path) continue;
    if (p.links.has(targetPage.path)) continue; // already links to target
    if (UTILITY.test(p.path)) continue; // don't suggest links from legal/utility pages
    const lower = p.text.toLowerCase();
    const shared = terms.filter((t) => lower.includes(t));
    if (shared.length < 2) continue; // require real topical overlap, not one incidental word

    const g = groundAnchor(p.text, core, phrase);
    scored.push({
      sourceUrl: p.url,
      sourcePath: p.path,
      sourceTitle: p.title,
      score: shared.length / Math.max(terms.length, 1),
      sharedTerms: shared,
      anchor: g.anchor,
      placement: g.placement,
      sentence: g.sentence,
      reason:
        g.placement === "linkify"
          ? `Already says "${g.anchor}" — link it to ${targetPage.path}.`
          : `Mentions ${shared.slice(0, 4).join(", ")} but has no natural anchor — add a sentence.`,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return { suggestions: scored.slice(0, maxSuggestions), alreadyLinking };
}

/** LLM-draft an insertion sentence for the top new_sentence placements (bounded to `cap` calls). */
async function draftNewSentences(items: LinkSuggestion[], targetTitle: string, targetPath: string, cap: number): Promise<void> {
  if (!llmEnabled()) return;
  const todo = items.filter((s) => s.placement === "new_sentence").slice(0, cap);
  for (const s of todo) {
    const res = await llmChat({
      maxTokens: 60,
      temperature: 0.3,
      prompt: `Write ONE natural sentence (15–30 words) to add to a page titled "${s.sourceTitle}" that would naturally link to "${targetTitle}" (${targetPath}). It must read like it belongs on the page and include a clear anchor phrase for the link. Reply with ONLY the sentence.`,
    });
    const draft = res?.content?.trim().replace(/^["']|["']$/g, "");
    if (draft && draft.length >= 20) s.draftSentence = draft;
  }
}

// ── Crawl helper ──────────────────────────────────────────────────────────────
async function crawlPages(urls: string[], domain: string, concurrency = 4): Promise<CrawledPage[]> {
  const queue = new PQueue({ concurrency });
  const pages: CrawledPage[] = [];
  await Promise.all(
    urls.map((url) =>
      queue.add(async () => {
        const rendered = await fetchRendered(url);
        const html = rendered?.ok ? rendered.html : (await fetchRaw(url))?.html;
        if (html) pages.push(extractPage(html, url, domain));
      }),
    ),
  );
  return pages;
}

// ── Entry point: single target (existing behavior, now with grounded anchors) ──
export interface InternalLinkOptions {
  target: string; // path or full URL
  domain?: string;
  limit?: number;
  maxSuggestions?: number;
}

export async function runInternalLinks(opts: InternalLinkOptions): Promise<InternalLinkReport> {
  const startedAt = new Date();
  const domain = opts.domain ?? "imagine.art";
  const limit = Math.min(opts.limit ?? 30, 60);
  const maxSuggestions = opts.maxSuggestions ?? 15;
  const notes: string[] = [];
  const targetPath = toPath(opts.target.startsWith("http") ? opts.target : `https://${domain}${opts.target}`);
  const targetUrl = `https://${domain}${targetPath}`;

  const { urls } = await discover({ domain, limit });
  const toCrawl = [...new Set([targetUrl, ...urls])].slice(0, limit + 1);

  const pages = await crawlPages(toCrawl, domain);
  if (!pages.some((p) => p.text.length > 400)) {
    notes.push("Pages returned little text — set PLAYWRIGHT_ENABLED=true so JS-rendered content can be read.");
  }

  const targetPage = pages.find((p) => p.path === targetPath);
  if (!targetPage) {
    notes.push(`Could not fetch the target page ${targetPath}.`);
    return { target: targetUrl, targetPath, targetTitle: "", crawled: pages.length, alreadyLinking: 0, suggestions: [], notes, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() };
  }

  const { suggestions, alreadyLinking } = suggestionsForTarget(targetPage, pages, maxSuggestions);
  await draftNewSentences(suggestions, targetPage.title, targetPath, 6);
  if (!llmEnabled()) notes.push("OpenRouter key not set — 'new sentence' drafts are unavailable (linkify suggestions are unaffected).");

  return {
    target: targetUrl,
    targetPath,
    targetTitle: targetPage.title,
    crawled: pages.length,
    alreadyLinking,
    suggestions,
    notes,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };
}

// ── Entry point: whole-site sweep (every money page in one crawl) ──────────────
export interface SweepOptions {
  domain?: string;
  limit?: number;            // pages to crawl (the sample size)
  perTarget?: number;        // max opportunities kept per target
  draftCap?: number;         // max LLM sentence-drafts across the whole sweep
}

export async function runInternalLinksSweep(opts: SweepOptions = {}): Promise<InternalLinkSweepReport> {
  const startedAt = new Date();
  const domain = opts.domain ?? "imagine.art";
  const limit = Math.min(Math.max(opts.limit ?? 80, 20), 150);
  const perTarget = opts.perTarget ?? 10;
  const draftCap = opts.draftCap ?? 10;
  const notes: string[] = [];

  // Crawl a money-first sample once — targets AND their potential source pages come from it.
  const { urls, totalDiscovered } = await discover({ domain, limit, moneyFirst: true });
  const pages = await crawlPages(urls, domain);
  notes.push(`Crawled ${pages.length} of ${totalDiscovered} sitemap URLs (sample capped at ${limit}).`);
  if (!pages.some((p) => p.text.length > 400)) {
    notes.push("Pages returned little text — set PLAYWRIGHT_ENABLED=true so JS-rendered content can be read.");
  }

  const targets = pages.filter((p) => isMoneyPage(p.path));
  if (targets.length === 0) notes.push("No money pages found in the crawled sample — check MONEY_PAGE_PATTERNS or raise the limit.");

  const opportunities: SweepOpportunity[] = [];
  const targetSummaries: InternalLinkSweepReport["targets"] = [];
  for (const t of targets) {
    const { suggestions, alreadyLinking } = suggestionsForTarget(t, pages, perTarget);
    targetSummaries.push({ path: t.path, title: t.title, alreadyLinking, opportunities: suggestions.length });
    for (const s of suggestions) opportunities.push({ ...s, targetPath: t.path, targetTitle: t.title });
  }

  // Rank the whole backlog; linkify (ready-to-place) wins ties over new_sentence.
  opportunities.sort((a, b) => b.score - a.score || (a.placement === "linkify" ? -1 : 1));

  // Draft insertion sentences only for the top new_sentence opportunities (bounded LLM spend).
  const newSentenceTop = opportunities.filter((o) => o.placement === "new_sentence").slice(0, draftCap);
  if (llmEnabled()) {
    for (const s of newSentenceTop) {
      const res = await llmChat({
        maxTokens: 60,
        temperature: 0.3,
        prompt: `Write ONE natural sentence (15–30 words) to add to a page titled "${s.sourceTitle}" that would naturally link to "${s.targetTitle}" (${s.targetPath}). It must read like it belongs on the page and include a clear anchor phrase for the link. Reply with ONLY the sentence.`,
      });
      const draft = res?.content?.trim().replace(/^["']|["']$/g, "");
      if (draft && draft.length >= 20) s.draftSentence = draft;
    }
  } else {
    notes.push("OpenRouter key not set — 'new sentence' drafts are unavailable (linkify suggestions are unaffected).");
  }

  return {
    domain,
    crawled: pages.length,
    targets: targetSummaries.sort((a, b) => b.opportunities - a.opportunities),
    opportunities,
    notes,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
  };
}
