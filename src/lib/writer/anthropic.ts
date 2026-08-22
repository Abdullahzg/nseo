// Single Anthropic client for the writing agent, in the same spirit as llmEnabled() /
// strapiConfigured() / isGscConfigured() elsewhere in the repo: a boolean gate, and one place that
// knows the credential.
//
// This is a DIFFERENT stack from src/lib/seo-agents/llm.ts (OpenRouter, default Haiku, no
// streaming, no caching). Don't route writer calls through that helper and don't route the ~20
// existing llmChat call sites through this one — they solve different problems (cheap
// classification vs. a long, cached, streaming authoring session).
import Anthropic from "@anthropic-ai/sdk";

export const WRITER_MODEL = "claude-sonnet-5";

let _client: Anthropic | null | undefined;

export function writerEnabled(): boolean {
  const k = process.env.ANTHROPIC_API_KEY;
  return !!k && k.length > 20;
}

/** Lazily constructed, reused across requests in the same server process. Returns null when
 *  unconfigured so callers degrade (405/"not configured") rather than throwing at import time. */
export function anthropicClient(): Anthropic | null {
  if (_client !== undefined) return _client;
  _client = writerEnabled() ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
  return _client;
}

/**
 * The parameters every writer call shares. Centralised because getting any of these wrong is a
 * silent failure, not an error:
 *   - `temperature`/`top_p`/`top_k` are REJECTED (400) on Sonnet 5 when non-default — never pass them.
 *   - `thinking: {type:"enabled", budget_tokens}` is REJECTED (400) on Sonnet 5 — adaptive only.
 *   - `display: "summarized"` is NOT the SDK's advertised default. The installed SDK's docstring
 *     (v0.107.0, predates Sonnet 5) claims "summarized" is default; verified live that the real
 *     default is "omitted", which streams thinking blocks with EMPTY text — a silent dead pause in
 *     a chat UI, not an error. Omitting `display` here would reproduce that bug.
 */
export function baseWriterParams(effort: "low" | "medium" | "high" | "xhigh" | "max" = "high") {
  return {
    model: WRITER_MODEL,
    thinking: { type: "adaptive" as const, display: "summarized" as const },
    output_config: { effort },
  };
}
