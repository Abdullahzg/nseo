// Run: node scripts/037_geo_checks.mjs
// History for the GEO Citation Agent. Google's AI Overview (and any AI engine, really) is
// genuinely intermittent per query — confirmed live: the same prompt flips between showing an
// answer and showing nothing over hours, with no per-request randomness. A single scan's 0%
// looks broken; a rolling hit-rate ("answered 3/10 of the last checks") tells the truth instead.
// One row per (prompt, engine) per scan run.
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
await c.query(`
  CREATE TABLE IF NOT EXISTS geo_checks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_at          timestamptz NOT NULL DEFAULT now(),
    prompt          text NOT NULL,
    engine          text NOT NULL,   -- perplexity | chatgpt | gemini | google_aio
    answered        boolean NOT NULL,
    brand_mentioned boolean NOT NULL DEFAULT false,
    surface         text,            -- google_aio only: "AI Overview" | "featured snippet"
    cited_domains   text[] DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS geo_checks_trend_idx ON geo_checks (prompt, engine, run_at DESC);
`);
console.log("037 done — geo_checks."); await c.end();
