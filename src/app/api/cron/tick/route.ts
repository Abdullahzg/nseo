import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase";

// GET /api/cron/tick — server-side auto-tick for all active campaigns
// Call this from an external cron service (e.g. cron-job.org, Vercel Cron) every 30-60 seconds
// The CRON_SECRET header must match the env var for auth.
export async function GET(req: NextRequest) {
  // Authenticate with cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Find all active campaigns
  const { data: campaigns } = await supabaseAdmin
    .from("campaigns")
    .select("id, phase, emergency_stopped, demo_mode")
    .in("phase", ["discovering", "qualifying", "resolving_contacts", "outreaching", "monitoring"])
    .eq("emergency_stopped", false);

  if (!campaigns?.length) {
    return NextResponse.json({ ticked: 0, message: "no active campaigns" });
  }

  const results: Array<{ id: string; ok: boolean; action?: string; error?: string }> = [];

  for (const camp of campaigns) {
    try {
      // Call the tick endpoint for each campaign
      const tickRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3100"}/api/campaigns/${camp.id}/tick`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader ?? "",
        },
      });
      const data = await tickRes.json();
      results.push({ id: camp.id, ok: data.ok ?? false, action: data.action });
    } catch (e: any) {
      results.push({ id: camp.id, ok: false, error: e?.message ?? "tick failed" });
    }
  }

  return NextResponse.json({
    ticked: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
