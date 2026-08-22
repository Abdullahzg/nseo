// Run: node scripts/036_reply_intent.mjs
// Store the INTENT of a genuine reply (interested | asks_price | wants_topic |
// not_interested | follow_up_later | other) so the inbox can triage real-deal replies
// (someone who's interested or asking price) apart from soft/no responses. Complements
// reply_sentiment (030) — sentiment is tone, intent is the next action.
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
await c.query(`ALTER TABLE outreach_emails ADD COLUMN IF NOT EXISTS reply_intent text;`);
console.log("036 done."); await c.end();
