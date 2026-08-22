// Does Hunter find addresses for prospects the cascade gave up on?
import * as dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.local"), quiet: true });

const { findEmailHunter, hunterStatus } = await import("../../src/lib/enrich/hunter.ts");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

console.log("Hunter account:", JSON.stringify(await hunterStatus()));

// Real prospects with a named author, a domain, and NO email on file.
const { data: rows } = await sb
  .from("backlink_prospects").select("domain, author_id").limit(200);
const ids = [...new Set((rows ?? []).map((r: any) => r.author_id))];
const { data: authors } = await sb.from("authors").select("id, full_name").in("id", ids);
const { data: mails } = await sb.from("contacts").select("author_id").eq("type", "mailto").in("author_id", ids);
const has = new Set((mails ?? []).map((m: any) => m.author_id));

const byId = new Map((authors ?? []).map((a: any) => [a.id, a.full_name]));
const targets = (rows ?? [])
  .filter((r: any) => !has.has(r.author_id))
  .map((r: any) => ({ name: byId.get(r.author_id) as string, domain: r.domain }))
  .filter((t) => t.name && !/editorial$/i.test(t.name) && t.name.split(" ").length >= 2)
  .slice(0, 8);

console.log(`\nTrying ${targets.length} prospects with a real name and no email on file:\n`);
let found = 0;
for (const t of targets) {
  const h = await findEmailHunter(t.name, t.domain, 50).catch(() => null);
  if (h) found++;
  console.log(`  ${h ? "FOUND" : "  -  "}  ${t.name.padEnd(24)} @ ${t.domain.padEnd(26)} ${h ? `${h.email} (${h.score}%)` : ""}`);
}
console.log(`\n${found}/${targets.length} resolved by Hunter that the cascade had left empty.`);
