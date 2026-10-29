// Deterministic campaign policy. Code owns: which actions are AVAILABLE this tick, phase
// transitions, tick intervals and completion. The model only chooses among available actions.
import type { Campaign, CampaignPhase } from "./types";

export type ActionKey = "run_discovery" | "qualify" | "resolve_contacts" | "send_outreach" | "handle_replies" | "schedule_followups";

export interface PolicyInput {
  camp: Campaign;
  counts: Record<string, number>;      // prospects by status
  deals: number;
  openInterventions: number;
  unansweredReplies: number;
  sendableReady: number;                // ready prospects with a contact email
  actionableQualified: number;          // qualified prospects with < 3 contact attempts
  dueDemoReplies?: number;              // demo only: model-written editor replies waiting to arrive
  canSearch?: boolean;                  // real only: a search provider exists and the owner allowed searching (default true)
  dueFollowups?: number;                // real only: unanswered initials old enough for a polite nudge
}

/** Demo fixtures and seed-only campaigns load their whole pool in one go; searching campaigns fill to a target. */
function loadsInOneGo(i: PolicyInput): boolean {
  return i.camp.demo_mode || i.canSearch === false;
}

export interface AvailableAction { key: ActionKey; description: string; size: number }

const POOL_TARGET_MIN = 12;

export function poolTarget(camp: Campaign): number {
  const fromPlan = Number(camp.plan?.pool_target);
  if (Number.isFinite(fromPlan) && fromPlan > 0) return fromPlan;
  return Math.max(POOL_TARGET_MIN, camp.desired_deals * 6);
}

/** What the campaign COULD do right now. Empty ⇒ no-op tick, no model call. */
export function availableActions(i: PolicyInput): AvailableAction[] {
  const { camp, counts } = i;
  const c = (k: string) => counts[k] ?? 0;
  const pool = c("discovered") + c("qualified") + c("resolving_contact") + c("ready") + c("outreached") + c("replied") + c("negotiating") + c("deal") + c("escalated");
  const out: AvailableAction[] = [];
  switch (camp.phase) {
    case "planning":
    case "discovering":
      // Demo fixtures load in one go; real campaigns keep searching until the pool target is met.
      // One-go campaigns load once: if everything loaded was rejected, that is "nothing qualified", not a reason to load again.
      if (loadsInOneGo(i) ? pool + c("rejected") === 0 : pool < poolTarget(camp)) out.push({ key: "run_discovery", description: camp.demo_mode ? (i.canSearch === false ? "Load the demo publications." : "Search the web for publications.") : i.canSearch === false ? "Load the publications the owner listed." : `Search for new publications (have ${pool}, want ~${poolTarget(camp)}).`, size: 1 });
      if (c("discovered") > 0) out.push({ key: "qualify", description: `Evaluate ${c("discovered")} discovered publications for fit and authority.`, size: Math.min(6, c("discovered")) });
      break;
    case "qualifying":
      if (c("discovered") > 0) out.push({ key: "qualify", description: `Evaluate ${c("discovered")} discovered publications for fit and authority.`, size: Math.min(6, c("discovered")) });
      if (i.actionableQualified > 0) out.push({ key: "resolve_contacts", description: `Find an editor's email at ${i.actionableQualified} qualified publications.`, size: Math.min(4, i.actionableQualified) });
      break;
    case "resolving_contacts":
      if (i.actionableQualified > 0) out.push({ key: "resolve_contacts", description: `Find an editor's email at ${i.actionableQualified} qualified publications.`, size: Math.min(4, i.actionableQualified) });
      if (i.sendableReady > 0) out.push({ key: "send_outreach", description: `Write and send outreach to ${i.sendableReady} editors whose address is known.`, size: Math.min(4, i.sendableReady) });
      break;
    case "outreaching":
      if (i.sendableReady > 0) out.push({ key: "send_outreach", description: `Write and send outreach to ${i.sendableReady} editors whose address is known.`, size: Math.min(4, i.sendableReady) });
      if (i.unansweredReplies > 0 || (camp.demo_mode && (i.dueDemoReplies ?? 0) > 0)) out.push({ key: "handle_replies", description: `Read and answer ${i.unansweredReplies} editor replies (negotiate within policy).`, size: Math.min(3, i.unansweredReplies) });
      break;
    case "monitoring":
      if (i.unansweredReplies > 0) out.push({ key: "handle_replies", description: `Read and answer ${i.unansweredReplies} editor replies (negotiate within policy).`, size: Math.min(3, i.unansweredReplies) });
      if (camp.demo_mode && (i.dueDemoReplies ?? 0) > 0) out.push({ key: "handle_replies", description: `Check the inbox: ${i.dueDemoReplies} editor ${i.dueDemoReplies === 1 ? "reply is" : "replies are"} waiting.`, size: 3 });
      else if ((i.dueFollowups ?? 0) > 0) out.push({ key: "schedule_followups", description: `Schedule polite follow-ups for ${i.dueFollowups} unanswered emails older than the follow-up delay.`, size: 5 });
      if (i.sendableReady > 0) out.push({ key: "send_outreach", description: `Write and send outreach to ${i.sendableReady} more editors.`, size: Math.min(4, i.sendableReady) });
      break;
  }
  // de-dupe by key, keep first
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.key) ? false : (seen.add(a.key), true)));
}

/** Phase transition, computed from counts after the tick's work. */
export function nextPhase(i: PolicyInput): { phase: CampaignPhase; reason: string } | null {
  const { camp, counts } = i;
  const c = (k: string) => counts[k] ?? 0;
  const pool = c("discovered") + c("qualified") + c("resolving_contact") + c("ready") + c("outreached") + c("replied") + c("negotiating") + c("deal") + c("escalated");
  const inFlight = c("outreached") + c("replied") + c("negotiating") + c("escalated");
  switch (camp.phase) {
    case "planning": return { phase: "discovering", reason: "plan ready" };
    case "discovering":
      if (pool >= poolTarget(camp) || (pool + c("rejected") > 0 && loadsInOneGo(i))) return { phase: "qualifying", reason: "pool filled" };
      return null;
    case "qualifying":
      if (c("discovered") === 0 && (c("qualified") > 0 || c("ready") > 0)) return { phase: "resolving_contacts", reason: "all prospects evaluated" };
      if (c("discovered") === 0 && c("qualified") === 0 && c("resolving_contact") === 0 && c("ready") === 0 && inFlight === 0 && c("rejected") > 0) return { phase: "completed", reason: "nothing_qualified" };
      return null;
    case "resolving_contacts":
      if (i.actionableQualified === 0 && c("resolving_contact") === 0) {
        if (i.sendableReady > 0) return { phase: "outreaching", reason: "contacts resolved" };
        if (inFlight > 0) return { phase: "monitoring", reason: "outreach in flight" };
        return { phase: "completed", reason: "no_contactable_prospects" };
      }
      return null;
    case "outreaching":
      if (i.sendableReady === 0) return { phase: "monitoring", reason: "outreach sent" };
      return null;
    case "monitoring":
      if (i.deals >= camp.desired_deals) return { phase: "completed", reason: "goal_reached" };
      if (inFlight === 0 && i.sendableReady === 0 && i.actionableQualified === 0 && c("discovered") === 0 && (i.dueDemoReplies ?? 0) === 0) return { phase: "completed", reason: "prospects_exhausted" };
      return null;
  }
  return null;
}

/** How long until this campaign should be looked at again. */
export function nextTickDelayMs(camp: Campaign, didWork: boolean): number | null {
  if (!["planning", "discovering", "qualifying", "resolving_contacts", "outreaching", "monitoring"].includes(camp.phase)) return null;
  if (camp.demo_mode) return didWork ? 15_000 : 60_000;
  if (camp.phase === "monitoring") return 20 * 60_000;
  return 5 * 60_000;
}

/** The one sentence at the top of the Campaign screen. Always true, never model-written. */
export function statusSentence(i: PolicyInput & { paused_reason?: string | null; completion_reason?: string | null }): string {
  const { camp, counts } = i;
  const c = (k: string) => counts[k] ?? 0;
  const money = `$${Math.round(camp.budget_used)} of $${Math.round(camp.budget_total)} committed`;
  if (camp.paused) return `Paused — ${i.paused_reason ?? "by you"}.`;
  if (camp.phase === "completed") {
    const why = i.completion_reason === "goal_reached" ? "Goal reached" : i.completion_reason === "budget_exhausted" ? "Budget spent" : i.completion_reason === "nothing_qualified" ? "No publication passed the bar" : "Finished";
    return `${why}. ${i.deals} ${i.deals === 1 ? "deal" : "deals"} agreed, ${money}.`;
  }
  if (camp.phase === "stopped") return `Stopped. ${i.deals} deals agreed, ${money}.`;
  const needs = i.openInterventions > 0 ? `${i.openInterventions} ${i.openInterventions === 1 ? "thing needs" : "things need"} you.` : "Nothing needs you right now.";
  switch (camp.phase) {
    case "draft": return "Ready to launch.";
    case "planning": return "Planning the search.";
    case "discovering": return `Searching for publications — ${c("discovered") + c("qualified") + c("rejected")} found so far.`;
    case "qualifying": return `Evaluating ${c("discovered")} publications for fit and authority — ${c("qualified")} qualified so far.`;
    case "resolving_contacts": return `Finding editors at ${c("qualified") + c("resolving_contact")} qualified publications — ${c("ready")} found.`;
    case "outreaching": return `Emailing ${c("ready")} editors. ${needs}`;
    case "monitoring": {
      const talking = c("negotiating") + c("replied");
      const waiting = c("outreached");
      return `${talking > 0 ? `Negotiating with ${talking} ${talking === 1 ? "editor" : "editors"}` : waiting > 0 ? `Waiting on ${waiting} ${waiting === 1 ? "reply" : "replies"}` : "Monitoring"}. ${i.deals} ${i.deals === 1 ? "deal" : "deals"} agreed, ${money}. ${needs}`;
    }
  }
  return "";
}
