import { NextRequest } from "next/server";
import { authorizeAgent, unauthorized, badRequest } from "@/lib/agent/gateway";
import { getCampaignRow, countProspectsByStatus, getDeals, listInterventions } from "@/lib/campaign/queries";
import { isActivePhase } from "@/lib/campaign/queries";
import { setCampaignPhase, setCampaignControls } from "@/lib/campaign/queries";

// GET /api/agent/campaigns/[id] — full campaign state for the ADK Campaign Manager.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorizeAgent(req);
  if (!a.ok) return unauthorized();
  const { id } = await params;
  const camp = await getCampaignRow(id);
  if (!camp) return Response.json({ error: "not found" }, { status: 404 });
  const [byStatus, deals, openInterventions] = await Promise.all([
    countProspectsByStatus(id).catch(() => ({})),
    getDeals(id).catch(() => []),
    listInterventions(id, "open").catch(() => []),
  ]);
  return Response.json({
    campaign: camp,
    is_active: isActivePhase(camp.phase),
    prospects_by_status: byStatus,
    deals,
    open_interventions: openInterventions,
    budget: {
      total: Number(camp.budget_total ?? 0),
      used: Number(camp.budget_used ?? 0),
      remaining: Number(camp.budget_total ?? 0) - Number(camp.budget_used ?? 0),
      currency: camp.currency ?? "USD",
    },
  });
}

// PATCH /api/agent/campaigns/[id] — phase transitions + capability controls.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorizeAgent(req);
  if (!a.ok) return unauthorized();
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("body required");

  const { phase, reason, ...controls } = body as Record<string, unknown>;
  const allowedControls = ["paused_discovery", "paused_outreach", "paused_negotiation", "emergency_stopped"] as const;
  const controlPatch: Record<string, boolean> = {};
  for (const k of allowedControls) if (typeof controls[k] === "boolean") controlPatch[k] = controls[k] as boolean;
  if (Object.keys(controlPatch).length) await setCampaignControls(id, controlPatch);
  if (typeof phase === "string") await setCampaignPhase(id, phase as never, typeof reason === "string" ? reason : undefined);

  return Response.json({ ok: true });
}
