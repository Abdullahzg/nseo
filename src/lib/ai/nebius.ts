// The ONLY LLM adapter in the app. Every model decision goes through here, and every result
// carries {model, tokens_in, tokens_out, latency_ms, reasoning} so the activity feed can show
// exactly which Nemotron model decided what, at what cost.
//
// Verified against Token Factory on 2026-09-20 (RESEARCH.md §C5):
//   - all four Nemotron models return structured tool_calls and honour response_format json_schema
//   - reasoning arrives as `reasoning_content` (Super/Ultra/Lightning) OR `reasoning` (Nano) — read both
//   - chat_template_kwargs.enable_thinking=false is the cheap path (26–110 completion tokens)
//   - with thinking ON, a small max_tokens truncates the trace (finish_reason=length) — never do that
//
// There is no fallback provider. If Nebius fails, we throw NebiusError and the caller records it.
import { MODELS, type ModelRole } from "./models";

export const NEBIUS_BASE_URL = (process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, "");

export type NebiusErrorKind = "not_configured" | "auth" | "rate_limit" | "timeout" | "http" | "invalid_output" | "truncated" | "budget";

export class NebiusError extends Error {
  kind: NebiusErrorKind;
  status?: number;
  raw?: string;
  constructor(kind: NebiusErrorKind, message: string, extra: { status?: number; raw?: string } = {}) {
    super(message);
    this.name = "NebiusError";
    this.kind = kind;
    this.status = extra.status;
    this.raw = extra.raw;
  }
}

export interface LLMMeta {
  model: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  reasoning: string | null;
  finish_reason: string | null;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolCall {
  id?: string;
  type?: "function";
  function: { name: string; arguments: string };
}

export interface ChatOptions {
  role: ModelRole;
  messages: ChatMessage[];
  /** thinking ON needs a big budget (≥1500); thinking OFF is the fast path. */
  thinking: boolean;
  max_tokens?: number;
  temperature?: number;
  tools?: ToolDef[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
  json_schema?: { name: string; schema: Record<string, unknown> };
  timeout_ms?: number;
  /** Override the routed model (used for the Ultra→Super downgrade after the per-campaign cap). */
  model?: string;
}

export interface ChatResult {
  content: string;
  tool_calls: ToolCall[] | null;
  meta: LLMMeta;
  /** The raw assistant message, so it can be appended to a tool round-trip verbatim. */
  assistant_message: ChatMessage;
}

export function nebiusConfigured(): boolean {
  return !!process.env.NEBIUS_API_KEY?.trim();
}

/** Usage hook — the tick guard registers itself here so every call feeds the daily token budget. */
let usageSink: ((meta: LLMMeta) => Promise<void> | void) | null = null;
export function setUsageSink(fn: typeof usageSink) { usageSink = fn; }

export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const key = process.env.NEBIUS_API_KEY?.trim();
  if (!key) throw new NebiusError("not_configured", "NEBIUS_API_KEY is not set");
  const model = opts.model ?? MODELS[opts.role];
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    max_tokens: opts.max_tokens ?? (opts.thinking ? 1500 : 400),
    temperature: opts.temperature ?? (opts.thinking ? 0.2 : 0),
  };
  if (!opts.thinking) body.chat_template_kwargs = { enable_thinking: false };
  if (opts.tools?.length) { body.tools = opts.tools; body.tool_choice = opts.tool_choice ?? "auto"; }
  if (opts.json_schema) body.response_format = { type: "json_schema", json_schema: { name: opts.json_schema.name, schema: opts.json_schema.schema, strict: true } };

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(`${NEBIUS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeout_ms ?? 40_000),
    });
  } catch (e: any) {
    const timeout = e?.name === "TimeoutError" || /timeout|aborted/i.test(String(e?.message));
    throw new NebiusError(timeout ? "timeout" : "http", `Nebius request failed: ${e?.message ?? e}`);
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new NebiusError("auth", `Nebius rejected the API key (HTTP ${res.status})`, { status: res.status, raw: text.slice(0, 300) });
  if (res.status === 429) throw new NebiusError("rate_limit", `Nebius rate limit (retry-after ${res.headers.get("retry-after") ?? "?"}s)`, { status: 429, raw: text.slice(0, 300) });
  if (!res.ok) throw new NebiusError("http", `Nebius HTTP ${res.status}: ${text.slice(0, 200)}`, { status: res.status, raw: text.slice(0, 300) });

  let json: any;
  try { json = JSON.parse(text); } catch { throw new NebiusError("invalid_output", "Nebius returned non-JSON", { raw: text.slice(0, 300) }); }
  const choice = json.choices?.[0];
  const msg = choice?.message ?? {};
  const meta: LLMMeta = {
    model: json.model ?? model,
    tokens_in: Number(json.usage?.prompt_tokens ?? 0),
    tokens_out: Number(json.usage?.completion_tokens ?? 0),
    latency_ms: Date.now() - t0,
    // Nano reports `reasoning`; the others `reasoning_content`. Both are optional.
    reasoning: (msg.reasoning_content || msg.reasoning || null) as string | null,
    finish_reason: choice?.finish_reason ?? null,
  };
  try { await usageSink?.(meta); } catch { /* accounting must never break a call */ }

  const toolCalls: ToolCall[] | null = Array.isArray(msg.tool_calls) && msg.tool_calls.length ? msg.tool_calls : null;
  const content = typeof msg.content === "string" ? msg.content : "";
  if (meta.finish_reason === "length" && !toolCalls) {
    throw new NebiusError("truncated", `Nebius output truncated at max_tokens=${body.max_tokens} on ${model} (reasoning ${meta.reasoning?.length ?? 0} chars)`, { raw: content.slice(0, 300) });
  }
  return {
    content,
    tool_calls: toolCalls,
    meta,
    assistant_message: { role: "assistant", content: content || null, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
  };
}

/** Strip ```json fences and find the outermost object. */
export function extractJson(text: string): unknown | null {
  const trimmed = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const start = trimmed.indexOf("{"), end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* no */ } }
  return null;
}

export interface JsonResult<T> { data: T; meta: LLMMeta; raw: string }

/**
 * Structured call: json_schema response_format + a caller-supplied validator. Invalid output is an
 * error, not a fallback — a fabricated score is worse than a visible failure.
 */
export async function json<T>(opts: Omit<ChatOptions, "json_schema" | "tools" | "tool_choice"> & { schema: { name: string; schema: Record<string, unknown> }; validate: (v: unknown) => v is T }): Promise<JsonResult<T>> {
  const { schema, validate, ...rest } = opts;
  let r: ChatResult;
  try {
    r = await chat({ ...rest, json_schema: schema });
  } catch (e) {
    // Nano occasionally degenerates into a runaway on JSON mode (~1 in 12 calls, RESEARCH.md).
    // Retry ONCE on the other fast Nemotron. Same provider, and the feed shows which model answered.
    if (e instanceof NebiusError && e.kind === "truncated" && rest.role === "fast" && !rest.model) {
      r = await chat({ ...rest, model: MODELS.fast_alt, json_schema: schema });
    } else throw e;
  }
  const parsed = extractJson(r.content);
  if (parsed == null || !validate(parsed)) {
    throw new NebiusError("invalid_output", `Nebius (${r.meta.model}) returned JSON that failed validation for ${schema.name}`, { raw: r.content.slice(0, 400) });
  }
  return { data: parsed, meta: r.meta, raw: r.content };
}

/** Plain text call (openers, negotiation bodies). Empty output is an error. */
export async function text(opts: Omit<ChatOptions, "json_schema" | "tools" | "tool_choice">): Promise<{ text: string; meta: LLMMeta }> {
  let r: ChatResult;
  try {
    r = await chat(opts);
  } catch (e) {
    // A thinking model can spend its whole budget reasoning. Retry ONCE with double the budget (capped).
    if (e instanceof NebiusError && e.kind === "truncated" && opts.thinking) {
      r = await chat({ ...opts, max_tokens: Math.min(6000, (opts.max_tokens ?? 1500) * 2) });
    } else throw e;
  }
  const out = r.content.trim();
  if (!out) throw new NebiusError("invalid_output", `Nebius (${r.meta.model}) returned empty content`, { raw: JSON.stringify(r.assistant_message).slice(0, 300) });
  return { text: out, meta: r.meta };
}

/** Liveness check used by /api/health and the Setup page: lists models and confirms routing. */
export async function ping(): Promise<{ ok: boolean; models: number; missing: string[]; error?: string }> {
  const key = process.env.NEBIUS_API_KEY?.trim();
  if (!key) return { ok: false, models: 0, missing: Object.values(MODELS), error: "NEBIUS_API_KEY not set" };
  try {
    const res = await fetch(`${NEBIUS_BASE_URL}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, models: 0, missing: [], error: `HTTP ${res.status}` };
    const ids = new Set(((await res.json()).data ?? []).map((m: any) => m.id));
    const missing = [...new Set(Object.values(MODELS))].filter((m) => !ids.has(m));
    return { ok: missing.length === 0, models: ids.size, missing, error: missing.length ? `routed models missing on this key: ${missing.join(", ")}` : undefined };
  } catch (e: any) {
    return { ok: false, models: 0, missing: [], error: e?.message ?? "unreachable" };
  }
}
