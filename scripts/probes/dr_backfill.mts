// Backfill Domain Rating for domains that don't have one.
//
// Bounded and resumable by design: pass --limit and run it repeatedly rather than trying to clear 1,062
// domains in one pass. Every run picks up where the last stopped, because "has no DR yet" IS the queue.
//
// Prioritised, not arbitrary. DR only changes a decision for a domain we might actually email — the
// prospect ranking is relevancy, then DR, then trackability — so backlink prospects are filled first and
// domains nobody has ever considered come last. Filling 1,062 rows in discovery order would spend the
// whole budget on domains that never reach a shortlist.
//
// Uses Ahrefs' FREE domain-rating endpoint (src/lib/enrich/domainRating.ts), so the constraint is rate
// limiting rather than API units. Concurrency is deliberately low and there is a pause between batches;
// getting throttled costs more time than going slowly.
//
//   node scripts/dr_backfill.mjs --limit 50          # default
//   node scripts/dr_backfill.mjs --limit 200 --all   # include non-prospect domains
import * as dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.local"), quiet: true });

const args = process.argv.slice(2);
const limit = Number(args[args.indexOf("--limit") + 1]) || 50;
const includeAll = args.includes("--all");
const CONCURRENCY = 3;
const PAUSE_MS = 1200;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { fetchDomainRating } = await import("../../src/lib/enrich/domainRating.ts");

// Prospect domains first. A left-join would be cleaner in SQL but PostgREST cannot express it, so the
// prospect host list is fetched and used as an ordering key.
const { data: prospects } = await sb.from("backlink_prospects").select("domain").limit(2000);
const prospectHosts = new Set((prospects ?? []).map((p) => p.domain).filter(Boolean));

const { data: missing } = await sb
  .from("domains").select("id, host").is("dr", null).limit(2000);
const rows = (missing ?? []).filter((r) => r.host);

const queue = includeAll
  ? [...rows].sort((a, b) => Number(prospectHosts.has(b.host)) - Number(prospectHosts.has(a.host)))
  : rows.filter((r) => prospectHosts.has(r.host));

const batch = queue.slice(0, limit);
console.log(
  `${rows.length} domains have no DR. ${queue.length} are ${includeAll ? "eligible" : "backlink prospects"}. ` +
  `Doing ${batch.length} this run.`,
);
if (!batch.length) {
  console.log(includeAll ? "Nothing left." : "No prospect domains left — re-run with --all for the rest.");
  process.exit(0);
}

let filled = 0, noData = 0, throttled = 0;
for (let i = 0; i < batch.length; i += CONCURRENCY) {
  const slice = batch.slice(i, i + CONCURRENCY);
  const results = await Promise.all(slice.map(async (r) => ({ r, out: await fetchDomainRating(r.host) })));
  for (const { r, out } of results) {
    if (typeof out?.dr !== "number") { noData++; continue; }
    // dr_checked_at is not set here: the column may not exist on every environment, and the queue is
    // "dr IS NULL" so a filled row leaves the queue regardless.
    const { error } = await sb.from("domains").update({ dr: out.dr }).eq("id", r.id);
    if (error) { noData++; continue; }
    filled++;
    console.log(`  ${String(out.dr).padStart(3)}  ${r.host}`);
  }
  // Stop early rather than hammering a throttled endpoint — the queue is durable, so resuming is free.
  // A whole batch returning nothing usually means throttling or a key problem, not that every
  // domain is unknown — stop rather than burning the queue against a broken endpoint.
  if (filled === 0 && i >= CONCURRENCY * 3) { console.log("\nNothing resolved in the first few batches — stopping. Check AHREFS_API_KEY."); break; }
  if (i + CONCURRENCY < batch.length) await new Promise((f) => setTimeout(f, PAUSE_MS));
}

const { count: nowWith } = await sb.from("domains").select("*", { count: "exact", head: true }).not("dr", "is", null);
console.log(`\nfilled ${filled}, no data ${noData}, throttled ${throttled}. Domains with a DR now: ${nowWith}.`);
