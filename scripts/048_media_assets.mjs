// The platform image gallery: every asset we generate or upload, in one place.
//
// Why its own table rather than Strapi's media library (the alternative we weighed):
//   - Generation produces rejects. Four variants per prompt, one gets used. Pushing all four into
//     Strapi fills the CMS library with garbage that editors then have to scroll past forever.
//   - The gallery has to be fast and filterable by things Strapi does not model: which prompt made
//     this, which model, which draft it was made for, what it is FOR (hero / og / inline / thumbnail).
//   - An asset only reaches Strapi when it is actually placed in a draft, at which point it earns its
//     place in the library. `strapi_media_id` records that promotion so it happens at most once.
//
// The provider is deliberately not in the schema's assumptions: `provider` + `model` are plain text,
// so fal, an OpenAI image model, or a hand upload all live in the same table and the gallery does not
// care which made what.
import * as dotenv from "dotenv";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

await c.query(`
  CREATE TABLE IF NOT EXISTS media_assets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Where the bytes live. "url" is what gets embedded in markdown; it is our own CDN copy, never
    -- the provider's temporary output URL (fal's outputs expire, and a link that 404s three weeks
    -- after publishing is worse than no image).
    url             text NOT NULL,
    storage_key     text,                      -- object key in our bucket, for deletion
    width           int,
    height          int,
    bytes           int,
    mime            text,

    -- Provenance. "prompt" is the FINAL prompt sent to the model, after any rewriting, because that
    -- is the thing worth reusing when an image comes out well.
    source          text NOT NULL DEFAULT 'generated',   -- generated | uploaded | url_import
    provider        text,                                 -- fal | openai | …
    model           text,                                 -- the exact model id
    prompt          text,
    revised_prompt  text,                                 -- if an LLM rewrote the user's prompt
    seed            bigint,
    params          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- the full request, for exact reproduction

    -- What it is for. Drives the size preset and the SEO treatment: an OG card is 1200x630 and may
    -- carry text, an inline body image is wide and must not, a thumbnail is square-ish.
    role            text NOT NULL DEFAULT 'inline',       -- hero | og | inline | thumbnail | landing
    alt             text,                                 -- required before it can be placed
    caption         text,

    -- Optional link back to what it was made for, so "regenerate the hero for this post" is possible
    -- and so the gallery can be filtered to one piece of work.
    draft_id        uuid REFERENCES blog_drafts(id) ON DELETE SET NULL,
    cluster_id      uuid,

    -- Promotion into the CMS, recorded so it happens at most once per asset.
    strapi_media_id int,
    strapi_url      text,

    -- Soft delete: a hidden asset may still be referenced by a published article's markdown, so the
    -- row must survive being removed from the gallery.
    archived        boolean NOT NULL DEFAULT false,

    created_by      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS media_assets_recent_idx   ON media_assets (created_at DESC) WHERE NOT archived;
  CREATE INDEX IF NOT EXISTS media_assets_draft_idx    ON media_assets (draft_id) WHERE draft_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS media_assets_role_idx     ON media_assets (role);
  -- The same URL must not appear twice: a re-import of an already-hosted image should find the
  -- existing row rather than duplicate it.
  CREATE UNIQUE INDEX IF NOT EXISTS media_assets_url_idx ON media_assets (url);

  -- One row per generation attempt, including failures. A content-policy refusal is information
  -- (that prompt shape does not work) and silently dropping it means rediscovering it repeatedly.
  CREATE TABLE IF NOT EXISTS media_generations (
    id           bigserial PRIMARY KEY,
    asset_id     uuid REFERENCES media_assets(id) ON DELETE SET NULL,
    provider     text NOT NULL,
    model        text NOT NULL,
    prompt       text NOT NULL,
    role         text,
    ok           boolean NOT NULL DEFAULT true,
    error        text,
    ms           int,
    est_cost_usd numeric(10, 5),
    created_by   text,
    created_at   timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS media_generations_recent_idx ON media_generations (created_at DESC);
`);

// Same posture as scripts/024_enable_rls.mjs and 047: enable, no policies. Service role and owner
// bypass RLS, so the app and these scripts are unaffected; the public anon key that ships in the
// browser bundle gets nothing.
await c.query(`ALTER TABLE media_assets      ENABLE ROW LEVEL SECURITY;`);
await c.query(`ALTER TABLE media_generations ENABLE ROW LEVEL SECURITY;`);

const { rows } = await c.query(`
  SELECT (SELECT count(*) FROM media_assets) AS assets,
         (SELECT count(*) FROM media_generations) AS gens
`);
console.log(`048 ok — media_assets: ${rows[0].assets} rows, media_generations: ${rows[0].gens} rows`);
await c.end();
