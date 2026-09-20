// Demo mode. The rule: FIXTURE DATA IS FAKE, EVERY DECISION IS REAL.
//
// Fixtures give the model something to judge (publications, an editor, scripted replies). Every
// decision on top of them — relevance, qualification, outreach wording, reply classification,
// negotiation counters, deal recording — is a genuine Nemotron call or a deterministic policy
// rule, identical to real mode. The only simulated thing is the email transport.
import { supabaseAdmin } from "@/lib/db/supabase";
import { recordReplyOnAnchor } from "@/lib/db/queries";
import { listCampaignThreads, getProspect, updateProspect } from "./queries";

export interface DemoFixture { host: string; url: string; title: string; blurb: string; dr: number; editor: { name: string; email: string } }

// DR values are deliberately spread so the DR ≥ 50 gate rejects some; two are off-topic so the
// relevance model rejects some. The rest are the negotiation cast.
export const DEMO_FIXTURES: DemoFixture[] = [
  { host: "creativetech.invalid", url: "https://creativetech.invalid/best-ai-photo-editors", title: "The Best AI Photo Editors We Tested This Year", blurb: "Hands-on reviews of AI-powered photo editing apps: object removal, upscaling, restoration and batch workflows for creators.", dr: 58, editor: { name: "Sarah Mitchell", email: "sarah.mitchell@creativetech.invalid" } },
  { host: "photoworkflow.daily.invalid", url: "https://photoworkflow.daily.invalid/ai-image-restoration-guide", title: "AI Image Restoration: A Practical Guide for Photographers", blurb: "A working photographer's guide to restoring damaged and faded photos with AI tools, with before/after samples.", dr: 62, editor: { name: "Daniel Okafor", email: "daniel@photoworkflow.daily.invalid" } },
  { host: "restorereview.invalid", url: "https://restorereview.invalid/photo-restoration-tools-compared", title: "Photo Restoration Tools Compared: Old Photos, New Life", blurb: "Side-by-side comparison of consumer photo restoration services and apps, rated on quality, speed and price.", dr: 55, editor: { name: "Priya Raman", email: "priya@restorereview.invalid" } },
  { host: "makersblog.tech.invalid", url: "https://makersblog.tech.invalid/ai-photo-editor-roundup", title: "7 AI Photo Editor Apps for Content Creators (Hands-on)", blurb: "Roundup for YouTubers and social creators: which AI photo editors save the most time in a real publishing week.", dr: 64, editor: { name: "Leo Brandt", email: "leo@makersblog.tech.invalid" } },
  { host: "designdigest.creative.invalid", url: "https://designdigest.creative.invalid/restore-old-photos-ai", title: "How to Restore Old Photos with AI in 2026", blurb: "Step-by-step tutorial on scanning and restoring family photos using AI, aimed at hobbyists.", dr: 71, editor: { name: "Maya Chen", email: "maya@designdigest.creative.invalid" } },
  { host: "pixelcraft.journal.invalid", url: "https://pixelcraft.journal.invalid/ai-image-tools-for-ecommerce", title: "AI Image Tools Every Ecommerce Team Should Know", blurb: "Product-photo cleanup, background removal and enhancement tools for online stores, with pricing tables.", dr: 75, editor: { name: "Tom Alvarez", email: "tom@pixelcraft.journal.invalid" } },
  { host: "lensandlight.blog.invalid", url: "https://lensandlight.blog.invalid/photo-restoration-software-review", title: "I Tested 5 Photo Restoration Services: Honest Review", blurb: "One photographer's honest review of five photo restoration services, including AI-based ones.", dr: 53, editor: { name: "Hannah Weiss", email: "hannah@lensandlight.blog.invalid" } },
  { host: "genstack.weekly.invalid", url: "https://genstack.weekly.invalid/ai-image-restoration-roundup", title: "Roundup: AI Image Restoration Tools Worth Your Time", blurb: "Weekly newsletter's roundup of generative-AI image tools, with a section on restoration and enhancement.", dr: 78, editor: { name: "Ivan Petrov", email: "ivan@genstack.weekly.invalid" } },
  // Should be rejected on authority (DR below the default floor of 50):
  { host: "seomoz.invalid", url: "https://seomoz.invalid/ai-photo-editor-tools-list", title: "Top 50 AI Photo Editor Tools List", blurb: "A long list of AI photo tools with affiliate links.", dr: 31, editor: { name: "Editorial", email: "hello@seomoz.invalid" } },
  { host: "quickpix.review.invalid", url: "https://quickpix.review.invalid/best-photo-apps", title: "Best Photo Apps 2026", blurb: "Short listicle of photo apps for phones.", dr: 22, editor: { name: "Editorial", email: "team@quickpix.review.invalid" } },
  // Should be rejected on relevance (off-topic despite decent DR):
  { host: "gardenpost.invalid", url: "https://gardenpost.invalid/raised-beds-for-small-yards", title: "Raised Garden Beds for Small Yards", blurb: "Practical gardening advice on building raised beds, soil mixes and watering schedules.", dr: 61, editor: { name: "Nora Klein", email: "nora@gardenpost.invalid" } },
  { host: "fintechbrief.invalid", url: "https://fintechbrief.invalid/neobank-fees-compared", title: "Neobank Fees Compared: 2026 Edition", blurb: "A comparison of account fees, FX spreads and card perks across digital banks.", dr: 69, editor: { name: "Ravi Menon", email: "ravi@fintechbrief.invalid" } },
];

export function demoContactFor(host: string): { name: string; email: string } {
  return DEMO_FIXTURES.find((f) => f.host === host)?.editor ?? { name: "Editor", email: `editor@${host}` };
}

export type DemoPersona = "high_anchor" | "meeting_request" | "quick_deal" | "decliner" | "autoresponder" | "factual_question";
const PERSONAS: DemoPersona[] = ["high_anchor", "meeting_request", "quick_deal", "decliner", "high_anchor", "factual_question", "autoresponder", "high_anchor"];

const REPLY_DELAY_MS = Number(process.env.DEMO_REPLY_DELAY_MS ?? 0);

/** Scripted editor replies. Each stage is a genuine test of the negotiation policy. */
function nextPersonaMessage(persona: DemoPersona, theirMsgCount: number, product: string): { subject?: string; body: string } | null {
  switch (persona) {
    case "high_anchor":
      if (theirMsgCount === 0) return { body: `Hi, thanks for reaching out! We could include ${product} in an upcoming roundup. Our rate for a featured placement is $280.` };
      if (theirMsgCount === 1) return { body: "Appreciate the offer, but $220 is where we can land, and that is already below our usual rate." };
      if (theirMsgCount === 2) return { body: "Okay, final offer: $180 and we can publish this week." };
      return null;
    case "quick_deal":
      if (theirMsgCount === 0) return { body: `This fits our column nicely. We charge $120 for an inclusion, so if that works just send over the details and we will get it published.` };
      if (theirMsgCount === 1) return { body: "Great, $120 it is. Send the blurb whenever you're ready." };
      return null;
    case "meeting_request":
      if (theirMsgCount === 0) return { body: "Interesting. Before we include anything I'd like to hop on a quick 15-minute call to learn about the product. What does your availability look like this week?" };
      return null;
    case "factual_question":
      if (theirMsgCount === 0) return { body: "Could be a fit. Two questions first: what's your monthly traffic, and is the link do-follow and permanent? We only feature tools that meet our editorial bar." };
      return null;
    case "decliner":
      if (theirMsgCount === 0) return { body: "Thanks for thinking of us, but we don't accept placements like this. Best of luck elsewhere!" };
      return null;
    case "autoresponder":
      if (theirMsgCount === 0) return { subject: "Automatic reply: Out of office", body: "I am out of office until Monday with limited email access. For urgent matters please contact our editor at desk@dailyexample.invalid." };
      return null;
  }
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
    if (["agreed", "declined", "needs_human", "stalled", "handoff"].includes(th.negotiation_status ?? "")) continue;
    if (!th.prospect_id) continue;
    const p = await getProspect(th.prospect_id);
    const persona = (p?.demo_persona as DemoPersona) || null;
    if (!persona) { n++; continue; } // unassigned = first reply still due
    const st = await demoStage(th.id);
    if (!st || !st.ourSentAfter) continue;
    if (nextPersonaMessage(persona, st.theirs, "")) n++;
  }
  return n;
}

export async function assignDemoPersona(prospectId: string): Promise<DemoPersona> {
  const p = await getProspect(prospectId);
  if (p?.demo_persona && PERSONAS.includes(p.demo_persona as DemoPersona)) return p.demo_persona as DemoPersona;
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
    if (["agreed", "declined", "needs_human", "stalled"].includes(th.negotiation_status ?? "")) continue;
    if (!th.prospect_id) continue;
    const prospect = await getProspect(th.prospect_id);
    if (!prospect) continue;
    const persona = (prospect.demo_persona as DemoPersona) || (await assignDemoPersona(prospect.id));
    const stage = await demoStage(th.id);
    if (!stage) continue;
    const msg = nextPersonaMessage(persona, stage.theirs, product);
    if (!msg) continue;
    const ourSentAfter = stage.ourSentAfter;
    if (!ourSentAfter) continue; // wait until we've answered
    if (REPLY_DELAY_MS && Date.now() - new Date(ourSentAfter).getTime() < REPLY_DELAY_MS) continue;
    const editor = demoContactFor(prospect.domain_host);
    // Stamp the reply 1 s after our send so the "already answered" guard orders correctly.
    const at = new Date(new Date(ourSentAfter).getTime() + 1000).toISOString();
    const ok = await recordReplyOnAnchor(th.id, { reply_kind: persona === "autoresponder" ? "auto" : "reply", reply_from: `${editor.name} <${editor.email}>`, reply_subject: msg.subject ?? null, reply_excerpt: msg.body }, at);
    if (ok) injected++;
  }
  return injected;
}
