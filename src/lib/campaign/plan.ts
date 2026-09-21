// The editable plan. Before launch the user can change what the agent will do: the search angles,
// how many publications to look at, the authority floor, the money rules, and the standing answers
// the agent may give on the owner's behalf (a call? traffic? files?). Stored on the campaign as
// `plan` and read by the Scout, the Judge and the Negotiator. Anything absent falls back to the
// defaults the agent would have used anyway.

export type AskPolicy = "email_only" | "ask_me" | "share_calendar";

export interface CampaignPlan {
  queries?: string[];                 // Scout: search angles (Nano proposes them; you can edit)
  pool_target?: number;               // Scout: how many publications to look at before judging (real mode)
  min_dr?: number;                    // Judge: authority floor when DR is measured
  auto_accept_below?: number;         // Negotiator: a quote at or under this is accepted at their number
  human_approval_above?: number;      // Negotiator: ask me before agreeing above this
  tone?: "gentle" | "balanced" | "firm";
  followup_after_days?: number;       // Writer: nudge after this many days without a reply
  if_asked_for_call?: AskPolicy;      // "email_only" answers without asking you
  if_asked_about_traffic?: "ask_me" | "use_facts";
  facts?: string;                     // things the agent may state as true about your business (traffic, audience, link type)
  approve_emails?: boolean;           // real mode: show me each first email before it goes out
  notify_email?: boolean;             // real mode: email me (from my own Gmail) when a card or a deal appears
}

export const PLAN_DEFAULTS: Required<Omit<CampaignPlan, "queries" | "facts">> = {
  pool_target: 12, min_dr: 50, auto_accept_below: 150, human_approval_above: 200, tone: "balanced", followup_after_days: 3, if_asked_for_call: "ask_me", if_asked_about_traffic: "ask_me", approve_emails: false, notify_email: true,
};

export function normalizePlan(raw: unknown): CampaignPlan {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (k: keyof CampaignPlan, lo: number, hi: number) => { const n = Number(p[k]); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : undefined; };
  const out: CampaignPlan = {};
  if (Array.isArray(p.queries)) out.queries = p.queries.map((q) => String(q).trim()).filter(Boolean).slice(0, 10);
  const pool = num("pool_target", 3, 60); if (pool != null) out.pool_target = pool;
  const dr = num("min_dr", 0, 90); if (dr != null) out.min_dr = dr;
  const acc = num("auto_accept_below", 0, 100000); if (acc != null) out.auto_accept_below = acc;
  const appr = num("human_approval_above", 0, 100000); if (appr != null) out.human_approval_above = appr;
  const fu = num("followup_after_days", 1, 30); if (fu != null) out.followup_after_days = fu;
  if (["gentle", "balanced", "firm"].includes(String(p.tone))) out.tone = p.tone as CampaignPlan["tone"];
  if (["email_only", "ask_me", "share_calendar"].includes(String(p.if_asked_for_call))) out.if_asked_for_call = p.if_asked_for_call as AskPolicy;
  if (["ask_me", "use_facts"].includes(String(p.if_asked_about_traffic))) out.if_asked_about_traffic = p.if_asked_about_traffic as CampaignPlan["if_asked_about_traffic"];
  if (typeof p.facts === "string" && p.facts.trim()) out.facts = p.facts.trim().slice(0, 1200);
  if (typeof p.approve_emails === "boolean") out.approve_emails = p.approve_emails;
  if (typeof p.notify_email === "boolean") out.notify_email = p.notify_email;
  return out;
}

export function planWithDefaults(raw: unknown): Required<Omit<CampaignPlan, "queries" | "facts">> & Pick<CampaignPlan, "queries" | "facts"> {
  return { ...PLAN_DEFAULTS, ...normalizePlan(raw) };
}
