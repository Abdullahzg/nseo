// Web search via Tavily (the runtime Tavily call for the Best Use of Tavily bonus). Real search APIs (not HTML scraping) so they don't get
// bot-blocked or return junk like DuckDuckGo/Bing do from a server. Uses whichever key is
// configured, in order of preference. All have a genuinely free tier:
//   TAVILY_API_KEY        — 1,000/mo, no card, renews (recommended)
//   GOOGLE_CSE_KEY + _CX  — 100/day, no card, renews (real Google)
//   BRAVE_SEARCH_API_KEY  — 2,000/mo, needs card, renews
//   SERPER_API_KEY        — 2,500 one-time, no card (real Google)

export interface SearchHit { url: string; title: string; snippet: string }

import { resolveTavilyKey } from "@/lib/ai/context";

export function searchProvider(): string | null {
  if (resolveTavilyKey()) return "tavily";
  return null;
}

export function searchEnabled(): boolean {
  return searchProvider() !== null;
}

export async function webSearch(query: string, count = 8, signal?: AbortSignal, onError?: (msg: string) => void): Promise<SearchHit[]> {
  const provider = searchProvider();
  if (!provider) { onError?.("no search API key configured"); return []; }
  const sig = signal ?? AbortSignal.timeout(12000);
  const fail = (res: Response) => onError?.(`${provider} HTTP ${res.status}`);
  try {
    if (provider === "tavily") {
      const { trackTavilyCall, flagTavilyError, getActiveTavilyKey, markTavilyKeyExhausted } = await import("./tavilyUsage");
      // Quota-exhaustion statuses → this key is spent for the month; roll to the next in the pool.
      const QUOTA = new Set([402, 403, 429, 432]);
      // Try successive keys from the pool until one works or we run out (cap attempts so a
      // pool of dead keys can't loop forever).
      for (let attempt = 0; attempt < 8; attempt++) {
        const own = resolveTavilyKey();
        const active = own && own !== process.env.TAVILY_API_KEY ? { id: "owner", key: own } : await getActiveTavilyKey(true);
        if (!active) { onError?.("no Tavily key available (pool empty / all exhausted)"); return []; }
        void trackTavilyCall(); // count toward the global monthly-usage tally (per-key done at reserve)
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${active.key}` },
          body: JSON.stringify({ query, max_results: count, search_depth: "basic" }),
          signal: sig,
        });
        if (res.ok) {
          const d = await res.json();
          return (d.results ?? []).map((r: any) => ({ url: r.url, title: r.title ?? "", snippet: (r.content ?? "").slice(0, 300) })).filter((h: SearchHit) => h.url?.startsWith("http"));
        }
        if (QUOTA.has(res.status) && active.id && active.id !== "env") {
          // Pool key hit its quota — mark it exhausted for the month and try the next one.
          await markTavilyKeyExhausted(active.id);
          onError?.(`Tavily key ${active.id} exhausted (HTTP ${res.status}) — rotating to next`);
          continue;
        }
        // Non-quota error (e.g. 401 bad key with no id, 5xx) → surface and stop.
        if ([401, 402, 403, 429, 432].includes(res.status)) void flagTavilyError(`HTTP ${res.status}`);
        fail(res); return [];
      }
      onError?.("Tavily: all keys exhausted");
      return [];
    }
    return [];
  } catch (e: any) {
    onError?.(e?.name === "TimeoutError" ? "search timed out" : (e?.message ?? "search network error"));
    return [];
  }
}
