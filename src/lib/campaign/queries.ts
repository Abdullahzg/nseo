// Data access for campaigns, prospects, deals, interventions and the activity feed.
import { supabaseAdmin } from "@/lib/db/supabase";
import { costUsd } from "@/lib/ai/models";
import type { AgentEventInput, AgentEvent, BudgetCheck, Campaign, CampaignPhase, DealTerms, Prospect, ProspectStatus } from "./types";

// ─── Campaigns ───────────────────────────────────────────────────────────────

export async function getCampaign(id: string): Promise<Campaign | null> {
  const { data } = await supabaseAdmin.from("campaigns").select("*").eq("id", id).maybeSingle();
  return (data as Campaign) ?? null;
}

/** The header's live line: "Judge is reading designdigest.creative.invalid (3 of 12)". Best-effort, never throws. */
export async function setActivity(campaignId: string, activity: Omit<import("./agents").Activity, "at"> | null): Promise<void> {
  try { await supabaseAdmin.from("campaigns").update({ activity: activity ? { ...activity, at: new Date().toISOString() } : null }).eq("id", campaignId); } catch { /* cosmetic */ }
}

export async function updateCampaign(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from("campaigns").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function setPhase(id: string, phase: CampaignPhase, reason?: string): Promise<void> {
  const patch: Record<string, unknown> = { phase };
  if (reason !== undefined) patch.completion_reason = reason;
  if (phase === "completed" || phase === "stopped" || phase === "failed") { patch.completed_at = new Date().toISOString(); patch.next_tick_after = null; }
  await updateCampaign(id, patch);
}

export async function listCampaigns(scope: { owner_email?: string | null; guest_id?: string | null }): Promise<Campaign[]> {
  let q = supabaseAdmin.from("campaigns").select("*").order("created_at", { ascending: false }).limit(100);
  if (scope.guest_id) q = q.eq("guest_id", scope.guest_id);
  else if (scope.owner_email) q = q.eq("owner_email", scope.owner_email).is("guest_id", null);
  const { data } = await q;
  return (data as Campaign[]) ?? [];
}

/** Campaigns the cron should tick now. */
export async function listDueCampaigns(limit = 10): Promise<Campaign[]> {
  const { data } = await supabaseAdmin
    .from("campaigns").select("*")
    .in("phase", ["planning", "discovering", "qualifying", "resolving_contacts", "outreaching", "monitoring"])
    .eq("paused", false)
    .or(`next_tick_after.is.null,next_tick_after.lte.${new Date().toISOString()}`)
    .order("next_tick_after", { ascending: true, nullsFirst: true })
    .limit(limit);
  return (data as Campaign[]) ?? [];
}

/**
 * Atomic budget commit: the UPDATE only applies while headroom holds, so two concurrent deals
 * cannot both pass the check. Returns ok=false when the second one loses.
 */
export async function reserveBudget(campaignId: string, amount: number, dealId?: string | null, note?: string): Promise<BudgetCheck> {
  const camp = await getCampaign(campaignId);
  if (!camp) return { ok: false, remaining: 0, requested: amount, reason: "campaign not found" };
  const total = Number(camp.budget_total ?? 0);
  const { data, error } = await supabaseAdmin.rpc("commit_budget", { p_campaign: campaignId, p_amount: amount });
  if (error) return { ok: false, remaining: Math.max(0, total - Number(camp.budget_used ?? 0)), requested: amount, reason: error.message };
  const ok = data === true;
  if (ok) await supabaseAdmin.from("budget_ledger").insert({ campaign_id: campaignId, deal_id: dealId ?? null, entry_type: "commit", amount, currency: camp.currency ?? "USD", note: note ?? null });
  const fresh = await getCampaign(campaignId);
  return { ok, remaining: Math.max(0, total - Number(fresh?.budget_used ?? 0)), requested: amount, reason: ok ? undefined : "insufficient budget" };
}

// ─── Prospects ───────────────────────────────────────────────────────────────

export async function upsertProspect(input: { campaign_id: string; domain_host: string; prospect_url?: string | null; title?: string | null; provenance: Prospect["provenance"] }): Promise<{ id: string; created: boolean }> {
  const { data: existing } = await supabaseAdmin.from("campaign_prospects").select("id").eq("campaign_id", input.campaign_id).eq("domain_host", input.domain_host).maybeSingle();
  if (existing) return { id: (existing as any).id, created: false };
  const { data, error } = await supabaseAdmin.from("campaign_prospects").insert({ ...input, status: "discovered" }).select("id").single();
  if (error) {
    const { data: again } = await supabaseAdmin.from("campaign_prospects").select("id").eq("campaign_id", input.campaign_id).eq("domain_host", input.domain_host).maybeSingle();
    if (again) return { id: (again as any).id, created: false };
    throw error;
  }
  return { id: (data as any).id, created: true };
}

export async function getProspect(id: string): Promise<Prospect | null> {
  const { data } = await supabaseAdmin.from("campaign_prospects").select("*").eq("id", id).maybeSingle();
  return (data as Prospect) ?? null;
}

export async function listProspects(campaignId: string, status?: ProspectStatus | ProspectStatus[], limit = 500): Promise<Prospect[]> {
  let q = supabaseAdmin.from("campaign_prospects").select("*").eq("campaign_id", campaignId).order("created_at", { ascending: true }).limit(limit);
  if (status) q = Array.isArray(status) ? q.in("status", status) : q.eq("status", status);
  const { data } = await q;
  return (data as Prospect[]) ?? [];
}

export async function countProspectsByStatus(campaignId: string): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin.from("campaign_prospects").select("status").eq("campaign_id", campaignId).limit(2000);
  const out: Record<string, number> = {};
  for (const r of (data as any[]) ?? []) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

export async function updateProspect(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from("campaign_prospects").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// ─── Deals ───────────────────────────────────────────────────────────────────

export async function createDeal(input: { campaign_id: string; anchor_email_id: string; author_id?: string | null; domain_host: string; publication?: string | null; terms: DealTerms; original_ask: number | null; agreed_price: number | null; currency?: string }) {
  const { data, error } = await supabaseAdmin.from("deals").insert({ ...input, currency: input.currency ?? "USD", status: "terms_agreed", agreed_at: new Date().toISOString() }).select().single();
  if (error) throw error;
  return data as any;
}

export async function getDeals(campaignId: string): Promise<any[]> {
  const { data } = await supabaseAdmin.from("deals").select("*").eq("campaign_id", campaignId).order("created_at", { ascending: true });
  return (data as any[]) ?? [];
}

export async function getDealByAnchor(anchorEmailId: string): Promise<any | null> {
  const { data } = await supabaseAdmin.from("deals").select("*").eq("anchor_email_id", anchorEmailId).maybeSingle();
  return (data as any) ?? null;
}

export async function listDealsForScope(scope: { owner_email?: string | null; guest_id?: string | null }): Promise<any[]> {
  let q = supabaseAdmin.from("deals").select("*, campaign:campaigns!inner(id, name, owner_email, guest_id, demo_mode)").order("created_at", { ascending: false }).limit(200);
  if (scope.guest_id) q = q.eq("campaign.guest_id", scope.guest_id);
  else if (scope.owner_email) q = q.eq("campaign.owner_email", scope.owner_email).is("campaign.guest_id", null);
  const { data } = await q;
  return (data as any[]) ?? [];
}

// ─── Interventions ───────────────────────────────────────────────────────────

export async function createIntervention(input: { campaign_id: string; anchor_email_id: string | null; prospect_id?: string | null; type: string; editor_quote: string | null; agent_plan: string; agent_needs: string; assistable: boolean }) {
  // One open card per thread.
  if (input.anchor_email_id) {
    const { data: open } = await supabaseAdmin.from("interventions").select("id").eq("anchor_email_id", input.anchor_email_id).eq("status", "open").maybeSingle();
    if (open) return { ...(open as any), duplicate: true };
  }
  const { data, error } = await supabaseAdmin.from("interventions").insert({ ...input, status: "open" }).select().single();
  if (error) throw error;
  return data as any;
}

export async function resolveIntervention(id: string, answer: string, resolvedBy: string, outcome: "answered" | "dismissed" | "taken_over"): Promise<any | null> {
  const { data, error } = await supabaseAdmin.from("interventions")
    .update({ status: outcome === "answered" ? "resolved" : outcome === "dismissed" ? "dismissed" : "taken_over", answer, resolved_by: resolvedBy, resolved_at: new Date().toISOString() })
    .eq("id", id).eq("status", "open").select().single();
  if (error) return null;
  return data as any;
}

export async function listInterventions(scope: { campaign_id?: string | null; owner_email?: string | null; guest_id?: string | null; status?: "open" | "resolved" | "dismissed" | "taken_over" }): Promise<any[]> {
  let q = supabaseAdmin.from("interventions").select("*, campaign:campaigns!inner(id, name, owner_email, guest_id, demo_mode), prospect:campaign_prospects(contact_name, domain_host)").order("created_at", { ascending: false }).limit(200);
  if (scope.campaign_id) q = q.eq("campaign_id", scope.campaign_id);
  if (scope.guest_id) q = q.eq("campaign.guest_id", scope.guest_id);
  else if (scope.owner_email) q = q.eq("campaign.owner_email", scope.owner_email).is("campaign.guest_id", null);
  if (scope.status) q = q.eq("status", scope.status);
  const { data } = await q;
  return (data as any[]) ?? [];
}

// ─── Activity feed ───────────────────────────────────────────────────────────

/** Append-only. Model metadata is flattened onto the row so the feed can show it without joins. */
export async function recordEvent(ev: AgentEventInput): Promise<void> {
  const metas = Array.isArray(ev.llm) ? ev.llm : ev.llm ? [ev.llm] : [];
  const tokens_in = metas.reduce((s, m) => s + (m.tokens_in ?? 0), 0);
  const tokens_out = metas.reduce((s, m) => s + (m.tokens_out ?? 0), 0);
  const latency_ms = metas.reduce((s, m) => s + (m.latency_ms ?? 0), 0);
  const model = metas.length ? [...new Set(metas.map((m) => m.model))].join(" + ") : null;
  const cost = metas.reduce<number | null>((s, m) => { const c = costUsd(m.model, m.tokens_in, m.tokens_out); return c == null ? s : (s ?? 0) + c; }, null);
  const reasoning = metas.map((m) => m.reasoning).filter(Boolean).join("\n\n---\n\n").slice(0, 4000) || null;
  const { error } = await supabaseAdmin.from("agent_events").insert({
    campaign_id: ev.campaign_id, agent: ev.agent, action: ev.action, human: ev.human, engine: ev.engine, level: ev.level ?? "info",
    prospect_id: ev.prospect_id ?? null, thread_id: ev.thread_id ?? null, detail: ev.detail ?? {},
    model, tokens_in: metas.length ? tokens_in : null, tokens_out: metas.length ? tokens_out : null, latency_ms: metas.length ? latency_ms : null,
    reasoning, cost_usd: cost, event_key: ev.event_key ?? null,
  });
  if (error && !/duplicate key/i.test(error.message)) console.error("[events] insert failed:", error.message);
}

export async function listEvents(campaignId: string, opts: { after_id?: number; before_id?: number; limit?: number } = {}): Promise<AgentEvent[]> {
  let q = supabaseAdmin.from("agent_events").select("*").eq("campaign_id", campaignId).order("id", { ascending: false }).limit(Math.min(500, opts.limit ?? 100));
  if (opts.after_id) q = q.gt("id", opts.after_id);
  if (opts.before_id) q = q.lt("id", opts.before_id);
  const { data } = await q;
  return (data as AgentEvent[]) ?? [];
}

// ─── Threads (outreach_emails anchors) ───────────────────────────────────────

export interface ThreadRow { id: string; author_id: string | null; negotiation_status: string | null; replied_at: string | null; reply_kind: string | null; to_email: string | null; prospect_id: string | null }

export async function listCampaignThreads(campaignId: string): Promise<ThreadRow[]> {
  const { data } = await supabaseAdmin.from("outreach_emails").select("id, author_id, negotiation_status, replied_at, reply_kind, to_email, prospect_id").eq("campaign_id", campaignId).eq("kind", "initial");
  return (data as ThreadRow[]) ?? [];
}

export async function countUnansweredReplies(campaignId: string): Promise<number> {
  const threads = await listCampaignThreads(campaignId);
  let n = 0;
  for (const t of threads) {
    if (!t.replied_at || ["agreed", "declined", "needs_human", "stalled", "handoff", "withdrawn"].includes(t.negotiation_status ?? "") || t.reply_kind === "auto") continue;
    const { data } = await supabaseAdmin.from("outreach_emails").select("sent_at").eq("parent_id", t.id).eq("kind", "negotiation").eq("status", "sent").order("sent_at", { ascending: false }).limit(1);
    const last = (data as any[])?.[0]?.sent_at as string | undefined;
    if (!last || last < t.replied_at) n++;
  }
  return n;
}
