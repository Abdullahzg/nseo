// Run: node scripts/035_blog_drafts.mjs
// Local draft layer for the Strapi blog composer. Posts are authored and saved here first, so a
// save always succeeds even when Strapi's required fields are still blank.
//
// ⚠️ This header used to claim "the resources content type has Draft & Publish DISABLED — every
// create there goes live immediately, so drafts can't live in Strapi". That is FALSE and was the
// root cause of two bugs (a publish path that omitted publishedAt, and a missing required
// thumbnail field). Draft & Publish is ENABLED — verified live via
// filters[publishedAt][$null] returning 200 where an unknown field returns 400. Real Strapi
// drafts are possible and are now a distinct state; see scripts/043_blog_editor_sync.mjs.
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
await c.query(`
  CREATE TABLE IF NOT EXISTS blog_drafts (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title              text NOT NULL DEFAULT '',
    slug               text NOT NULL DEFAULT '',
    body               text NOT NULL DEFAULT '',       -- markdown
    description        text NOT NULL DEFAULT '',       -- meta description (Strapi min length applies at publish)
    tags               text,
    is_featured        boolean NOT NULL DEFAULT false,
    should_index       boolean NOT NULL DEFAULT true,
    canonical_tag       text,
    youtube_video_id   text,
    cover_media_id     integer,          -- Strapi media id (uploaded via /api/upload, works pre-publish)
    cover_media_url    text,
    author_id          integer,          -- Strapi authors.id
    category_id        integer,          -- Strapi resource-categories.id
    hero_cta_text      text,
    hero_cta_url       text,
    seo_title          text,
    seo_description    text,
    seo_keywords       text,
    -- draft (only here) | published (pushed to Strapi — strapi_id set)
    status             text NOT NULL DEFAULT 'draft',
    strapi_id          integer,
    strapi_url          text,
    created_by         text,             -- user email, for "who's editing what"
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    published_at       timestamptz
  );
  CREATE INDEX IF NOT EXISTS blog_drafts_status_idx ON blog_drafts (status, updated_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS blog_drafts_strapi_id_idx ON blog_drafts (strapi_id) WHERE strapi_id IS NOT NULL;
`);
console.log("035 done — blog_drafts."); await c.end();
