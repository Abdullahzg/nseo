// Landing pages: record WHICH template a page uses, and how that template came to exist.
//
// The stage model shipped in 049 is strictly linear — brief → vibe_coded → templatised → drafted →
// published — which encodes an assumption that every landing page needs a new template built for it.
// That is false for most pages. There are 24 templates already registered in Strapi's cluster-page
// dynamiczone; reusing one means there is no page to vibe-code and nothing to templatize, so those two
// stages are not "not done yet", they are *not applicable*. Without this column a reused-template page
// sits at `vibe_coded` looking like it is blocked on engineering work nobody needs to do.
//
// So the branch is explicit:
//
//   existing    → template already ships. Create the Strapi entry, go write copy.
//   vibe_coded  → design a new page (imagine-landing), port it to a Strapi template
//                 (vibe-coded-template), open a PR. Then write copy.
//
// Numbered 056, not 053: PR #9 is open with 053/054/055 on it. Reusing a number would collide on merge.
import * as dotenv from "dotenv";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

// 'existing' | 'vibe_coded'. NULL = the choice has not been made yet, which is a real state: a page can
// have a brief before anyone has decided whether it needs its own design.
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS template_source text`);

// The Strapi dynamiczone component string, e.g. 'vibe-coded-templates.ai-ad-studio-template'. Stored as
// the raw string rather than an id because that string IS the identifier Strapi and imagine-web both key
// on, and it is what a developer greps for.
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS strapi_template text`);

// The `category` enum value on the entry. Kept separately from the template because they are NOT the
// same thing and conflating them is the single most common cause of a wired template still 404ing: the
// dedicated route folders (/features/[slug], /imagine-computer/models/[slug]) gate on `category`
// equalling the value THAT route checks for, which is frequently not the template's own category.
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS strapi_category text`);

// The created cluster-page entry, so the app can deep-link an editor straight to it instead of asking
// them to find it in the admin.
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS strapi_entry_id integer`);
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS strapi_slug text`);
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS configured_at timestamptz`);

// The PR that adds a newly vibe-coded template to the codebase. Repo kept alongside the URL because the
// template lands across two repositories and which one this PR is against is not inferable from the URL
// pattern alone.
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS template_pr_url text`);
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS template_pr_repo text`);

// Which writer session seeded this page, when it started in the AI writer rather than being created by
// hand. Makes the two entry points distinguishable in the status board and in the adoption report.
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS origin text`);

// One entry per slug: two landing pages pointing at the same Strapi entry would let two people write
// competing copy into one page and each think they owned it. Partial, so the many rows with no entry yet
// do not collide with each other on NULL.
await c.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS landing_pages_strapi_entry_idx
  ON landing_pages (strapi_entry_id) WHERE strapi_entry_id IS NOT NULL`);

const { rows } = await c.query(`
  SELECT count(*)::int total,
         count(template_source)::int chosen,
         count(strapi_entry_id)::int configured
    FROM landing_pages`);
console.log(`landing_pages: ${rows[0].total} rows, ${rows[0].chosen} with a template choice, ${rows[0].configured} configured in Strapi`);

await c.end();
