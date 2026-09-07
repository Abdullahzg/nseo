import { NextRequest, NextResponse } from "next/server";
import { authorizeAgent, unauthorized } from "@/lib/agent/gateway";
import { runFallbackTick } from "@/lib/campaign/fallbackOrchestrator";
import { supabaseAdmin } from "@/lib/db/supabase";

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
  let executionEngine = "fallback-ts";
  let fallbackUsed = false;

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
      executionEngine = "strands";
      fallbackUsed = false;
      const payload: Record<string, unknown> = { ...data, mode: "strands-agent-service", execution_engine: executionEngine, fallback_used: fallbackUsed };
      // Store execution metadata on campaign for UI display
      await supabaseAdmin.from("campaigns").update({ policy: { ...(data as any).policy ?? {}, execution_engine: executionEngine, fallback_used: fallbackUsed, model_provider: "bedrock", last_tick_at: new Date().toISOString() } }).eq("id", id).then(() => {}, () => {});
      return NextResponse.json(payload, { status: res.status });
    } catch (e: any) {
      if (HACKATHON_MODE) {
        // Store failure metadata so UI can show it
        await supabaseAdmin.from("campaigns").update({ policy: { execution_engine: "strands-failed", fallback_used: false, last_error: e?.message, last_tick_at: new Date().toISOString() } }).eq("id", id).then(() => {}, () => {});
        return NextResponse.json(
          { ok: false, mode: "hackathon-fail", error: `Strands service unavailable: ${e?.message}`, execution_engine: "strands-failed", fallback_used: false },
          { status: 503 },
        );
      }
      // Non-hackathon: degrade to TS fallback rather than stalling.
      executionEngine = "fallback-ts";
      fallbackUsed = true;
      const r = await runFallbackTick(id);
      await supabaseAdmin.from("campaigns").update({ policy: { execution_engine: executionEngine, fallback_used: true, last_tick_at: new Date().toISOString() } }).eq("id", id).then(() => {}, () => {});
      return NextResponse.json({ ...r, agent_service_error: e?.message, execution_engine: executionEngine, fallback_used: fallbackUsed });
    }
  }
  if (HACKATHON_MODE) {
    await supabaseAdmin.from("campaigns").update({ policy: { execution_engine: "strands-not-configured", fallback_used: false, last_error: "AGENT_SERVICE_URL not set", last_tick_at: new Date().toISOString() } }).eq("id", id).then(() => {}, () => {});
    return NextResponse.json(
      { ok: false, mode: "hackathon-fail", error: "AGENT_SERVICE_URL not configured; Strands service required", execution_engine: "strands-not-configured", fallback_used: false },
      { status: 503 },
    );
  }
  executionEngine = "fallback-ts";
  fallbackUsed = true;
  const r = await runFallbackTick(id);
  await supabaseAdmin.from("campaigns").update({ policy: { execution_engine: executionEngine, fallback_used: true, last_tick_at: new Date().toISOString() } }).eq("id", id).then(() => {}, () => {});
  return NextResponse.json({ ...r, execution_engine: executionEngine, fallback_used: fallbackUsed });
}
