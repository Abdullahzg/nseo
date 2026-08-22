// Usage events: the one adoption signal the rest of the schema cannot give us.
//
// Almost everything a CGO would want to know is already recorded somewhere — blog_drafts.created_by,
// outreach_emails.sent_by_email/replied_at/success_at, backlink_prospects.link_live_at,
// writer_clusters.done/failed. So the adoption report is built from those tables first, and it works
// retroactively: there is real history from July onward without waiting for new instrumentation.
//
// What that data CANNOT tell you is who opened a surface and did nothing. A person who logs in weekly,
// browses Clusters and never runs one is invisible to every outcome table, yet they are exactly the
// adoption story you need — an engaged user blocked on something. This table records those visits so
// "reach" can be separated from "output".
//
// Deliberately thin: one row per meaningful surface open, not per click. A click-level log on 22 pages
// would outgrow the useful signal within a week and turn every page into a write path.
import * as dotenv from "dotenv";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

await c.query(`
  CREATE TABLE IF NOT EXISTS usage_events (
    id          bigserial PRIMARY KEY,
    user_email  text NOT NULL,
    -- A coarse verb: "view" | "run" | "create" | "publish". Kept as text rather than an enum so adding
    -- a verb is a code change, not a migration plus a deploy ordering problem.
    action      text NOT NULL,
    -- The nav surface, matching the route ("/blog/clusters"), so this joins to the sidebar the user
    -- actually sees rather than to an internal module name.
    surface     text NOT NULL,
    entity_id   text,
    meta        jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
  )`);

// The report groups by (user, day) and by (surface, week); both indexes serve those directly.
await c.query(`CREATE INDEX IF NOT EXISTS usage_events_user_time_idx ON usage_events (user_email, created_at DESC)`);
await c.query(`CREATE INDEX IF NOT EXISTS usage_events_surface_time_idx ON usage_events (surface, created_at DESC)`);

// One row per user per surface per hour. Without this, leaving a tab open with a polling page turns a
// single visit into hundreds of rows and every "most used surface" number becomes a lie about
// refresh rates rather than about people.
//
// `AT TIME ZONE 'UTC'` is not decoration: date_trunc() over a timestamptz is only STABLE, because its
// result depends on the session TimeZone, and Postgres rejects a non-IMMUTABLE expression in an index.
// Pinning the zone first yields a plain timestamp, and date_trunc() over that IS immutable.
await c.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS usage_events_dedupe_idx
  ON usage_events (user_email, action, surface, date_trunc('hour', created_at AT TIME ZONE 'UTC'))
  WHERE action = 'view'`);

// RLS enabled with no policies, mirroring scripts/024_enable_rls.mjs: the service role and the table
// owner bypass it, so the app and these scripts are unaffected, while the public anon key that ships in
// the browser bundle cannot read who uses what.
await c.query(`ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY`);

const { rows } = await c.query(`SELECT count(*)::int n FROM usage_events`);
console.log(`usage_events ready (${rows[0].n} rows)`);
await c.end();
