// One bounded, locked, capped tick of a campaign.
//
//   1. guards: lock, caps, token budget, paused/terminal
//   2. policy: which actions are available — none ⇒ policy_noop, no model call, return
//   3. MODEL (Nemotron 3 Super, thinking on): choose ONE of the available actions, as a tool call
//   4. code executes it, bounded to fit a 45 s wall-clock budget
//   5. policy: phase transition, completion, next tick time
import { chat, NebiusError, type ToolDef } from "@/lib/ai/nebius";
import { modelLabel } from "@/lib/ai/models";
import { getCampaign, updateCampaign, setPhase, countProspectsByStatus, getDeals, listInterventions, listProspects, countUnansweredReplies, recordEvent } from "./queries";
import { availableActions, nextPhase, nextTickDelayMs, type ActionKey, type PolicyInput, type AvailableAction } from "./policy";
import { planDiscoveryQueries, discoverBatch, qualifyBatch, contactBatch } from "./tools";
import { outreachBatch, processReplies, scheduleFollowups, checkCompletion } from "./outreach";
import { countDueDemoReplies } from "./demo";
import { searchProvider } from "@/lib/search/webSearch";
import { acquireTickLock, releaseTickLock, checkTickCaps, bumpTickCounters, assertTokenBudget, installUsageSink, pauseCampaign } from "./guard";
import { withKeys } from "@/lib/ai/context";
import { getOwnerKeys } from "@/lib/db/queries";
import type { Campaign } from "./types";

export const TICK_BUDGET_MS = Number(process.env.TICK_BUDGET_MS ?? 45_000);

export interface TickResult {
  ok: boolean;
  campaign_id: string;
  phase_before: string;
  phase_after: string;
  action: ActionKey | "noop" | "paused" | "locked" | "capped" | "error";
  decided_by: "model" | "policy" | null;
  model?: string | null;
  summary?: string;
  details?: Record<string, unknown>;
  error?: string;
  duration_ms: number;
}

async function policyInput(camp: Campaign): Promise<PolicyInput> {
  const [counts, deals, open, unansweredReplies, ready, qualified] = await Promise.all([
    countProspectsByStatus(camp.id),
    getDeals(camp.id),
    listInterventions({ campaign_id: camp.id, status: "open" }),
    countUnansweredReplies(camp.id),
    listProspects(camp.id, "ready", 200),
    listProspects(camp.id, "qualified", 200),
  ]);
  const dueDemoReplies = camp.demo_mode ? await countDueDemoReplies(camp.id) : 0;
  return {
    camp, counts, deals: deals.filter((d) => d.status !== "cancelled").length, openInterventions: open.length, unansweredReplies,
    sendableReady: ready.filter((p) => !!p.contact_email).length,
    actionableQualified: qualified.filter((p) => (p.contact_attempts ?? 0) < 3).length,
    dueDemoReplies,
    canSearch: camp.demo_mode ? true : camp.search_web !== false && !!searchProvider(),
  };
}

const TOOL_DESCRIPTIONS: Record<ActionKey, string> = {
  run_discovery: "Plan new search angles and search the web for candidate publications.",
  qualify: "Evaluate discovered publications: topical fit (model) and authority gate (code).",
  resolve_contacts: "Find a real editor's email at qualified publications.",
  send_outreach: "Draft and send personalised outreach emails to editors with a known address.",
  handle_replies: "Read new editor replies, classify them, and negotiate within the price ceiling. Parks anything needing a human.",
  schedule_followups: "Check the inbox and schedule polite follow-ups for unanswered emails.",
};

/**
 * Public entry: every model and search call inside the tick runs under the campaign owner's own
 * keys (Settings). Guests' demo campaigns run on the platform key.
 */
export async function tick(campaignId: string, opts: { via?: string } = {}): Promise<TickResult> {
  const t0 = Date.now();
  const camp0 = await getCampaign(campaignId);
  if (!camp0) return { ok: false, campaign_id: campaignId, phase_before: "?", phase_after: "?", action: "error", decided_by: null, error: "campaign not found", duration_ms: Date.now() - t0 };
  return withKeys(await getOwnerKeys(camp0.owner_email), () => tickInner(camp0, opts, t0));
}

async function tickInner(camp0: Campaign, opts: { via?: string }, t0: number): Promise<TickResult> {
  const campaignId = camp0.id;
  installUsageSink();
  const done = (r: Omit<TickResult, "duration_ms" | "campaign_id">): TickResult => ({ ...r, campaign_id: campaignId, duration_ms: Date.now() - t0 });

  const before = camp0.phase;
  if (!["planning", "discovering", "qualifying", "resolving_contacts", "outreaching", "monitoring"].includes(before)) return done({ ok: true, phase_before: before, phase_after: before, action: "noop", decided_by: null, summary: `phase ${before} is not active` });
  if (camp0.paused) return done({ ok: true, phase_before: before, phase_after: before, action: "paused", decided_by: null, summary: camp0.paused_reason ?? "paused" });

  const capReason = await checkTickCaps(camp0);
  if (capReason) { await pauseCampaign(campaignId, capReason, "cap"); return done({ ok: true, phase_before: before, phase_after: before, action: "capped", decided_by: null, summary: capReason }); }
  if (!(await acquireTickLock(campaignId))) return done({ ok: true, phase_before: before, phase_after: before, action: "locked", decided_by: null, summary: "another tick is running" });

  try {
    await bumpTickCounters(camp0);
    const camp = (await getCampaign(campaignId))!;
    const input = await policyInput(camp);
    const actions = availableActions(input);

    // No-op: nothing to do → no model call. Cheap and honest.
    if (actions.length === 0) {
      const t = nextPhase(input);
      if (t) { await setPhase(campaignId, t.phase, t.reason); await recordEvent({ campaign_id: campaignId, agent: "manager", action: "phase_changed", engine: "policy", human: phaseLine(t.phase, t.reason), detail: { from: before, to: t.phase, reason: t.reason } }); }
      const fresh = (await getCampaign(campaignId))!;
      const c = await checkCompletion(fresh);
      const delay = nextTickDelayMs((await getCampaign(campaignId))!, !!t);
      await updateCampaign(campaignId, { next_tick_after: delay == null ? null : new Date(Date.now() + delay).toISOString() });
      await recordEvent({ campaign_id: campaignId, agent: "manager", action: "policy_noop", engine: "policy", human: `Nothing to do this step${t ? ` — moved to ${t.phase.replace("_", " ")}` : ""}`, detail: { via: opts.via, transition: t, completed: c.completed }, level: "info" });
      return done({ ok: true, phase_before: before, phase_after: (await getCampaign(campaignId))!.phase, action: "noop", decided_by: "policy", details: { transition: t, completed: c } });
    }

    // Budget check happens before the first model call of the tick.
    await assertTokenBudget();

    // MODEL: choose one action. If the model returns no tool call, policy takes the first available.
    let chosen: AvailableAction = actions[0];
    let decidedBy: "model" | "policy" = "policy";
    let model: string | null = null;
    let summary = "";
    if (actions.length >= 1) {
      const tools: ToolDef[] = actions.map((a) => ({ type: "function", function: { name: a.key, description: `${TOOL_DESCRIPTIONS[a.key]} ${a.description}`, parameters: { type: "object", properties: { why: { type: "string", description: "One sentence: why this is the best next step." } }, required: ["why"] } } }));
      try {
        const r = await chat({
          role: "orchestrator", thinking: true, max_tokens: 1500, temperature: 0.2, timeout_ms: 30_000, tools, tool_choice: "auto",
          messages: [
            { role: "system", content: "You are the campaign manager of an autonomous SEO placement-outreach workforce. Each step you choose exactly ONE action by calling exactly one tool. Money, ceilings, send safety, and phase transitions are enforced in code; you decide priority. Prefer answering editor replies over anything else; prefer finishing evaluation before searching for more; keep the funnel moving toward the deal goal within budget." },
            { role: "user", content: `CAMPAIGN STATE\n${JSON.stringify({ product: camp.what_you_sell ?? camp.name, keywords: camp.keywords, goal_deals: camp.desired_deals, deals_agreed: input.deals, budget: { total: camp.budget_total, committed: camp.budget_used, max_per_deal: camp.max_per_deal }, phase: camp.phase, prospects_by_status: input.counts, unanswered_editor_replies: input.unansweredReplies, open_questions_for_owner: input.openInterventions, mode: camp.demo_mode ? "demo (simulated transport, real decisions)" : "real" }, null, 1)}\n\nChoose the single best next action by calling one tool.` },
          ],
        });
        model = r.meta.model;
        const call = r.tool_calls?.[0];
        const key = call?.function?.name as ActionKey | undefined;
        const pick = actions.find((a) => a.key === key);
        let why = "";
        try { why = JSON.parse(call?.function?.arguments ?? "{}").why ?? ""; } catch { /* ignore */ }
        if (pick) { chosen = pick; decidedBy = "model"; }
        summary = why || r.content.slice(0, 200);
        await recordEvent({ campaign_id: campaignId, agent: "manager", action: "decided", engine: pick ? "model" : "policy", llm: r.meta, human: pick ? `${modelLabel(r.meta.model)} chose: ${actionLine(chosen)}${why ? ` — ${why}` : ""}` : `Policy chose: ${actionLine(chosen)} (model gave no tool call)`, detail: { available: actions.map((a) => a.key), chosen: chosen.key, why, via: opts.via } });
      } catch (e: any) {
        if (e instanceof NebiusError && (e.kind === "auth" || e.kind === "not_configured" || e.kind === "budget")) throw e;
        // Transient model failure on the DECISION only: policy picks; the work itself still needs the model and will surface its own errors.
        await recordEvent({ campaign_id: campaignId, agent: "manager", action: "decision_error", engine: "system", level: "warn", human: `Manager model call failed (${e?.message ?? e}); policy chose ${actionLine(actions[0])}`, detail: { kind: e instanceof NebiusError ? e.kind : "unknown" } });
      }
    }

    // EXECUTE, bounded.
    const deadline = t0 + TICK_BUDGET_MS;
    const remaining = () => Math.max(0, deadline - Date.now());
    const details: Record<string, unknown> = { chosen: chosen.key, decided_by: decidedBy };
    switch (chosen.key) {
      case "run_discovery": {
        // Demo mode loads fixtures; without a search provider only the owner's seeds load. Planning
        // queries in either case would be a model call with no purpose.
        const queries = camp.demo_mode || camp.search_web === false || !searchProvider() ? [] : (await planDiscoveryQueries(camp)).queries;
        details.discovery = await discoverBatch(camp, queries, 8);
        break;
      }
      case "qualify": details.qualify = await qualifyBatch(camp, Math.max(1, Math.min(chosen.size, Math.floor(remaining() / 6000)))); break;
      case "resolve_contacts": details.contacts = await contactBatch(camp, Math.max(1, Math.min(chosen.size, Math.floor(remaining() / 8000)))); break;
      case "send_outreach": details.outreach = await outreachBatch(camp, Math.max(1, Math.min(chosen.size, Math.floor(remaining() / 5000)))); break;
      case "handle_replies": details.replies = await processReplies(camp, Math.max(1, Math.min(chosen.size, Math.floor(remaining() / 12000)))); break;
      case "schedule_followups": details.followups = await scheduleFollowups(camp, chosen.size); if (!camp.demo_mode) details.replies = await processReplies(camp, 2); break;
    }

    // POLICY: transition + completion + schedule.
    const after = await policyInput((await getCampaign(campaignId))!);
    const t = nextPhase(after);
    if (t) { await setPhase(campaignId, t.phase, t.reason); await recordEvent({ campaign_id: campaignId, agent: "manager", action: "phase_changed", engine: "policy", human: phaseLine(t.phase, t.reason), detail: { from: before, to: t.phase, reason: t.reason } }); }
    const fresh = (await getCampaign(campaignId))!;
    const c = await checkCompletion(fresh);
    const delay = nextTickDelayMs((await getCampaign(campaignId))!, true);
    await updateCampaign(campaignId, { next_tick_after: delay == null ? null : new Date(Date.now() + delay).toISOString() });
    return done({ ok: true, phase_before: before, phase_after: (await getCampaign(campaignId))!.phase, action: chosen.key, decided_by: decidedBy, model, summary, details: { ...details, transition: t, completed: c } });
  } catch (e: any) {
    const kind = e instanceof NebiusError ? e.kind : "unknown";
    if (e instanceof NebiusError && (e.kind === "auth" || e.kind === "not_configured")) await pauseCampaign(campaignId, `Nebius Token Factory is unreachable: ${e.message}`, "nebius");
    else if (e instanceof NebiusError && e.kind === "budget") await pauseCampaign(campaignId, e.message, "budget");
    else await recordEvent({ campaign_id: campaignId, agent: "system", action: "tick_error", engine: "system", level: "error", human: `Step failed: ${e?.message ?? e}`, detail: { kind, via: opts.via } });
    return done({ ok: false, phase_before: before, phase_after: (await getCampaign(campaignId))?.phase ?? before, action: "error", decided_by: null, error: e?.message ?? String(e), details: { kind } });
  } finally {
    await releaseTickLock(campaignId).catch(() => {});
  }
}

function actionLine(a: AvailableAction): string {
  switch (a.key) {
    case "run_discovery": return "search for more publications";
    case "qualify": return `evaluate ${a.size} publication${a.size === 1 ? "" : "s"}`;
    case "resolve_contacts": return `find editors at ${a.size} publication${a.size === 1 ? "" : "s"}`;
    case "send_outreach": return `email ${a.size} editor${a.size === 1 ? "" : "s"}`;
    case "handle_replies": return "read and answer editor replies";
    case "schedule_followups": return "check the inbox and schedule follow-ups";
  }
}

function phaseLine(phase: string, reason: string): string {
  switch (phase) {
    case "discovering": return "Started searching for publications";
    case "qualifying": return "Enough candidates found — evaluating them now";
    case "resolving_contacts": return "Evaluation done — finding editors' addresses";
    case "outreaching": return "Editors found — writing outreach";
    case "monitoring": return "Outreach sent — now watching for replies";
    case "completed": return reason === "goal_reached" ? "Goal reached" : reason === "budget_exhausted" ? "Budget spent" : reason === "nothing_qualified" ? "No publication passed the bar — finished" : reason === "no_contactable_prospects" ? "Could not find an editor at any qualified publication — finished" : "Finished — no more prospects to work";
    default: return `Moved to ${phase.replace("_", " ")} (${reason})`;
  }
}
