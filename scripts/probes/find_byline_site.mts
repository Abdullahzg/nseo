import * as dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.local"), quiet: true });
const { fetchRaw } = await import("../../src/lib/indexing/fetchRendered.ts");
const { extractByline } = await import("../../src/lib/backlinks/authorName.ts");

for (const d of ["startuphub.ai", "deepai.org", "zeely.ai", "m1-project.com", "brandedagency.com"]) {
  const sm = await fetchRaw(`https://${d}/sitemap.xml`).catch(() => null);
  const ok = sm?.ok && /<(urlset|sitemapindex)/i.test(sm.html ?? "");
  if (!ok) { console.log(`${d.padEnd(22)} sitemap: no`); continue; }
  let urls = [...(sm!.html!).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  if (/<sitemapindex/i.test(sm!.html!)) {
    const kid = await fetchRaw(urls[0]).catch(() => null);
    urls = [...(kid?.html ?? "").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  }
  const hits: string[] = [];
  for (const u of urls.slice(-6)) {
    const r = await fetchRaw(u).catch(() => null);
    const b = r?.html ? extractByline(r.html) : null;
    if (b) hits.push(b);
  }
  console.log(`${d.padEnd(22)} urls=${String(urls.length).padStart(4)}  bylines found: ${hits.length ? hits.join(", ") : "none"}`);
}
