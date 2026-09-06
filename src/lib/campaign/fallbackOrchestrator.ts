// Fallback tick orchestrator (TypeScript mirror of agents/seo_workforce/orchestrator.py).
//
// Used ONLY when AGENT_SERVICE_URL is not configured AND HACKATHON_MODE is false.
// The primary brain is the Strands Agents SDK service; this keeps the product functional
// and demo-safe without it, executing the same deterministic phase policy through the
// same in-process tool functions. Every action still flows through the same guards.
import { getCampaignRow, countProspectsByStatus, getDeals, setCampaignPhase, updateCampaignExt, listProspects } from "./queries";
import { planDiscoveryQueries, discoverBatch, evaluateProspect, resolveContactForProspect, emitEvent } from "./tools";
import { sendOutreachToProspect, processRepliesTick } from "./outreach";
import { runSendProcessorHint } from "./sendProcessor";

const POOL_TARGET_MIN = 30;
// Consecutive zero-yield discovery passes per campaign before we force-advance.
const EMPTY_DISCOVERY_LIMIT = 3;
const _emptyDiscoverRuns = new Map<string, number>();

export interface TickOutcome {
  ok: boolean;
  mode: "fallback-ts";
  phase_before?: string;
  phase_after?: string;
  action: string;
  details?: Record<string, unknown>;
  error?: string;
}

async function poolCounts(campaignId: string) {
  const counts = await countProspectsByStatus(campaignId);
  return counts;
}

function pick<T>(arr: T[], n: number): T[] {
  return arr.slice(0, Math.max(0, n));
}

/** Executes ONE bounded work unit for the campaign's current phase. */
export async function runFallbackTick(campaignId: string): Promise<TickOutcome> {
  const camp = await getCampaignRow(campaignId);
  if (!camp) return { ok: false, mode: "fallback-ts", action: "noop", error: "campaign not found" };
  if (camp.emergency_stopped) return { ok: true, mode: "fallback-ts", action: "noop", details: { reason: "emergency stop" } };
  const before = camp.phase;

  let action = "noop";
  const details: Record<string, unknown> = {};

  if (!camp.demo_mode && process.env.AGENT_SERVICE_URL) {
    // Should not happen (caller routes to the ADK service), but stay honest.
    return { ok: false, mode: "fallback-ts", action: "noop", error: "AGENT_SERVICE_URL configured; use the ADK service" };
  }

  try {
    switch (before) {
      case "planning": {
        await planDiscoveryQueries(campaignId).catch(() => null);
        await setCampaignPhase(campaignId, "discovering");
        action = "plan";
        break;
      }
      case "discovering": {
        const counts = await poolCounts(campaignId);
        const desired = camp.desired_deals ?? 3;
        const target = Math.max(POOL_TARGET_MIN, desired * 12);
        const have = (counts.discovered ?? 0) + (counts.qualified ?? 0) + (counts.ready ?? 0) + (counts.outreached ?? 0) + (counts.replied ?? 0) + (counts.negotiating ?? 0);
        if (have < target && !camp.paused_discovery) {
          const plan = await planDiscoveryQueries(campaignId);
          const batch = await discoverBatch(campaignId, plan.queries.slice(0, 10), { maxPerQuery: 8 });
          action = "discover";
          details.batch = batch;
        }
        break;
      }
      case "qualifying": {
        const pending = (await import("./queries")).listProspects;
        const discovered = await pending(campaignId, "discovered", 8);
        for (const p of pick(discovered, 8)) await evaluateProspect(p.id);
        action = discovered.length ? `qualify(${Math.min(8, discovered.length)})` : "qualify(none)";
        break;
      }
      case "resolving_contacts": {
        const { listProspects } = await import("./queries");
        const qualified = (await listProspects(campaignId, ["qualified"], 20)).filter((x) => (x.notes?.contact_attempts ?? 0) < 3);
        for (const p of pick(qualified, 8)) await resolveContactForProspect(p.id);
        action = qualified.length ? `contact(${Math.min(8, qualified.length)})` : "contact(none)";
        break;
      }
      case "outreaching": {
        const { listProspects } = await import("./queries");
        const ready = (await listProspects(campaignId, ["ready"], 20)).filter((x) => x.contact_email);
        for (const p of pick(ready, 5)) await sendOutreachToProspect(p.id);
        action = ready.length ? `outreach(${Math.min(5, ready.length)})` : "outreach(none)";
        break;
      }
      case "monitoring": {
        // detectReplies stays true: in demo mode this triggers persona injection instead of IMAP
        // (processRepliesTick picks the right source per campaign.demo_mode).
        const r = await processRepliesTick(campaignId, { detectReplies: true });
        action = "monitor";
        details.replies = r;
        // Process due follow-ups for multi-touch sequences
        const { processDueFollowUps } = await import("./outreach");
        const fu = await processDueFollowUps(campaignId);
        details.followups = fu;
        // Nudge real delivery of any scheduled mail (no-op in demo mode).
        void runSendProcessorHint();
        break;
      }
      default:
        action = "noop";
    }
  } catch (e: any) {
    return { ok: false, mode: "fallback-ts", phase_before: before, action: "error", error: e?.message };
  }

  // Deterministic transition check.
  const fresh = await getCampaignRow(campaignId);
  const after = await transitionIfNeeded(campaignId, fresh);

  // Discovery saturation: a full pass with nothing new means the pool is exhausted —
  // move on regardless of the nominal target (demo fixtures / dry search providers).
  if (!after && action === "discover") {
    const created = (details.batch as any)?.created ?? 0;
    const c = await poolCounts(campaignId);
    const have = (c.discovered ?? 0) + (c.qualified ?? 0) + (c.ready ?? 0) + (c.outreached ?? 0) + (c.replied ?? 0) + (c.negotiating ?? 0);
    const empties = (_emptyDiscoverRuns.get(campaignId) ?? 0);
    if (created === 0) _emptyDiscoverRuns.set(campaignId, empties + 1); else _emptyDiscoverRuns.set(campaignId, 0);
    if ((have > 0 && created === 0) || (created === 0 && empties + 1 >= EMPTY_DISCOVERY_LIMIT)) {
      await setCampaignPhase(campaignId, "qualifying", "discovery_saturated");
      return { ok: true, mode: "fallback-ts", phase_before: before, phase_after: "qualifying", action, details };
    }
  }

  await emitEvent(campaignId, "campaign_manager", "tick", {
    state_before: before, state_after: after ?? fresh.phase,
    detail: { action, mode: "fallback-ts", ...details },
  });

  return { ok: true, mode: "fallback-ts", phase_before: before, phase_after: after ?? fresh.phase, action, details };
}

async function transitionIfNeeded(campaignId: string, camp: any): Promise<string | null> {
  const counts = await poolCounts(campaignId);
  const desired = camp.desired_deals ?? null;
  const deals = await getDeals(campaignId);
  const phase = camp.phase;
  const totalPool = (counts.discovered ?? 0) + (counts.qualified ?? 0) + (counts.resolving_contact ?? 0) + (counts.ready ?? 0) + (counts.outreached ?? 0) + (counts.replied ?? 0) + (counts.negotiating ?? 0);

  let nxt: string | null = null;
  let reason: string | undefined;

  if (phase === "discovering") {
    const target = Math.max(POOL_TARGET_MIN, (desired ?? 3) * 12);
    const have = (counts.discovered ?? 0) + (counts.qualified ?? 0) + (counts.ready ?? 0) + (counts.outreached ?? 0) + (counts.replied ?? 0) + (counts.negotiating ?? 0);
    if (have >= target || (have > 0 && (counts.discovered ?? 0) === 0)) { nxt = "qualifying"; reason = "pool filled"; }
  } else if (phase === "qualifying") {
    if ((counts.discovered ?? 0) === 0 && totalPool > 0) { nxt = "resolving_contacts"; reason = "all prospects evaluated"; }
  } else if (phase === "resolving_contacts") {
    const qualified = await listProspects(campaignId, "qualified", 200);
    const actionable = qualified.filter((x) => (x.notes?.contact_attempts ?? 0) < 3);
    const stuckResolving = await listProspects(campaignId, "resolving_contact" as any, 200);
    if ((counts.qualified ?? 0) === 0 || (actionable.length === 0 && stuckResolving.length === 0)) {
      if ((counts.ready ?? 0) > 0) { nxt = "outreaching"; reason = "contacts resolved"; }
      else if ((counts.outreached ?? 0) + (counts.replied ?? 0) + (counts.negotiating ?? 0) > 0) { nxt = "monitoring"; reason = "outreach in flight"; }
      else { nxt = "completed"; reason = "no contactable prospects"; }
    }
  } else if (phase === "outreaching") {
    const ready = await listProspects(campaignId, "ready", 200);
    const sendable = ready.filter((x) => x.contact_email);
    if (sendable.length === 0) { nxt = "monitoring"; reason = "initial outreach queued"; }
  } else if (phase === "monitoring") {
    if (desired != null && deals.filter((d) => d.status !== "cancelled").length >= desired) { nxt = "completed"; reason = "goal_reached"; }
    else if (
      totalPool === 0 &&
      (counts.outreached ?? 0) + (counts.replied ?? 0) + (counts.negotiating ?? 0) === 0 &&
      (await staleMonitoring(campaignId))
    ) { nxt = "completed"; reason = "prospects_exhausted"; }
  }

  if (nxt) {
    await setCampaignPhase(campaignId, nxt as never, reason);
    await updateCampaignExt(campaignId, {});
    return nxt;
  }
  return null;
}

async function staleMonitoring(campaignId: string): Promise<boolean> {
  // Consider monitoring exhausted only after a quiet period (no new replies for 1h+).
  try {
    const events = await (await import("./queries")).listAgentEvents(campaignId, 0, 50);
    const lastActivity = events.length ? new Date(events[events.length - 1].ts).getTime() : 0;
    return Date.now() - lastActivity > 60 * 60 * 1000;
  } catch {
    return false;
  }
}
