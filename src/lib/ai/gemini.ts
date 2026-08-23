// Centralized LLM configuration for the agentic system.
//
// PRIMARY: Google Gemini via the Gemini API (GEMINI_API_KEY), model from
// GEMINI_MODEL (default gemini-3.5-flash). This is the competition model and the
// only provider used when its key is present.
//
// FALLBACK: OpenRouter (OPENROUTER_API_KEY, claude-haiku) — preserved from the
// legacy system so a missing Gemini key degrades instead of breaking. Every
// response carries `provider` so logs/UI can label provenance honestly.
//
// Never call other LLM endpoints directly; import from here so model choice
// stays a one-line env change.

export type LLMProvider = "gemini" | "openrouter" | "none";

export interface LLMResult {
  text: string;
  provider: LLMProvider;
  model: string;
}

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
// OpenRouter is the labeled fallback provider. Model overridable via OPENROUTER_MODEL
// (e.g. a ":free" tier model for testing without billing).
const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-4-5";

export function geminiModel(): string {
  return (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
}

export function llmProvider(): LLMProvider {
  const gk = process.env.GEMINI_API_KEY;
  if (gk && gk.length > 10) return "gemini";
  const ok = process.env.OPENROUTER_API_KEY;
  if (ok && ok.length > 20) return "openrouter";
  return "none";
}

async function geminiCall(
  prompt: string,
  opts: { system?: string; maxTokens?: number; temperature?: number; json?: boolean; timeoutMs?: number }
): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.length < 10) return null;
  const model = geminiModel();
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxTokens ?? 512,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p: any) => p?.text ?? "").join("").trim();
    return text || null;
  } catch {
    return null;
  }
}

async function openRouterCall(
  prompt: string,
  opts: { maxTokens?: number; temperature?: number; json?: boolean; timeoutMs?: number }
): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key.length < 20) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_OPENROUTER_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: opts.maxTokens ?? 512,
        temperature: opts.temperature ?? 0.4,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = ((data.choices?.[0]?.message?.content as string) ?? "").trim();
    // Some free models emit reasoning blocks; strip <think>…</think> so downstream
    // parsers (META tags, JSON extraction, email bodies) see only the answer.
    const cleaned = raw
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/^[\s\S]*?<\/think>/i, (m) => (m.includes("<think") ? "" : m))
      .trim();
    return cleaned || null;
  } catch {
    return null;
  }
}

/** Single completion through the primary provider (fallback when unconfigured). */
export async function llmText(
  prompt: string,
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<LLMResult | null> {
  const p = llmProvider();
  if (p === "none") return null;
  if (p === "gemini") {
    const text = await geminiCall(prompt, opts);
    if (text != null) return { text, provider: "gemini", model: geminiModel() };
    // Primary failed mid-call — try the fallback rather than failing the step.
    const fb = await openRouterCall(prompt, opts);
    return fb != null ? { text: fb, provider: "openrouter", model: DEFAULT_OPENROUTER_MODEL } : null;
  }
  const text = await openRouterCall(prompt, opts);
  return text != null ? { text, provider: "openrouter", model: DEFAULT_OPENROUTER_MODEL } : null;
}

function extractJson(raw: string): unknown | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch { /* fall through */ }
  // Tolerant extraction: first {...} or [...] block anywhere in the output.
  for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* keep trying */ }
    }
  }
  return null;
}

/**
 * Structured completion. The model is asked for JSON (Gemini enforces it via
 * responseMimeType); output is parsed tolerantly and validated by the caller's
 * predicate. Returns null on any failure — callers must have deterministic
 * fallbacks (the legacy rule: an LLM miss never blocks the workflow).
 */
export async function llmJson<T>(
  prompt: string,
  validate: (v: unknown) => v is T,
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<(LLMResult & { data: T }) | null> {
  const out = await llmText(prompt, { ...opts });
  if (!out) return null;
  const parsed = extractJson(out.text);
  if (parsed == null || !validate(parsed)) return null;
  return { ...out, data: parsed };
}
