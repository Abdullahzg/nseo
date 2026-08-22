// Record that a human reviewed an AI-drafted pitch.
//
// The nightly cron drafts backlink pitches as `ready` outreach_emails. Until now there was no surface to
// read them — a teammate reported "I cannot find the option to see / edit the pitches written by AI" — so
// the queue was unreviewable by design. The new pitch modal in /backlinks fixes the reading half; these
// two columns are what make the review auditable.
//
// The distinction they buy is the one that matters operationally: "AI wrote this and nobody looked" versus
// "a person read this and approved the wording". Without it, a reviewed pitch and an untouched one are
// indistinguishable, so nobody can tell what still needs attention.
import * as dotenv from "dotenv";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

await c.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS edited_at timestamptz`);
await c.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS edited_by text`);

const { rows } = await c.query(
  `SELECT count(*)::int total,
          count(*) FILTER (WHERE status = 'ready' AND sent_at IS NULL)::int awaiting_review,
          count(edited_at)::int reviewed
     FROM outreach_emails`);
console.log(`outreach_emails: ${rows[0].total} total, ${rows[0].awaiting_review} ready+unsent (reviewable), ${rows[0].reviewed} human-edited`);

await c.end();
