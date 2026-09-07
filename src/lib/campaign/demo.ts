// Demo mode simulator (new hackathon work).
//
// Simulated publisher personas injected through the REAL reply-recording path
// (recordReplyOnAnchor — the same idempotent entry point the IMAP sweeper uses),
// so classification, negotiation policy, HITL parking and deal recording all run
// unmodified. Only the transport boundary is simulated; everything downstream is real.
import { supabaseAdmin } from "@/lib/db/supabase";
import { recordReplyOnAnchor } from "@/lib/db/queries";
import { listCampaignThreads } from "./outreach";

export type DemoPersona = "high_anchor" | "meeting_request" | "decliner" | "autoresponder" | "quick_deal";

const PERSONAS: DemoPersona[] = ["high_anchor", "meeting_request", "quick_deal", "decliner", "autoresponder"];

const REPLY_DELAY_MS = Number(process.env.DEMO_REPLY_DELAY_MS ?? 8000);

interface PersonaMsg {
  subject?: string;
  body: string;
}

/** Deterministic scripts that reproduce the historical negotiation arc (§50):
 *  they open high ($350), concede slowly ($275), settle at $230 — under a $240 ceiling. */
function nextPersonaMessage(persona: DemoPersona, theirMsgCount: number): PersonaMsg | null {
  switch (persona) {
    case "high_anchor":
      // Sequence of THEIR messages across the negotiation.
      if (theirMsgCount === 0)
        return { body: "Hi, thanks for reaching out! We could include your tool in an upcoming roundup. Our rate for a feature is \$350." };
      if (theirMsgCount === 1) return { body: "Appreciate the offer, but $275 is where we can land, and that is already below our usual rate." };
      if (theirMsgCount === 2) return { body: "Final offer: $230 and we can publish this week." };
      return null;
    case "quick_deal":
      if (theirMsgCount === 0) return { body: "This fits our column nicely. We charge $120 for an inclusion, payable by invoice." };
      return null;
    case "meeting_request":
      if (theirMsgCount === 0)
        return { body: "Interesting! Before we go further, can you jump on a quick call Wednesday at 2pm to walk me through it?" };
      return null;
    case "decliner":
      if (theirMsgCount === 0) return { body: "Thanks for thinking of us, but we don't accept placements like this. Best of luck elsewhere!" };
      return null;
    case "autoresponder":
      if (theirMsgCount === 0)
        return { subject: "Out of office", body: "I am out of office until Monday with limited email access. For urgent matters contact editor@dailyexample.com." };
      return null;
  }
}

/** Assign each demo outreach a deterministic persona so the scenario repeats reliably. */
export async function assignDemoPersona(prospectId: string): Promise<DemoPersona> {
  const { data } = await supabaseAdmin
    .from("campaign_prospects")
    .select("notes")
    .eq("id", prospectId)
    .maybeSingle();
  const existing = ((data as any)?.notes?.demo_persona ?? "") as DemoPersona;
  if (existing && PERSONAS.includes(existing)) return existing;
  const { count } = await supabaseAdmin
    .from("campaign_prospects")
    .select("id", { count: "exact", head: true })
    .not("notes->>demo_persona", "is", null);
  const persona = PERSONAS[(count ?? 0) % PERSONAS.length];
  await supabaseAdmin
    .from("campaign_prospects")
    .update({ notes: { ...((data as any)?.notes ?? {}), demo_persona: persona } })
    .eq("id", prospectId);
  return persona;
}

function countTheirMessages(rows: any[]): number {
  return rows.filter((r) => r.replied_at).length;
}

/**
 * Inject due simulated replies for one campaign's threads. Idempotent: a persona whose
 * current-stage message is already recorded produces nothing.
 */
export async function injectDemoReplies(campaignId: string): Promise<number> {
  const threads = await listCampaignThreads(campaignId);
  let injected = 0;
  for (const th of threads) {
    const { data: anchor } = await supabaseAdmin
      .from("outreach_emails")
      .select("*")
      .eq("id", th.anchor_id)
      .maybeSingle();
    const a = anchor as any;
    if (!a || !a.sent_at) continue;
    if (["agreed", "declined", "needs_human", "handoff"].includes(a.negotiation_status)) continue;

    // Persona comes from the prospect row scoped to THIS campaign (not just author_id).
    const { data: prospect } = await supabaseAdmin
      .from("campaign_prospects")
      .select("id, notes, domain_host")
      .eq("campaign_id", campaignId)
      .eq("author_id", a.author_id)
      .limit(1)
      .maybeSingle();
    let persona = ((prospect as any)?.notes?.demo_persona ?? "") as DemoPersona;
    if (!persona || !PERSONAS.includes(persona)) {
      if (!prospect) continue;
      persona = await assignDemoPersona((prospect as any).id);
    }

    // Conversation state: full thread rows oldest-first.
    const { data: rows } = await supabaseAdmin
      .from("outreach_emails")
      .select("kind, status, replied_at, sent_at, parent_id")
      .or(`id.eq.${th.anchor_id},parent_id.eq.${th.anchor_id}`)
      .order("created_at", { ascending: true });
    const rowsT = (rows ?? []) as any[];
    const theirs = countTheirMessages(rowsT);

    const msg = nextPersonaMessage(persona, theirs);
    if (!msg) continue;

    // Pace the demo: stage 0 fires after the initial send; every later stage fires only
    // after WE have replied to their previous message (a real negotiation rhythm).
    const theirLast = rowsT.map((r) => r.replied_at).filter(Boolean).sort().pop() as string | undefined;
    let reference: string | undefined;
    if (theirs > 0) {
      const ourRepliesAfter = rowsT
        .filter((r) => r.status === "sent" && r.sent_at && (!theirLast || r.sent_at > theirLast))
        .map((r) => r.sent_at)
        .sort()
        .pop() as string | undefined;
      if (!ourRepliesAfter) continue; // our negotiator hasn't answered yet — hold the next stage
      reference = ourRepliesAfter;
    } else {
      reference = rowsT.filter((r) => r.status === "sent").map((r) => r.sent_at).sort().pop() as string | undefined;
    }
    if (reference && Date.now() - new Date(reference).getTime() < REPLY_DELAY_MS) continue;

    // Autoresponder persona: mark as auto so the negotiator skips it (legacy rule).
    const kind = persona === "autoresponder" ? "auto" : "reply";
    const senderName = `${(prospect as any)?.domain_host ?? "publisher"} Editorial`;
    const ok = await recordReplyOnAnchor(
      th.anchor_id,
      {
        reply_kind: kind,
        reply_from: `${senderName} <editor@${(prospect as any)?.domain_host ?? "simulated.local"}>`,
        reply_subject: msg.subject ?? `Re: ${a.subject ?? ""}`,
        reply_excerpt: msg.body,
      },
      new Date().toISOString(),
    );
    if (!ok) continue;
    injected++;

    try {
      await supabaseAdmin.from("campaign_prospects").update({ status: "replied" }).eq("id", (prospect as any).id);
    } catch {}
  }
  return injected;
}
