import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { getCampaignRow, getDeals, countProspectsByStatus, listInterventions, listAgentEvents, updateCampaignExt, setCampaignPhase } from "@/lib/campaign/queries";
import { isActivePhase } from "@/lib/campaign/queries";

export const maxDuration = 60;

// GET /api/campaigns/[id] — full state for the campaign observability UI.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user?.email) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await params;

  const camp = await getCampaignRow(id);
  if (!camp) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [byStatus, deals, interventions, events] = await Promise.all([
    countProspectsByStatus(id).catch(() => ({})),
    getDeals(id).catch(() => []),
    listInterventions(id).catch(() => []),
    listAgentEvents(id, 0, 300).catch(() => []),
  ]);

  return NextResponse.json({
    campaign: camp,
    is_active: isActivePhase(camp.phase),
    prospects_by_status: byStatus,
    deals,
    interventions,
    events,
    budget: {
      total: Number(camp.budget_total ?? 0),
      used: Number(camp.budget_used ?? 0),
      remaining: Number(camp.budget_total ?? 0) - Number(camp.budget_used ?? 0),
      currency: camp.currency ?? "USD",
    },
  });
}

// PATCH /api/campaigns/[id] — controls: pause/resume per capability + stop/emergency.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user?.email) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const allowed = ["paused_discovery", "paused_outreach", "paused_negotiation", "emergency_stopped"] as const;
  const patch: Record<string, unknown> = {};
  for (const k of allowed) if (typeof body[k] === "boolean") patch[k] = body[k];
  if (body.action === "resume") {
    patch.emergency_stopped = false;
    patch.phase = "monitoring";
    patch.completion_reason = null;
    await setCampaignPhase(id, "monitoring", null as never).catch(() => {});
  }
  if (body.action === "stop") Object.assign(patch, { phase: "stopped", completion_reason: "stopped_by_user" });
  if (Object.keys(patch).length) await updateCampaignExt(id, patch);
  return NextResponse.json({ ok: true });
}
