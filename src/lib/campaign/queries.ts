// Typed data access for the agentic campaign layer. All calls go through the
// service-role client (server-side only), matching the legacy queries.ts pattern.
import { supabaseAdmin } from "@/lib/db/supabase";
import type {
  AgentEventInput,
  BudgetCheck,
  CampaignPhase,
  DealStatus,
  DealTerms,
  DiscoveryProvenance,
  ProspectStatus,
  ScoreBreakdown,
} from "./types";

// ─── Campaign lifecycle ───────────────────────────────────────────────────────

export async function getCampaignRow(id: string): Promise<any | null> {
  const { data } = await supabaseAdmin.from("campaigns").select("*").eq("id", id).maybeSingle();
  return (data as any) ?? null;
}

export async function updateCampaignExt(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from("campaigns").update(patch).eq("id", id);
  if (error) throw error;
}

export function isActivePhase(phase: string | null | undefined): boolean {
  return ["planning", "discovering", "qualifying", "resolving_contacts", "outreaching", "monitoring"].includes(phase ?? "");
}

export async function setCampaignPhase(id: string, phase: CampaignPhase, reason?: string): Promise<void> {
  const patch: Record<string, unknown> = { phase };
  if (reason !== undefined) patch.completion_reason = reason;
  if (phase === "completed" || phase === "stopped" || phase === "failed") patch.completed_at = new Date().toISOString();
  await updateCampaignExt(id, patch);
}

export async function setCampaignControls(
  id: string,
  controls: Partial<{ paused_discovery: boolean; paused_outreach: boolean; paused_negotiation: boolean; emergency_stopped: boolean }>
): Promise<void> {
  await updateCampaignExt(id, controls);
}

/** Atomic budget reservation. Returns ok=false when the remaining budget is insufficient —
 *  the WHERE clause makes the check-and-increment a single atomic statement in Postgres. */
export async function reserveBudget(campaignId: string, amount: number, dealId?: string | null, note?: string): Promise<BudgetCheck> {
  const camp = await getCampaignRow(campaignId);
  if (!camp) return { ok: false, remaining: 0, requested: amount, reason: "campaign not found" };
  const total = Number(camp.budget_total ?? 0);
  const used = Number(camp.budget_used ?? 0);
  if (amount > total - used) {
    return { ok: false, remaining: Math.max(0, total - used), requested: amount, reason: "insufficient budget" };
  }
  // Guarded increment: only applies when the headroom still holds (race-safe).
  const { data, error } = await supabaseAdmin
    .from("campaigns")
    .update({ budget_used: used + amount })
    .eq("id", campaignId)
    .lte("budget_used", total - amount)
    .select("budget_total,budget_used")
    .single();
  if (error || !data) {
    const cur = await getCampaignRow(campaignId);
    return { ok: false, remaining: Math.max(0, Number(cur?.budget_total ?? 0) - Number(cur?.budget_used ?? 0)), requested: amount, reason: "concurrent spend" };
  }
  await addLedgerEntry(campaignId, dealId ?? null, "commit", amount, camp.currency ?? "USD", note ?? "deal committed");
  return { ok: true, remaining: Number(data.budget_total) - Number(data.budget_used), requested: amount };
}

export async function releaseBudget(campaignId: string, amount: number, dealId?: string | null, note?: string): Promise<void> {
  const camp = await getCampaignRow(campaignId);
  if (!camp) return;
  const next = Math.max(0, Number(camp.budget_used ?? 0) - amount);
  await updateCampaignExt(campaignId, { budget_used: next });
  await addLedgerEntry(campaignId, dealId ?? null, "release", amount, camp.currency ?? "USD", note ?? "released");
}

export async function addLedgerEntry(
  campaignId: string,
  dealId: string | null,
  entryType: "commit" | "spend" | "release" | "adjust",
  amount: number,
  currency: string,
  note?: string,
  createdBy: "agent" | "human" = "agent"
): Promise<void> {
  await supabaseAdmin.from("budget_ledger").insert({
    campaign_id: campaignId, deal_id: dealId, entry_type: entryType, amount, currency, note, created_by: createdBy,
  });
}

// ─── Prospects ────────────────────────────────────────────────────────────────

export async function upsertCampaignProspect(input: {
  campaign_id: string;
  author_id?: string | null;
  domain_host: string;
  prospect_url?: string | null;
  title?: string | null;
  provenance: DiscoveryProvenance;
}): Promise<{ id: string; created: boolean }> {
  // Aggressive dedupe at the DB boundary: one prospect per (campaign, host, author).
  const { data: existing } = await supabaseAdmin
    .from("campaign_prospects")
    .select("id")
    .eq("campaign_id", input.campaign_id)
    .eq("domain_host", input.domain_host)
    .maybeSingle();
  if (existing) return { id: (existing as any).id, created: false };
  const { data, error } = await supabaseAdmin
    .from("campaign_prospects")
    .insert({
      campaign_id: input.campaign_id,
      author_id: input.author_id ?? null,
      domain_host: input.domain_host,
      prospect_url: input.prospect_url ?? null,
      title: input.title ?? null,
      provenance: input.provenance,
      status: "discovered",
    })
    .select("id")
    .single();
  if (error) {
    // Race with a parallel insert — treat as existing.
    const { data: again } = await supabaseAdmin
      .from("campaign_prospects").select("id").eq("campaign_id", input.campaign_id).eq("domain_host", input.domain_host).maybeSingle();
    if (again) return { id: (again as any).id, created: false };
    throw error;
  }
  return { id: (data as any).id, created: true };
}

export async function getProspect(id: string): Promise<any | null> {
  const { data } = await supabaseAdmin.from("campaign_prospects").select("*").eq("id", id).maybeSingle();
  return (data as any) ?? null;
}

export async function listProspects(campaignId: string, status?: ProspectStatus | ProspectStatus[], limit = 500): Promise<any[]> {
  let q = supabaseAdmin.from("campaign_prospects").select("*").eq("campaign_id", campaignId).order("opportunity_score", { ascending: false, nullsFirst: false }).limit(limit);
  if (status) q = Array.isArray(status) ? q.in("status", status as string[]) : q.eq("status", status);
  const { data } = await q;
  return (data as any[]) ?? [];
}

export async function countProspectsByStatus(campaignId: string): Promise<Record<string, number>> {
  const rows = await fetchAll<{ status: string }>("campaign_prospects", "status", (q) => q.eq("campaign_id", campaignId));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

export async function updateProspect(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from("campaign_prospects").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function setProspectEvaluation(
  id: string,
  opts: { score: number; breakdown: ScoreBreakdown; qualified: boolean; qualification: Record<string, unknown>; ceiling: number | null }
): Promise<void> {
  await updateProspect(id, {
    opportunity_score: opts.score,
    score_breakdown: opts.breakdown,
    qualification: opts.qualification,
    ceiling: opts.ceiling,
    status: opts.qualified ? "qualified" : "rejected",
  });
}

async function fetchAll<T>(table: string, cols: string, filter: (q: any) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await filter(supabaseAdmin.from(table).select(cols)).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data as T[]) ?? []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// ─── Deals ────────────────────────────────────────────────────────────────────

export async function createDeal(input: {
  campaign_id: string;
  anchor_email_id?: string | null;
  author_id?: string | null;
  domain_host: string;
  publication?: string | null;
  terms: DealTerms;
  original_ask?: number | null;
  agreed_price?: number | null;
  currency?: string;
}): Promise<any> {
  const { data, error } = await supabaseAdmin
    .from("deals")
    .insert({
      campaign_id: input.campaign_id,
      anchor_email_id: input.anchor_email_id ?? null,
      author_id: input.author_id ?? null,
      domain_host: input.domain_host,
      publication: input.publication ?? null,
      terms: input.terms,
      original_ask: input.original_ask ?? null,
      agreed_price: input.agreed_price ?? null,
      currency: input.currency ?? "USD",
      status: "terms_agreed",
      agreed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDeal(id: string, patch: Partial<{ status: DealStatus; terms: DealTerms; next_action: string | null; agreed_price: number | null; closed_at: string }>): Promise<void> {
  const { error } = await supabaseAdmin.from("deals").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function getDeals(campaignId: string): Promise<any[]> {
  const { data } = await supabaseAdmin.from("deals").select("*").eq("campaign_id", campaignId).order("created_at", { ascending: true });
  return (data as any[]) ?? [];
}

export async function getDealByAnchor(anchorEmailId: string): Promise<any | null> {
  const { data } = await supabaseAdmin.from("deals").select("*").eq("anchor_email_id", anchorEmailId).maybeSingle();
  return (data as any) ?? null;
}

// ─── Interventions (durable HITL) ─────────────────────────────────────────────

export async function createIntervention(input: {
  campaign_id?: string | null;
  anchor_email_id?: string | null;
  type: string;
  ask?: string;
  reason?: string;
  agent_note?: string;
  suggested_options?: string[];
}): Promise<any> {
  const { data, error } = await supabaseAdmin
    .from("interventions")
    .insert({
      campaign_id: input.campaign_id ?? null,
      anchor_email_id: input.anchor_email_id ?? null,
      type: input.type,
      ask: input.ask ?? null,
      reason: input.reason ?? null,
      agent_note: input.agent_note ?? null,
      suggested_options: input.suggested_options ?? [],
      status: "open",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function resolveIntervention(id: string, assistInput: string, resolvedBy: string, hasAsset = false): Promise<any | null> {
  const { data, error } = await supabaseAdmin
    .from("interventions")
    .update({ status: "resolved", assist_input: assistInput, resolved_by: resolvedBy, resolved_at: new Date().toISOString(), has_asset: hasAsset })
    .eq("id", id)
    .eq("status", "open")
    .select()
    .single();
  if (error) return null;
  return data;
}

export async function listInterventions(campaignId: string | null, status?: "open" | "resolved" | "dismissed"): Promise<any[]> {
  let q = supabaseAdmin.from("interventions").select("*").order("created_at", { ascending: false }).limit(200);
  if (campaignId) q = q.eq("campaign_id", campaignId);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return (data as any[]) ?? [];
}

// ─── Agent runs & events ──────────────────────────────────────────────────────

export async function startRun(campaignId: string, agent: string, tickKind?: string, adkSessionId?: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("agent_runs")
    .insert({ campaign_id: campaignId || null, agent, tick_kind: tickKind ?? null, adk_session_id: adkSessionId ?? null })
    .select("id")
    .single();
  if (error) throw error;
  return (data as any).id as string;
}

export async function finishRun(runId: string, status: "completed" | "failed" | "stopped", stats?: Record<string, unknown>, error?: string): Promise<void> {
  await supabaseAdmin
    .from("agent_runs")
    .update({ status, stats: stats ?? {}, error: error ?? null, finished_at: new Date().toISOString() })
    .eq("id", runId);
}

/** Idempotent event write. Duplicate event_key deliveries are dropped (Pub/Sub at-least-once). */
export async function recordAgentEvent(ev: AgentEventInput): Promise<{ recorded: boolean }> {
  const row: Record<string, unknown> = {
    campaign_id: ev.campaign_id ?? null,
    run_id: ev.run_id ?? null,
    agent: ev.agent,
    action: ev.action,
    tool: ev.tool ?? null,
    prospect_id: ev.prospect_id ?? null,
    thread_id: ev.thread_id ?? null,
    state_before: ev.state_before ?? null,
    state_after: ev.state_after ?? null,
    duration_ms: ev.duration_ms ?? null,
    status: ev.status ?? "ok",
    error_code: ev.error_code ?? null,
    retry_count: ev.retry_count ?? 0,
    level: ev.level ?? "info",
    detail: ev.detail ?? {},
    event_key: ev.event_key ?? null,
  };
  let q = supabaseAdmin.from("agent_events").insert(row);
  const { error } = await q;
  if (error) {
    // Unique-violation on event_key means an at-least-once redelivery — that's success.
    if (!String((error as any)?.message ?? "").includes("duplicate")) console.warn("[agent_events]", (error as any).message);
    return { recorded: false };
  }
  return { recorded: true };
}

export async function listAgentEvents(campaignId: string, afterId = 0, limit = 200): Promise<any[]> {
  const { data } = await supabaseAdmin
    .from("agent_events")
    .select("*")
    .eq("campaign_id", campaignId)
    .gt("id", afterId)
    .order("id", { ascending: true })
    .limit(limit);
  return (data as any[]) ?? [];
}

// ─── Idempotency ──────────────────────────────────────────────────────────────

/** Claims an idempotency key. True = caller should perform the action; False = already done/claimed. */
export async function claimIdempotencyKey(key: string, scope?: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("idempotency_keys")
    .upsert({ key, scope: scope ?? null }, { onConflict: "key", ignoreDuplicates: true })
    .select("key")
    .single();
  return !!data;
}

export async function completeIdempotencyKey(key: string, result: Record<string, unknown>): Promise<void> {
  await supabaseAdmin.from("idempotency_keys").update({ result }).eq("key", key);
}
