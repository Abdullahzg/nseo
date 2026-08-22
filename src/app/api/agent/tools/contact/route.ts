import { NextRequest } from "next/server";
import { authorizeAgent, unauthorized, badRequest } from "@/lib/agent/gateway";
import { resolveContactForProspect } from "@/lib/campaign/tools";
import { listProspects } from "@/lib/campaign/queries";

export const maxDuration = 300;

// POST /api/agent/tools/contact — body: { prospect_id } | { campaign_id, limit? }
// Runs the enrichment cascade (or domain-level fallback) and persists the verified contact.
export async function POST(req: NextRequest) {
  const a = await authorizeAgent(req);
  if (!a.ok) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const prospectId = (body as any)?.prospect_id;
  const campaignId = (body as any)?.campaign_id;

  if (prospectId) {
    return Response.json(await resolveContactForProspect(String(prospectId)));
  }
  if (!campaignId) return badRequest("campaign_id or prospect_id required");

  const limit = Math.min(10, Math.max(1, Number((body as any)?.limit ?? 5)));
  // Qualified, not yet resolved. Skip known failures this round.
  const pending = await listProspects(campaignId, "qualified", limit * 3);
  const results = [];
  for (const p of pending.filter((x) => !(x.notes?.contact_failed)).slice(0, limit)) {
    results.push({ prospect_id: p.id, ...(await resolveContactForProspect(p.id)) });
  }
  return Response.json({ results });
}
