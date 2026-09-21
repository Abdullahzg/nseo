// Demo mode. The rule: THE DEMO IS THE REAL PIPELINE; ONLY THE EMAIL TRANSPORT IS SIMULATED.
//
// With a Tavily key the demo searches the real web, reads real pages, judges them, finds real
// editors, and writes real outreach — it just never sends it. The editors' replies are written by
// the model role-playing an editor with a stance. Without any search key, the fixture publications
// below stand in for the web so the demo still runs offline; they are labelled as such.
import { supabaseAdmin } from "@/lib/db/supabase";
import { threadFromRows } from "@/lib/negotiation/thread";
import { recordReplyOnAnchor } from "@/lib/db/queries";
import { listCampaignThreads, getProspect, updateProspect, recordEvent } from "./queries";
import { searchProvider } from "@/lib/search/webSearch";
import { json as nebiusJson, type LLMMeta } from "@/lib/ai/nebius";

export interface DemoFixture { host: string; url: string; title: string; blurb: string; dr: number; editor: { name: string; email: string } }

// DR values are deliberately spread so the DR ≥ 50 gate rejects some; two are off-topic so the
// relevance model rejects some. The rest are the negotiation cast.
export const DEMO_FIXTURES: DemoFixture[] = [
  { host: "creativetech.example", url: "https://creativetech.example/best-ai-photo-editors", title: "The Best AI Photo Editors We Tested This Year", blurb: "Hands-on reviews of AI-powered photo editing apps: object removal, upscaling, restoration and batch workflows for creators.", dr: 58, editor: { name: "Sarah Mitchell", email: "sarah.mitchell@creativetech.example" } },
  { host: "photoworkflow.daily.example", url: "https://photoworkflow.daily.example/ai-image-restoration-guide", title: "AI Image Restoration: A Practical Guide for Photographers", blurb: "A working photographer's guide to restoring damaged and faded photos with AI tools, with before/after samples.", dr: 62, editor: { name: "Daniel Okafor", email: "daniel@photoworkflow.daily.example" } },
  { host: "restorereview.example", url: "https://restorereview.example/photo-restoration-tools-compared", title: "Photo Restoration Tools Compared: Old Photos, New Life", blurb: "Side-by-side comparison of consumer photo restoration services and apps, rated on quality, speed and price.", dr: 55, editor: { name: "Priya Raman", email: "priya@restorereview.example" } },
  { host: "makersblog.tech.example", url: "https://makersblog.tech.example/ai-photo-editor-roundup", title: "7 AI Photo Editor Apps for Content Creators (Hands-on)", blurb: "Roundup for YouTubers and social creators: which AI photo editors save the most time in a real publishing week.", dr: 64, editor: { name: "Leo Brandt", email: "leo@makersblog.tech.example" } },
  { host: "designdigest.creative.example", url: "https://designdigest.creative.example/restore-old-photos-ai", title: "How to Restore Old Photos with AI in 2026", blurb: "Step-by-step tutorial on scanning and restoring family photos using AI, aimed at hobbyists.", dr: 71, editor: { name: "Maya Chen", email: "maya@designdigest.creative.example" } },
  { host: "pixelcraft.journal.example", url: "https://pixelcraft.journal.example/ai-image-tools-for-ecommerce", title: "AI Image Tools Every Ecommerce Team Should Know", blurb: "Product-photo cleanup, background removal and enhancement tools for online stores, with pricing tables.", dr: 75, editor: { name: "Tom Alvarez", email: "tom@pixelcraft.journal.example" } },
  { host: "lensandlight.blog.example", url: "https://lensandlight.blog.example/photo-restoration-software-review", title: "I Tested 5 Photo Restoration Services: Honest Review", blurb: "One photographer's honest review of five photo restoration services, including AI-based ones.", dr: 53, editor: { name: "Hannah Weiss", email: "hannah@lensandlight.blog.example" } },
  { host: "genstack.weekly.example", url: "https://genstack.weekly.example/ai-image-restoration-roundup", title: "Roundup: AI Image Restoration Tools Worth Your Time", blurb: "Weekly newsletter's roundup of generative-AI image tools, with a section on restoration and enhancement.", dr: 78, editor: { name: "Ivan Petrov", email: "ivan@genstack.weekly.example" } },
  // Should be rejected on authority (DR below the default floor of 50):
  { host: "seomoz.example", url: "https://seomoz.example/ai-photo-editor-tools-list", title: "Top 50 AI Photo Editor Tools List", blurb: "A long list of AI photo tools with affiliate links.", dr: 31, editor: { name: "Editorial", email: "hello@seomoz.example" } },
  { host: "quickpix.review.example", url: "https://quickpix.review.example/best-photo-apps", title: "Best Photo Apps 2026", blurb: "Short listicle of photo apps for phones.", dr: 22, editor: { name: "Editorial", email: "team@quickpix.review.example" } },
  // Should be rejected on relevance (off-topic despite decent DR):
  { host: "gardenpost.example", url: "https://gardenpost.example/raised-beds-for-small-yards", title: "Raised Garden Beds for Small Yards", blurb: "Practical gardening advice on building raised beds, soil mixes and watering schedules.", dr: 61, editor: { name: "Nora Klein", email: "nora@gardenpost.example" } },
  { host: "fintechbrief.example", url: "https://fintechbrief.example/neobank-fees-compared", title: "Neobank Fees Compared: 2026 Edition", blurb: "A comparison of account fees, FX spreads and card perks across digital banks.", dr: 69, editor: { name: "Ravi Menon", email: "ravi@fintechbrief.example" } },
];

const STAND_IN_FIRST = ["Sofia", "Marcus", "Aisha", "Jonas", "Priya", "Elena", "Tomas", "Hannah", "Kenji", "Lucas", "Nadia", "Oliver", "Mei", "Daniel"];
const STAND_IN_LAST = ["Reyes", "Bell", "Karim", "Weber", "Nair", "Rossi", "Ortega", "Lind", "Sato", "Moreau", "Okafor", "Hughes", "Tanaka"];

/** A fixture's editor, or a labelled stand-in for a real site that publishes no address (demo only; nothing is ever sent). */
export function demoContactFor(host: string): { name: string; email: string } {
  const fixture = DEMO_FIXTURES.find((f) => f.host === host)?.editor;
  if (fixture) return fixture;
  let h = 0; for (const ch of host) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const name = `${STAND_IN_FIRST[h % STAND_IN_FIRST.length]} ${STAND_IN_LAST[Math.floor(h / 7) % STAND_IN_LAST.length]}`;
  const [first, last] = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(" ");
  return { name, email: `${first}.${last}@${host}` };
}

export type DemoPersona = "high_anchor" | "meeting_request" | "quick_deal" | "decliner" | "autoresponder" | "factual_question" | "manual";
const PERSONAS: DemoPersona[] = ["high_anchor", "meeting_request", "quick_deal", "decliner", "high_anchor", "factual_question", "autoresponder", "high_anchor"];

const REPLY_DELAY_MS = Number(process.env.DEMO_REPLY_DELAY_MS ?? 0);

/**
 * THE DEMO RULE (2026-09-20, second version): the demo IS the real pipeline — real web search,
 * real pages, real judging, real editor lookup — with exactly one difference: no email leaves the
 * machine. The editors' replies are written by Nemotron 3 Nano role-playing an editor with a
 * stance (below), so the negotiation faces words nobody scripted. Only when there is no Tavily key
 * at all does the demo fall back to the fixture publications above.
 */
export function demoUsesFixtures(): boolean {
  return !searchProvider();
}

/** The editor's stance at each stage of a thread. The words are the model's, every time. */
function personaBrief(persona: DemoPersona, theirMsgCount: number): { brief: string; auto?: boolean } | null {
  switch (persona) {
    case "manual": return null; // a person is playing this editor from the simulated inbox
    case "high_anchor":
      if (theirMsgCount === 0) return { brief: "You like the pitch and will include them. Quote a firm price of $280 for a permanent, do-follow inclusion. Confident, brief." };
      if (theirMsgCount === 1) return { brief: "They countered below your price. Come down a little, to around $200, and say that is as low as you go this month." };
      if (theirMsgCount === 2) return { brief: "If their last number is at least $150, accept it and ask them to send the blurb and link. Otherwise decline politely." };
      return null;
    case "quick_deal":
      if (theirMsgCount === 0) return { brief: "Easy yes. Say it fits your column, your rate is $120 for an inclusion, and ask them to send a short blurb and a link." };
      if (theirMsgCount === 1) return { brief: "Confirm the deal in one line and ask for the blurb whenever they are ready." };
      return null;
    case "meeting_request":
      if (theirMsgCount === 0) return { brief: "You are interested but want a quick 15-minute call before including anything. Ask what their availability is this week. Do not name a price." };
      if (theirMsgCount === 1) return { brief: "Fine, email works. Quote $150 for the inclusion and ask if that works." };
      if (theirMsgCount === 2) return { brief: "If they accepted or offered at least $120, agree and ask for the blurb. Otherwise say you will pass." };
      return null;
    case "factual_question":
      if (theirMsgCount === 0) return { brief: "Before quoting anything you need two facts: their monthly traffic, and whether they expect a do-follow, permanent link. Ask exactly those two questions. Do not name a price." };
      if (theirMsgCount === 1) return { brief: "Their numbers are fine. Quote $160 for a do-follow inclusion." };
      if (theirMsgCount === 2) return { brief: "If they accepted or offered at least $130, agree in one line. Otherwise decline politely." };
      return null;
    case "decliner":
      if (theirMsgCount === 0) return { brief: "Decline politely in one or two sentences: you do not run paid or sponsored placements in editorial content. Wish them luck." };
      return null;
    case "autoresponder":
      if (theirMsgCount === 0) return { brief: "You are an out-of-office autoresponder: state you are away until next Monday with limited email access, and that you will reply on return. No other content.", auto: true };
      return null;
  }
}

const REPLY_SCHEMA = { name: "editor_reply", schema: { type: "object", properties: { body: { type: "string" } }, required: ["body"], additionalProperties: false } };
const isReply = (v: unknown): v is { body: string } => typeof (v as any)?.body === "string" && (v as any).body.trim().length > 10;

/** Nano role-plays the editor: the stance is given, the words are not. Throws on model failure (recorded by the caller). */
async function writeEditorReply(persona: DemoPersona, theirMsgCount: number, ctx: { host: string; editorName: string; product: string; thread: { from: "us" | "them"; body: string }[] }): Promise<{ subject?: string; body: string; auto: boolean; meta: LLMMeta } | null> {
  const stage = personaBrief(persona, theirMsgCount);
  if (!stage) return null;
  const convo = ctx.thread.map((m) => `${m.from === "us" ? "THEM (the product's outreach)" : "YOU (the editor)"}: ${m.body}`).join("\n\n---\n\n");
  const r = await nebiusJson<{ body: string }>({
    role: "fast", thinking: false, max_tokens: 300, temperature: 0.7, schema: REPLY_SCHEMA, validate: isReply,
    messages: [
      { role: "system", content: `You are ${ctx.editorName}, an editor at ${ctx.host}, replying by email to a product team that wants to be featured. Write only the reply body, 1-3 sentences, plain text, in your own words, no signature, no subject line. Stay in character and follow the stance you are given exactly. JSON: {body}.` },
      { role: "user", content: `Their product: ${ctx.product}.\nYour stance for THIS reply: ${stage.brief}\n\nThe conversation so far:\n${convo || "(they have not written yet)"}` },
    ],
  });
  return { body: r.data.body.trim(), subject: stage.auto ? "Automatic reply: Out of office" : undefined, auto: !!stage.auto, meta: r.meta };
}

/**
 * Where a thread is in its script. `theirs` = how many scripted messages the editor has already
 * sent = how many replies of ours went out (each of ours answers one of theirs; the initial counts
 * as answering nothing). `ourSentAfter` = our latest send that is newer than their latest reply.
 */
export async function demoStage(anchorId: string): Promise<{ theirs: number; ourSentAfter: string | undefined } | null> {
  const { data: rows } = await supabaseAdmin.from("outreach_emails").select("kind, status, replied_at, sent_at").or(`id.eq.${anchorId},parent_id.eq.${anchorId}`).order("created_at", { ascending: true });
  const rowsT = (rows ?? []) as any[];
  const anchor = rowsT.find((r) => r.kind === "initial");
  if (!anchor?.sent_at) return null;
  const ourReplies = rowsT.filter((r) => r.kind === "negotiation" && r.status === "sent" && r.sent_at);
  const theirs = ourReplies.length;
  const theirLast = anchor.replied_at as string | null;
  const ourSentAfter = [anchor, ...ourReplies].filter((r) => r.sent_at && (!theirLast || r.sent_at > theirLast)).map((r) => r.sent_at as string).sort().pop();
  return { theirs, ourSentAfter };
}

/** How many threads would receive a scripted reply on the next injection (no writes). */
export async function countDueDemoReplies(campaignId: string): Promise<number> {
  const threads = await listCampaignThreads(campaignId);
  let n = 0;
  for (const th of threads) {
    if (["agreed", "declined", "needs_human", "stalled", "handoff", "withdrawn"].includes(th.negotiation_status ?? "")) continue;
    if (!th.prospect_id) continue;
    const p = await getProspect(th.prospect_id);
    const persona = (p?.demo_persona as DemoPersona) || null;
    if (persona === "manual") continue;
    if (!persona) { n++; continue; } // unassigned = first reply still due
    const st = await demoStage(th.id);
    if (!st || !st.ourSentAfter) continue;
    if (personaBrief(persona, st.theirs)) n++;
  }
  return n;
}

export async function assignDemoPersona(prospectId: string): Promise<DemoPersona> {
  const p = await getProspect(prospectId);
  if (p?.demo_persona && (PERSONAS.includes(p.demo_persona as DemoPersona) || p.demo_persona === "manual")) return p.demo_persona as DemoPersona;
  const { count } = await supabaseAdmin.from("campaign_prospects").select("id", { count: "exact", head: true }).eq("campaign_id", p!.campaign_id).not("demo_persona", "is", null);
  const persona = PERSONAS[(count ?? 0) % PERSONAS.length];
  await updateProspect(prospectId, { demo_persona: persona });
  return persona;
}

/**
 * Inject the next scripted reply on each thread that is waiting for one. Uses the SAME
 * idempotent entry point as the real IMAP sweeper (recordReplyOnAnchor). Stage 0 fires after our
 * initial; later stages only after we have answered the previous one — a real rhythm.
 */
export async function injectDemoReplies(campaignId: string, product: string): Promise<number> {
  const threads = await listCampaignThreads(campaignId);
  let injected = 0;
  for (const th of threads) {
    if (["agreed", "declined", "needs_human", "stalled", "handoff", "withdrawn"].includes(th.negotiation_status ?? "")) continue;
    if (!th.prospect_id) continue;
    const prospect = await getProspect(th.prospect_id);
    if (!prospect) continue;
    const persona = (prospect.demo_persona as DemoPersona) || (await assignDemoPersona(prospect.id));
    const stage = await demoStage(th.id);
    if (!stage) continue;
    if (!personaBrief(persona, stage.theirs)) continue;
    const ourSentAfter = stage.ourSentAfter;
    if (!ourSentAfter) continue; // wait until we've answered
    if (REPLY_DELAY_MS && Date.now() - new Date(ourSentAfter).getTime() < REPLY_DELAY_MS) continue;
    // The thread as the editor sees it (our sends and their earlier replies), for the role-play.
    const { data: rows } = await supabaseAdmin.from("outreach_emails").select("kind, body, subject, status, reply_excerpt, reply_history, reply_from, reply_subject, sent_at, replied_at, created_at").or(`id.eq.${th.id},parent_id.eq.${th.id}`).order("created_at", { ascending: true });
    const thread: { from: "us" | "them"; body: string }[] = threadFromRows((rows ?? []) as any[]).map((m) => ({ from: m.from, body: m.body }));
    const editorName = prospect.contact_name || demoContactFor(prospect.domain_host).name;
    const editorEmail = prospect.contact_email || demoContactFor(prospect.domain_host).email;
    let msg: Awaited<ReturnType<typeof writeEditorReply>>;
    try { msg = await writeEditorReply(persona, stage.theirs, { host: prospect.domain_host, editorName, product, thread }); }
    catch (e: any) {
      await recordEvent({ campaign_id: campaignId, agent: "inbox", action: "demo_reply_error", engine: "system", level: "warn", thread_id: th.id, prospect_id: prospect.id, human: `Could not write ${editorName}'s reply (${e?.message ?? e}); it will be tried again next step`, detail: { persona } });
      continue;
    }
    if (!msg) continue;
    // Stamp the reply 1 s after our send so the "already answered" guard orders correctly.
    const at = new Date(Math.max(new Date(ourSentAfter).getTime() + 1000, Date.now() - 500)).toISOString();
    const ok = await recordReplyOnAnchor(th.id, { reply_kind: msg.auto ? "auto" : "reply", reply_from: `${editorName} <${editorEmail}>`, reply_subject: msg.subject ?? null, reply_excerpt: msg.body }, at);
    if (ok) {
      injected++;
      await recordEvent({ campaign_id: campaignId, agent: "inbox", action: "demo_reply_written", engine: "model", llm: msg.meta, thread_id: th.id, prospect_id: prospect.id, human: `${editorName} at ${prospect.domain_host} replied (written by the model playing an editor who ${describe(persona)}): “${msg.body.slice(0, 120)}${msg.body.length > 120 ? "…" : ""}”`, detail: { persona, stage: stage.theirs, simulated: true, body: msg.body } });
    }
  }
  return injected;
}

function describe(p: DemoPersona): string {
  return { high_anchor: "opens high on price", quick_deal: "says yes quickly", meeting_request: "wants a call first", factual_question: "asks about traffic", decliner: "declines sponsored content", autoresponder: "is out of office", manual: "is played by you" }[p];
}
