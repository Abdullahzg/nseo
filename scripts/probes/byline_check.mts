import * as dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.local"), quiet: true });
const { fetchRaw } = await import("../../src/lib/indexing/fetchRendered.ts");
const { extractByline } = await import("../../src/lib/backlinks/authorName.ts");

// One sitemap child, then a real post from it.
const sm = await fetchRaw("https://invideo.io/sitemap.xml");
const kids = [...(sm?.html ?? "").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]).slice(0, 6);
let posts: string[] = [];
for (const k of kids) {
  const sub = await fetchRaw(k);
  const urls = [...(sub?.html ?? "").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  posts = urls.filter((u) => /\/(blog|blogs|articles|resources)(\/|$)/i.test(u));
  if (posts.length) { console.log(`child ${k} → ${posts.length} blog urls`); break; }
}
for (const u of posts.slice(-3)) {
  const r = await fetchRaw(u);
  const html = r?.html ?? "";
  console.log(`\n${u.slice(0, 90)}  (${html.length} bytes)`);
  console.log("  extractByline:", JSON.stringify(extractByline(html)));
  // What author signals does the page actually carry?
  for (const [label, re] of [
    ["meta author", /<meta[^>]+name=["']author["'][^>]+content=["']([^"']{2,60})["']/i],
    ["JSON-LD author", /"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]{2,60})"/],
    ["rel=author", /rel=["']author["'][^>]*>([^<]{2,60})</i],
    ["class author", /class=["'][^"']*author[^"']*["'][^>]*>\s*(?:by\s+)?([^<]{2,60})</i],
  ]) console.log(`  ${label.padEnd(16)}`, JSON.stringify(html.match(re as RegExp)?.[1]?.trim() ?? null));
}
