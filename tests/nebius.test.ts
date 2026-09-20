// The adapter is the one place every model decision passes through. These tests pin the
// behaviours RESEARCH.md found empirically: both reasoning field names, thinking-off wire
// format, tool round-trip shape, json_schema validation, and loud failure modes.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_KEY = process.env.NEBIUS_API_KEY;

function mockFetch(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const fn = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const completion = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: "x", model: "nvidia/nemotron-3-super-120b-a12b", choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 7 }, ...extra,
});

describe("nebius adapter", () => {
  beforeEach(() => { process.env.NEBIUS_API_KEY = "test-key"; vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); process.env.NEBIUS_API_KEY = ORIGINAL_KEY; });

  it("throws not_configured when the key is absent (no fallback provider exists)", async () => {
    delete process.env.NEBIUS_API_KEY;
    const { chat, NebiusError } = await import("@/lib/ai/nebius");
    await expect(chat({ role: "fast", thinking: false, messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({ name: "NebiusError", kind: "not_configured" });
    expect(NebiusError).toBeDefined();
  });

  it("reads reasoning_content (Super/Ultra/Lightning)", async () => {
    mockFetch(completion({ content: "391", reasoning_content: "17*23=391" }));
    const { chat } = await import("@/lib/ai/nebius");
    const r = await chat({ role: "orchestrator", thinking: true, messages: [{ role: "user", content: "17*23?" }] });
    expect(r.content).toBe("391");
    expect(r.meta.reasoning).toBe("17*23=391");
    expect(r.meta.tokens_in).toBe(12);
    expect(r.meta.tokens_out).toBe(7);
  });

  it("reads `reasoning` (Nano) when reasoning_content is absent", async () => {
    mockFetch(completion({ content: "391", reasoning: "nano thinks" }));
    const { chat } = await import("@/lib/ai/nebius");
    const r = await chat({ role: "fast", thinking: true, messages: [{ role: "user", content: "17*23?" }] });
    expect(r.meta.reasoning).toBe("nano thinks");
  });

  it("thinking:false sends chat_template_kwargs.enable_thinking=false and a small budget", async () => {
    const f = mockFetch(completion({ content: "ok" }));
    const { chat } = await import("@/lib/ai/nebius");
    await chat({ role: "fast", thinking: false, messages: [{ role: "user", content: "x" }] });
    const sent = JSON.parse((f.mock.calls[0] as any)[1].body);
    expect(sent.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(sent.max_tokens).toBeLessThanOrEqual(400);
    expect(sent.model).toMatch(/Nano/);
    expect((f.mock.calls[0] as any)[1].headers.Authorization).toBe("Bearer test-key");
  });

  it("thinking:true omits enable_thinking and uses a large budget", async () => {
    const f = mockFetch(completion({ content: "ok" }));
    const { chat } = await import("@/lib/ai/nebius");
    await chat({ role: "orchestrator", thinking: true, messages: [{ role: "user", content: "x" }] });
    const sent = JSON.parse((f.mock.calls[0] as any)[1].body);
    expect(sent.chat_template_kwargs).toBeUndefined();
    expect(sent.max_tokens).toBeGreaterThanOrEqual(1500);
  });

  it("returns structured tool_calls and an assistant message that can be replayed for the round-trip", async () => {
    mockFetch(completion({ content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "qualify", arguments: "{\"why\":\"pool full\"}" } }] }, { choices: [{ index: 0, message: { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "qualify", arguments: "{\"why\":\"pool full\"}" } }] }, finish_reason: "tool_calls" }] }));
    const { chat } = await import("@/lib/ai/nebius");
    const r = await chat({ role: "orchestrator", thinking: true, messages: [{ role: "user", content: "pick" }], tools: [{ type: "function", function: { name: "qualify", description: "d", parameters: { type: "object", properties: {} } } }] });
    expect(r.tool_calls?.[0].function.name).toBe("qualify");
    expect(r.assistant_message.tool_calls?.length).toBe(1);
    expect(r.assistant_message.role).toBe("assistant");
  });

  it("json(): validates against the caller's guard and THROWS invalid_output otherwise", async () => {
    mockFetch(completion({ content: "{\"relevance_0_100\": \"high\"}" }));
    const { json } = await import("@/lib/ai/nebius");
    await expect(json<{ relevance_0_100: number }>({ role: "fast", thinking: false, messages: [{ role: "user", content: "x" }], schema: { name: "r", schema: { type: "object" } }, validate: (v): v is { relevance_0_100: number } => typeof (v as any)?.relevance_0_100 === "number" })).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("json(): strips code fences and returns typed data + meta", async () => {
    mockFetch(completion({ content: "```json\n{\"relevance_0_100\": 85}\n```" }));
    const { json } = await import("@/lib/ai/nebius");
    const r = await json<{ relevance_0_100: number }>({ role: "fast", thinking: false, messages: [{ role: "user", content: "x" }], schema: { name: "r", schema: { type: "object" } }, validate: (v): v is { relevance_0_100: number } => typeof (v as any)?.relevance_0_100 === "number" });
    expect(r.data.relevance_0_100).toBe(85);
    expect(r.meta.model).toMatch(/nemotron/);
  });

  it("throws truncated when finish_reason=length with no tool call (reasoning ate the budget)", async () => {
    mockFetch(completion({ content: "", reasoning_content: "still thinking" }, { choices: [{ index: 0, message: { role: "assistant", content: "", reasoning_content: "still thinking" }, finish_reason: "length" }] }));
    const { chat } = await import("@/lib/ai/nebius");
    await expect(chat({ role: "fast", thinking: true, max_tokens: 50, messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({ kind: "truncated" });
  });

  it("maps 401 → auth, 429 → rate_limit, 500 → http", async () => {
    const { chat } = await import("@/lib/ai/nebius");
    mockFetch({ error: "bad key" }, 401);
    await expect(chat({ role: "fast", thinking: false, messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({ kind: "auth" });
    mockFetch({ error: "slow down" }, 429, { "retry-after": "3" });
    await expect(chat({ role: "fast", thinking: false, messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({ kind: "rate_limit" });
    mockFetch("boom", 500);
    await expect(chat({ role: "fast", thinking: false, messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({ kind: "http" });
  });

  it("feeds every call's usage to the registered sink", async () => {
    mockFetch(completion({ content: "ok" }));
    const { chat, setUsageSink } = await import("@/lib/ai/nebius");
    const seen: number[] = [];
    setUsageSink((m) => { seen.push(m.tokens_in + m.tokens_out); });
    await chat({ role: "fast", thinking: false, messages: [{ role: "user", content: "x" }] });
    expect(seen).toEqual([19]);
  });
});
