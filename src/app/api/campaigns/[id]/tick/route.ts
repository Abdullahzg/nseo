import { NextRequest, NextResponse } from "next/server";
import { authorizeAgent, unauthorized } from "@/lib/agent/gateway";
import { runFallbackTick } from "@/lib/campaign/fallbackOrchestrator";
import { supabaseAdmin } from "@/lib/db/supabase";

export const maxDuration = 300;

// Environment flags
const HACKATHON_MODE = process.env.HACKATHON_MODE === "true" || process.env.HACKATHON_MODE === "1";
const REQUIRE_STRANDS = HACKATHON_MODE || process.env.REQUIRE_STRANDS === "true";
const ALLOW_ORCHESTRATOR_FALLBACK = process.env.ALLOW_ORCHESTRATOR_FALLBACK !== "false" && !REQUIRE_STRANDS;

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
        signal: AbortSignal.timeout(280_000),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      executionEngine = "strands";
      fallbackUsed = false;
      const payload: Record<string, unknown> = { ...data, mode: "strands-agent-service", execution_engine: executionEngine, fallback_used: fallbackUsed };
      // Store execution metadata on campaign for UI display
      await supabaseAdmin.from("campaigns").update({ policy: { ...(data as any).policy ?? {}, execution_engine: executionEngine, fallback_used: fallbackUsed, model_provider: "strands", last_tick_at: new Date().toISOString() } }).eq("id", id).then(() => {}, () => {});
      return NextResponse.json(payload, { status: res.status });
    } catch (e: any) {
      if (REQUIRE_STRANDS) {
        // HACKATHON MODE: Fail visibly. No TypeScript fallback allowed.
        await supabaseAdmin.from("campaigns").update({ policy: { execution_engine: "strands-failed", fallback_used: false, last_error: e?.message, last_tick_at: new Date().toISOString() } }).eq("id", id).then(() => {}, () => {});
        return NextResponse.json(
          { ok: false, mode: "hackathon-fail", error: `Strands service unavailable: ${e?.message}`, execution_engine: "strands-failed", fallback_used: false },
          { status: 503 },
        );
      }
      // Non-hackathon: degrade to TS fallback only if allowed.
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

  // No AGENT_SERVICE_URL configured
  if (REQUIRE_STRANDS) {
    await supabaseAdmin.from("campaigns").update({ policy: { execution_engine: "strands-not-configured", fallback_used: false, last_error: "AGENT_SERVICE_URL not set", last_tick_at: new Date().toISOString() } }).eq("id", id).then(() => {}, () => {});
    return NextResponse.json(
      { ok: false, mode: "hackathon-fail", error: "AGENT_SERVICE_URL not configured; Strands service required", execution_engine: "strands-not-configured", fallback_used: false },
      { status: 503 },
    );
  }

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
