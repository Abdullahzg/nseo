// The Tavily client. Four endpoints, each used where it is actually the right tool:
//
//   /search   the Scout: find publications writing about the topic. Platform domains are excluded
//             at the API rather than judged and thrown away, and results below a relevance score
//             are dropped before they cost a model call.
//   /extract  the Judge: read the article itself, with `query` so Tavily returns the chunks about
//             the topic instead of the whole page. Used when our own fetch comes back thin, which
//             is what happens on JavaScript-rendered publications.
//   /map      the Finder: list a publication's about / contact / team / masthead pages for about a
//             tenth of a credit each, instead of guessing three URLs and fetching them.
//   /crawl    the Finder: read the pages /map found, with natural-language instructions, to pull a
//             named editor and an address.
//
// Credits are counted per call and attributed to the campaign, so the Tools tab can show what the
// run actually cost. Every call carries X-Session-Id so one campaign's calls group together in
// Tavily's own dashboard.
//
// Costs (docs.tavily.com/documentation/api-credits, 2026-10-15):
//   search basic 1 · search advanced 2 · extract 1 per 5 URLs (2 advanced) · map 1 per 10 pages
//   (2 with instructions) · crawl = map + extract.

import { resolveTavilyKey } from "@/lib/ai/context";

const BASE = "https://api.tavily.com";

export type TavilyEndpoint = "search" | "extract" | "map" | "crawl" | "usage";

export interface TavilyCall {
  endpoint: TavilyEndpoint;
  credits: number;
  ms: number;
  ok: boolean;
  detail: string;
}

/** Where a run's Tavily calls are collected so the campaign can record what it spent. */
export type CallSink = (c: TavilyCall) => void;
let sink: CallSink | null = null;
export function setTavilySink(fn: CallSink | null) { sink = fn; }

export class TavilyError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "TavilyError"; }
  /** 429 is "slow down", 432/433/402 is "this key is spent for the month". */
  get quotaExhausted() { return [402, 403, 432, 433].includes(this.status); }
}

async function call<T>(endpoint: TavilyEndpoint, body: unknown, opts: { sessionId?: string; credits: number; detail: string; timeoutMs?: number } = { credits: 1, detail: "" }): Promise<T> {
  const key = resolveTavilyKey();
  if (!key) throw new TavilyError(0, "no Tavily key configured");
  const started = Date.now();
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
  // Groups every call made by one campaign in Tavily's dashboard.
  if (opts.sessionId) headers["X-Session-Id"] = opts.sessionId;
  let res: Response;
  try {
    res = await fetch(`${BASE}/${endpoint}`, {
      method: endpoint === "usage" ? "GET" : "POST",
      headers,
      body: endpoint === "usage" ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
  } catch (e: any) {
    sink?.({ endpoint, credits: 0, ms: Date.now() - started, ok: false, detail: `${opts.detail} — ${e?.name === "TimeoutError" ? "timed out" : e?.message ?? "failed"}` });
    throw new TavilyError(0, e?.message ?? "network error");
  }
  const ms = Date.now() - started;
  if (!res.ok) {
    sink?.({ endpoint, credits: 0, ms, ok: false, detail: `${opts.detail} — HTTP ${res.status}` });
    throw new TavilyError(res.status, `Tavily ${endpoint} HTTP ${res.status}`);
  }
  const data = (await res.json()) as any;
  // Tavily reports what it actually charged when include_usage is set; fall back to the documented
  // price for the call we made.
  const charged = Number(data?.usage?.credits ?? data?.usage?.total_credits ?? NaN);
  sink?.({ endpoint, credits: Number.isFinite(charged) ? charged : opts.credits, ms, ok: true, detail: opts.detail });
  return data as T;
}

// ── /search ──────────────────────────────────────────────────────────────────────────────────────

export interface SearchHit { url: string; title: string; snippet: string; score: number; published?: string | null }

/** Publications writing about the topic. Platforms are excluded at the API, not after the fact. */
export async function tavilySearch(query: string, opts: { count?: number; excludeDomains?: string[]; minScore?: number; sessionId?: string; topic?: "general" | "news" } = {}): Promise<SearchHit[]> {
  const d = await call<any>("search", {
    query: query.slice(0, 1400),
    max_results: opts.count ?? 8,
    search_depth: "basic",
    topic: opts.topic ?? "general",
    chunks_per_source: 3,
    // 150 is the documented maximum.
    exclude_domains: (opts.excludeDomains ?? []).slice(0, 150),
    include_usage: true,
  }, { credits: 1, detail: `search "${query.slice(0, 60)}"`, sessionId: opts.sessionId });
  const min = opts.minScore ?? 0;
  return ((d.results ?? []) as any[])
    .filter((r) => typeof r.url === "string" && r.url.startsWith("http") && (r.score ?? 1) >= min)
    .map((r) => ({ url: r.url, title: r.title ?? "", snippet: String(r.content ?? "").slice(0, 400), score: Number(r.score ?? 0), published: r.published_date ?? null }));
}

// ── /extract ─────────────────────────────────────────────────────────────────────────────────────

export interface ExtractResult { url: string; content: string }

/**
 * Read pages Tavily's way. `query` makes it return the chunks about that topic rather than the
 * whole page, which is both cheaper in tokens and better for judging an article.
 */
export async function tavilyExtract(urls: string[], query: string | null, opts: { advanced?: boolean; sessionId?: string } = {}): Promise<{ results: ExtractResult[]; failed: string[] }> {
  const take = urls.slice(0, 20);
  if (!take.length) return { results: [], failed: [] };
  const d = await call<any>("extract", {
    urls: take,
    ...(query ? { query, chunks_per_source: 3 } : {}),
    extract_depth: opts.advanced ? "advanced" : "basic",
    format: "markdown",
    include_usage: true,
  }, { credits: Math.ceil(take.length / 5) * (opts.advanced ? 2 : 1), detail: `extract ${take.length} page${take.length === 1 ? "" : "s"}`, sessionId: opts.sessionId, timeoutMs: 45_000 });
  return {
    results: ((d.results ?? []) as any[]).map((r) => ({ url: r.url, content: String(r.raw_content ?? "") })),
    failed: ((d.failed_results ?? []) as any[]).map((f) => String(f.url ?? "")),
  };
}

// ── /map and /crawl ──────────────────────────────────────────────────────────────────────────────

/** The paths an editorial contact actually lives behind. */
export const EDITOR_PATHS = ["/about.*", "/contact.*", "/team.*", "/staff.*", "/masthead.*", "/authors?/.*", "/editorial.*", "/write-for-us.*", "/contribute.*"];

/** List the pages of a publication that look like they name a person. Cheap: ~1 credit per 10. */
export async function tavilyMap(host: string, opts: { limit?: number; sessionId?: string } = {}): Promise<string[]> {
  const d = await call<any>("map", {
    url: `https://${host}`,
    instructions: "Find pages that name the editorial team, the editor, or how to pitch and contact them",
    select_paths: EDITOR_PATHS,
    max_depth: 2,
    max_breadth: 20,
    limit: opts.limit ?? 20,
    include_usage: true,
  }, { credits: 2, detail: `map ${host} for editor pages`, sessionId: opts.sessionId, timeoutMs: 45_000 });
  return ((d.results ?? []) as any[]).map(String).filter((u) => u.startsWith("http"));
}

/** Read a publication's contact pages in one call, with the instruction in plain English. */
export async function tavilyCrawl(host: string, opts: { limit?: number; sessionId?: string } = {}): Promise<ExtractResult[]> {
  const d = await call<any>("crawl", {
    url: `https://${host}`,
    instructions: "Find the editorial staff and the contact or pitch address for the editor",
    select_paths: EDITOR_PATHS,
    max_depth: 2,
    max_breadth: 15,
    limit: opts.limit ?? 10,
    extract_depth: "basic",
    format: "markdown",
    include_usage: true,
  }, { credits: 3, detail: `crawl ${host} for an editor`, sessionId: opts.sessionId, timeoutMs: 60_000 });
  return ((d.results ?? []) as any[]).map((r) => ({ url: String(r.url ?? ""), content: String(r.raw_content ?? "") }));
}

// ── /usage ───────────────────────────────────────────────────────────────────────────────────────

export interface TavilyUsage { used: number; limit: number; plan: string }

/** What the key has actually spent this month, from Tavily rather than our own tally. */
export async function tavilyUsageLive(): Promise<TavilyUsage | null> {
  try {
    const d = await call<any>("usage", null, { credits: 0, detail: "usage check" });
    const key = d?.key ?? {}, account = d?.account ?? {};
    return { used: Number(key.usage ?? account.plan_usage ?? 0), limit: Number(key.limit ?? account.plan_limit ?? 0), plan: String(account.current_plan ?? "unknown") };
  } catch { return null; }
}
