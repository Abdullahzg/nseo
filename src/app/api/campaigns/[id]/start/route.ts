import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { getCampaignRow, updateCampaignExt } from "@/lib/campaign/queries";

// POST /api/campaigns/[id]/start — flip draft → planning and kick the agent service.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth().catch(() => null);
  if (!session?.user?.email) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await params;
  const camp = await getCampaignRow(id);
  if (!camp) return NextResponse.json({ error: "not found" }, { status: 404 });

  await updateCampaignExt(id, {
    phase: "planning",
    emergency_stopped: false,
    completion_reason: null,
    started_at: camp.started_at ?? new Date().toISOString(),
  });

  // Kick the ADK agent service when configured (fire-and-forget; ticks are idempotent).
  const agentUrl = process.env.AGENT_SERVICE_URL;
  let kicked = false;
  if (agentUrl) {
    void fetch(`${agentUrl.replace(/\/$/, "")}/campaigns/${id}/start`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: process.env.AGENT_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.AGENT_SERVICE_TOKEN}` } : {},
    })
      .then(() => fetch(`${agentUrl.replace(/\/$/, "")}/tick`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(process.env.AGENT_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.AGENT_SERVICE_TOKEN}` } : {}) },
        body: JSON.stringify({ campaign_id: id }),
        signal: AbortSignal.timeout(300_000),
      }))
      .catch(() => {});
    kicked = true;
  }
  return NextResponse.json({ ok: true, phase: "planning", agent_service_kicked: kicked });
}
