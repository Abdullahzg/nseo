import { NextRequest, NextResponse } from "next/server";
import { identifyCaller } from "@/lib/auth/service";
import { supabaseAdmin } from "@/lib/db/supabase";

// POST /api/agent/tools/followups — schedule follow-up emails for multi-touch sequences
export async function POST(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { campaign_id, limit = 10 } = await req.json().catch(() => ({}));
  if (!campaign_id) return NextResponse.json({ error: "campaign_id required" }, { status: 400 });

  // Find prospects in 'outreached' status that haven't replied
  const { data: prospects } = await supabaseAdmin
    .from("prospects")
    .select("id, author_id, domain_host, contact_email, campaign_id")
    .eq("campaign_id", campaign_id)
    .eq("status", "outreached")
    .not("contact_email", "is", null)
    .limit(limit);

  if (!prospects?.length) {
    return NextResponse.json({ scheduled: 0, skipped_replied: 0, skipped_complete: 0, errors: [] });
  }

  const { scheduleNextSequenceTouch } = await import("@/lib/campaign/outreach");

  let scheduled = 0;
  let skippedReplied = 0;
  let skippedComplete = 0;
  const errors: string[] = [];

  for (const p of prospects) {
    try {
      const result = await scheduleNextSequenceTouch(p.id);
      if (result.ok && result.scheduled) scheduled++;
      else if (result.reason === "already replied") skippedReplied++;
      else if (result.reason === "sequence complete") skippedComplete++;
    } catch (e: any) {
      errors.push(`${p.id}: ${e?.message ?? "unknown"}`);
    }
  }

  return NextResponse.json({ scheduled, skipped_replied: skippedReplied, skipped_complete: skippedComplete, errors: errors.slice(0, 10) });
}
