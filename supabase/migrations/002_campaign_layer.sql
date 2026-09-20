-- GenAI Scout — campaign layer schema
-- Adds all tables for the agentic campaign lifecycle: discovery → qualification →
-- outreach → negotiation → deals, with HITL interventions and budget tracking.
-- Safe to run on existing databases (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ─── Extensions (ensure) ────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── Missing columns on existing tables ──────────────────────────────────────

-- domains: DR, organic traffic, metrics source
alter table domains add column if not exists dr numeric(5,2);
alter table domains add column if not exists dr_checked_at timestamptz;
alter table domains add column if not exists metrics_source text;
alter table domains add column if not exists organic_traffic integer;
alter table domains add column if not exists us_traffic_share numeric(5,2);

-- authors: safety, contact overrides, timezone, discard
alter table authors add column if not exists safety_score numeric(5,2);
alter table authors add column if not exists safety_summary text;
alter table authors add column if not exists safety_checked_at timestamptz;
alter table authors add column if not exists email_search_attempted_at timestamptz;
alter table authors add column if not exists timezone text;
alter table authors add column if not exists contacted_override boolean;
alter table authors add column if not exists discarded boolean default false;

-- ─── Campaigns (main campaign table) ─────────────────────────────────────────
create table if not exists campaigns (
  id                uuid primary key default uuid_generate_v4(),
  name              text not null,
  status            text default 'draft',         -- draft | active | paused | completed
  phase             text default 'draft',         -- planning | discovering | qualifying | resolving_contacts | outreaching | monitoring | completed | stopped | failed
  completion_reason text,
  objective         text,                          -- free-text goal description
  keywords          jsonb default '[]',            -- target keywords
  website_url       text,
  region            text,
  owner_email       text,
  currency          text default 'USD',
  budget_total      numeric(12,2) default 0,
  budget_used       numeric(12,2) default 0,
  desired_deals     integer,
  target_hits       integer default 2500,
  paused_discovery  boolean default false,
  paused_outreach   boolean default false,
  paused_negotiation boolean default false,
  emergency_stopped boolean default false,
  demo_mode         boolean default false,
  autonomy_mode     text default 'autonomous',    -- autonomous | assisted | manual
  email_template_id uuid,
  ab_variant_ids    jsonb default '[]',
  seed_writer_name  text,
  seed_article_url  text,
  seed_domains      jsonb default '[]',
  seed_article_urls jsonb default '[]',
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  completed_at      timestamptz
);

-- ─── Campaign Prospects (discovered prospects per campaign) ──────────────────
create table if not exists campaign_prospects (
  id                uuid primary key default uuid_generate_v4(),
  campaign_id       uuid not null references campaigns(id) on delete cascade,
  author_id         uuid references authors(id),
  domain_host       text not null,
  prospect_url      text,
  title             text,
  provenance        jsonb default '{}',           -- { source, query, position, keyword, discovered_at }
  status            text default 'discovered',    -- discovered | qualified | rejected | resolving_contact | ready | outreached | replied | negotiating | deal | lost | escalated
  opportunity_score numeric(5,2),
  score_breakdown   jsonb,
  qualification     jsonb,
  ceiling           numeric(10,2),
  contact_email     text,
  notes             jsonb default '{}',
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists idx_cp_campaign on campaign_prospects(campaign_id);
create index if not exists idx_cp_author on campaign_prospects(author_id);
create index if not exists idx_cp_domain on campaign_prospects(domain_host);
create index if not exists idx_cp_status on campaign_prospects(status);
create index if not exists idx_cp_score on campaign_prospects(opportunity_score desc nulls last);
create unique index if not exists idx_cp_dedupe on campaign_prospects(campaign_id, domain_host);

-- ─── Campaign Authors (linking campaigns to authors) ─────────────────────────
create table if not exists campaign_authors (
  id              uuid primary key default uuid_generate_v4(),
  campaign_id     uuid not null references campaigns(id) on delete cascade,
  author_id       uuid not null references authors(id) on delete cascade,
  discovered_at   timestamptz default now(),
  unique (campaign_id, author_id)
);
create index if not exists idx_ca_campaign on campaign_authors(campaign_id);
create index if not exists idx_ca_author on campaign_authors(author_id);

-- ─── Workflows (email workflows per campaign) ────────────────────────────────
create table if not exists workflows (
  id              uuid primary key default uuid_generate_v4(),
  campaign_id     uuid references campaigns(id) on delete set null,
  name            text not null,
  filters         jsonb default '{}',
  status          text default 'draft',           -- draft | ready | sending | paused | completed
  prospect_count  integer default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_wf_campaign on workflows(campaign_id);

-- ─── Workflow Prospects (prospects in a workflow) ────────────────────────────
create table if not exists workflow_prospects (
  id              uuid primary key default uuid_generate_v4(),
  workflow_id     uuid not null references workflows(id) on delete cascade,
  author_id       uuid not null references authors(id) on delete cascade,
  included        boolean default true,
  rank            integer default 0,
  created_at      timestamptz default now()
);
create index if not exists idx_wfp_workflow on workflow_prospects(workflow_id);
create index if not exists idx_wfp_author on workflow_prospects(author_id);
create unique index if not exists idx_wfp_dedupe on workflow_prospects(workflow_id, author_id);

-- ─── Email Templates ─────────────────────────────────────────────────────────
create table if not exists email_templates (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  subject         text not null default '',
  body            text not null default '',
  guidance        text,                           -- AI instructions for this template
  channel         text default 'email',           -- email | linkedin
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ─── Outreach Emails (all emails — initial, followup, negotiation) ───────────
create table if not exists outreach_emails (
  id                  uuid primary key default uuid_generate_v4(),
  workflow_id         uuid references workflows(id) on delete set null,
  campaign_id         uuid references campaigns(id) on delete set null,
  author_id           uuid references authors(id) on delete set null,
  parent_id           uuid references outreach_emails(id) on delete set null,
  kind                text default 'initial',     -- initial | followup | negotiation
  template_id         uuid,
  email_template_id   uuid,
  subject             text,
  body                text,
  sender_email        text,                       -- whose mailbox sent this
  sent_by_email       text,                       -- who clicked send (shared sender)
  to_email            text,
  recipient_override  text,                       -- admin test-send override
  status              text default 'draft',       -- draft | ready | scheduled | sent | failed
  ai_managed          boolean default false,
  max_offer           numeric(10,2),
  agreed_price        numeric(10,2),
  paid_amount         numeric(10,2),
  payment_status      text,                       -- owed | requested | paid
  paid_at             timestamptz,
  payment_requested_at timestamptz,
  scheduled_at        timestamptz,
  sent_at             timestamptz,
  success_at          timestamptz,
  success_link        text,
  success_notes       text,
  error               text,
  replied_at          timestamptz,
  reply_checked_at    timestamptz,
  message_id          text,                       -- RFC Message-ID for threading
  followup_skipped    boolean default false,
  negotiation_status  text,                       -- agreed | declined | needs_human | stalled | handoff
  intervention_type   text,
  intervention_ask    text,
  intervention_reason text,
  intervention_at     timestamptz,
  reply_kind          text,                       -- reply | bounce | auto
  reply_from          text,
  reply_subject       text,
  reply_excerpt       text,
  reply_sentiment     text,                       -- positive | neutral | negative
  reply_intent        text,                       -- interested | asks_price | wants_topic | not_interested | follow_up_later | other
  bounced_at          timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
create index if not exists idx_oe_workflow on outreach_emails(workflow_id);
create index if not exists idx_oe_campaign on outreach_emails(campaign_id);
create index if not exists idx_oe_author on outreach_emails(author_id);
create index if not exists idx_oe_parent on outreach_emails(parent_id);
create index if not exists idx_oe_status on outreach_emails(status);
create index if not exists idx_oe_kind on outreach_emails(kind);
create index if not exists idx_oe_scheduled on outreach_emails(scheduled_at) where status = 'scheduled';
create index if not exists idx_oe_sender on outreach_emails(sender_email);
create index if not exists idx_oe_message_id on outreach_emails(message_id);
-- Partial unique: one initial per (workflow, author) — excludes negotiation rows
create unique index if not exists idx_oe_initial_unique
  on outreach_emails(workflow_id, author_id) where kind = 'initial';

-- ─── Deals (agreed placements) ──────────────────────────────────────────────
create table if not exists deals (
  id                uuid primary key default uuid_generate_v4(),
  campaign_id       uuid not null references campaigns(id) on delete cascade,
  anchor_email_id   uuid references outreach_emails(id) on delete set null,
  author_id         uuid references authors(id) on delete set null,
  domain_host       text,
  publication       text,
  terms             jsonb default '{}',           -- { placement_type, price, currency, link_type, permanence, turnaround_days, conditions }
  original_ask      numeric(10,2),
  agreed_price      numeric(10,2),
  currency          text default 'USD',
  status            text default 'terms_agreed',  -- terms_agreed | awaiting_content | awaiting_payment_approval | placement_pending | live | verified | closed | cancelled
  next_action       text,
  agreed_at         timestamptz,
  closed_at         timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists idx_deals_campaign on deals(campaign_id);
create index if not exists idx_deals_anchor on deals(anchor_email_id);
create index if not exists idx_deals_author on deals(author_id);
create index if not exists idx_deals_status on deals(status);

-- ─── Budget Ledger (budget tracking) ────────────────────────────────────────
create table if not exists budget_ledger (
  id              uuid primary key default uuid_generate_v4(),
  campaign_id     uuid not null references campaigns(id) on delete cascade,
  deal_id         uuid references deals(id) on delete set null,
  entry_type      text not null,                  -- commit | spend | release | adjust
  amount          numeric(12,2) not null,
  currency        text default 'USD',
  note            text,
  created_by      text default 'agent',           -- agent | human
  created_at      timestamptz default now()
);
create index if not exists idx_bl_campaign on budget_ledger(campaign_id);
create index if not exists idx_bl_deal on budget_ledger(deal_id);

-- ─── Interventions (human-in-the-loop requests) ─────────────────────────────
create table if not exists interventions (
  id                uuid primary key default uuid_generate_v4(),
  campaign_id       uuid references campaigns(id) on delete set null,
  anchor_email_id   uuid references outreach_emails(id) on delete set null,
  type              text not null,                 -- sync_contact | scheduling | asset_request | payment_details | factual_question | legal_contract | budget_exception | over_policy | thread_limit | other
  ask               text,
  reason            text,
  agent_note        text,
  suggested_options jsonb default '[]',
  status            text default 'open',           -- open | resolved | dismissed
  assist_input      text,                          -- human's response
  resolved_by       text,
  resolved_at       timestamptz,
  has_asset         boolean default false,
  result_action     text,
  created_at        timestamptz default now()
);
create index if not exists idx_iv_campaign on interventions(campaign_id);
create index if not exists idx_iv_anchor on interventions(anchor_email_id);
create index if not exists idx_iv_status on interventions(status);

-- ─── Agent Runs (agent execution records) ───────────────────────────────────
create table if not exists agent_runs (
  id              uuid primary key default uuid_generate_v4(),
  campaign_id     uuid references campaigns(id) on delete set null,
  agent           text not null,                   -- agent name / identifier
  tick_kind       text,                            -- campaign_tick | outreach_tick | etc.
  adk_session_id  text,
  status          text default 'running',          -- running | completed | failed | stopped
  stats           jsonb default '{}',
  error           text,
  started_at      timestamptz default now(),
  finished_at     timestamptz
);
create index if not exists idx_ar_campaign on agent_runs(campaign_id);
create index if not exists idx_ar_agent on agent_runs(agent);
create index if not exists idx_ar_started on agent_runs(started_at desc);

-- ─── Agent Events (detailed event log) ──────────────────────────────────────
create table if not exists agent_events (
  id              bigserial primary key,
  campaign_id     uuid references campaigns(id) on delete set null,
  run_id          uuid references agent_runs(id) on delete set null,
  agent           text not null,
  action          text not null,
  tool            text,
  prospect_id     uuid,
  thread_id       uuid,
  state_before    text,
  state_after     text,
  duration_ms     integer,
  status          text default 'ok',              -- ok | error | retry | skipped
  error_code      text,
  retry_count     integer default 0,
  level           text default 'info',            -- info | warn | error
  detail          jsonb default '{}',
  event_key       text,                           -- dedup key for at-least-once delivery
  created_at      timestamptz default now()
);
create index if not exists idx_ae_campaign on agent_events(campaign_id);
create index if not exists idx_ae_run on agent_events(run_id);
create index if not exists idx_ae_agent on agent_events(agent);
create index if not exists idx_ae_id on agent_events(id);
-- Optional dedup: only if event_key is populated
create unique index if not exists idx_ae_event_key on agent_events(event_key) where event_key is not null;

-- ─── Idempotency Keys (dedup) ──────────────────────────────────────────────
create table if not exists idempotency_keys (
  key             text primary key,
  scope           text,
  result          jsonb,
  created_at      timestamptz default now()
);

-- ─── Negotiation Settings (global negotiation config) ───────────────────────
create table if not exists negotiation_settings (
  id                      boolean primary key default true,
  ai_autonomy             text default 'autonomous',
  handbook                text,
  tone                    text default 'professional',
  aggressiveness          numeric(3,2) default 0.5,
  opening_percent         numeric(5,2) default 0.6,
  style_rules             text,
  max_thread_length       integer default 4,
  max_placement_price     numeric(10,2) default 500,
  target_placement_price  numeric(10,2) default 200,
  campaign_budget         numeric(12,2) default 0,
  auto_accept_below       numeric(10,2) default 100,
  human_approval_above    numeric(10,2) default 250,
  absolute_max_price      numeric(10,2) default 500,
  min_price               numeric(10,2) default 50,
  currency                text default 'USD',
  anti_highball           text,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

-- ─── Negotiation Activity (audit log) ───────────────────────────────────────
create table if not exists negotiation_activity (
  id              uuid primary key default uuid_generate_v4(),
  anchor_id       uuid not null references outreach_emails(id) on delete cascade,
  actor           text not null,
  action          text not null,
  detail          text,
  author_id       uuid references authors(id),
  created_at      timestamptz default now()
);
create index if not exists idx_na_anchor on negotiation_activity(anchor_id);

-- ─── LinkedIn Messages (generated connection notes) ─────────────────────────
create table if not exists linkedin_messages (
  id              uuid primary key default uuid_generate_v4(),
  workflow_id     uuid not null references workflows(id) on delete cascade,
  author_id       uuid not null references authors(id) on delete cascade,
  template_id     uuid,
  body            text not null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (workflow_id, author_id)
);

-- ─── Email Send Config (per-workflow scheduling) ────────────────────────────
create table if not exists email_send_config (
  id              uuid primary key default uuid_generate_v4(),
  workflow_id     uuid not null references workflows(id) on delete cascade unique,
  provider        text default 'smtp',
  timezone        text default 'America/New_York',
  send_hour_start integer default 9,
  send_hour_end   integer default 17,
  gap_minutes     integer default 15,
  daily_cap       integer default 50,
  created_at      timestamptz default now()
);

-- ─── User Email Config (per-user SMTP) ──────────────────────────────────────
create table if not exists user_email_config (
  user_email              text primary key,
  app_password_enc        text,
  from_name               text,
  timezone                text default 'America/New_York',
  send_hour_start         integer default 9,
  send_hour_end           integer default 17,
  gap_minutes             integer default 15,
  daily_cap               integer default 50,
  shared_sender_label     text,
  shared_sender_enabled   boolean default false,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

-- ─── Inbox State (per-user read/dismiss) ────────────────────────────────────
create table if not exists inbox_state (
  id              uuid primary key default uuid_generate_v4(),
  user_email      text not null,
  author_id       uuid not null references authors(id) on delete cascade,
  last_seen_at    timestamptz,
  last_reply_at   timestamptz,
  dismissed       boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (user_email, author_id)
);
create index if not exists idx_is_user on inbox_state(user_email);

-- ─── Author Watches ─────────────────────────────────────────────────────────
create table if not exists author_watches (
  id                uuid primary key default uuid_generate_v4(),
  user_email        text not null,
  author_id         uuid not null references authors(id) on delete cascade,
  last_checked_at   timestamptz,
  created_at        timestamptz default now(),
  unique (user_email, author_id)
);
create index if not exists idx_aw_user on author_watches(user_email);
create index if not exists idx_aw_author on author_watches(author_id);

-- ─── Author Watch Notifications ─────────────────────────────────────────────
create table if not exists author_watch_notifications (
  id              uuid primary key default uuid_generate_v4(),
  user_email      text not null,
  author_id       uuid not null references authors(id) on delete cascade,
  article_id      uuid references articles(id) on delete cascade,
  read_at         timestamptz,
  emailed_at      timestamptz,
  created_at      timestamptz default now(),
  unique (user_email, article_id)
);
create index if not exists idx_awn_user on author_watch_notifications(user_email);

-- ─── Flagged Content (content safety screening) ─────────────────────────────
create table if not exists flagged_content (
  id              uuid primary key default uuid_generate_v4(),
  author_id       uuid not null references authors(id) on delete cascade,
  article_id      uuid not null references articles(id) on delete cascade,
  category        text not null,
  severity        text not null,
  reason          text,
  created_at      timestamptz default now(),
  unique (article_id)
);

-- ─── Enrichment Runs ────────────────────────────────────────────────────────
create table if not exists enrichment_runs (
  id              uuid primary key default uuid_generate_v4(),
  campaign_id     text,
  campaign_name   text,
  total           integer default 0,
  done            integer default 0,
  found           integer default 0,
  by_source       jsonb default '{}',
  people          jsonb default '[]',
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz default now()
);

-- ─── Backlink Prospects ─────────────────────────────────────────────────────
create table if not exists backlink_prospects (
  id                    uuid primary key default uuid_generate_v4(),
  backlink_campaign_id  uuid,
  domain                text,
  prospect_url          text,
  stage                 text default 'discovered',
  outreach_email_id     uuid references outreach_emails(id) on delete set null,
  link_live_at          timestamptz,
  notes                 jsonb default '{}',
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);
create index if not exists idx_bp_campaign on backlink_prospects(backlink_campaign_id);

-- ─── Internal Link Opportunities ────────────────────────────────────────────
create table if not exists internal_link_opportunities (
  id              uuid primary key default uuid_generate_v4(),
  source_path     text not null,
  target_path     text not null,
  source_url      text,
  source_title    text,
  target_title    text,
  anchor          text,
  placement       text,
  sentence        text,
  draft_sentence  text,
  score           numeric(5,2) default 0,
  shared_terms    jsonb default '[]',
  status          text default 'open',            -- open | actioned | dismissed
  ticket_url      text,
  first_seen_at   timestamptz default now(),
  last_seen_at    timestamptz default now(),
  created_at      timestamptz default now(),
  unique (source_path, target_path)
);
create index if not exists idx_ilo_status on internal_link_opportunities(status);
create index if not exists idx_ilo_target on internal_link_opportunities(target_path);

-- ─── Seed category column on seed_tools ──────────────────────────────────────
alter table seed_tools add column if not exists category text default 'competitor';

-- ─── RLS Policies ───────────────────────────────────────────────────────────
-- Grant full access to service_role, anon, and authenticated on all new tables.
-- This matches the pattern needed for Supabase local dev (service_role bypasses RLS,
-- anon/authenticated get explicit access).

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'campaigns', 'campaign_prospects', 'campaign_authors',
      'workflows', 'workflow_prospects',
      'outreach_emails', 'deals', 'budget_ledger',
      'interventions', 'agent_runs', 'agent_events',
      'idempotency_keys', 'email_templates', 'user_email_config',
      'negotiation_settings', 'negotiation_activity',
      'linkedin_messages', 'email_send_config',
      'inbox_state', 'author_watches', 'author_watch_notifications',
      'flagged_content', 'enrichment_runs',
      'backlink_prospects', 'internal_link_opportunities'
    ])
  LOOP
    -- Enable RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    -- service_role: full access (bypasses RLS anyway, but explicit is clear)
    EXECUTE format(
      'CREATE POLICY IF NOT EXISTS "%s_service_all" ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t, t
    );
    -- anon: full access (local dev / demo mode)
    EXECUTE format(
      'CREATE POLICY IF NOT EXISTS "%s_anon_all" ON %I FOR ALL TO anon USING (true) WITH CHECK (true)',
      t, t
    );
    -- authenticated: full access
    EXECUTE format(
      'CREATE POLICY IF NOT EXISTS "%s_auth_all" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t, t
    );
  END LOOP;
END $$;
