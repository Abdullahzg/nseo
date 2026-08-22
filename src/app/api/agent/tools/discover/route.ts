import { NextRequest } from "next/server";
import { authorizeAgent, unauthorized, badRequest } from "@/lib/agent/gateway";
import { planDiscoveryQueries, discoverBatch } from "@/lib/campaign/tools";
import { getCampaignRow } from "@/lib/campaign/queries";

export const maxDuration = 120;

// POST /api/agent/tools/discover — body: { campaign_id, queries?: string[], max_per_query?: number }
// Without `queries`, the strategy agent generates a fresh plan first.
export async function POST(req: NextRequest) {
  const a = await authorizeAgent(req);
  if (!a.ok) return unauthorized();
  const body = await req.json().catch(() => null);
  const campaignId = (body as any)?.campaign_id;
  if (!campaignId) return badRequest("campaign_id required");
  const camp = await getCampaignRow(campaignId);
  if (!camp) return Response.json({ error: "campaign not found" }, { status: 404 });
  if (camp.emergency_stopped) return Response.json({ error: "emergency stop active" }, { status: 409 });

  let queries: string[] = Array.isArray((body as any)?.queries) ? (body as any).queries : [];
  let planner: string | undefined;
  if (!queries.length) {
    const planned = await planDiscoveryQueries(campaignId);
    queries = planned.queries;
    planner = planned.provider;
  }
  const result = await discoverBatch(campaignId, queries, { maxPerQuery: (body as any)?.max_per_query });
  return Response.json({ ...result, planner, queries_run: queries.length });
}
