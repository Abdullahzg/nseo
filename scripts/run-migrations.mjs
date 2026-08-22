// Run: node scripts/run-migrations.mjs
// Executes every scripts/NNN_*.mjs in numeric order against DATABASE_URL.
// All migrations are idempotent, so this is safe to re-run after partial failures.
import { execFileSync } from "child_process";
import { readdirSync, readFileSync } from "fs";
import { join, basename } from "path";
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (set it in .env.local)");
  process.exit(1);
}

// 1) Plain-SQL migrations (e.g. migrations/001_initial.sql) run FIRST — the numbered
//    scripts ALTER tables those files create.
const sqlDir = resolve(__dirname, "../migrations");
const sqlFiles = readdirSync(sqlDir).filter((f) => f.endsWith(".sql")).sort();
{
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  for (const f of sqlFiles) {
    console.log(`▶ ${basename(f)} (sql)`);
    try {
      await client.query(readFileSync(join(sqlDir, f), "utf8"));
    } catch (e) {
      // Idempotent DDL should not fail; anything that does aborts loudly.
      console.error(`✗ ${f} failed: ${e.message}`);
      process.exit(1);
    }
  }
  await client.end();
}

// 2) Numbered .mjs migration scripts in numeric order (each idempotent).
const SKIP = new Set(["run-migrations.mjs", "setup-qstash.mjs"]);
const files = readdirSync(__dirname)
  .filter((f) => /^\d{3}_.*\.mjs$/.test(f) && !SKIP.has(f))
  .sort();

for (const f of files) {
  console.log(`▶ ${basename(f)}`);
  try {
    execFileSync(process.execPath, [join(__dirname, f)], { stdio: "inherit" });
  } catch (e) {
    console.error(`✗ ${f} failed — aborting (fix and re-run; all steps are idempotent).`);
    process.exit(1);
  }
}
console.log(`✓ ${files.length} migrations applied.`);
