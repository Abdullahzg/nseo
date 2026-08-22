import { NextRequest } from "next/server";
import { authorizeAgent, unauthorized, badRequest } from "@/lib/agent/gateway";
import { sendOutreachToProspect } from "@/lib/campaign/outreach";
import { listProspects } from "@/lib/campaign/queries";

export const maxDuration = 120;

// POST /api/agent/tools/outreach — body: { prospect_id } | { campaign_id, limit? }
// Queues personalized outreach. Real delivery is owned by the legacy burst processor
// (/api/emails/process) with all trust gates; demo campaigns record simulated sends.
export async function POST(req: NextRequest) {
  const a = await authorizeAgent(req);
  if (!a.ok) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const prospectId = (body as any)?.prospect_id;
  const campaignId = (body as any)?.campaign_id;

  if (prospectId) {
    return Response.json(await sendOutreachToProspect(String(prospectId)));
  }
  if (!campaignId) return badRequest("campaign_id or prospect_id required");

  const limit = Math.min(10, Math.max(1, Number((body as any)?.limit ?? 5)));
  // Ready prospects with a resolved address; skip ones we already know we can't reach.
  const ready = await listProspects(campaignId, "ready", limit * 4);
  const results = [];
  for (const p of ready.filter((x) => x.contact_email && !x.notes?.contact_failed).slice(0, limit)) {
    results.push({ prospect_id: p.id, ...(await sendOutreachToProspect(p.id)) });
  }
  return Response.json({ results });
}
