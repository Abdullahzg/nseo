import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase";

export const maxDuration = 60;

// GET /api/agent-runs?campaign_id=&limit=100 — list agent runs (no auth required for UI)
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaign_id");
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 100)));

  let q = supabaseAdmin
    .from("agent_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (campaignId) q = q.eq("campaign_id", campaignId);

  const { data, error } = await q;
  if (error) return Response.json({ runs: [], error: error.message });
  return Response.json({ runs: data ?? [] });
}
