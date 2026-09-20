-- Nseo — the complete schema for the campaign flow. One file, applied with `supabase db reset`
-- locally or `supabase db push` to a hosted project. Nothing here is historical.
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ─── Identity graph (publications, editors, addresses) ─────────────────────────
create table domains (
  id uuid primary key default gen_random_uuid(),
  host text not null unique,
  name text,
  dr numeric(5,2),
  dr_checked_at timestamptz,
  metrics_source text,
  organic_traffic integer,
  us_traffic_share numeric(5,2),
  country text,
  last_seen timestamptz default now(),
  created_at timestamptz default now()
);

create table authors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  primary_domain_id uuid references domains(id) on delete set null,
  source text,
  timezone text,
  discarded boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (full_name, primary_domain_id)
);

create table articles (
  id uuid primary key default gen_random_uuid(),
  url_canonical text not null unique,
  title text,
  domain_id uuid references domains(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table article_authors (
  article_id uuid not null references articles(id) on delete cascade,
  author_id uuid not null references authors(id) on delete cascade,
  primary key (article_id, author_id)
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references authors(id) on delete cascade,
  type text not null,                         -- mailto | linkedin | twitter | form | author_page
  value text not null,
  confidence numeric(4,3),
  source text,
  created_at timestamptz default now(),
  unique (author_id, type, value)
);

create table suppression (
  id uuid primary key default gen_random_uuid(),
  type text not null,                         -- domain | author | email
  value text not null unique,
  reason text,
  created_at timestamptz default now()
);

-- ─── Campaigns ────────────────────────────────────────────────────────────────
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_email text,
  guest_id text,
  name text not null,
  website_url text,
  what_you_sell text,
  keywords jsonb not null default '[]',
  desired_deals integer not null default 2,
  budget_total numeric(12,2) not null default 0,
  budget_used numeric(12,2) not null default 0,
  max_per_deal numeric(10,2),
  min_dr integer not null default 50,
  currency text not null default 'USD',
  demo_mode boolean not null default true,
  phase text not null default 'draft',        -- draft | planning | discovering | qualifying | resolving_contacts | outreaching | monitoring | completed | stopped | failed
  completion_reason text,
  paused boolean not null default false,
  paused_reason text,
  paused_kind text,                           -- budget | nebius | cap | user
  tick_count integer not null default 0,
  ticks_today integer not null default 0,
  ticks_day text,
  last_tick_at timestamptz,
  next_tick_after timestamptz,
  tick_lock_until timestamptz,
  ultra_calls integer not null default 0,
  plan_text text,
  seed_contacts jsonb not null default '[]',      -- [{url, email?}] publications the owner already knows
  search_web boolean not null default true,        -- false: contact only the seeded publications, never search
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz,
  -- STRUCTURAL guest wall: a guest campaign cannot be a real one, whatever the code says.
  constraint guest_campaigns_are_demo check (guest_id is null or demo_mode = true)
);
create index idx_campaigns_owner on campaigns(owner_email);
create index idx_campaigns_guest on campaigns(guest_id);
create index idx_campaigns_due on campaigns(phase, paused, next_tick_after);

create table campaign_prospects (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  author_id uuid references authors(id) on delete set null,
  domain_host text not null,
  prospect_url text,
  title text,
  provenance jsonb not null default '{}',
  status text not null default 'discovered',  -- discovered | qualified | rejected | resolving_contact | ready | outreached | replied | negotiating | deal | lost | escalated
  opportunity_score numeric(5,2),
  score_basis text,                           -- full | relevance_only
  score_breakdown jsonb,
  qualification jsonb,
  ceiling numeric(10,2),
  contact_email text,
  contact_name text,
  contact_source text,
  contact_confidence numeric(5,2),
  contact_attempts integer not null default 0,
  demo_persona text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (campaign_id, domain_host)
);
create index idx_cp_campaign_status on campaign_prospects(campaign_id, status);

create table workflows (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  name text not null,
  status text not null default 'ready',
  created_at timestamptz default now()
);

-- ─── Email threads ────────────────────────────────────────────────────────────
create table outreach_emails (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid references workflows(id) on delete set null,
  campaign_id uuid references campaigns(id) on delete cascade,
  author_id uuid references authors(id) on delete set null,
  prospect_id uuid references campaign_prospects(id) on delete set null,
  parent_id uuid references outreach_emails(id) on delete set null,
  kind text not null default 'initial',       -- initial | followup | negotiation
  subject text,
  body text,
  to_email text,
  sender_email text,
  sent_by_email text,
  status text not null default 'draft',       -- draft | ready | scheduled | sent | failed
  scheduled_at timestamptz,
  sent_at timestamptz,
  message_id text,
  error text,
  simulated boolean not null default false,
  ai_managed boolean not null default true,
  followup_skipped boolean not null default false,
  success_at timestamptz,
  opened_at timestamptz,
  bounced_at timestamptz,
  replied_at timestamptz,
  reply_checked_at timestamptz,
  reply_kind text,                            -- reply | bounce | auto
  reply_from text,
  reply_subject text,
  reply_excerpt text,
  reply_sentiment text,
  reply_intent text,
  reply_price numeric(10,2),
  original_ask numeric(10,2),
  max_offer numeric(10,2),
  agreed_price numeric(10,2),
  negotiation_status text,                    -- negotiating | agreed | declined | needs_human | stalled | handoff | withdrawn (campaign finished)
  intervention_type text,
  intervention_ask text,
  intervention_reason text,
  intervention_at timestamptz,
  created_at timestamptz default now()
);
create index idx_oe_campaign on outreach_emails(campaign_id);
create index idx_oe_parent on outreach_emails(parent_id);
create index idx_oe_scheduled on outreach_emails(scheduled_at) where status = 'scheduled';
create index idx_oe_author on outreach_emails(author_id);

-- STRUCTURAL guest wall #2: nothing on a guest/demo campaign can ever be queued for real sending.
create or replace function block_real_send_on_demo() returns trigger language plpgsql as $$
declare is_demo boolean; has_guest boolean;
begin
  if new.status = 'scheduled' and new.campaign_id is not null then
    select demo_mode, guest_id is not null into is_demo, has_guest from campaigns where id = new.campaign_id;
    if coalesce(is_demo, false) or coalesce(has_guest, false) then
      raise exception 'demo/guest campaigns cannot schedule real email (campaign %)', new.campaign_id;
    end if;
  end if;
  return new;
end $$;
create trigger trg_block_real_send_on_demo before insert or update of status on outreach_emails
  for each row execute function block_real_send_on_demo();

-- ─── Outcomes ─────────────────────────────────────────────────────────────────
create table deals (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  anchor_email_id uuid references outreach_emails(id) on delete set null,
  author_id uuid references authors(id) on delete set null,
  domain_host text,
  publication text,
  terms jsonb not null default '{}',
  original_ask numeric(10,2),
  agreed_price numeric(10,2),
  currency text not null default 'USD',
  status text not null default 'terms_agreed', -- terms_agreed | awaiting_content | placement_pending | live | closed | cancelled
  agreed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index idx_deals_campaign on deals(campaign_id);

create table budget_ledger (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  deal_id uuid references deals(id) on delete set null,
  entry_type text not null,                   -- commit | release | adjust
  amount numeric(12,2) not null,
  currency text not null default 'USD',
  note text,
  created_at timestamptz default now()
);

create table interventions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  anchor_email_id uuid references outreach_emails(id) on delete set null,
  prospect_id uuid references campaign_prospects(id) on delete set null,
  type text not null,
  editor_quote text,
  agent_plan text,
  agent_needs text,
  assistable boolean not null default true,
  status text not null default 'open',        -- open | resolved | dismissed | taken_over
  answer text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz default now()
);
create index idx_iv_campaign_status on interventions(campaign_id, status);

-- ─── Activity feed ────────────────────────────────────────────────────────────
create table agent_events (
  id bigserial primary key,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  agent text not null,
  action text not null,
  human text not null,
  engine text not null,                       -- model | policy | fixture | system
  level text not null default 'info',
  prospect_id uuid,
  thread_id uuid,
  detail jsonb not null default '{}',
  model text,
  tokens_in integer,
  tokens_out integer,
  latency_ms integer,
  reasoning text,
  cost_usd numeric(10,6),
  event_key text,
  created_at timestamptz default now()
);
create index idx_ae_campaign_id on agent_events(campaign_id, id desc);
create unique index idx_ae_event_key on agent_events(event_key) where event_key is not null;

-- ─── Settings & state ─────────────────────────────────────────────────────────
create table negotiation_settings (
  id boolean primary key default true,
  ai_autonomy boolean default true,
  handbook text,
  tone text,
  aggressiveness text default 'firm',
  opening_percent numeric(5,2) default 20,
  style_rules text,
  max_thread_length integer default 4,
  max_placement_price numeric(10,2) default 250,
  target_placement_price numeric(10,2) default 150,
  campaign_budget numeric(12,2) default 1000,
  auto_accept_below numeric(10,2) default 150,
  human_approval_above numeric(10,2) default 200,
  absolute_max_price numeric(10,2) default 300,
  min_price numeric(10,2) default 0,
  currency text default 'USD',
  anti_highball text,
  pricing_rules jsonb default '[{"min_dr":50,"max_offer":250,"label":"DR 50+"}]',
  updated_at timestamptz default now()
);
insert into negotiation_settings (id) values (true);

create table negotiation_activity (
  id uuid primary key default gen_random_uuid(),
  anchor_id uuid not null references outreach_emails(id) on delete cascade,
  actor text not null,
  action text not null,
  detail text,
  author_id uuid,
  created_at timestamptz default now()
);

-- Per-owner settings. Keys are the owner's own (bring-your-own-key), encrypted with AUTH_SECRET.
create table user_email_config (
  user_email text primary key,
  app_password_enc text,
  nebius_api_key_enc text,
  tavily_api_key_enc text,
  from_name text,
  timezone text default 'America/New_York',
  send_hour_start integer default 9,
  send_hour_end integer default 17,
  gap_minutes integer default 15,
  daily_cap integer default 50,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table app_state (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz default now()
);

-- ─── Atomic helpers ───────────────────────────────────────────────────────────
-- Budget commit that can never overspend under concurrency.
create or replace function commit_budget(p_campaign uuid, p_amount numeric) returns boolean language plpgsql as $$
declare n integer;
begin
  update campaigns set budget_used = budget_used + p_amount, updated_at = now()
   where id = p_campaign and budget_used + p_amount <= budget_total;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- One tick at a time per campaign.
create or replace function acquire_tick_lock(p_campaign uuid, p_seconds integer) returns boolean language plpgsql as $$
declare n integer;
begin
  update campaigns set tick_lock_until = now() + make_interval(secs => p_seconds)
   where id = p_campaign and (tick_lock_until is null or tick_lock_until < now());
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Global daily token counter.
create or replace function add_tokens(p_key text, p_n integer) returns bigint language plpgsql as $$
declare total bigint;
begin
  insert into app_state (key, value) values (p_key, jsonb_build_object('total', p_n))
    on conflict (key) do update set value = jsonb_build_object('total', (coalesce((app_state.value->>'total')::bigint, 0) + p_n)), updated_at = now()
    returning (value->>'total')::bigint into total;
  return total;
end $$;

-- ─── Access ───────────────────────────────────────────────────────────────────
-- The app only ever uses the service role. Lock everything else out.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "%s_service" on %I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;
