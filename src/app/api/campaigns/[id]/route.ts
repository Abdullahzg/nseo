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
  // Per-agent and per-tool tallies for the pipeline graphic and the Tools panel — read from the
  // feed, so they are the same numbers a judge can count there.
  const { data: ev } = await supabaseAdmin.from("agent_events").select("agent, action, engine, model, tokens_in, tokens_out, cost_usd, detail").eq("campaign_id", id).limit(5000);
  const events = (ev ?? []) as any[];
  const modelCalls = events.filter((e) => e.engine === "model");
  const byAgent: Record<string, { events: number; model_calls: number; cost_usd: number }> = {};
  for (const e of events) { const a = (byAgent[e.agent] ??= { events: 0, model_calls: 0, cost_usd: 0 }); a.events++; if (e.engine === "model") { a.model_calls++; a.cost_usd += Number(e.cost_usd ?? 0); } }
  const modelsUsed: Record<string, number> = {};
  for (const e of modelCalls) for (const m of String(e.model ?? "").split(" + ")) if (m) modelsUsed[m] = (modelsUsed[m] ?? 0) + 1;
  const searches = events.filter((e) => e.action === "search_batch" && !e.detail?.synthetic && !e.detail?.seed);
  const tools = {
    nebius: { calls: modelCalls.length, cost_usd: modelCalls.reduce((s, e) => s + Number(e.cost_usd ?? 0), 0), tokens_in: modelCalls.reduce((s, e) => s + Number(e.tokens_in ?? 0), 0), tokens_out: modelCalls.reduce((s, e) => s + Number(e.tokens_out ?? 0), 0), models: modelsUsed },
    tavily: { searches: searches.length, results: searches.reduce((s, e) => s + Number(e.detail?.hits ?? 0), 0), used: !camp.demo_mode && camp.search_web !== false },
    seeds: { listed: (camp.seed_contacts ?? []).length },
    fixtures: { loaded: events.filter((e) => e.engine === "fixture" && e.action === "prospect_found").length },
    pages: { fetched: events.filter((e) => ["prospect_qualified", "prospect_rejected"].includes(e.action)).length },
    gmail: { sent: events.filter((e) => ["outreach_sent", "negotiation_sent", "followup_sent"].includes(e.action)).length, simulated: events.filter((e) => e.action === "outreach_sent_simulated").length, replies: events.filter((e) => e.action === "replies_received").reduce((s, e) => s + 1, 0) },
    ledger: { deals: dealsLive.length, committed: Number(camp.budget_used) },
  };
  return NextResponse.json({
    campaign: camp, is_active: isActivePhase(camp.phase), sentence,
    numbers: { found, contacted, replied, deals: dealsLive.length },
    budget: { total: Number(camp.budget_total), used: Number(camp.budget_used), currency: camp.currency },
    open_interventions: open.length, deals: dealsLive, counts,
    activity: camp.activity ?? null, agents: byAgent, tools,
    contacts: c("ready") + c("outreached") + c("replied") + c("negotiating") + c("deal") + c("escalated") + c("lost"),
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
