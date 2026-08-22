import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { runFallbackTick } from "@/lib/campaign/fallbackOrchestrator";

export const maxDuration = 300;

// POST /api/campaigns/[id]/tick — one bounded work unit.
// Primary: the ADK agent service (AGENT_SERVICE_URL). Fallback: in-process TS policy
// with identical guardrails, so the product never hard-depends on a second process.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user?.email) return NextResponse.json({ error: "not signed in" }, { status: 401 });
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
      const payload: Record<string, unknown> = { ...data, mode: "adk-agent-service" };
      return NextResponse.json(payload, { status: res.status });
    } catch (e: any) {
      // Agent service unreachable — degrade to the TS fallback rather than stalling.
      const r = await runFallbackTick(id);
      return NextResponse.json({ ...r, agent_service_error: e?.message });
    }
  }
  const r = await runFallbackTick(id);
  return NextResponse.json(r);
}
