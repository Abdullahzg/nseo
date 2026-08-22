// Do the images in our drafts actually load?
//
// The live preview will show a broken image honestly, but a broken image on a published SEO page is
// expensive, so it is worth knowing across every draft at once rather than one at a time. Pulls
// every markdown image URL out of every draft body and HEADs it.
//
//   npx tsx scripts/blog_image_check.mjs
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const { supabaseAdmin } = await import("../src/lib/db/supabase.ts");

const { data: drafts, error } = await supabaseAdmin
  .from("blog_drafts")
  .select("id, title, slug, body, cover_media_url, thumbnail_media_url")
  .order("updated_at", { ascending: false });
if (error) { console.error(error.message); process.exit(1); }

const IMG = /!\[[^\]]*\]\(([^)\s]+)/g;
let checked = 0, broken = 0;

for (const d of drafts ?? []) {
  const urls = new Set();
  for (const m of String(d.body ?? "").matchAll(IMG)) urls.add(m[1]);
  if (d.cover_media_url) urls.add(d.cover_media_url);
  if (d.thumbnail_media_url) urls.add(d.thumbnail_media_url);
  if (!urls.size) continue;

  console.log(`\n${d.title || "(untitled)"}  [${d.slug}]`);
  for (const u of urls) {
    if (!/^https?:\/\//i.test(u)) { console.log(`  ? ${u}  (not an absolute URL)`); continue; }
    checked++;
    try {
      // Some CDNs reject HEAD, so fall back to a ranged GET rather than reporting a false failure.
      let res = await fetch(u, { method: "HEAD", redirect: "follow" });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(u, { headers: { range: "bytes=0-0" }, redirect: "follow" });
      }
      const type = res.headers.get("content-type") ?? "";
      const good = res.ok && type.startsWith("image/");
      if (!good) broken++;
      console.log(`  ${good ? "✓" : "✗"} HTTP ${res.status} ${type || "(no type)"}  ${u.slice(0, 110)}`);
    } catch (e) {
      broken++;
      console.log(`  ✗ ${e?.message ?? "fetch failed"}  ${u.slice(0, 110)}`);
    }
  }
}

console.log(`\n${checked} image URLs checked, ${broken} not loading as images`);
