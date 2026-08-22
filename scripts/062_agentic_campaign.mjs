// Run: node scripts/062_agentic_campaign.mjs
//
// Agentic campaign layer for the hackathon build (NEW work — see docs/PREEXISTING_WORK.md).
// Extends the existing campaigns table into an autonomous-workflow objective, and adds:
//   campaign_prospects   per-prospect funnel state + opportunity score + discovery provenance
//   deals                structured deal terms (never "CLOSED because sounds good")
//   interventions        durable human-in-the-loop requests/resumptions
//   agent_runs           one row per agent execution unit
//   agent_events         append-only observability timeline (operational traces, NOT CoT)
//   budget_ledger        every committed/spent/released dollar, auditable
//   idempotency_keys     at-most-once external actions across crashes/retries
//
// All CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS — safe to re-run.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`
  -- ─── campaigns: objective + autonomy + live phase ───────────────────────────
  ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS owner_email text,
    ADD COLUMN IF NOT EXISTS website_url text,
    ADD COLUMN IF NOT EXISTS objective text,
    ADD COLUMN IF NOT EXISTS budget_total numeric NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS budget_used numeric NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS min_dr integer,
    ADD COLUMN IF NOT EXISTS geos text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS desired_deals integer,
    ADD COLUMN IF NOT EXISTS max_per_deal numeric,
    ADD COLUMN IF NOT EXISTS excluded_domains text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS constraints_text text,
    ADD COLUMN IF NOT EXISTS autonomy_mode text NOT NULL DEFAULT 'autonomous', -- autonomous|assisted|manual
    ADD COLUMN IF NOT EXISTS policy jsonb NOT NULL DEFAULT '{}',
    -- execution: phase is the agentic lifecycle; legacy status column stays untouched
    ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'draft',
      -- draft|planning|discovering|qualifying|resolving_contacts|outreaching|monitoring|completing|completed|stopped|failed
    ADD COLUMN IF NOT EXISTS completion_reason text,
    ADD COLUMN IF NOT EXISTS demo_mode boolean NOT NULL DEFAULT false,
    -- independent capability pauses + emergency stop
    ADD COLUMN IF NOT EXISTS paused_discovery boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS paused_outreach boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS paused_negotiation boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS emergency_stopped boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS started_at timestamptz,
    ADD COLUMN IF NOT EXISTS completed_at timestamptz;
  CREATE INDEX IF NOT EXISTS idx_campaigns_owner ON campaigns(owner_email);

  -- ─── campaign_prospects ─────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS campaign_prospects (
    id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id       uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    author_id         uuid,
    domain_host       text NOT NULL,
    prospect_url      text,
    title             text,
    -- provenance: how was this found (query/source/position/timestamp) — never lost
    provenance        jsonb NOT NULL DEFAULT '{}',
    -- deterministic + semantic scoring breakdown (explainable, no invented numbers)
    opportunity_score integer,
    score_breakdown   jsonb NOT NULL DEFAULT '{}',
    qualification     jsonb NOT NULL DEFAULT '{}',
    -- discovered|qualified|rejected|resolving_contact|ready|outreached|replied|negotiating|deal|lost|escalated
    status            text NOT NULL DEFAULT 'discovered',
    contact_email     text,
    contact_source    text,
    contact_confidence numeric,
    ceiling           numeric,
    notes             jsonb NOT NULL DEFAULT '{}',
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS campaign_prospects_uniq
    ON campaign_prospects (campaign_id, domain_host, coalesce(author_id::text, 'none'));
  CREATE INDEX IF NOT EXISTS idx_cprosp_status ON campaign_prospects (campaign_id, status);

  -- ─── deals ──────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS deals (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id     uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    anchor_email_id uuid,                 -- the initial outreach_emails row (the thread)
    author_id       uuid,
    domain_host     text NOT NULL,
    publication     text,
    terms           jsonb NOT NULL DEFAULT '{}',
      -- {placement_type, price, currency, link_type, permanence, turnaround, conditions[]}
    original_ask    numeric,
    agreed_price    numeric,
    currency        text NOT NULL DEFAULT 'USD',
    -- terms_agreed|awaiting_content|awaiting_payment_approval|placement_pending|live|verified|closed|cancelled
    status          text NOT NULL DEFAULT 'terms_agreed',
    next_action     text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    agreed_at       timestamptz,
    closed_at       timestamptz
  );
  CREATE UNIQUE INDEX IF NOT EXISTS deals_anchor_uniq ON deals (anchor_email_id) WHERE anchor_email_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_deals_campaign ON deals (campaign_id, status);

  -- ─── interventions (durable HITL suspend/resume) ────────────────────────────
  -- Types mirror src/lib/negotiation/agent.ts InterventionType.
  CREATE TABLE IF NOT EXISTS interventions (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id     uuid REFERENCES campaigns(id) ON DELETE CASCADE,
    anchor_email_id uuid,
    type            text NOT NULL,        -- sync_contact|legal_contract|asset_request|...
    ask             text,                 -- what they literally asked for
    reason          text,                 -- why the agent paused
    agent_note      text,                 -- structured context for the human
    status          text NOT NULL DEFAULT 'open',  -- open|resolved|dismissed
    assist_input    text,                 -- the human's trusted answer (becomes tool input)
    has_asset       boolean NOT NULL DEFAULT false,
    suggested_options jsonb NOT NULL DEFAULT '[]',
    resumed_run_id  uuid,
    resolved_by     text,
    resolved_at     timestamptz,
    result_action   text,
    created_at      timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_interventions_open ON interventions (campaign_id, status);

  -- ─── agent_runs ─────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS agent_runs (
    id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id    uuid REFERENCES campaigns(id) ON DELETE CASCADE,
    agent          text NOT NULL,          -- campaign_manager | discovery | negotiation | ...
    adk_session_id text,
    tick_kind      text,                   -- which bounded work unit this ran
    status         text NOT NULL DEFAULT 'running', -- running|completed|failed|stopped
    stats          jsonb NOT NULL DEFAULT '{}',
    error          text,
    started_at     timestamptz NOT NULL DEFAULT now(),
    finished_at    timestamptz
  );
  CREATE INDEX IF NOT EXISTS idx_agent_runs_campaign ON agent_runs (campaign_id, started_at DESC);

  -- ─── agent_events (append-only timeline; operational traces only) ──────────
  CREATE TABLE IF NOT EXISTS agent_events (
    id            bigserial PRIMARY KEY,
    campaign_id   uuid,
    run_id        uuid,
    ts            timestamptz NOT NULL DEFAULT now(),
    agent         text NOT NULL,
    action        text NOT NULL,
    tool          text,
    prospect_id   uuid,
    thread_id     uuid,
    state_before  text,
    state_after   text,
    duration_ms   integer,
    status        text NOT NULL DEFAULT 'ok',  -- ok|error|retry|skipped
    error_code    text,
    retry_count   integer NOT NULL DEFAULT 0,
    level         text NOT NULL DEFAULT 'info', -- info|warn|error
    detail        jsonb NOT NULL DEFAULT '{}',
    -- dedupe key so a redelivered Pub/Sub message cannot double-log an action
    event_key     text
  );
  CREATE UNIQUE INDEX IF NOT EXISTS agent_events_key_uniq ON agent_events (event_key) WHERE event_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_agent_events_timeline ON agent_events (campaign_id, id DESC);
  COMMENT ON TABLE agent_events IS
    'Operational traces (agent/action/tool/state/duration/confidence). Never contains private model chain-of-thought.';

  -- ─── budget_ledger ──────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS budget_ledger (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    deal_id     uuid REFERENCES deals(id) ON DELETE SET NULL,
    entry_type  text NOT NULL,   -- commit|spend|release|adjust
    amount      numeric NOT NULL,
    currency    text NOT NULL DEFAULT 'USD',
    note        text,
    created_by  text NOT NULL DEFAULT 'agent', -- agent|human
    created_at  timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_budget_campaign ON budget_ledger (campaign_id, created_at);

  -- ─── idempotency_keys (at-most-once external effects) ───────────────────────
  CREATE TABLE IF NOT EXISTS idempotency_keys (
    key        text PRIMARY KEY,
    scope      text,
    result     jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  -- ─── RLS: mirror repo convention (scripts 024/050): lock the anon key out;
  -- ─── service role + owner bypass RLS, so app/scripts are unaffected. ────────
  ALTER TABLE campaign_prospects ENABLE ROW LEVEL SECURITY;
  ALTER TABLE deals             ENABLE ROW LEVEL SECURITY;
  ALTER TABLE interventions     ENABLE ROW LEVEL SECURITY;
  ALTER TABLE agent_runs        ENABLE ROW LEVEL SECURITY;
  ALTER TABLE agent_events      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE budget_ledger     ENABLE ROW LEVEL SECURITY;
  ALTER TABLE idempotency_keys  ENABLE ROW LEVEL SECURITY;
`);

console.log("062 done: agentic campaign schema ready.");
await client.end();
