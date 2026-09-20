import { NextRequest, NextResponse } from "next/server";
import { canSee } from "@/lib/campaign/access";
import { supabaseAdmin } from "@/lib/db/supabase";
import { recordReplyOnAnchor } from "@/lib/db/queries";
import { demoContactFor } from "@/lib/campaign/demo";
import { updateProspect, recordEvent } from "@/lib/campaign/queries";
import { handleThread } from "@/lib/campaign/outreach";
import { withKeys } from "@/lib/ai/context";
import { getOwnerKeys } from "@/lib/db/queries";
import { stripQuotedReply } from "@/lib/email/imap";

export const maxDuration = 60;

export interface ThreadView {
  id: string; host: string; editor: string | null; subject: string; status: string | null; persona: string | null;
  messages: { from: "us" | "them"; body: string; at: string | null }[];
  open: boolean;
  /** What is happening on this thread right now, in the user's terms. */
  state: "agent_writing" | "waiting_editor" | "editor_replied" | "needs_you" | "you_answered" | "deal" | "declined" | "closed" | "taken_over";
  state_label: string;
  intervention: { type: string; status: string; answer: string | null } | null;
}

async function threadsFor(campaignId: string): Promise<ThreadView[]> {
  const [{ data: rows }, { data: ivs }, { data: campRow }] = await Promise.all([
    supabaseAdmin.from("outreach_emails")
      .select("id, kind, parent_id, subject, body, status, sent_at, replied_at, reply_excerpt, reply_from, negotiation_status, prospect:campaign_prospects(domain_host, contact_name, demo_persona)")
      .eq("campaign_id", campaignId).in("kind", ["initial", "negotiation"]).neq("status", "draft").order("created_at", { ascending: true }),
    supabaseAdmin.from("interventions").select("anchor_email_id, type, status, answer, created_at").eq("campaign_id", campaignId).order("created_at", { ascending: false }),
    supabaseAdmin.from("campaigns").select("activity").eq("id", campaignId).maybeSingle(),
  ]);
  const ivByAnchor = new Map<string, any>();
  for (const iv of (ivs ?? []) as any[]) if (!ivByAnchor.has(iv.anchor_email_id)) ivByAnchor.set(iv.anchor_email_id, iv);
  const activity = (campRow as any)?.activity ?? null;
  const writingTarget = activity && !activity.done && activity.agent === "negotiation" && Date.now() - new Date(activity.at).getTime() < 90_000 ? String(activity.target ?? "") : "";
  const byAnchor = new Map<string, ThreadView>();
  for (const r of (rows ?? []) as any[]) {
    const anchorId = r.kind === "initial" ? r.id : r.parent_id;
    if (!anchorId) continue;
    if (r.kind === "initial") {
      byAnchor.set(r.id, { id: r.id, host: r.prospect?.domain_host ?? "", editor: r.prospect?.contact_name ?? null, subject: r.subject ?? "", status: r.negotiation_status ?? null, persona: r.prospect?.demo_persona ?? null, messages: [], open: !["agreed", "declined", "stalled", "handoff", "withdrawn", "needs_human"].includes(r.negotiation_status ?? ""), state: "waiting_editor", state_label: "", intervention: null });
    }
    const t = byAnchor.get(anchorId);
    if (!t) continue;
    if (r.status === "sent" && r.body) t.messages.push({ from: "us", body: r.body, at: r.sent_at });
    if (r.kind === "initial" && r.reply_excerpt) t.messages.push({ from: "them", body: r.reply_excerpt, at: r.replied_at });
  }
  // Their reply belongs after the send it answers: order by time.
  for (const t of byAnchor.values()) {
    t.messages.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
    const iv = ivByAnchor.get(t.id);
    t.intervention = iv ? { type: iv.type, status: iv.status, answer: iv.answer ?? null } : null;
    const lastFrom = t.messages[t.messages.length - 1]?.from;
    const who = t.editor ?? "the editor";
    const st = t.status ?? "";
    if (st === "agreed") { t.state = "deal"; t.state_label = "Deal agreed"; }
    else if (st === "declined") { t.state = "declined"; t.state_label = `${who} declined; closed politely`; }
    else if (st === "handoff") { t.state = "taken_over"; t.state_label = "You took this over; the agent stays out"; }
    else if (st === "withdrawn" || st === "stalled") { t.state = "closed"; t.state_label = st === "withdrawn" ? "Closed politely; the campaign finished" : "Wound down after several rounds"; }
    else if (st === "needs_human") { t.state = "needs_you"; t.state_label = `Needs you: ${(iv?.type ?? "a decision").replace(/_/g, " ")}`; }
    else if (writingTarget && (t.host === writingTarget || t.host.endsWith(writingTarget))) { t.state = "agent_writing"; t.state_label = "Negotiator is writing the reply now"; }
    else if (iv && iv.status === "resolved" && lastFrom === "us") { t.state = "you_answered"; t.state_label = `You answered; the agent resumed and wrote back. Waiting for ${who}`; }
    else if (lastFrom === "them") { t.state = "editor_replied"; t.state_label = `${who} replied; the Negotiator answers on the next step`; }
    else { t.state = "waiting_editor"; t.state_label = `Waiting for ${who} to reply`; }
  }
  return [...byAnchor.values()].reverse();
}

/** GET — every email thread of the campaign, both directions, for the simulated inbox. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { camp, ok } = await canSee(req, id);
  if (!camp || !ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ threads: await threadsFor(id), demo: camp.demo_mode });
}

/**
 * POST {thread_id, text} — YOU are the editor. Demo only. The reply is recorded through the same
 * idempotent entry point the IMAP sweep uses, the scripted persona for that thread is retired, and
 * the agent answers immediately with a real model call — the point being that nothing you type can
 * have been anticipated.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { caller, camp, ok } = await canSee(req, id);
  if (!camp || !ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!camp.demo_mode) return NextResponse.json({ error: "Real campaigns get real replies: the agent reads the owner's inbox over IMAP." }, { status: 403 });
  if (!["outreaching", "monitoring"].includes(camp.phase)) return NextResponse.json({ error: `The campaign is ${camp.phase.replace("_", " ")}; there is no live thread to reply on.` }, { status: 409 });
  const body = await req.json().catch(() => ({}));
  const threadId = String(body?.thread_id ?? "");
  const text = stripQuotedReply(String(body?.text ?? "")).trim().slice(0, 2000);
  if (!threadId || text.length < 2) return NextResponse.json({ error: "thread_id and text required" }, { status: 400 });
  const { data: anchor } = await supabaseAdmin.from("outreach_emails").select("id, campaign_id, prospect_id, negotiation_status, subject, prospect:campaign_prospects(domain_host, demo_persona)").eq("id", threadId).eq("kind", "initial").maybeSingle();
  if (!anchor || (anchor as any).campaign_id !== id) return NextResponse.json({ error: "thread not found" }, { status: 404 });
  if (["agreed", "declined", "stalled", "handoff", "withdrawn"].includes((anchor as any).negotiation_status ?? "")) return NextResponse.json({ error: "This thread is closed." }, { status: 409 });
  if ((anchor as any).negotiation_status === "needs_human") return NextResponse.json({ error: "This thread is parked on the Needs-you screen — answer it there first." }, { status: 409 });
  const host = (anchor as any).prospect?.domain_host ?? "";
  const editor = demoContactFor(host);
  const isAuto = /^(automatic reply|out of office)/i.test(text);
  // Retire the script for this thread: from now on only you speak for this editor.
  if ((anchor as any).prospect_id) await updateProspect((anchor as any).prospect_id, { demo_persona: "manual" } as any);
  const recorded = await recordReplyOnAnchor(threadId, { reply_kind: isAuto ? "auto" : "reply", reply_from: `${editor.name} <${editor.email}>`, reply_subject: `Re: ${(anchor as any).subject ?? ""}`, reply_excerpt: text }, new Date().toISOString());
  if (!recorded) return NextResponse.json({ error: "That reply was already recorded." }, { status: 409 });
  await recordEvent({ campaign_id: id, agent: "editor", action: "reply_written_by_you", engine: "system", thread_id: threadId, prospect_id: (anchor as any).prospect_id ?? null, human: `You replied as ${editor.name} at ${host}: “${text.slice(0, 100)}${text.length > 100 ? "…" : ""}”`, detail: { by: caller?.kind ?? "unknown", simulated: true } });
  const result = await withKeys(await getOwnerKeys(camp.owner_email), () => handleThread(camp, threadId));
  return NextResponse.json({ ok: true, result: { persistedAs: result.persistedAs, statusHint: result.statusHint, intent: result.intent, theirPrice: result.theirPrice, interventionType: result.interventionType, body: result.draft?.body ?? null, error: (result as any).error ?? null }, threads: await threadsFor(id) });
}
