// Shared OpenRouter chat helper for the SEO agents. Mirrors the pattern already used across the
// app (src/lib/linkaudit/slack.ts etc.). Returns null on any failure so callers degrade to a
// heuristic path rather than throwing. `citations` is populated by Perplexity Sonar models.
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

export function llmEnabled(): boolean {
  const k = process.env.OPENROUTER_API_KEY;
  return !!k && k.length > 20;
}

export interface LlmResult {
  content: string;
  citations: string[];
}

export async function llmChat(opts: {
  model?: string;
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<LlmResult | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key.length < 20) return null;
  try {
    const messages = [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      { role: "user", content: opts.prompt },
    ];
    const res = await fetch(OPENROUTER, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.model ?? "anthropic/claude-haiku-4-5",
        messages,
        max_tokens: opts.maxTokens ?? 400,
        temperature: opts.temperature ?? 0.2,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const msg = data.choices?.[0]?.message ?? {};
    const content: string = msg.content ?? "";
    // Citations arrive in one of a few shapes depending on the model/provider:
    //  - OpenAI-style annotations: message.annotations[].url_citation.url  (Perplexity via OpenRouter today)
    //  - a top-level `citations` string[]  (older Perplexity)
    //  - per-choice `citations`
    const fromAnnotations: string[] = Array.isArray(msg.annotations)
      ? msg.annotations.map((a: any) => a?.url_citation?.url ?? a?.url).filter(Boolean)
      : [];
    const fromTopLevel: string[] = Array.isArray(data.citations) ? data.citations : [];
    const fromChoice: string[] = Array.isArray(data.choices?.[0]?.citations) ? data.choices[0].citations : [];
    const citations: string[] = [...fromAnnotations, ...fromTopLevel, ...fromChoice].filter(
      (u: unknown): u is string => typeof u === "string" && u.startsWith("http"),
    );
    return { content, citations };
  } catch {
    return null;
  }
}
