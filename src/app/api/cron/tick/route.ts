import { NextRequest, NextResponse } from "next/server";
import { identifyCaller } from "@/lib/auth/service";
import { listDueCampaigns } from "@/lib/campaign/queries";
import { tick } from "@/lib/campaign/orchestrator";

export const maxDuration = 300;

// GitHub Actions calls this every 5 minutes with Bearer CRON_SECRET. Each due campaign is ticked
// once; the per-campaign lock and next_tick_after make overlapping calls harmless.
async function run(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (caller?.kind !== "cron") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const due = await listDueCampaigns(8);
  const results: unknown[] = [];
  const deadline = Date.now() + 240_000;
  for (const c of due) {
    if (Date.now() > deadline) break;
    results.push(await tick(c.id, { via: "cron" }).catch((e: any) => ({ campaign_id: c.id, ok: false, error: e?.message })));
  }
  return NextResponse.json({ due: due.length, ticked: results.length, results });
}
export const GET = run;
export const POST = run;
