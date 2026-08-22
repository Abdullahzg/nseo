import { NextRequest } from "next/server";
import { authorizeAgent, unauthorized } from "@/lib/agent/gateway";
import { listInterventions, resolveIntervention } from "@/lib/campaign/queries";
import { resumeFromIntervention } from "@/lib/campaign/outreach";

// GET /api/agent/interventions?campaign_id=&status=open — HITL queue.
export async function GET(req: NextRequest) {
  const a = await authorizeAgent(req);
  if (!a.ok) return unauthorized();
  const campaignId = req.nextUrl.searchParams.get("campaign_id");
  const status = (req.nextUrl.searchParams.get("status") ?? "open") as "open" | "resolved" | "dismissed";
  const rows = await listInterventions(campaignId, status);
  return Response.json({ interventions: rows });
}

// POST /api/agent/interventions — body: { id, assist_input } → resolve + resume the thread.
export async function POST(req: NextRequest) {
  const a = await authorizeAgent(req);
  if (!a.ok) return unauthorized();
  const body = await req.json().catch(() => null);
  const id = (body as any)?.id;
  const assistInput = String((body as any)?.assist_input ?? "").trim();
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  if (!assistInput && !(body as any)?.dismiss) {
    return Response.json({ error: "assist_input required (or dismiss=true)" }, { status: 400 });
  }
  if ((body as any)?.dismiss) {
    await resolveIntervention(String(id), "", a.via === "session" ? a.via : "agent-service");
    return Response.json({ ok: true, dismissed: true });
  }
  const r = await resumeFromIntervention(String(id), assistInput, a.via);
  return Response.json(r, { status: r.ok ? 200 : 409 });
}
