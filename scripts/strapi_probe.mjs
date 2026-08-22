// Run: node scripts/strapi_probe.mjs
// One-time discovery of the Strapi instance's schema, so the blog-publishing UI is built
// against REAL field names instead of guesses. Reads STRAPI_URL + STRAPI_API_TOKEN from
// .env.local. Sweeps candidate collection API IDs (with the token, the real ones return 200
// and wrong names 404), then dumps one entry's field names + detects the media/upload +
// publish-action support. Prints the value to set for STRAPI_BLOG_TYPE.
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const BASE = (process.env.STRAPI_URL || "").replace(/\/$/, "");
const TOKEN = process.env.STRAPI_API_TOKEN || "";
if (!BASE) { console.error("STRAPI_URL not set"); process.exit(1); }
if (!TOKEN) { console.error("STRAPI_API_TOKEN not set — paste your token into .env.local first."); process.exit(1); }

const H = { Authorization: `Bearer ${TOKEN}` };
const CANDIDATES = [
  "articles", "blogs", "blog-posts", "posts", "blog", "article", "post",
  "pages", "news", "stories", "guides", "resources", "insights",
  "authors", "categories", "tags", "seos",
];

async function get(path) {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: H, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text?.slice(0, 200) }; }
    return { status: res.status, json, server: res.headers.get("x-powered-by") };
  } catch (e) {
    return { status: 0, json: { error: e.message } };
  }
}

console.log(`Probing ${BASE} …\n`);

const found = [];
for (const type of CANDIDATES) {
  const r = await get(`/api/${type}?pagination[pageSize]=1&populate=*`);
  const tag = r.status === 200 ? "✅ EXISTS" : r.status === 403 ? "🔒 exists (token lacks find perm)" : r.status === 404 ? "—" : `⚠ ${r.status}`;
  if (r.status === 200 || r.status === 403) console.log(`  /api/${type}  ${tag}`);
  if (r.status === 200) found.push({ type, sample: r.json?.data?.[0] });
}

if (found.length === 0) {
  console.log("\nNo candidate collections returned 200. Either the token lacks permissions, or the");
  console.log("blog collection has a non-standard API ID. Check Strapi admin → Content-Type Builder");
  console.log("for the collection's 'API ID (plural)', then set STRAPI_BLOG_TYPE to it.");
  process.exit(0);
}

console.log("\n── Field names per discovered collection ──");
for (const f of found) {
  const keys = f.sample ? Object.keys(f.sample) : [];
  console.log(`\n[${f.type}] fields: ${keys.length ? keys.join(", ") : "(no entries yet — create one in Strapi to see fields)"}`);
  if (f.sample) {
    // Guess which field is the body / slug / title / cover for the UI mapping.
    const guess = (names) => keys.find((k) => names.some((n) => k.toLowerCase().includes(n)));
    console.log(`   title→ ${guess(["title", "name", "heading"]) ?? "?"} | slug→ ${guess(["slug", "permalink"]) ?? "?"} | body→ ${guess(["content", "body", "text", "markdown", "rich"]) ?? "?"} | cover→ ${guess(["cover", "image", "thumbnail", "featured", "media", "hero"]) ?? "?"}`);
  }
}

// Detect publish-action support on the most blog-like collection.
const primary = found.find((f) => /article|blog|post/i.test(f.type)) ?? found[0];
console.log(`\n── Recommended STRAPI_BLOG_TYPE = "${primary.type}" ──`);

// Report upload endpoint reachability (list existing media, read-only).
const up = await get(`/api/upload/files?pagination[pageSize]=1`);
console.log(`\nMedia library (/api/upload/files): ${up.status === 200 ? "✅ reachable — image upload will work" : `status ${up.status} (token may need Upload permission)`}`);
if (up.server) console.log(`Server: ${up.server}`);
console.log("\nDone. Set STRAPI_BLOG_TYPE in .env.local to the recommended value above.");
