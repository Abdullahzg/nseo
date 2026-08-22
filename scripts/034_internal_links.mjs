// Run: node scripts/034_internal_links.mjs
// Persisted backlog for the Internal Linking agent's whole-site sweep. Each row is one grounded
// opportunity ("from source_path, link to target_path with this anchor"), deduped on
// (source_path, target_path) so nightly re-sweeps UPDATE rather than pile up — and so we can
// surface only NEW opportunities (first_seen_at) and remember which you've actioned/dismissed.
// The unique index is a PLAIN column pair (no partial predicate) so supabase-js upserts cleanly.
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
await c.query(`
  CREATE TABLE IF NOT EXISTS internal_link_opportunities (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_path    text NOT NULL,
    target_path    text NOT NULL,
    source_url     text NOT NULL,
    source_title   text,
    target_title   text,
    anchor         text NOT NULL,
    -- linkify (anchor is verbatim on the page) | new_sentence (draft_sentence must be added)
    placement      text NOT NULL DEFAULT 'linkify',
    sentence       text,
    draft_sentence text,
    score          numeric,
    shared_terms   text[],
    -- open (fresh backlog) | actioned (link added / ticket made) | dismissed (not worth it)
    status         text NOT NULL DEFAULT 'open',
    ticket_url     text,
    first_seen_at  timestamptz NOT NULL DEFAULT now(),
    last_seen_at   timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS internal_link_opps_uniq ON internal_link_opportunities (source_path, target_path);
  CREATE INDEX IF NOT EXISTS internal_link_opps_status_idx ON internal_link_opportunities (status, score DESC);
  CREATE INDEX IF NOT EXISTS internal_link_opps_target_idx ON internal_link_opportunities (target_path);
`);
console.log("034 done — internal_link_opportunities."); await c.end();
