// Run: node scripts/043_blog_editor_sync.mjs
//
// Rebuilds the blog composer's save/publish model on three verified facts that the original
// scripts/035_blog_drafts.mjs got wrong (its header comment has been corrected too):
//
//   1. Draft & Publish IS ENABLED on Strapi's `resources` type. Verified live:
//      filters[publishedAt][$null] returns HTTP 200 (a fake field returns 400), so publishedAt
//      is a real field — null = draft, timestamp = live. Real Strapi drafts ARE possible, which
//      is why we now track sync separately from publish.
//   2. `thumbnail` is media + REQUIRED on that content type (from the content-type-builder API),
//      and it existed nowhere in our stack — no column, not in mapDraftToStrapi, not in
//      publishReadiness. Publish could never have succeeded. Hence thumbnail_media_id/url.
//   3. blog_drafts had NO row level security, and the public anon key (which ships in the
//      browser bundle) could read it — verified with a live PostgREST select. 035 landed after
//      scripts/024_enable_rls.mjs, so it was never in that allowlist. Fixed at the bottom.
//
// The save model this enables: autosave writes ONLY here and must always succeed even when
// required Strapi sections are blank. `rev` gives optimistic concurrency so two tabs can't
// silently clobber each other, and blog_draft_revisions means a save can always be recovered.
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

// ── blog_drafts: concurrency, the missing thumbnail, locale, and sync bookkeeping ──
// sync_state holds only the committed states; the "…_stale" variants are DERIVED in code from
// (rev !== synced_rev) so the DB and UI can never disagree about staleness.
await c.query(`
  ALTER TABLE blog_drafts
    ADD COLUMN IF NOT EXISTS rev                 integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS thumbnail_media_id  integer,
    ADD COLUMN IF NOT EXISTS thumbnail_media_url text,
    ADD COLUMN IF NOT EXISTS locale              text NOT NULL DEFAULT 'en',
    ADD COLUMN IF NOT EXISTS sync_state          text NOT NULL DEFAULT 'local_only',
    ADD COLUMN IF NOT EXISTS sync_error          text,
    ADD COLUMN IF NOT EXISTS sync_attempted_at   timestamptz,
    ADD COLUMN IF NOT EXISTS synced_at           timestamptz,
    ADD COLUMN IF NOT EXISTS synced_rev          integer,
    ADD COLUMN IF NOT EXISTS strapi_published_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_edited_by      text;
`);

// Backfill sync_state for any row that predates it. No-op on a fresh DB (nothing has ever
// reached Strapi — every existing row has strapi_id IS NULL), but keeps the migration correct
// if it's ever re-run against a database where publishing did happen.
await c.query(`
  UPDATE blog_drafts SET sync_state =
    CASE WHEN status = 'published' AND strapi_id IS NOT NULL THEN 'published'
         WHEN strapi_id IS NOT NULL THEN 'synced'
         ELSE 'local_only' END
  WHERE strapi_id IS NOT NULL AND sync_state = 'local_only';
`);

// Strapi's `slug` is a `uid` field: REQUIRED and globally unique, and uid uniqueness is NOT
// relaxed for drafts. Two rows auto-slugged from an empty title would both be '' and collide on
// the first sync, so give every row a distinct placeholder up front.
await c.query(`
  UPDATE blog_drafts
  SET slug = 'untitled-' || substr(md5(id::text), 1, 8)
  WHERE coalesce(slug, '') = '';
`);

// ── Revision snapshots: the literal "start off from that point" requirement ──
// Also the safety net behind conflict resolution: whichever branch loses a 409 is snapshotted
// here first, so no edit is ever silently discarded.
await c.query(`
  CREATE TABLE IF NOT EXISTS blog_draft_revisions (
    id         bigserial PRIMARY KEY,
    draft_id   uuid NOT NULL REFERENCES blog_drafts(id) ON DELETE CASCADE,
    rev        integer NOT NULL,
    -- autosave | manual | autofill | pre_conflict_overwrite | pre_sync | pre_publish | pre_restore
    reason     text NOT NULL DEFAULT 'autosave',
    snapshot   jsonb NOT NULL,          -- allow-listed editable fields only, never the whole row
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS blog_draft_revisions_draft_idx
    ON blog_draft_revisions (draft_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS blog_drafts_sync_state_idx
    ON blog_drafts (sync_state, updated_at DESC);
`);

// ── RLS (see fact 3 above) ──
// Same reasoning as scripts/024_enable_rls.mjs: enable, add NO policies, do NOT set FORCE.
// supabaseAdmin uses the service role and the migration scripts connect as the table owner, so
// both continue to bypass RLS — nothing in the app changes. The anon key loses PostgREST access.
for (const t of ["blog_drafts", "blog_draft_revisions"]) {
  const { rows } = await c.query(
    `SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || $1)::regclass`, [t]
  );
  if (rows[0]?.relrowsecurity) { console.log(`  (RLS already on: ${t})`); continue; }
  await c.query(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`);
  console.log(`  ✓ RLS enabled: ${t}`);
}

const { rows: n } = await c.query(`SELECT count(*)::int AS c FROM blog_drafts`);
console.log(`043 done: blog_drafts extended (${n[0].c} rows), blog_draft_revisions created, RLS on.`);
await c.end();
