// Landing pages: the campaign path — a page cloned from a competitor reference for a paid campaign.
//
// This is a genuinely third kind of landing page, not a variant of the other two, and collapsing it into
// either would lose the fields that make it buildable:
//
//   existing template  → Strapi cluster-page, content editable in the CMS, lives on imagine.art
//   vibe-coded feature → own design, static export on R2, optionally templatized into Strapi later
//   campaign clone     → a competitor page's STRUCTURE in the Imagine kit, its own repo, its own
//                        Vercel deployment, every CTA pointed at one live imagine.art surface
//
// Four inputs are mandatory for the campaign path and have no equivalent on the others, which is the
// clearest evidence it is its own shape: the reference being cloned, the destination every CTA points at,
// the product wordmark in the nav, and the repo/Vercel project name.
//
// The destination one carries a trap worth recording in the schema comment because it has already cost a
// full research cycle: imagine.art is an SPA that returns HTTP 200 for EVERY path under /computer/agent/*,
// including invented ones. A status check therefore proves nothing, and a page was built for a surface
// that had not shipped. The destination has to be confirmed by rendering it and looking at it, which is
// why `destination_verified_at` records a human's confirmation rather than an automated probe.
import * as dotenv from "dotenv";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

// The competitor page whose structure and palette get cloned.
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS reference_url text`);
// The one live imagine.art surface every CTA links to. No query string, ever — see the skill's rule 1.
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS destination_url text`);
// Set only when a person has RENDERED the destination and looked at it. Deliberately not an automated
// check: a 200 from this SPA is meaningless.
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS destination_verified_at timestamptz`);
// The nav sub-wordmark beside "ImagineArt" — e.g. "Sheets".
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS product_name text`);
// Repo and Vercel project share one name by convention: ai-<product>-<reference>.
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS repo_name text`);
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS deployed_url text`);

// Marketing sign-off. A campaign clone reproduces someone else's marketing structure, and the claim-safety
// pass produces TODO(marketing) items that a person must clear before the page runs as an ad. Recording it
// here is what separates "built" from "cleared to spend money against".
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS marketing_cleared_at timestamptz`);
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS marketing_cleared_by text`);

// One landing page per repo. Two rows pointing at one repo would mean two people believing they own the
// same deployment. Partial so the many rows with no repo do not collide on NULL.
await c.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS landing_pages_repo_idx
  ON landing_pages (repo_name) WHERE repo_name IS NOT NULL`);

const { rows } = await c.query(`
  SELECT count(*)::int total,
         count(*) FILTER (WHERE template_source = 'campaign')::int campaigns,
         count(destination_verified_at)::int verified
    FROM landing_pages`);
console.log(`landing_pages: ${rows[0].total} rows, ${rows[0].campaigns} campaign clones, ${rows[0].verified} with a verified destination`);

await c.end();
