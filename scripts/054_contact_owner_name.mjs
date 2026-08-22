// Record WHO an address belongs to, when that is not the article's author.
//
// Needed by the new Hunter domain-search cascade step. domain-search returns everyone Hunter knows at a
// publication, which is the point — it finds addresses that `email-finder` cannot, because it needs no
// name. But the best available contact is often a DIFFERENT person from the byline we started with: an
// editor or founder, who for backlink outreach is usually the better target anyway since they can
// actually place a link where a freelance contributor cannot.
//
// Without this column that improvement silently breaks the pitch. draftBacklinkPitches() greets
// `authors.full_name` for the prospect while taking the address from `contacts`, so a Hunter alt contact
// would produce "Hi Sarah," delivered to lion@filmcrux.com. A misaddressed pitch is worse than no pitch:
// it is the one mistake a recipient cannot un-see, and it burns the prospect permanently.
//
// Nullable, and null keeps today's behaviour exactly — greet the author. Only set when the address
// demonstrably belongs to someone else.
import * as dotenv from "dotenv";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

// The person this address actually belongs to. Null = the author it is attached to.
await c.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS owner_name text`);
// Their role, when the provider gives one ("Founder", "Managing Editor"). Useful in the pitch and in the
// UI, because "Founder" tells an operator whether this contact can actually place a link.
await c.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS owner_position text`);

const { rows } = await c.query(
  `SELECT count(*)::int total, count(owner_name)::int named FROM contacts WHERE type IN ('email','mailto')`);
console.log(`contacts: ${rows[0].total} email rows, ${rows[0].named} with an explicit owner name`);

await c.end();
