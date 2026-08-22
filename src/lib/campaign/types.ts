// Agentic campaign domain model (new hackathon work).
// These types back the autonomous lifecycle: objective → plan → discover → qualify →
// contacts → outreach → replies → negotiation → deals, with HITL pauses.

export type CampaignPhase =
  | "draft"
  | "planning"
  | "discovering"
  | "qualifying"
  | "resolving_contacts"
  | "outreaching"
  | "monitoring"
  | "completing"
  | "completed"
  | "stopped"
  | "failed";

export const ACTIVE_PHASES: CampaignPhase[] = [
  "planning",
  "discovering",
  "qualifying",
  "resolving_contacts",
  "outreaching",
  "monitoring",
];

export type AutonomyMode = "autonomous" | "assisted" | "manual";

export type ProspectStatus =
  | "discovered"
  | "qualified"
  | "rejected"
  | "resolving_contact"
  | "ready"
  | "outreached"
  | "replied"
  | "negotiating"
  | "deal"
  | "lost"
  | "escalated";

export type DealStatus =
  | "terms_agreed"
  | "awaiting_content"
  | "awaiting_payment_approval"
  | "placement_pending"
  | "live"
  | "verified"
  | "closed"
  | "cancelled";

export interface DealTerms {
  placement_type?: string;      // link_insertion | guest_post | mention | roundup_inclusion
  price?: number;
  currency?: string;
  link_type?: string;           // dofollow | nofollow | sponsored | unknown
  permanence?: string;          // permanent | 1_year | unspecified
  turnaround_days?: number;
  conditions?: string[];
}

// Structured scoring breakdown — every numeric component deterministic or labeled.
export interface ScoreBreakdown {
  authority?: { value: number | null; source: string };        // DR measured, else null
  relevance?: { value: number; source: "gemini" | "heuristic" };
  traffic?: { value: number | null; source: string };
  geographic?: { value: number | null; source: string };
  contact_reachability?: { value: number; source: string };
  spam_risk?: { level: "low" | "medium" | "high"; source: string };
  fair_value_range?: [number, number] | null;
  provider_notes?: string[];
}

export interface DiscoveryProvenance {
  source: string;          // websearch:tavily | harvesters | seed_site | ...
  query?: string;
  position?: number;
  keyword?: string;
  discovered_at: string;
}

// Observability event — operational trace only (never private chain-of-thought).
export interface AgentEventInput {
  campaign_id?: string | null;
  run_id?: string | null;
  agent: string;
  action: string;
  tool?: string | null;
  prospect_id?: string | null;
  thread_id?: string | null;
  state_before?: string | null;
  state_after?: string | null;
  duration_ms?: number | null;
  status?: "ok" | "error" | "retry" | "skipped";
  error_code?: string | null;
  retry_count?: number;
  level?: "info" | "warn" | "error";
  detail?: Record<string, unknown>;
  event_key?: string | null;
}

export interface BudgetCheck {
  ok: boolean;
  remaining: number;
  requested: number;
  reason?: string;
}
