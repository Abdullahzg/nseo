import { NextRequest } from "next/server";
import { authorizeAgent, unauthorized, badRequest } from "@/lib/agent/gateway";
import { processRepliesTick, negotiateCampaignThread } from "@/lib/campaign/outreach";

export const maxDuration = 300;

// POST /api/agent/tools/negotiate — body:
//   { campaign_id }                      → one bounded replies+negotiation tick
//   { anchor_email_id, assist_input? }   → a single thread step (also the HITL resume path)
export async function POST(req: NextRequest) {
  const a = await authorizeAgent(req);
  if (!a.ok) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const campaignId = (body as any)?.campaign_id;
  const anchorEmailId = (body as any)?.anchor_email_id;

  if (anchorEmailId) {
    const r = await negotiateCampaignThread(String(anchorEmailId), {
      assistInput: (body as any)?.assist_input ?? null,
    });
    return Response.json(r);
  }
  if (!campaignId) return badRequest("campaign_id or anchor_email_id required");

  const r = await processRepliesTick(String(campaignId));
  return Response.json(r);
}
