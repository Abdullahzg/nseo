import { NextRequest } from "next/server";
import { authorizeAgent, unauthorized, badRequest } from "@/lib/agent/gateway";
import { evaluateProspect } from "@/lib/campaign/tools";
import { listProspects } from "@/lib/campaign/queries";

export const maxDuration = 120;

// POST /api/agent/tools/qualify — body: { prospect_id } | { campaign_id, limit? }
// Single-prospect evaluation, or a bounded batch over the oldest unqualified prospects.
export async function POST(req: NextRequest) {
  const a = await authorizeAgent(req);
  if (!a.ok) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const prospectId = (body as any)?.prospect_id;
  const campaignId = (body as any)?.campaign_id;

  if (prospectId) {
    const r = await evaluateProspect(String(prospectId));
    if (!r) return Response.json({ error: "prospect not found" }, { status: 404 });
    return Response.json({ results: [r] });
  }
  if (!campaignId) return badRequest("campaign_id or prospect_id required");

  const limit = Math.min(20, Math.max(1, Number((body as any)?.limit ?? 8)));
  const pending = await listProspects(campaignId, "discovered", limit * 2);
  const results = [];
  for (const p of pending.slice(0, limit)) {
    const r = await evaluateProspect(p.id);
    if (r) results.push(r);
  }
  return Response.json({ results });
}
