// Centralized LLM configuration for the agentic system.
//
// PRIMARY: Google Gemini via the Gemini API. Key resolution order:
//   1. app_settings.gemini_api_key  (Settings UI, runtime-editable)
//   2. process.env.GEMINI_API_KEY
// Model: GEMINI_MODEL env or app_settings.gemini_model override (default gemini-3.5-flash).
//
// FALLBACKS (each labeled in results; used only when the previous step is unconfigured/fails):
//   OpenRouter (OPENROUTER_API_KEY, OPENROUTER_MODEL) → Groq small model (GROQ_API_KEY, GROQ_MODEL).
//
// Never call other LLM endpoints directly; import from here so model choice stays centralized.

export type LLMProvider = "gemini" | "openrouter" | "groq" | "none";

export interface LLMResult {
  text: string;
  provider: LLMProvider;
  model: string;
}

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-4-5";
const DEFAULT_GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

export function geminiModel(): string {
  return (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
}

export function llmProvider(): LLMProvider {
  const gk = process.env.GEMINI_API_KEY;
  if (gk && gk.length > 10) return "gemini";
  const ok = process.env.OPENROUTER_API_KEY;
  if (ok && ok.length > 20) return "openrouter";
  const grk = process.env.GROQ_API_KEY;
  if (grk && grk.length > 20) return "groq";
  return "none";
}

/** Check provider with runtime settings (cached). */
export async function llmProviderAsync(): Promise<LLMProvider> {
  const runtime = await getRuntimeAIConfig().catch(() => null);
  const gk = runtime?.gemini_api_key || process.env.GEMINI_API_KEY;
  if (gk && gk.length > 10) return "gemini";
  const ok = process.env.OPENROUTER_API_KEY;
  if (ok && ok.length > 20) return "openrouter";
  const grk = runtime?.groq_api_key || process.env.GROQ_API_KEY;
  if (grk && grk.length > 20) return "groq";
  return "none";
}

// ── Runtime AI settings (Settings UI writes; read-through with a short cache) ──
export interface RuntimeAIConfig {
  gemini_api_key?: string | null;
  gemini_model?: string | null;
  groq_api_key?: string | null;
  groq_model?: string | null;
}

let _runtimeCache: { at: number; value: RuntimeAIConfig | null } | null = null;

export function invalidateRuntimeAIConfigCache(): void {
  _runtimeCache = null;
}

async function getRuntimeAIConfig(): Promise<RuntimeAIConfig | null> {
  if (_runtimeCache && Date.now() - _runtimeCache.at < 30_000) return _runtimeCache.value;
  try {
    const { supabaseAdmin } = await import("@/lib/db/supabase");
    const { data } = await supabaseAdmin
      .from("app_settings")
      .select("gemini_api_key, gemini_model, groq_api_key, groq_model")
      .eq("id", true)
      .maybeSingle();
    _runtimeCache = { at: Date.now(), value: (data as RuntimeAIConfig) ?? null };
    return _runtimeCache.value;
  } catch {
    _runtimeCache = { at: Date.now(), value: null };
    return null;
  }
}

// ── provider calls ────────────────────────────────────────────────────────────

function stripReasoning(raw: string): string {
  // Some models emit reasoning blocks; downstream parsers (META tags, JSON extraction,
  // email bodies) must only ever see the answer.
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[^]*?<\/think>/i, "")
    .trim();
}

async function geminiCall(
  key: string,
  modelOverride: string | null | undefined,
  prompt: string,
  opts: { maxTokens?: number; temperature?: number; json?: boolean; timeoutMs?: number }
): Promise<string | null> {
  const model = (modelOverride || geminiModel()).trim();
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxTokens ?? 512,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
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
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number }
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
    return stripReasoning(raw) || null;
  } catch {
    return null;
  }
}

const GROQ_MAX_RETRIES = 2;

async function groqCall(
  prompt: string,
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number },
  runtimeKey?: string | null,
  runtimeModel?: string | null,
): Promise<string | null> {
  const key = runtimeKey || process.env.GROQ_API_KEY;
  if (!key || key.length < 20) return null;
  const model = (runtimeModel || DEFAULT_GROQ_MODEL).trim();

  for (let attempt = 0; attempt <= GROQ_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        // Respect Retry-After header or exponential backoff
        const backoffMs = Math.min(2000 * Math.pow(2, attempt - 1), 8000);
        await new Promise((r) => setTimeout(r, backoffMs));
      }

      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: opts.maxTokens ?? 512,
          temperature: opts.temperature ?? 0.4,
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
      });

      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        const waitMs = retryAfter
          ? Math.min(parseInt(retryAfter, 10) * 1000, 10_000)
          : Math.min(2000 * Math.pow(2, attempt), 8_000);
        if (attempt < GROQ_MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        return null;
      }

      if (!res.ok) return null;
      const data = await res.json();
      const raw = ((data.choices?.[0]?.message?.content as string) ?? "").trim();
      return stripReasoning(raw) || null;
    } catch {
      if (attempt >= GROQ_MAX_RETRIES) return null;
    }
  }
  return null;
}

/**
 * Single completion through the chain: Gemini → OpenRouter → Groq.
 * When AI_PROVIDER=groq, Groq is tried FIRST (skipping Gemini/OpenRouter).
 * Returns the successful result with honest provenance labels, or null when every
 * configured provider fails — callers must keep deterministic fallbacks (legacy rule).
 */
export async function llmText(
  prompt: string,
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<LLMResult | null> {
  const runtime = await getRuntimeAIConfig().catch(() => null);
  const aiProvider = process.env.AI_PROVIDER || "cascade";

  // When AI_PROVIDER=groq, use Groq as primary (skip Gemini/OpenRouter)
  if (aiProvider === "groq") {
    const groqText = await groqCall(prompt, opts, runtime?.groq_api_key, runtime?.groq_model);
    if (groqText != null) return { text: groqText, provider: "groq", model: runtime?.groq_model || DEFAULT_GROQ_MODEL };
    return null;
  }

  // Default cascade: Gemini → OpenRouter → Groq
  const geminiKey = runtime?.gemini_api_key || process.env.GEMINI_API_KEY;

  if (geminiKey && geminiKey.length > 10) {
    const text = await geminiCall(geminiKey, runtime?.gemini_model, prompt, opts);
    if (text != null) return { text, provider: "gemini", model: runtime?.gemini_model || geminiModel() };
  }
  if (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.length > 20) {
    const text = await openRouterCall(prompt, opts);
    if (text != null) return { text, provider: "openrouter", model: DEFAULT_OPENROUTER_MODEL };
  }
  const groqText = await groqCall(prompt, opts, runtime?.groq_api_key, runtime?.groq_model);
  if (groqText != null) return { text: groqText, provider: "groq", model: runtime?.groq_model || DEFAULT_GROQ_MODEL };
  return null;
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
  const out = await llmText(prompt, opts);
  if (!out) return null;
  const parsed = extractJson(out.text);
  if (parsed == null || !validate(parsed)) return null;
  return { ...out, data: parsed };
}
