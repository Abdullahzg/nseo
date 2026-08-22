// Assembles what actually gets sent to the model: the cached system prompt, the phase directive
// that steers each turn, and the cache-breakpoint placement across the growing message history.
import type { Anthropic } from "@anthropic-ai/sdk";
import { SKILL_PROMPT } from "./skill";
import { renderVoiceSystem } from "./voice";
import type { WriterSession, WriterPhase, WriterVoice } from "@/lib/db/queries";

/**
 * Machine-injected directive blocks. These are written into the USER turn (they have to be: the
 * top-level system prompt is cached and Sonnet 5 has no mid-conversation system role), which means
 * the transcript contains text the human never typed.
 *
 * They must be stripped before anything is displayed. Getting this wrong is not subtle: a
 * `<section_assignment>` block listing every source URL rendered as a giant user chat bubble, and it
 * looked like the user had pasted it. Stripping happens server-side in the display projection so the
 * UI cannot forget to do it.
 */
export const DIRECTIVE_TAGS = ["phase", "section_assignment", "cluster", "repair_request"] as const;

/**
 * Remove every machine directive, leaving only what a human actually wrote.
 *
 * A block that BEGINS with one of these tags is entirely machine-authored: `runTurn` always puts the
 * human's own words in a SEPARATE content block from the directive. So the whole block goes. That
 * also retroactively cleans sessions persisted before the directive was fully wrapped, where the tag
 * held only the phase name and the instructions trailed after it in plain prose.
 *
 * `repair_request` is excluded from the whole-block rule on purpose: a human pressed "Ask it to fix
 * these" to send it, so the transcript should still show that it happened.
 */
const WHOLLY_MACHINE = /^\s*<(phase|section_assignment|cluster)>/;

export function stripDirectives(text: string): string {
  if (WHOLLY_MACHINE.test(text)) return "";
  let out = text;
  for (const tag of DIRECTIVE_TAGS) {
    // Paired form, and the self-contained `<phase>x</phase>` line.
    out = out.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"), "");
    // An unclosed directive (a truncated turn) would otherwise leak the whole tail.
    out = out.replace(new RegExp(`<${tag}>[\\s\\S]*$`, "g"), "");
  }
  return out.trim();
}

/**
 * `system[0]` = the frozen workflow (widest-shared, 1h TTL), `system[1]` = this voice (shared by
 * every article on this voice, 1h TTL). Order matters: system[0] alone is ~4.8k tokens, comfortably
 * over the worst-case minimum cacheable prefix; a terse voice profile in that position could fall
 * under it and silently not cache (see selfcheck's cache-minimum assertion for why this is checked
 * mechanically, not just documented).
 */
export function buildSystem(voice: WriterVoice): Anthropic.TextBlockParam[] {
  return [
    { type: "text", text: SKILL_PROMPT, cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: renderVoiceSystem(voice), cache_control: { type: "ephemeral", ttl: "1h" } },
  ];
}

/**
 * The per-turn instruction. Rides in the trailing USER turn, never in `system` (would invalidate
 * the two breakpoints above on every turn) and never as `{role:"system"}` (Opus 4.8 only —
 * unavailable on Sonnet 5). Wrapped so the model can tell it apart from the human's own words,
 * the same convention this app's own `<system-reminder>` injections use elsewhere.
 */
export function phaseDirective(session: WriterSession, isFirstTurn: boolean): string {
  // EVERYTHING this returns must end up inside the <phase> wrapper at the bottom of the function.
  // An earlier version tagged only the phase NAME and left the instruction prose bare, so
  // stripDirectives removed the word "gathering" and rendered the rest as a message the human
  // appeared to have typed ("Continue gathering step 1 requirements. Call save_brief once you have
  // enough." in a user bubble). If you add a line here, do not add it outside the wrapper.
  const lines: string[] = [`session phase: ${session.phase}`];
  switch (session.phase) {
    case "gathering":
      lines.push(isFirstTurn
        ? "This is the start of a new piece. Greet briefly and ask for the step 1 requirements in one message, then stop. Tools are disabled on this turn: asking is the whole job."
        : "Continue gathering step 1 requirements. Call save_brief once you have enough.");
      lines.push(
        "If you ask the human anything, that question must be the last thing in your turn and you " +
        "must not call a tool afterwards. Either ask and wait, or proceed without asking. Asking and " +
        "then immediately proceeding gives the human no chance to answer.",
      );
      break;
    case "researching":
      lines.push(
        "The brief is saved. Research now: call serp_analysis on the primary keyword first (it gives " +
        "you who ranks, the real People Also Ask questions and the real related searches), then " +
        "keyword_data, then web_search and fetch_page for the sources you need. Then call propose_outline.",
      );
      lines.push(
        "Also call internal_links for the main topic and for each major subtopic. It searches our own " +
        "site, and the paths it returns are the ONLY URLs on our domain you may link to. Guessing an " +
        "internal path produces a 404 on a published page, so search instead of assuming.",
      );
      lines.push(clusterSiblingNote(session));
      break;
    case "outline_pending":
      lines.push("An outline is awaiting human approval. If this message is feedback rather than an approval, revise and call propose_outline again. Do not write any section yet.");
      break;
    case "approved":
      lines.push("The outline was just approved by a human. Begin step 4: call submit_section for section 0 (the intro) now.");
      lines.push(writingAssignment(session, 0));
      break;
    case "writing": {
      const next = nextUnwrittenIndex(session);
      if (next === null) {
        lines.push("Every section in the approved outline is written. Do not call submit_section again.");
      } else {
        lines.push(`Continue step 4. The next section to submit is index ${next}.`);
        lines.push(writingAssignment(session, next));
      }
      break;
    }
    case "validating":
      lines.push("The draft is being checked automatically. If you are seeing this, a repair request will follow shortly with specific violations to fix.");
      break;
    default:
      lines.push("");
  }
  // One wrapper around the whole directive, so stripDirectives removes all of it. The nested
  // <section_assignment> goes with it, since the regex runs to the single closing </phase>.
  return `<phase>\n${lines.filter(Boolean).join("\n")}\n</phase>`;
}

/** Content-block types that accept `cache_control`. Anything else (notably `thinking` and
 *  `redacted_thinking`) is rejected with a 400 if marked. */
const CACHEABLE_BLOCK_TYPES = new Set([
  "text", "image", "tool_use", "tool_result", "document", "search_result",
]);

export function isCacheable(block: unknown): boolean {
  const t = (block as { type?: string } | null)?.type;
  return !!t && CACHEABLE_BLOCK_TYPES.has(t);
}

/**
 * For a cluster member: the sibling articles it must link to.
 *
 * These slugs were minted and collision-checked when the cluster plan was approved, so every one of
 * them will exist. Handing them over explicitly is what makes unattended interlinking correct: the
 * model never has to guess a sibling URL, and the validator rejects any internal link that is
 * neither in the voice's sitemap nor in this list.
 */
export function clusterSiblingNote(session: WriterSession): string {
  const siblings = (session.brief?.cluster_siblings ?? []) as string[];
  if (!siblings.length) return "";
  const angle = session.brief?.angle;
  const out = ["", "<cluster>"];
  out.push("This article is part of a topic cluster that a human has already approved.");
  if (angle) out.push(`The approved angle for this specific post: ${angle}`);
  out.push("", "It must link to these sibling articles in the cluster. They are being published alongside it, so the URLs are valid even though they are not live yet:");
  for (const s of siblings) out.push(`  ${s}`);
  out.push("", "Put them in your link_plan and write them as real inline links. Do not link to any other URL on our own domain that is not in the internal-link database.");
  out.push("</cluster>");
  return out.join("\n");
}

/** The lowest outline index not yet in the section map, or null once all are written. */
export function nextUnwrittenIndex(session: WriterSession): number | null {
  const total = session.outline?.sections.length ?? 0;
  if (!total) return null;
  for (let i = 0; i < total; i++) if (!(String(i) in (session.sections ?? {}))) return i;
  return null;
}

/**
 * Restate the approved plan for the section about to be written.
 *
 * This exists because of an observed failure: the agent wrote a complete 8,600-character article
 * containing ZERO links, despite an approved source plan and internal-link plan. By writing time the
 * outline was dozens of blocks back in the history, competing with several thousand tokens of tool
 * results, and the specific per-section assignments simply stopped being salient. Restating them in
 * the trailing user turn puts them adjacent to the instruction that uses them, and costs nothing in
 * cache terms because this text sits after the last breakpoint anyway.
 */
export function writingAssignment(session: WriterSession, index: number): string {
  const outline = session.outline;
  if (!outline) return "";
  const section = outline.sections[index];
  if (!section) return "";

  // Exact index match. An earlier version matched a free-text section NAME against the heading and
  // silently found nothing, after which this block told the model "no sources were assigned, do not
  // invent any" — which is how a fully-researched article shipped with zero citations. Indices
  // cannot near-miss.
  const sources = outline.source_plan.filter((s) => s.section_index === index);
  const links = outline.link_plan.filter((l) => l.section_index === index);

  // What is still unplaced anywhere, so the fallback below can offer real options instead of
  // suppressing links entirely.
  const written = new Set(Object.keys(session.sections ?? {}).map(Number));
  const unplacedSources = outline.source_plan.filter(
    (s) => !outline.sections[s.section_index] || (!written.has(s.section_index) && s.section_index > index),
  );
  const unplacedLinks = outline.link_plan.filter(
    (l) => !outline.sections[l.section_index] || (!written.has(l.section_index) && l.section_index > index),
  );

  const out: string[] = ["", `<section_assignment index="${index}">`];
  out.push(`Heading (${section.level}): ${section.heading}`);
  if (section.target_words) {
    out.push(`Target length: about ${section.target_words} words. Staying close to this matters, because the whole-article word count is checked against the brief.`);
  }
  if (section.is_faq) {
    out.push("This heading is a question. Answer it completely in the first sentence so the answer stands alone if quoted out of context, then support it.");
  }

  if (sources.length) {
    out.push("", "Sources assigned to this section. Embed each as a contextual markdown link using the given anchor text, and paraphrase the insight rather than quoting it:");
    for (const s of sources) out.push(`  [${s.anchor_text}](${s.url})  for: ${s.insight}`);
  }
  if (links.length) {
    out.push("", "Internal links assigned to this section. Embed each as a markdown link:");
    for (const l of links) out.push(`  [${l.anchor_text}](${l.url})`);
  }

  if (sources.length || links.length) {
    out.push("", "Write these as real inline markdown links in the prose, not as a list at the end. A section that omits its assigned links fails the automated check and comes back to you.");
  } else {
    // Never say "no links assigned, don't add any" — that is what produced zero-citation articles.
    // Offer what is still unplaced instead, and let it decide.
    out.push("", "Nothing was assigned specifically to this section index in the approved plan.");
    if (unplacedSources.length || unplacedLinks.length) {
      out.push("If any of these fit naturally here, use them; otherwise leave them for their own section:");
      for (const s of unplacedSources.slice(0, 4)) out.push(`  [${s.anchor_text}](${s.url})  for: ${s.insight}`);
      for (const l of unplacedLinks.slice(0, 3)) out.push(`  [${l.anchor_text}](${l.url})`);
    }
    out.push("Do not invent a URL that is not in the approved plan.");
  }
  out.push("</section_assignment>");
  return out.join("\n");
}

export function toolChoiceFor(phase: WriterPhase, isFirstTurn = false): Anthropic.ToolChoice {
  if (phase === "approved" || phase === "writing") {
    return { type: "tool", name: "submit_section" };
  }
  // The opening turn may only ASK. Without this the model reliably asked its questions and then
  // called save_brief in the same turn, so research started before the human could answer a single
  // one — "the ai asks me questions yet delays letting me answer". Making the first turn incapable of
  // calling a tool is structural; a prompt instruction not to was not obeyed.
  //
  // Cache-safe: tool_choice is not part of the cached prefix. The tools ARRAY must stay identical
  // across turns (a conditional tools array invalidates every breakpoint) — this changes neither.
  if (phase === "gathering" && isFirstTurn) return { type: "none" };
  return { type: "auto" };
}

/**
 * Place cache_control on the message-history side of the request, WITHOUT mutating the blocks the
 * caller will persist (a stored block must never carry request-only fields).
 *
 * Two breakpoints, always the same two positions relative to the end: the last content block
 * (the standard "growing conversation" placement), and — once the history is long enough that a
 * single tool-heavy research turn could exceed it — one 15 blocks back from the end. The plan's
 * finding: each breakpoint walks back at most 20 content blocks to find a prior entry, and the
 * research phase emits tool_use/tool_result pairs in bulk, easily exceeding 20 in one turn. A
 * second, earlier breakpoint keeps the older portion of a long tool-loop within reach of the newer
 * one. Combined with the 2 system breakpoints in buildSystem(), this is 4 total: the hard cap.
 */
export function applyCacheBreakpoints(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  type Flat = { mi: number; bi: number };
  const flat: Flat[] = [];
  messages.forEach((m, mi) => {
    const blocks = Array.isArray(m.content) ? m.content : [];
    blocks.forEach((b, bi) => {
      // Only blocks that ACCEPT cache_control are eligible positions. `thinking` and
      // `redacted_thinking` do not: marking one returns
      //   400 messages.N.content.0.thinking.cache_control: Extra inputs are not permitted
      // and it is invisible until the history happens to end on a thinking block, so the failure
      // shows up several turns in rather than on the first request. Types are not enough to catch
      // this — ContentBlockParam is a union and cache_control is valid on most of its members.
      if (isCacheable(b)) flat.push({ mi, bi });
    });
  });
  if (flat.length === 0) return messages;

  const marks = new Set<string>([`${flat[flat.length - 1].mi}:${flat[flat.length - 1].bi}`]);
  if (flat.length > 15) {
    const back = flat[flat.length - 16];
    marks.add(`${back.mi}:${back.bi}`);
  }

  return messages.map((m, mi) => {
    if (!Array.isArray(m.content)) return m;
    const content = m.content.map((block, bi) => {
      if (!marks.has(`${mi}:${bi}`)) return block;
      // Shallow clone: adds cache_control for THIS request only, leaves the original (which the
      // caller persists to writer_messages) untouched.
      return { ...block, cache_control: { type: "ephemeral" as const } };
    });
    return { ...m, content };
  });
}
