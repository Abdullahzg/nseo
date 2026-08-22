// Teach every voice the ```CTA fenced-block convention and seed the one real, team-approved example.
//
// The gap: renderVoiceSystem() and validateArticle() were both updated in the same change that adds this
// migration to understand a ```CTA fence — a fenced code block containing {"text", "url"} JSON that the
// blog frontend renders as an inline CTA button, distinct from the single required Strapi hero CTA. But
// the writer was never told the target url has to come from `sitemap_links`, which meant a body CTA had no
// real destination to point at that carried pre-approved button copy — every `cta_text` was the model's
// own invention, unreviewed by whoever actually owns that copy.
//
// This adds `cta_text` to sitemap_links entries (additive — voiceSitemap() already tolerates unknown keys,
// so this is backward compatible with every existing entry) and seeds exactly one: the Fashion Studio CTA
// handed over directly, verbatim. Not inventing additional ones for other pages — cta_text represents copy
// someone has actually signed off on, and only this one has been.
//
// Also adds the /ai-fashion-studio page itself to the sitemap. It was missing entirely (confirmed: no
// "fashion-studio" match anywhere in the seed list from migration 044) despite Fashion Studio being one of
// the platform's most concentrated B2B products (~65% paid, per the verified GTM data) — so the writer
// could never have linked or CTA'd to it without link_provenance flagging the URL as fabricated.
//
// Union-safe and idempotent like 051/052: merges by url, only touches the one row that matches, and only
// bumps prompt_revision when the merged content actually differs from what's stored.
import * as dotenv from "dotenv";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

const FASHION_STUDIO = {
  url: "https://www.imagine.art/ai-fashion-studio",
  category: "Core product",
  description: "Fashion Studio : saved AI fashion models, catalog and editorial photoshoots, image and video",
  cta_text: "Generate Background For Fashion Videos",
};

const { rows: voices } = await c.query(
  `SELECT id, slug, sitemap_links, prompt_revision FROM writer_voices`);

for (const v of voices) {
  const links = Array.isArray(v.sitemap_links) ? v.sitemap_links : [];
  const idx = links.findIndex((l) => l && String(l.url) === FASHION_STUDIO.url);
  const merged = idx === -1
    ? [...links, FASHION_STUDIO]
    : links.map((l, i) => (i === idx ? { ...l, ...FASHION_STUDIO } : l));

  const changed = JSON.stringify(merged) !== JSON.stringify(links);

  await c.query(
    `UPDATE writer_voices
        SET sitemap_links = $2::jsonb,
            prompt_revision = prompt_revision + CASE WHEN $3 THEN 1 ELSE 0 END
      WHERE id = $1`,
    [v.id, JSON.stringify(merged), changed]);

  console.log(
    `${v.slug.padEnd(20)} links ${String(links.length).padStart(2)} -> ${String(merged.length).padStart(2)}` +
    `   ${changed ? `prompt_revision -> ${v.prompt_revision + 1}` : "unchanged"}`);
}

await c.end();
