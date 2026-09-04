import { NextRequest, NextResponse } from "next/server";
import { authorizeAgent, unauthorized } from "@/lib/agent/gateway";
import { runFallbackTick } from "@/lib/campaign/fallbackOrchestrator";

export const maxDuration = 300;

const HACKATHON_MODE = process.env.HACKATHON_MODE === "true" || process.env.HACKATHON_MODE === "1";

// POST /api/campaigns/[id]/tick — one bounded work unit.
// Primary: Strands agent service (AGENT_SERVICE_URL). Fallback: in-process TS policy
// with identical guardrails. In HACKATHON_MODE, fails visibly if Strands is unavailable.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const a = await authorizeAgent(req);
  if (!a.ok) return unauthorized();
  const { id } = await params;

  const agentUrl = process.env.AGENT_SERVICE_URL;
  if (agentUrl) {
    try {
      const res = await fetch(`${agentUrl.replace(/\/$/, "")}/tick`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.AGENT_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.AGENT_SERVICE_TOKEN}` } : {}),
        },
        body: JSON.stringify({ campaign_id: id }),
        signal: AbortSignal.timeout(280_000),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      const payload: Record<string, unknown> = { ...data, mode: "strands-agent-service" };
      return NextResponse.json(payload, { status: res.status });
    } catch (e: any) {
      if (HACKATHON_MODE) {
        return NextResponse.json(
          { ok: false, mode: "hackathon-fail", error: `Strands service unavailable: ${e?.message}` },
          { status: 503 },
        );
      }
      // Non-hackathon: degrade to TS fallback rather than stalling.
      const r = await runFallbackTick(id);
      return NextResponse.json({ ...r, agent_service_error: e?.message });
    }
  }
  if (HACKATHON_MODE) {
    return NextResponse.json(
      { ok: false, mode: "hackathon-fail", error: "AGENT_SERVICE_URL not configured; Strands service required" },
      { status: 503 },
    );
  }
  const r = await runFallbackTick(id);
  return NextResponse.json(r);
}
