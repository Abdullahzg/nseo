// Campaign domain model. Mirrors supabase/migrations/0001_schema.sql.
import type { LLMMeta } from "@/lib/ai/nebius";

export type CampaignPhase = "draft" | "planning" | "discovering" | "qualifying" | "resolving_contacts" | "outreaching" | "monitoring" | "completed" | "stopped" | "failed";
export const ACTIVE_PHASES: CampaignPhase[] = ["planning", "discovering", "qualifying", "resolving_contacts", "outreaching", "monitoring"];
export const isActivePhase = (p: string | null | undefined): boolean => ACTIVE_PHASES.includes((p ?? "") as CampaignPhase);

export type ProspectStatus = "discovered" | "qualified" | "rejected" | "resolving_contact" | "ready" | "outreached" | "replied" | "negotiating" | "deal" | "lost" | "escalated";
export type DealStatus = "terms_agreed" | "awaiting_content" | "placement_pending" | "live" | "closed" | "cancelled";
export type ScoreBasis = "full" | "relevance_only";

export interface Campaign {
  id: string;
  owner_email: string | null;
  guest_id: string | null;
  name: string;
  website_url: string | null;
  what_you_sell: string | null;
  keywords: string[];
  desired_deals: number;
  budget_total: number;
  budget_used: number;
  max_per_deal: number | null;
  min_dr: number;
  currency: string;
  demo_mode: boolean;
  phase: CampaignPhase;
  completion_reason: string | null;
  paused: boolean;
  paused_reason: string | null;
  tick_count: number;
  ticks_today: number;
  ticks_day: string | null;
  last_tick_at: string | null;
  next_tick_after: string | null;
  ultra_calls: number;
  plan_text: string | null;
  plan: import("./plan").CampaignPlan;
  /** Real mode: publications the owner already knows, optionally with the editor's address. */
  seed_contacts: { url: string; email?: string }[];
  /** Real mode: false means "only the publications I listed" — no web search, no strangers. */
  search_web: boolean;
  /** Live: which agent is doing what, while a step runs. Null between steps. */
  story?: Record<string, unknown> | null;
  share_token?: string | null;
  activity: { agent: string; doing: string; target?: string | null; n?: number; of?: number; model?: string | null; at: string; done?: boolean } | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface Prospect {
  id: string;
  campaign_id: string;
  author_id: string | null;
  domain_host: string;
  prospect_url: string | null;
  title: string | null;
  provenance: { source: string; query?: string; position?: number; discovered_at: string; synthetic?: boolean };
  status: ProspectStatus;
  opportunity_score: number | null;
  score_basis: ScoreBasis | null;
  score_breakdown: ScoreBreakdown | null;
  qualification: { checks: { label: string; state: "pass" | "fail" | "unverified" }[]; title?: string; why_fit?: string; placement_angle?: string; is_editorial?: boolean; page_type?: string; article_author?: string | null } | null;
  ceiling: number | null;
  contact_email: string | null;
  contact_name: string | null;
  contact_source: string | null;
  contact_confidence: number | null;
  contact_attempts: number;
  demo_persona: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScoreBreakdown {
  authority: { value: number | null; source: string };          // DR: measured:ahrefs | fixture | unverified
  relevance: { value: number; source: string; model?: string };  // always model (or fixture-scored by model)
  traffic: { value: number | null; source: string };
  spam_risk: { level: "low" | "medium" | "high"; source: string };
  fair_value_range: [number, number] | null;
}

export interface DealTerms { placement_type?: string; link_type?: string; permanence?: string; turnaround_days?: number; conditions?: string[] }

export type EventEngine = "model" | "policy" | "fixture" | "system";

export interface AgentEventInput {
  campaign_id: string;
  agent: string;                 // strategy | discovery | qualification | contact | outreach | negotiation | manager | system
  action: string;                // machine key
  human: string;                 // the one-line sentence shown in the feed
  engine: EventEngine;
  level?: "info" | "warn" | "error";
  prospect_id?: string | null;
  thread_id?: string | null;
  detail?: Record<string, unknown>;
  llm?: LLMMeta | LLMMeta[] | null;
  event_key?: string | null;
}

export interface AgentEvent extends Omit<AgentEventInput, "llm"> {
  id: number;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  reasoning: string | null;
  cost_usd: number | null;
  created_at: string;
}

export interface BudgetCheck { ok: boolean; remaining: number; requested: number; reason?: string }
