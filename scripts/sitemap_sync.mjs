// Refresh the site URL inventory from sitemap.xml.
//
//   npx tsx scripts/sitemap_sync.mjs                          # live https://www.imagine.art/sitemap.xml
//   npx tsx scripts/sitemap_sync.mjs <url>                    # a different sitemap
//   npx tsx scripts/sitemap_sync.mjs --file path/to/sitemap.xml
import * as dotenv from "dotenv";
import { readFileSync } from "node:fs";
dotenv.config({ path: ".env.local", quiet: true });

const { syncSitemap, listSiteUrls } = await import("../src/lib/sitemap/store.ts");

const args = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const xml = fileIdx >= 0 ? readFileSync(args[fileIdx + 1], "utf8") : undefined;
const sourceUrl = fileIdx >= 0 ? `file:${args[fileIdx + 1]}` : (args[0] || undefined);

const r = await syncSitemap({ sourceUrl, xml });
if (!r.ok) { console.error(`✗ ${r.error}`); process.exit(1); }

console.log(`✓ ${r.url_count} URLs (${r.added} new) from ${r.source_url}\n`);
const rows = Object.entries(r.sections).sort((a, b) => b[1] - a[1]);
for (const [s, n] of rows.slice(0, 14)) console.log(`  ${String(n).padStart(5)}  /${s}`);

// Prove it round-trips out of the table, not just into it.
const blogs = await listSiteUrls({ section: "blogs", limit: 3 });
const money = await listSiteUrls({ moneyOnly: true, limit: 3 });
console.log(`\nread back: ${blogs.length ? blogs[0].path : "(none)"} … | money sample: ${money.map((m) => m.path).join(", ")}`);
