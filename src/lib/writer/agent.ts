// The turn loop: one call to runTurn() handles one human message, but internally may round-trip
// with the model several times (tool call → tool result → next response) before it either produces
// plain text, hits a control-tool stop point (propose_outline), or exhausts its per-turn budget.
//
// Everything from prompt.ts's cache layout to tools.ts's provenance ledger exists to make this loop
// safe and cheap to run repeatedly. This file is where they're actually wired together.
import Anthropic from "@anthropic-ai/sdk";
import {
  getWriterSession, updateWriterSession, appendWriterMessage, listWriterMessages,
  accumulateWriterUsage, getBlogDraft,
  type WriterSession, type WriterVoice,
} from "@/lib/db/queries";
import { anthropicClient, baseWriterParams } from "./anthropic";
import { buildSystem, phaseDirective, toolChoiceFor, applyCacheBreakpoints } from "./prompt";
import { WRITER_TOOLS, runTool, newLedger, type ResearchLedger } from "./tools";
import { CONTROL_TOOLS, runControlTool } from "./control";

const ALL_TOOLS = [...WRITER_TOOLS, ...CONTROL_TOOLS];
const RESEARCH_TOOL_NAMES = new Set(WRITER_TOOLS.map((t) => t.name));

/** Internal round-trips per human message. A round-trip is one model call; the model itself is
 *  also capped at 4 tool calls per call (tools.ts), so this bounds total tool fan-out per turn. */
const MAX_INTERNAL_ROUNDS = 8;
const DEFAULT_MAX_TOKENS = 8000;
const RETRY_MAX_TOKENS = 20000;

import { describeToolCall } from "./steps";

export type WriterEvent =
  | { t: "phase"; phase: string }
  | { t: "thinking"; text: string }
  | { t: "text"; text: string }
  /** `label`/`detail` are human-readable. The UI should never show a raw tool name: "web_search" is
   *  an implementation detail, "Searching the web for …" is what the user needs. */
  | { t: "tool_start"; name: string; label: string; detail?: string }
  | { t: "tool_result"; name: string; label: string; is_error: boolean; detail?: string; preview: string }
  /** Progress after a section lands, so the UI can show 3/8 without re-deriving it. */
  | { t: "progress"; sections_written: number; sections_total: number; words: number; target_words?: number | null }
  | { t: "outline"; outline: unknown }
  | { t: "draft"; draft_id: string }
  | { t: "usage"; usage: Record<string, number> }
  | { t: "done"; phase: string }
  | { t: "error"; message: string };

function ledgerFromSession(session: WriterSession): ResearchLedger {
  const ledger = newLedger();
  const research = (session.research ?? {}) as Record<string, unknown>;
  ledger.sources = (research.sources as ResearchLedger["sources"]) ?? {};
  ledger.keyword_rows = (research.keyword_rows as ResearchLedger["keyword_rows"]) ?? [];
  ledger.paa = (research.paa as string[]) ?? [];
  ledger.related = (research.related as string[]) ?? [];
  return ledger;
}

async function persistLedger(sessionId: string, ledger: ResearchLedger): Promise<void> {
  // Dedupe the string lists: serp_analysis may be called for several keyword variants and the same
  // PAA question often comes back more than once.
  await updateWriterSession(sessionId, {
    research: {
      sources: ledger.sources,
      keyword_rows: ledger.keyword_rows,
      paa: [...new Set(ledger.paa)],
      related: [...new Set(ledger.related)],
    },
  });
}

/**
 * Run one human turn to completion (which may be several model↔tool round-trips) and stream
 * progress via `onEvent`. Never throws for a model-side failure (refusal, truncation) — those are
 * reported as `{t:"error"}` events and the session is marked `failed`; throwing is reserved for
 * configuration errors (no API key, session/voice not found) the caller should 4xx on.
 */
export async function runTurn(
  sessionId: string,
  userText: string | undefined,
  onEvent: (e: WriterEvent) => void,
): Promise<WriterSession> {
  const client = anthropicClient();
  if (!client) throw new Error("Writer is not configured (ANTHROPIC_API_KEY not set).");

  let session = await getWriterSession(sessionId);
  if (!session) throw new Error("Session not found.");
  if (!session.voice_id) throw new Error("Session has no voice attached.");

  const { getWriterVoice } = await import("@/lib/db/queries");
  const voice: WriterVoice | null = await getWriterVoice(session.voice_id);
  if (!voice) throw new Error("The voice attached to this session no longer exists.");

  if (session.phase === "done" || session.phase === "failed" || session.phase === "validating") {
    throw new Error(`This session is in phase "${session.phase}" and cannot take another turn.`);
  }

  const history = await listWriterMessages(sessionId);
  const isFirstTurn = history.length === 0;
  const messages: Anthropic.MessageParam[] = history.map((h) => ({
    role: h.role, content: h.blocks as Anthropic.ContentBlockParam[],
  }));

  const ledger = ledgerFromSession(session);

  const userBlocks: Anthropic.ContentBlockParam[] = [
    { type: "text", text: phaseDirective(session, isFirstTurn) },
  ];
  if (userText?.trim()) userBlocks.push({ type: "text", text: userText.trim() });
  messages.push({ role: "user", content: userBlocks });
  await appendWriterMessage(sessionId, "user", userBlocks);

  const system = buildSystem(voice);
  let triedHigherBudget = false;

  for (let round = 0; round < MAX_INTERNAL_ROUNDS; round++) {
    ledger.callsThisTurn = 0;
    const toolChoice = toolChoiceFor(session.phase, isFirstTurn);
    const maxTokens = triedHigherBudget ? RETRY_MAX_TOKENS : DEFAULT_MAX_TOKENS;

    let stream: ReturnType<Anthropic["messages"]["stream"]>;
    try {
      stream = client.messages.stream({
        ...baseWriterParams(session.phase === "researching" ? "high" : "medium"),
        max_tokens: maxTokens,
        system,
        messages: applyCacheBreakpoints(messages),
        tools: ALL_TOOLS,
        tool_choice: toolChoice,
      });
    } catch (e: any) {
      onEvent({ t: "error", message: e?.message ?? "Request failed to start." });
      session = await updateWriterSession(sessionId, { phase: "failed", error: e?.message ?? "request failed" });
      return session;
    }

    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") onEvent({ t: "text", text: event.delta.text });
          else if (event.delta.type === "thinking_delta") onEvent({ t: "thinking", text: event.delta.thinking });
        } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          // The input hasn't streamed yet at block_start, so only the name is known here. The
          // specific query/URL arrives with the tool_result event below.
          const { label } = describeToolCall(event.content_block.name, {}, session.outline?.sections);
          onEvent({ t: "tool_start", name: event.content_block.name, label });
        }
      }
    } catch (e: any) {
      onEvent({ t: "error", message: e?.message ?? "Stream interrupted." });
      session = await updateWriterSession(sessionId, { phase: "failed", error: e?.message ?? "stream interrupted" });
      return session;
    }

    const final = await stream.finalMessage();
    await accumulateWriterUsage(sessionId, {
      input_tokens: final.usage.input_tokens,
      output_tokens: final.usage.output_tokens,
      cache_creation_input_tokens: final.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: final.usage.cache_read_input_tokens ?? 0,
    });
    onEvent({ t: "usage", usage: final.usage as unknown as Record<string, number> });

    // Never read final.content unconditionally — a refusal can arrive with empty content, and a
    // safety classifier decline is a real, expected outcome for the model to have, not a bug.
    if (final.stop_reason === "refusal") {
      onEvent({ t: "error", message: "The model declined this request (safety classifier)." });
      messages.push({ role: "assistant", content: final.content });
      await appendWriterMessage(sessionId, "assistant", final.content);
      session = await updateWriterSession(sessionId, { phase: "failed", error: "refusal" });
      return session;
    }

    const toolUses = final.content.filter(
      (b: Anthropic.ContentBlock): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    // A truncated response with no tool call: don't commit the partial, retry once with a larger
    // budget instead. (A truncated tool_use input is a different, rarer failure — the SDK cannot
    // parse it as JSON, so it wouldn't appear in toolUses at all; that case falls through to the
    // "no tool calls" branch below and gets the same retry, which is the correct response anyway.)
    if (final.stop_reason === "max_tokens" && toolUses.length === 0 && !triedHigherBudget) {
      triedHigherBudget = true;
      onEvent({ t: "text", text: "" }); // no-op keepalive; real signal is the retry itself
      continue;
    }

    messages.push({ role: "assistant", content: final.content });
    await appendWriterMessage(sessionId, "assistant", final.content);

    if (toolUses.length === 0) {
      // Plain end_turn (or a second max_tokens with no recovery left) — this human turn is done.
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let endTurnSignal = false;
    for (const tu of toolUses) {
      const input = (tu.input ?? {}) as Record<string, unknown>;
      let content: string;
      let isError = false;

      if (RESEARCH_TOOL_NAMES.has(tu.name)) {
        const r = await runTool(tu.name, input, { ledger });
        content = r.content; isError = !!r.is_error;
      } else {
        const r = await runControlTool(tu.name, input, { session, voice, ledger });
        content = r.content; isError = !!r.is_error;
        if (r.endTurn) endTurnSignal = true;
        // Control tools write directly to the session row; reload so phase/outline/draft reflect it.
        session = (await getWriterSession(sessionId)) ?? session;
      }

      const { label, detail } = describeToolCall(tu.name, input, session.outline?.sections);
      onEvent({ t: "tool_result", name: tu.name, label, detail, is_error: isError, preview: content.slice(0, 200) });
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content, is_error: isError });

      // Emit progress as each section lands, so a long writing turn visibly advances instead of
      // sitting on a spinner for several minutes.
      if (tu.name === "submit_section" && !isError) {
        const total = session.outline?.sections.length ?? 0;
        const written = Object.keys(session.sections ?? {}).length;
        const draft = session.draft_id ? await getBlogDraft(session.draft_id).catch(() => null) : null;
        onEvent({
          t: "progress",
          sections_written: written,
          sections_total: total,
          words: draft?.body ? draft.body.trim().split(/\s+/).filter(Boolean).length : 0,
          target_words: session.brief?.word_count ?? null,
        });
      }
    }

    await persistLedger(sessionId, ledger);
    if (session.phase === "outline_pending") onEvent({ t: "outline", outline: session.outline });
    if (session.draft_id) onEvent({ t: "draft", draft_id: session.draft_id });

    messages.push({ role: "user", content: toolResults });
    await appendWriterMessage(sessionId, "user", toolResults);

    if (endTurnSignal) break;
    triedHigherBudget = false; // a fresh round gets its own retry budget
  }

  onEvent({ t: "phase", phase: session.phase });
  onEvent({ t: "done", phase: session.phase });
  return session;
}

/**
 * Is this session waiting on the MACHINE, or on the human?
 *
 * `MAX_INTERNAL_ROUNDS` bounds model round-trips per message, which is necessary — but when a turn
 * hits that ceiling mid-research it simply falls out of the loop and reports `done` with the phase
 * still `researching`. To the user that is indistinguishable from the agent giving up: the transcript
 * shows a wall of tool calls, no conclusion, and an idle composer. One real session fetched 49 sources
 * and stopped exactly this way.
 *
 * Research and section-writing have nothing for a human to contribute, so the turn route keeps going
 * on its own while this returns true. `gathering` and `outline_pending` are the two phases that
 * genuinely need a person, and they must never auto-continue — `outline_pending` in particular is the
 * approval gate, and continuing through it would defeat the entire point.
 */
export function needsMachineContinuation(session: WriterSession): boolean {
  switch (session.phase) {
    case "researching":
      return true;                                    // must end at propose_outline
    case "approved":
      return true;                                    // section 0 not written yet
    case "writing":
      return !isWritingComplete(session);
    default:
      return false;                                   // gathering, outline_pending, validating, done, failed
  }
}

/** True once every outline section has a corresponding submit_section call. The turn route uses
 *  this to decide whether the NEXT human-triggered turn should move phase writing → validating
 *  instead of asking for another section. */
export function isWritingComplete(session: WriterSession): boolean {
  const total = session.outline?.sections.length ?? 0;
  return total > 0 && session.section_cursor >= total;
}

export { getBlogDraft };
