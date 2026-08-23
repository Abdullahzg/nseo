// Run: node scripts/063_app_settings.mjs
// Runtime-editable operational settings (Settings UI): AI provider key/model overrides
// so operators can rotate credentials without a redeploy. Env vars remain the fallback.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS app_settings (
    id boolean PRIMARY KEY DEFAULT true,
    gemini_api_key text,
    gemini_model text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_settings_singleton CHECK (id)
  );
  ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
`);

console.log("063 done: app_settings ready.");
await client.end();
