import { NextRequest, NextResponse } from "next/server";
import { tick } from "@/lib/campaign/orchestrator";
import { canSee } from "@/lib/campaign/access";

export const maxDuration = 60;

// A demo's "Run next step" hits this from the browser. Real campaigns are stepped only by the
// scheduler. The per-campaign lock + a 15 s spacing make repeated clicks harmless.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { caller, camp, ok } = await canSee(req, id);
  if (!camp || !ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (caller?.kind !== "cron" && !camp.demo_mode) return NextResponse.json({ error: "Real campaigns are stepped by the scheduler, not the browser." }, { status: 403 });
  if (caller?.kind !== "cron" && camp.last_tick_at && Date.now() - new Date(camp.last_tick_at).getTime() < 15_000) {
    return NextResponse.json({ ok: true, campaign_id: id, action: "rate_limited", phase_before: camp.phase, phase_after: camp.phase, decided_by: null, duration_ms: 0 });
  }
  const r = await tick(id, { via: caller?.kind ?? "unknown" });
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
