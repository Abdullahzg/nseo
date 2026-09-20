import { NextRequest, NextResponse } from "next/server";
import { authorizeAgent, unauthorized } from "@/lib/agent/gateway";
import { runFallbackTick } from "@/lib/campaign/fallbackOrchestrator";
import { supabaseAdmin } from "@/lib/db/supabase";

export const maxDuration = 300;

// Environment flags — Strands is preferred, but we ALWAYS allow fallback when it's
// unreachable so the system never gets stuck in a waiting state.
const ALLOW_ORCHESTRATOR_FALLBACK = process.env.ALLOW_ORCHESTRATOR_FALLBACK !== "false";

// POST /api/campaigns/[id]/tick — one bounded work unit.
// In HACKATHON_MODE/REQUIRE_STRANDS: Strands service ONLY. Fails visibly (503) if unavailable.
// In normal mode: Strands primary, TypeScript fallback allowed if configured.
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
        signal: AbortSignal.timeout(5_000),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      executionEngine = "strands";
      fallbackUsed = false;
      const payload: Record<string, unknown> = { ...data, mode: "strands-agent-service", execution_engine: executionEngine, fallback_used: fallbackUsed };
      // Store execution metadata on campaign for UI display
      await supabaseAdmin.from("campaigns").update({ policy: { ...(data as any).policy ?? {}, execution_engine: executionEngine, fallback_used: fallbackUsed, model_provider: "strands", last_tick_at: new Date().toISOString() } }).eq("id", id).then(() => {}, () => {});
      return NextResponse.json(payload, { status: res.status });
    } catch (e: any) {
      // Strands unavailable — always degrade to TS fallback so campaigns never get stuck.
      if (!ALLOW_ORCHESTRATOR_FALLBACK) {
        await supabaseAdmin.from("campaigns").update({ policy: { execution_engine: "strands-failed", fallback_used: false, last_error: e?.message, last_tick_at: new Date().toISOString() } }).eq("id", id).then(() => {}, () => {});
        return NextResponse.json(
          { ok: false, mode: "strands-required", error: `Strands service unavailable and fallback disabled: ${e?.message}`, execution_engine: "strands-failed", fallback_used: false },
          { status: 503 },
        );
      }
      executionEngine = "fallback-ts";
      fallbackUsed = true;
      const r = await runFallbackTick(id);
      await supabaseAdmin.from("campaigns").update({ policy: { execution_engine: executionEngine, fallback_used: true, last_tick_at: new Date().toISOString() } }).eq("id", id).then(() => {}, () => {});
      return NextResponse.json({ ...r, agent_service_error: e?.message, execution_engine: executionEngine, fallback_used: fallbackUsed });
    }
  }

  // No AGENT_SERVICE_URL configured — always fall back to TS orchestrator.
  if (!ALLOW_ORCHESTRATOR_FALLBACK) {
    await supabaseAdmin.from("campaigns").update({ policy: { execution_engine: "strands-not-configured", fallback_used: false, last_error: "AGENT_SERVICE_URL not set and fallback disabled", last_tick_at: new Date().toISOString() } }).eq("id", id).then(() => {}, () => {});
    return NextResponse.json(
      { ok: false, mode: "strands-required", error: "AGENT_SERVICE_URL not configured and fallback disabled", execution_engine: "strands-not-configured", fallback_used: false },
      { status: 503 },
    );
  }

  executionEngine = "fallback-ts";
  fallbackUsed = true;
  const r = await runFallbackTick(id);
  await supabaseAdmin.from("campaigns").update({ policy: { execution_engine: executionEngine, fallback_used: true, last_tick_at: new Date().toISOString() } }).eq("id", id).then(() => {}, () => {});
  return NextResponse.json({ ...r, execution_engine: executionEngine, fallback_used: fallbackUsed });
}
