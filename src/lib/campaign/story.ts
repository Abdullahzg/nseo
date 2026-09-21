// The campaign's story: chapters written by Nemotron 3 Super from the real ledger, plus the
// numbers (which code computes and the model never touches). Cached on the campaign; rewritten
// on request or when the campaign has moved on. Shareable read-only at /story/<token>, with
// addresses stripped.
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db/supabase";
import { json as nebiusJson, type LLMMeta } from "@/lib/ai/nebius";
import { withKeys } from "@/lib/ai/context";
import { getOwnerKeys } from "@/lib/db/queries";
import type { Campaign, AgentEvent } from "./types";
import { productName } from "./outreach";

export interface StoryFacts {
  product: string; goal: number; budget: number; committed: number; deals: { host: string; agreed: number; asked: number | null; editor: string | null }[];
  searches: { queries: string[]; found: number; source: string };
  judged: { passed: number; rejected: number; examples_pass: string[]; examples_reject: string[] };
  editors: { found: number; provided: number; scraped: number; standin: number };
  emailed: number; replies: { host: string; editor: string | null; quote: string }[];
  negotiations: { host: string; ask: number | null; counters: number[]; outcome: string }[];
  cards: { type: string; host: string; answered: boolean; answer: string | null }[];
  cost_usd: number; model_calls: number; steps: number; started_at: string; ended_at: string | null; minutes: number;
  demo: boolean; phase: string; completion_reason: string | null;
}

export interface Story {
  title: string; chapters: { heading: string; body: string }[]; highlight: { heading: string; body: string }; closing: string;
  written_at: string; at_tick: number; model: string; tokens: number;
}

const STRIP_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export const scrub = (s: string) => s.replace(STRIP_EMAIL, "[address]");

/** Everything true about the campaign, from the database. No model involved. */
export async function storyFacts(camp: Campaign): Promise<StoryFacts> {
  const [{ data: ev }, { data: prospects }, { data: deals }, { data: ivs }, { data: emails }] = await Promise.all([
    supabaseAdmin.from("agent_events").select("*").eq("campaign_id", camp.id).order("id", { ascending: true }).limit(2000),
    supabaseAdmin.from("campaign_prospects").select("domain_host, status, contact_name, contact_source, provenance, qualification").eq("campaign_id", camp.id),
    supabaseAdmin.from("deals").select("domain_host, agreed_price, original_ask, anchor_email_id").eq("campaign_id", camp.id).neq("status", "cancelled"),
    supabaseAdmin.from("interventions").select("type, status, answer, anchor_email_id, prospect_id").eq("campaign_id", camp.id),
    supabaseAdmin.from("outreach_emails").select("id, kind, status, prospect_id, reply_excerpt, reply_price, negotiation_status, original_ask, agreed_price, body, prospect:campaign_prospects(domain_host, contact_name)").eq("campaign_id", camp.id),
  ]);
  const events = (ev ?? []) as AgentEvent[];
  const ps = (prospects ?? []) as any[];
  const byId = new Map(((emails ?? []) as any[]).map((e) => [e.id, e]));
  const searches = events.filter((e) => e.action === "search_batch");
  const queries = [...new Set(searches.map((e) => String((e.detail as any)?.query ?? "")).filter(Boolean))];
  const passed = ps.filter((p) => !["discovered", "rejected"].includes(p.status));
  const rejected = ps.filter((p) => p.status === "rejected");
  const initials = ((emails ?? []) as any[]).filter((e) => e.kind === "initial");
  const replies = initials.filter((e) => e.reply_excerpt).map((e) => ({ host: e.prospect?.domain_host ?? "", editor: e.prospect?.contact_name ?? "the editor", quote: scrub(String(e.reply_excerpt).replace(/\s+/g, " ").slice(0, 220)) }));
  const counters = new Map<string, number[]>();
  for (const e of events) if (e.action === "counter_sent") { const m = e.human.match(/Countered \$(\d+)/); const host = e.human.match(/at ([a-z0-9.-]+\.[a-z]{2,})/i)?.[1] ?? ""; if (m && host) counters.set(host, [...(counters.get(host) ?? []), Number(m[1])]); }
  const negotiations = initials.filter((e) => e.reply_excerpt).map((e) => ({ host: e.prospect?.domain_host ?? "", ask: e.original_ask != null ? Number(e.original_ask) : e.reply_price != null ? Number(e.reply_price) : null, counters: counters.get(e.prospect?.domain_host ?? "") ?? [], outcome: String(e.negotiation_status ?? "open") }));
  const cards = ((ivs ?? []) as any[]).map((iv) => ({ type: String(iv.type).replace(/_/g, " "), host: byId.get(iv.anchor_email_id)?.prospect?.domain_host ?? "", answered: iv.status === "resolved", answer: iv.answer ? scrub(String(iv.answer).slice(0, 160)) : null }));
  const modelEvents = events.filter((e) => e.engine === "model");
  const first = events[0]?.created_at ?? camp.created_at, last = events[events.length - 1]?.created_at ?? null;
  return {
    product: `${productName(camp)} — ${camp.what_you_sell ?? camp.name}`, goal: camp.desired_deals, budget: Number(camp.budget_total), committed: Number(camp.budget_used),
    deals: ((deals ?? []) as any[]).map((d) => ({ host: d.domain_host, agreed: Number(d.agreed_price), asked: d.original_ask != null ? Number(d.original_ask) : null, editor: byId.get(d.anchor_email_id)?.prospect?.contact_name ?? "the editor" })),
    searches: { queries, found: ps.length, source: ps.some((p) => p.provenance?.synthetic) ? "the built-in list" : ps.some((p) => p.provenance?.source === "seed") && !queries.length ? "the publications you listed" : "Tavily web search" },
    judged: { passed: passed.length, rejected: rejected.length, examples_pass: passed.slice(0, 4).map((p) => `${p.domain_host}: ${p.qualification?.why_fit ?? ""}`), examples_reject: rejected.slice(0, 4).map((p) => `${p.domain_host}: ${(p.qualification?.checks ?? []).filter((c: any) => c.state === "fail").map((c: any) => c.label).join(", ")} — ${p.qualification?.why_fit ?? ""}`) },
    editors: { found: ps.filter((p) => p.contact_source).length, provided: ps.filter((p) => p.contact_source === "provided").length, scraped: ps.filter((p) => p.contact_source && !["provided", "demo-simulated"].includes(p.contact_source)).length, standin: ps.filter((p) => p.contact_source === "demo-simulated").length },
    emailed: initials.filter((e) => ["sent", "scheduled", "awaiting_approval", "sending"].includes(e.status)).length, replies, negotiations, cards,
    cost_usd: modelEvents.reduce((s, e) => s + Number(e.cost_usd ?? 0), 0), model_calls: modelEvents.length, steps: camp.tick_count,
    started_at: first, ended_at: last, minutes: last ? Math.max(1, Math.round((new Date(last).getTime() - new Date(first).getTime()) / 60000)) : 0,
    demo: camp.demo_mode, phase: camp.phase, completion_reason: camp.completion_reason,
  };
}

const STORY_SCHEMA = { name: "story", schema: { type: "object", properties: { title: { type: "string" }, chapters: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, body: { type: "string" } }, required: ["heading", "body"], additionalProperties: false } }, highlight: { type: "object", properties: { heading: { type: "string" }, body: { type: "string" } }, required: ["heading", "body"], additionalProperties: false }, closing: { type: "string" } }, required: ["title", "chapters", "highlight", "closing"], additionalProperties: false } };
const isStory = (v: unknown): v is { title: string; chapters: { heading: string; body: string }[]; highlight: { heading: string; body: string }; closing: string } => { const o = v as any; return !!o && typeof o.title === "string" && Array.isArray(o.chapters) && o.chapters.length >= 3 && o.chapters.every((c: any) => typeof c?.heading === "string" && typeof c?.body === "string" && c.body.length > 40) && typeof o.highlight?.body === "string" && typeof o.closing === "string"; };

/** Super writes the chapters from the facts. Numbers in the text must be the facts' numbers; the page prints the facts table beside it either way. */
export async function writeStory(camp: Campaign, facts: StoryFacts): Promise<Story> {
  const keys = await getOwnerKeys(camp.owner_email);
  const call = (thinking: boolean) => withKeys(keys, () => nebiusJson<{ title: string; chapters: { heading: string; body: string }[]; highlight: { heading: string; body: string }; closing: string }>({
    role: "orchestrator", thinking, max_tokens: thinking ? 7000 : 2500, temperature: 0.4, timeout_ms: 90_000, schema: STORY_SCHEMA, validate: isStory,
    messages: [
      { role: "system", content: "You write the story of an autonomous outreach campaign for its owner, in plain English, like a good colleague's debrief. The owner is \"you\" (you asked for three placements, you answered a card); the work was done by named agents in the third person: the Scout searched, the Judge read and rejected, the Finder found editors, the Writer emailed (first emails only), the Negotiator read every reply and made every counter and every agreement, the Ledger recorded. Use ONLY the facts given; every number must come from them; quote editors only from the quotes given; write publication names exactly as given (lowercase hostnames, never capitalised or respelled). 4 to 6 short chapters in order (the search, the judging, the editors, the conversations, the deals, what needed you), one highlight (the single most interesting negotiation or decision), and a two-sentence closing. No hype, no markdown, no bullet lists. JSON: {title, chapters:[{heading, body}], highlight:{heading, body}, closing}." },
      { role: "user", content: `FACTS:\n${JSON.stringify(facts, null, 1)}\n\nNotes: "demo" means nothing was sent and the editors' replies were written by a model playing editors — say so once, plainly. A stand-in editor means the site published no address. Costs are in US dollars at Nebius list prices.` },
    ],
  }));
  // Super can spend its whole budget thinking about a long ledger; the second attempt writes without.
  let r: Awaited<ReturnType<typeof call>>;
  try { r = await call(true); } catch (e: any) { if (e?.kind === "truncated") r = await call(false); else throw e; }
  // The model sometimes escapes apostrophes inside JSON strings; the reader should never see a backslash.
  const clean = (t: string) => t.replace(/\\'/g, "'").replace(/\\"/g, '"');
  const d = r.data;
  return { title: clean(d.title), chapters: d.chapters.map((c) => ({ heading: clean(c.heading), body: clean(c.body) })), highlight: { heading: clean(d.highlight.heading), body: clean(d.highlight.body) }, closing: clean(d.closing), written_at: new Date().toISOString(), at_tick: camp.tick_count, model: r.meta.model, tokens: r.meta.tokens_in + r.meta.tokens_out };
}

export async function getOrWriteStory(camp: Campaign, opts: { force?: boolean } = {}): Promise<{ story: Story; facts: StoryFacts; meta?: LLMMeta }> {
  const facts = await storyFacts(camp);
  const cached = (camp as any).story as Story | null;
  const stale = !cached || cached.at_tick !== camp.tick_count || opts.force;
  if (!stale) return { story: cached!, facts };
  const story = await writeStory(camp, facts);
  await supabaseAdmin.from("campaigns").update({ story }).eq("id", camp.id);
  return { story, facts };
}

export async function ensureShareToken(camp: Campaign): Promise<string> {
  const existing = (camp as any).share_token as string | null;
  if (existing) return existing;
  const token = crypto.randomBytes(12).toString("base64url");
  await supabaseAdmin.from("campaigns").update({ share_token: token }).eq("id", camp.id);
  return token;
}
