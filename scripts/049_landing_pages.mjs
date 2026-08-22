// Landing pages: the pipeline from "we want a page for X" to a published Strapi entry.
//
// The important thing this table encodes is that the middle of the flow does NOT happen in this app.
// Vibe-coding a page and templatising it into Strapi + imagine-web are two Claude skills run in a
// coding session against two other repos. This app cannot do that at runtime and pretending otherwise
// would produce a button that lies.
//
// So what lives here is the part the app CAN own: the grounded brief, the stage the page is at, and the
// handoff artifacts (the CDN URL a vibe-coded page ends up at, the Strapi component string a
// templatised one registers). Once a page reaches `templatised`, its CONTENT is written by the same AI
// writer and published through the same Strapi path as a blog post — which is why there is no separate
// publishing surface for landing pages.
import * as dotenv from "dotenv";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

await c.query(`
  CREATE TABLE IF NOT EXISTS landing_pages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What the page is for.
    feature         text NOT NULL,
    primary_keyword text,
    target_path     text,                 -- e.g. /ai-headshot-generator
    brief           jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- The grounding, captured at brief time so the decision is auditable later: GSC opportunity for
    -- the keyword, the canonical verdict, the internal links it should carry.
    research        jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- The stage machine. Deliberately linear: each step has a different owner and a different repo.
    --   brief        — captured here, grounded, ready to hand to the imagine-landing skill
    --   vibe_coded   — a static page exists on the R2 CDN (cdn_url set)
    --   templatised  — Strapi component + imagine-web template exist (strapi_component set)
    --   drafted      — a blog_drafts row holds the copy, written by the AI writer
    --   published    — live
    stage           text NOT NULL DEFAULT 'brief',

    -- Handoff artifacts. Each is set by the human after running the corresponding skill, because the
    -- skill runs outside this app and only the operator knows it succeeded.
    cdn_url          text,
    strapi_component text,
    draft_id         uuid REFERENCES blog_drafts(id) ON DELETE SET NULL,

    notes           text,
    created_by      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS landing_pages_stage_idx  ON landing_pages (stage);
  CREATE INDEX IF NOT EXISTS landing_pages_recent_idx ON landing_pages (created_at DESC);
`);

await c.query(`ALTER TABLE landing_pages ENABLE ROW LEVEL SECURITY;`);

const { rows } = await c.query(`SELECT count(*) AS n FROM landing_pages`);
console.log(`049 ok — landing_pages: ${rows[0].n} rows`);
await c.end();
