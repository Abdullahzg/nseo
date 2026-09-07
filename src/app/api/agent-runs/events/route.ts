import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase";

export const maxDuration = 60;

// GET /api/agent-runs/events?campaign_id=&after_id=0&limit=200 — agent events timeline (no auth)
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaign_id");
  if (!campaignId) return Response.json({ events: [], error: "campaign_id required" }, { status: 400 });

  const afterId = Number(req.nextUrl.searchParams.get("after_id") ?? 0);
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 200)));

  const { data, error } = await supabaseAdmin
    .from("agent_events")
    .select("*")
    .eq("campaign_id", campaignId)
    .gt("id", afterId)
    .order("id", { ascending: true })
    .limit(limit);

  if (error) return Response.json({ events: [], error: error.message });
  return Response.json({ events: data ?? [], last_id: data?.length ? data[data.length - 1].id : afterId });
}
