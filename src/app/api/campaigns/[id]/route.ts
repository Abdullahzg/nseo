import { NextRequest, NextResponse } from "next/server";
import { identifyCaller } from "@/lib/auth/service";
import { getCampaignRow, getDeals, countProspectsByStatus, listInterventions, listAgentEvents, updateCampaignExt, setCampaignPhase } from "@/lib/campaign/queries";
import { isActivePhase } from "@/lib/campaign/queries";
import { supabaseAdmin } from "@/lib/db/supabase";

export const maxDuration = 60;

// GET /api/campaigns/[id] — full state for the campaign observability UI.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await identifyCaller(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await params;

  const camp = await getCampaignRow(id);
  if (!camp) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [byStatus, deals, interventions, events] = await Promise.all([
    countProspectsByStatus(id).catch(() => ({})),
    getDeals(id).catch(() => []),
    listInterventions(id).catch(() => []),
    listAgentEvents(id, 0, 300).catch(() => []),
  ]);

  // Email tracking stats
  let emails: any[] = [];
  try {
    const { data: emailRows, error: emailErr } = await supabaseAdmin
      .from("outreach_emails")
      .select("id, status, opened_at, bounced_at, sent_at, created_at, email_template_id")
      .eq("campaign_id", id);
    if (emailErr) console.error("[campaign-detail] email error:", emailErr.message);
    emails = emailRows ?? [];
  } catch (e: any) {
    console.error("[campaign-detail] email stats error:", e?.message);
  }

  const emailStats = {
    total: emails?.length ?? 0,
    sent: emails?.filter((e) => e.status === "sent").length ?? 0,
    opened: emails?.filter((e) => e.opened_at).length ?? 0,
    bounced: emails?.filter((e) => e.bounced_at).length ?? 0,
    openRate: 0,
    bounceRate: 0,
    variants: {} as Record<string, { sent: number; opened: number; bounced: number; openRate: number }>,
  };
  if (emailStats.sent > 0) {
    emailStats.openRate = Math.round((emailStats.opened / emailStats.sent) * 100);
    emailStats.bounceRate = Math.round((emailStats.bounced / emailStats.sent) * 100);
  }
  // A/B variant breakdown
  for (const e of emails ?? []) {
    if (e.status !== "sent") continue;
    const vid = e.email_template_id ?? "default";
    if (!emailStats.variants[vid]) emailStats.variants[vid] = { sent: 0, opened: 0, bounced: 0, openRate: 0 };
    emailStats.variants[vid].sent++;
    if (e.opened_at) emailStats.variants[vid].opened++;
    if (e.bounced_at) emailStats.variants[vid].bounced++;
  }
  for (const v of Object.values(emailStats.variants)) {
    v.openRate = v.sent > 0 ? Math.round((v.opened / v.sent) * 100) : 0;
  }

  // Campaign metrics calculation (no fake ROI - spend is cost, not revenue)
  const totalPublisherAsking = deals.reduce((sum, d) => sum + (Number(d.original_ask) || Number(d.agreed_price) || 0), 0);
  const finalPlacementSpend = deals.reduce((sum, d) => sum + (Number(d.agreed_price) || 0), 0);
  const negotiatedSavings = totalPublisherAsking - finalPlacementSpend;
  const savingsPct = totalPublisherAsking > 0 ? Math.round((negotiatedSavings / totalPublisherAsking) * 100) : 0;
  const placementsAgreed = deals.length;
  const avgAgreedPrice = placementsAgreed > 0 ? Math.round(finalPlacementSpend / placementsAgreed) : 0;

  // Activity metrics
  const totalOutreached = (byStatus as any).outreached ?? 0;
  const totalReplied = (byStatus as any).replied ?? 0;
  const replyRate = totalOutreached > 0 ? Math.round((totalReplied / totalOutreached) * 100) : 0;
  const agreementRate = totalOutreached > 0 ? Math.round((placementsAgreed / totalOutreached) * 100) : 0;

  // Autonomy metrics
  const humanInterventions = interventions.length;
  const totalAgentActions = events.length;
  const manualActionsAvoided = Math.max(0, totalAgentActions - humanInterventions);
  const autonomyRate = totalAgentActions > 0 ? Math.round((manualActionsAvoided / totalAgentActions) * 100) : 100;

  // Budget tracking
  const totalSpent = Number(camp.budget_used ?? 0);

  return NextResponse.json({
    campaign: camp,
    is_active: isActivePhase(camp.phase),
    prospects_by_status: byStatus,
    deals,
    interventions,
    events,
    budget: {
      total: Number(camp.budget_total ?? 0),
      used: totalSpent,
      remaining: Number(camp.budget_total ?? 0) - totalSpent,
      currency: camp.currency ?? "USD",
    },
    email_stats: emailStats,
    roi: {
      total_publisher_asking: totalPublisherAsking,
      final_placement_spend: finalPlacementSpend,
      negotiated_savings: negotiatedSavings,
      savings_pct: savingsPct,
      placements_agreed: placementsAgreed,
      avg_agreed_price: avgAgreedPrice,
      reply_rate: replyRate,
      agreement_rate: agreementRate,
      autonomy_rate: autonomyRate,
      human_interventions: humanInterventions,
      manual_actions_avoided: manualActionsAvoided,
    },
  });
}

// PATCH /api/campaigns/[id] — controls: pause/resume per capability + stop/emergency.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await identifyCaller(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  // Fetch current phase for resume logic
  let currentPhase = "";
  if (body.action === "resume") {
    try {
      const { data: cur } = await supabaseAdmin.from("campaigns").select("phase").eq("id", id).maybeSingle();
      currentPhase = (cur as any)?.phase ?? "";
    } catch {}
  }

  const allowed = ["paused_discovery", "paused_outreach", "paused_negotiation", "emergency_stopped"] as const;
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (typeof body[k] === "boolean") patch[k] = body[k];
  // Campaign settings fields (editable after creation)
  if (typeof body.budget_total === "number") patch.budget_total = body.budget_total;
  if (typeof body.max_per_deal === "number") patch.max_per_deal = body.max_per_deal;
  if (typeof body.min_dr === "number") patch.min_dr = body.min_dr;
  if (Array.isArray(body.geos)) patch.geos = body.geos;
  if (Array.isArray(body.excluded_domains)) patch.excluded_domains = body.excluded_domains;
  if (typeof body.constraints_text === "string") patch.constraints_text = body.constraints_text;
  if (body.email_template_id !== undefined) patch.email_template_id = body.email_template_id || null;
  if (Array.isArray(body.ab_variant_ids)) patch.ab_variant_ids = body.ab_variant_ids;
  if (body.action === "resume") {
    patch.emergency_stopped = false;
    patch.completion_reason = null;
    // If campaign was stopped or is still in draft, start from discovering
    if (currentPhase === "stopped" || currentPhase === "draft") {
      patch.phase = "discovering";
    }
    // If just paused (not stopped), keep current phase — don't override
  }
  if (body.action === "stop") Object.assign(patch, { phase: "stopped", completion_reason: "stopped_by_user" });
  if (Object.keys(patch).length) await updateCampaignExt(id, patch);
  return NextResponse.json({ ok: true });
}

// DELETE /api/campaigns/[id] — delete campaign and all related data.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await identifyCaller(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await params;

  // Delete related data in order (foreign keys)
  await supabaseAdmin.from("agent_events").delete().eq("campaign_id", id);
  await supabaseAdmin.from("outreach_emails").delete().eq("campaign_id", id);
  await supabaseAdmin.from("deals").delete().eq("campaign_id", id);
  await supabaseAdmin.from("prospects").delete().eq("campaign_id", id);
  await supabaseAdmin.from("interventions").delete().eq("campaign_id", id);
  await supabaseAdmin.from("negotiation_threads").delete().eq("campaign_id", id);
  await supabaseAdmin.from("budget_ledger").delete().eq("campaign_id", id);
  await supabaseAdmin.from("campaigns").delete().eq("id", id);

  return NextResponse.json({ ok: true });
}

// POST /api/campaigns/[id] — clone campaign (body: { action: "clone" }).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await identifyCaller(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if (body.action !== "clone") return NextResponse.json({ error: "unknown action" }, { status: 400 });

  const src = await getCampaignRow(id);
  if (!src) return NextResponse.json({ error: "source not found" }, { status: 404 });

  // Create new campaign with same settings
  const { data: newCamp, error } = await supabaseAdmin.from("campaigns").insert({
    name: `${src.name} (copy)`,
    keywords: src.keywords,
    website_url: src.website_url,
    objective: src.objective,
    budget_total: src.budget_total,
    currency: src.currency,
    min_dr: src.min_dr,
    geos: src.geos,
    desired_deals: src.desired_deals,
    max_per_deal: src.max_per_deal,
    excluded_domains: src.excluded_domains,
    constraints_text: src.constraints_text,
    demo_mode: src.demo_mode,
    email_template_id: src.email_template_id,
    phase: "draft",
  }).select("id").maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: newCamp!.id, name: `${src.name} (copy)` }, { status: 201 });
}
