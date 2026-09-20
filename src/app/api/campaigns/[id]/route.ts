import { NextRequest, NextResponse } from "next/server";
import { actorFor } from "@/lib/auth/service";
import { canSee } from "@/lib/campaign/access";
import { updateCampaign, setPhase, countProspectsByStatus, getDeals, listInterventions, listProspects, countUnansweredReplies, recordEvent } from "@/lib/campaign/queries";
import { statusSentence } from "@/lib/campaign/policy";
import { supabaseAdmin } from "@/lib/db/supabase";
import { isActivePhase } from "@/lib/campaign/types";

export const maxDuration = 30;

/** GET — everything the Campaign screen needs above the feed. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { camp, ok } = await canSee(req, id);
  if (!camp || !ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [counts, deals, open, unanswered, ready, qualified] = await Promise.all([
    countProspectsByStatus(id), getDeals(id), listInterventions({ campaign_id: id, status: "open" }), countUnansweredReplies(id), listProspects(id, "ready", 200), listProspects(id, "qualified", 200),
  ]);
  const c = (k: string) => counts[k] ?? 0;
  const dealsLive = deals.filter((d) => d.status !== "cancelled");
  const sentence = statusSentence({ camp, counts, deals: dealsLive.length, openInterventions: open.length, unansweredReplies: unanswered, sendableReady: ready.filter((p) => p.contact_email).length, actionableQualified: qualified.filter((p) => (p.contact_attempts ?? 0) < 3).length, paused_reason: camp.paused_reason, completion_reason: camp.completion_reason });
  const found = Object.values(counts).reduce((s, n) => s + n, 0);
  const contacted = c("outreached") + c("replied") + c("negotiating") + c("deal") + c("escalated") + c("lost");
  const replied = c("replied") + c("negotiating") + c("deal") + c("escalated");
  return NextResponse.json({
    campaign: camp, is_active: isActivePhase(camp.phase), sentence,
    numbers: { found, contacted, replied, deals: dealsLive.length },
    budget: { total: Number(camp.budget_total), used: Number(camp.budget_used), currency: camp.currency },
    open_interventions: open.length, deals: dealsLive, counts,
  });
}

/** PATCH — pause / resume / stop. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { caller, camp, ok } = await canSee(req, id);
  if (!camp || !ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");
  if (action === "pause") { await updateCampaign(id, { paused: true, paused_reason: "by you", paused_kind: "user" }); await recordEvent({ campaign_id: id, agent: "you", action: "paused", engine: "system", human: "You paused the campaign" }); }
  else if (action === "resume") { await updateCampaign(id, { paused: false, paused_reason: null, paused_kind: null, next_tick_after: new Date().toISOString() }); await recordEvent({ campaign_id: id, agent: "you", action: "resumed", engine: "system", human: "You resumed the campaign" }); }
  else if (action === "stop") { await setPhase(id, "stopped", "stopped_by_user"); await recordEvent({ campaign_id: id, agent: "you", action: "stopped", engine: "system", human: "You stopped the campaign" }); }
  else return NextResponse.json({ error: "action must be pause | resume | stop" }, { status: 400 });
  return NextResponse.json({ ok: true, by: actorFor(caller) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { camp, ok } = await canSee(req, id);
  if (!camp || !ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  await supabaseAdmin.from("campaigns").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
