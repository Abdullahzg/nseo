// The site's own URL inventory, cached from sitemap.xml.
//
// Why cache something we can already fetch: `listMoneyPages()` (src/lib/indexing/discover.ts) parses
// the live sitemap on every call, and `useKnownPages()` calls it on mount of every page that has a
// URL picker. That is a 250KB fetch plus an XML parse per page view, serialised behind a 30s route.
// Caching it makes those pickers instant and lets us hold data the live parse throws away (lastmod,
// changefreq, priority) and query it by section.
//
// It also fixes a real blind spot. `isMoneyPage()` only matches /ai-image-generator,
// /ai-video-generator, /apps/* and /features/* — so of ~1,500 real URLs the pickers could only ever
// offer ~460, and the 747 /blogs/* pages were invisible. Those are exactly the pages a new blog post
// should be linking to.
import * as dotenv from "dotenv";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

await c.query(`
  CREATE TABLE IF NOT EXISTS site_urls (
    url         text PRIMARY KEY,
    path        text NOT NULL,
    -- First path segment ('' for the homepage): "blogs", "features", "apps", "compare"…
    -- Cheap grouping for pickers and for "link to a page in this section".
    section     text NOT NULL DEFAULT '',
    lastmod     date,
    changefreq  text,
    priority    real,
    -- Mirrors isMoneyPage() at sync time so a picker can prefer commercial pages without
    -- re-deriving the patterns client-side.
    is_money    boolean NOT NULL DEFAULT false,
    source      text NOT NULL DEFAULT 'sitemap',
    -- A URL dropped from the sitemap stops being refreshed rather than being deleted: keeping the
    -- row means a link that used to be valid can still be recognised, and staleness is a filter
    -- (last_seen) rather than an absence.
    first_seen  timestamptz NOT NULL DEFAULT now(),
    last_seen   timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS site_urls_section_idx  ON site_urls (section);
  CREATE INDEX IF NOT EXISTS site_urls_path_idx     ON site_urls (path);
  CREATE INDEX IF NOT EXISTS site_urls_lastseen_idx ON site_urls (last_seen DESC);

  -- One row per sync, so "when did this last refresh and did it shrink" is answerable. A sitemap
  -- that suddenly returns 12 URLs instead of 1,500 is a site problem worth seeing, not something to
  -- silently overwrite the inventory with.
  CREATE TABLE IF NOT EXISTS site_url_syncs (
    id          bigserial PRIMARY KEY,
    source_url  text NOT NULL,
    url_count   int NOT NULL,
    added       int NOT NULL DEFAULT 0,
    ok          boolean NOT NULL DEFAULT true,
    error       text,
    created_at  timestamptz NOT NULL DEFAULT now()
  );
`);

// Same posture as scripts/024_enable_rls.mjs: enable, no policies. The service role and the table
// owner bypass RLS, so the app and these scripts are unaffected, while the public anon key that
// ships in the browser bundle gets nothing.
await c.query(`ALTER TABLE site_urls      ENABLE ROW LEVEL SECURITY;`);
await c.query(`ALTER TABLE site_url_syncs ENABLE ROW LEVEL SECURITY;`);

const { rows } = await c.query(`
  SELECT
    (SELECT count(*) FROM site_urls)      AS urls,
    (SELECT count(*) FROM site_url_syncs) AS syncs
`);
console.log(`047 ok — site_urls: ${rows[0].urls} rows, site_url_syncs: ${rows[0].syncs} rows`);
await c.end();
