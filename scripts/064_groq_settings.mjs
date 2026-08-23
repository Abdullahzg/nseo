// Run: node scripts/064_groq_settings.mjs
// Add Groq API key/model columns to app_settings for runtime configuration.
import pg from "pg";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`
  ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS groq_api_key text;
  ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS groq_model text;
`);

console.log("064 done: groq_api_key + groq_model added to app_settings.");
await client.end();
