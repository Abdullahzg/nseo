// Run: node scripts/046_writer_sections.mjs
//
// Store each written section under its outline index instead of appending to blog_drafts.body.
//
// Why: submit_section used to append, which made it non-idempotent. Observed live — the model
// submitted the final section three times (it read "that was the last section" as needing
// acknowledgement), and the draft body ended up with that section duplicated three times. The
// cursor looked correct the whole time because it advances with Math.max, so nothing flagged it.
//
// With a map keyed by index, body is REBUILT in outline order on every submit, so a repeated or
// out-of-order submission is naturally correct. The validator's repair loop needs exactly the same
// property: fixing a banned word in section 3 means REPLACING section 3, which append cannot do.
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

await c.query(`
  ALTER TABLE writer_sessions
    ADD COLUMN IF NOT EXISTS sections jsonb NOT NULL DEFAULT '{}'::jsonb;
`);

console.log("046 done: writer_sessions.sections added (index -> markdown, body rebuilt from it).");
await c.end();
