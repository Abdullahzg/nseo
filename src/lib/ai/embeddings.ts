// Embeddings on Nebius Token Factory.
//
// Search brings back the same article more than once: a listicle syndicated to three sites, a
// publication that republished its own roundup under a new date, two near-identical "best tools"
// pages. Each of those costs a Nemotron 3 Super judgement to reject, which is the most expensive
// call in the system. One embedding call over all the candidates costs about a thousandth of that
// and removes the duplicates before they are judged.
//
// Model: Qwen/Qwen3-Embedding-8B — the only embedding model on the account (verified against
// GET /v1/models, 2026-10-15), 4096 dimensions, $0.01 per 1M input tokens.

import { NEBIUS_BASE_URL, NebiusError } from "./nebius";
import { resolveNebiusKey } from "./context";

export const EMBEDDING_MODEL = process.env.NEBIUS_MODEL_EMBEDDING || "Qwen/Qwen3-Embedding-8B";
const PRICE_PER_M_IN = 0.01;

export interface EmbedResult { vectors: number[][]; tokens: number; cost_usd: number; ms: number }

/** One call for many texts. Throws NebiusError like every other call here — no silent fallback. */
export async function embed(texts: string[]): Promise<EmbedResult> {
  const key = resolveNebiusKey();
  if (!key) throw new NebiusError("not_configured", "no Nebius key");
  if (!texts.length) return { vectors: [], tokens: 0, cost_usd: 0, ms: 0 };
  const started = Date.now();
  const res = await fetch(`${NEBIUS_BASE_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    // Each text is capped: a title and a snippet is all that is needed to tell two listicles apart.
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts.map((t) => t.slice(0, 1200)) }),
    signal: AbortSignal.timeout(30_000),
  }).catch((e) => { throw new NebiusError(e?.name === "TimeoutError" ? "timeout" : "http", e?.message ?? "embeddings failed"); });
  if (!res.ok) throw new NebiusError(res.status === 429 ? "rate_limit" : res.status === 401 ? "auth" : "http", `embeddings HTTP ${res.status}`, { status: res.status });
  const d = (await res.json()) as any;
  const vectors = ((d.data ?? []) as any[]).sort((a, b) => a.index - b.index).map((x) => x.embedding as number[]);
  const tokens = Number(d.usage?.prompt_tokens ?? 0);
  return { vectors, tokens, cost_usd: (tokens * PRICE_PER_M_IN) / 1_000_000, ms: Date.now() - started };
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export interface DedupeResult<T> { kept: T[]; dropped: { item: T; duplicateOf: T; similarity: number }[]; tokens: number; cost_usd: number; ms: number }

/**
 * Keep the first of each near-identical group. Order matters: callers pass the better candidate
 * first (higher search score), so the one that survives is the one worth judging.
 *
 * The threshold is deliberately high. 0.92 catches the same article under two titles; lower values
 * start merging two genuinely different reviews of the same product, which would lose a real lead.
 */
export async function dedupeBySimilarity<T>(items: T[], text: (t: T) => string, threshold = 0.92): Promise<DedupeResult<T>> {
  if (items.length < 2) return { kept: items, dropped: [], tokens: 0, cost_usd: 0, ms: 0 };
  const { vectors, tokens, cost_usd, ms } = await embed(items.map(text));
  if (vectors.length !== items.length) return { kept: items, dropped: [], tokens, cost_usd, ms };
  const kept: T[] = [];
  const keptVectors: number[][] = [];
  const dropped: { item: T; duplicateOf: T; similarity: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    let best = -1, bestSim = 0;
    for (let j = 0; j < keptVectors.length; j++) {
      const sim = cosine(vectors[i], keptVectors[j]);
      if (sim > bestSim) { bestSim = sim; best = j; }
    }
    if (best >= 0 && bestSim >= threshold) dropped.push({ item: items[i], duplicateOf: kept[best], similarity: bestSim });
    else { kept.push(items[i]); keptVectors.push(vectors[i]); }
  }
  return { kept, dropped, tokens, cost_usd, ms };
}
