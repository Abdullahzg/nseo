// Run: node scripts/000_core_bootstrap.mjs
//
// Fresh-database bootstrap for the CORE outreach tables that were created on the live
// production DB directly and never shipped as DDL (the QA report flagged this: a fresh
// Supabase project could not run migrations 004+ because `campaigns`, `workflows`,
// `outreach_emails` etc. did not exist yet — every later script ALTERs them).
//
// This script is IDEMPOTENT and safe on an existing DB (everything is IF NOT EXISTS).
// It reconstructs the six missing tables exactly as the app uses them today:
//   campaigns, workflows, campaign_authors, workflow_prospects, outreach_emails, email_templates
// Columns added by LATER scripts (033 negotiation, 036 payments, 040 intervention, ...)
// are intentionally NOT duplicated here — those scripts remain the source of truth and are
// all ADD COLUMN IF NOT EXISTS. Run order stays numeric: 000 → 001 → 004 → ... → 061.
//
// NOTE: no UNIQUE(workflow_id, author_id, kind) is recreated here. Migration 027 added it
// and 034 deliberately DROPPED it to allow multiple AI negotiation replies per thread.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  CREATE EXTENSION IF NOT EXISTS pg_trgm;

  -- ─── campaigns ──────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS campaigns (
    id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name             text NOT NULL,
    keywords         text[] NOT NULL DEFAULT '{}',
    region           text,
    target_hits      integer NOT NULL DEFAULT 2500,
    status           text NOT NULL DEFAULT 'draft',   -- draft | running | done
    seed_writer_name text,
    seed_article_url text,
    seed_domains     text[] NOT NULL DEFAULT '{}',
    seed_article_urls text[] NOT NULL DEFAULT '{}',
    created_at       timestamptz NOT NULL DEFAULT now()
  );

  -- ─── workflows ──────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS workflows (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
    name        text NOT NULL,
    filters     jsonb NOT NULL DEFAULT '{}',
    status      text NOT NULL DEFAULT 'draft',   -- draft | running | ready
    created_at  timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_workflows_campaign ON workflows(campaign_id);

  -- ─── campaign_authors (campaign ↔ author membership) ───────────────────────
  CREATE TABLE IF NOT EXISTS campaign_authors (
    campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    author_id   uuid NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, author_id)
  );

  -- ─── workflow_prospects (the ranked send list of a workflow) ────────────────
  CREATE TABLE IF NOT EXISTS workflow_prospects (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    author_id   uuid NOT NULL,
    included    boolean NOT NULL DEFAULT true,
    rank        integer,
    created_at  timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS workflow_prospects_wf_author_uniq
    ON workflow_prospects (workflow_id, author_id);

  -- ─── outreach_emails ────────────────────────────────────────────────────────
  -- Base columns only; negotiation/intervention/payment columns arrive via their own
  -- numbered migrations (033/036/038/040/055), which stay authoritative.
  CREATE TABLE IF NOT EXISTS outreach_emails (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id  uuid NOT NULL,
    author_id    uuid,
    template_id  uuid,
    subject      text,
    body         text,
    status       text NOT NULL DEFAULT 'draft',  -- draft | ready | scheduled | sent | failed
    scheduled_at timestamptz,
    sent_at      timestamptz,
    error        text,
    created_at   timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_outreach_due ON outreach_emails (status, scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_outreach_author ON outreach_emails (author_id);
  CREATE INDEX IF NOT EXISTS idx_outreach_workflow ON outreach_emails (workflow_id);

  -- ─── email_templates ────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS email_templates (
    id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       text NOT NULL,
    subject    text NOT NULL,
    body       text NOT NULL,
    guidance   text,
    channel    text NOT NULL DEFAULT 'email',    -- email | linkedin
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
`);

const { rows } = await client.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('campaigns','workflows','campaign_authors','workflow_prospects','outreach_emails','email_templates')
  ORDER BY table_name;
`);
console.log("core tables present:", rows.map((r) => r.table_name).join(", "));
console.log("000 done.");
await client.end();
