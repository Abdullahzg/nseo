// Run: node scripts/033_backlinks.mjs
// Backlink-outreach layer on top of the existing outreach system. A backlink campaign wraps a
// normal campaign + workflow + email template, all scoped to ONE target page we want links to.
// Each prospect references a real `authors` row (so enrichment / pitch-gen / sending / replies
// all reuse the existing machinery) and carries the backlink funnel state + target + angle.
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
await c.query(`
  CREATE TABLE IF NOT EXISTS backlink_campaigns (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id  uuid NOT NULL,
    workflow_id  uuid NOT NULL,
    template_id  uuid,
    target_url   text NOT NULL,
    target_path  text NOT NULL,
    topic        text,
    status       text NOT NULL DEFAULT 'active',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS backlink_campaigns_target_idx ON backlink_campaigns (target_path);

  CREATE TABLE IF NOT EXISTS backlink_prospects (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    backlink_campaign_id uuid NOT NULL REFERENCES backlink_campaigns(id) ON DELETE CASCADE,
    author_id           uuid NOT NULL,
    domain              text NOT NULL,
    prospect_url        text NOT NULL,
    angle               text,
    score               integer,
    -- funnel: found -> emailing (email being searched) -> ready (pitch drafted) -> sent -> replied -> won (link live) / lost
    stage               text NOT NULL DEFAULT 'found',
    outreach_email_id   uuid,
    link_live_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS backlink_prospects_uniq ON backlink_prospects (backlink_campaign_id, author_id);
  CREATE INDEX IF NOT EXISTS backlink_prospects_campaign_idx ON backlink_prospects (backlink_campaign_id);
  CREATE INDEX IF NOT EXISTS backlink_prospects_stage_idx ON backlink_prospects (backlink_campaign_id, stage);
`);
console.log("033 done — backlink_campaigns + backlink_prospects."); await c.end();
