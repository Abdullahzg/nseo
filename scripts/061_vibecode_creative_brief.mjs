// Landing pages: give the vibe-coded (original design) path its own creative input.
//
// The gap this closes: the "campaign" path (migration 057) has reference_url + destination_url +
// product_name — everything the campaign-landing-page skill needs. The "vibe_coded" path had NOTHING of
// its own. skillHandoff() embedded whatever `brief` the page already carried from its research stage
// (keyword, angle) and called it done, so an operator choosing "an original design, not a clone" had no
// way to hand over the one thing that pipeline actually runs on: a creative prompt, and optionally
// reference images for the imagine-image-assets skill to match a look against.
//
// Two columns, mirroring how 057 gave the campaign path its own shape rather than overloading `brief`:
//
//   creative_prompt       The free-text creative direction — tone, signature moment, what to avoid.
//   reference_image_urls  Optional. Already-uploaded media URLs (via /api/blog/upload, which is generic
//                         and unrelated to blog_drafts) the vibe-coding session should look at before
//                         picking a direction. jsonb array of strings, same storage shape as sitemap_links
//                         uses for its own array-of-structured-data column.
import * as dotenv from "dotenv";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS creative_prompt text`);
await c.query(`ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS reference_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb`);

console.log("landing_pages: creative_prompt + reference_image_urls added.");
await c.end();
