// Remove documentation placeholders that were stored as real contact emails.
//
// Reported from the field: a Film Studio prospect showed `user@domain.com` as its email, while the real
// address (lion@filmcrux.com) was sitting on the page and findable with Hunter's browser extension.
//
// Cause: `pageSignals.ts` guarded with `e.includes("example.")` — a trailing dot, so it matched
// foo@example.com and missed `example@domain.com` (that is `example@`) and `user@domain.com` entirely.
//
// Why it was dangerous rather than merely wrong: these landed with source `page-scrape`, which
// emailTrust() maps to "sourced" — the HIGHEST trust rank, above pattern-verified. The send gate only
// blocks `pattern`/`pattern-catchall`, so every one of these was cleared to send. A guessed address gets
// stopped; an invented one that looks scraped does not. Each would bounce, and bounces burn sender
// reputation for everyone on the domain.
//
// Extraction is now guarded in three places and the send gate rejects them outright. This clears what was
// already written.
//
// Deletes rather than flags: there is no salvage value in a placeholder, and leaving the row would keep
// the author looking "enriched" and so exclude them from future enrichment runs — which is exactly the
// outcome to avoid. Removing it makes them eligible again.
import * as dotenv from "dotenv";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

// Mirrors isPlaceholderEmail() in src/lib/enrich/personFilter.ts. Kept as explicit SQL rather than
// importing the TS so this script stays runnable standalone; the lists must be updated together.
const PLACEHOLDER_DOMAINS = [
  "example.com", "example.org", "example.net", "example.edu",
  "domain.com", "domain.net", "yourdomain.com", "mydomain.com", "site.com", "yoursite.com",
  "youremail.com", "company.com", "yourcompany.com", "acme.com",
  "test.com", "sample.com", "somewhere.com", "address.com", "abc.com", "localhost", "localhost.com",
];
const PLACEHOLDER_LOCALS = [
  "user", "username", "youremail", "your-email", "your_email", "email", "e-mail",
  "example", "sample", "test", "testing", "demo", "placeholder", "changeme", "yourname",
  "your-name", "your_name", "name", "firstname", "lastname", "firstnamelastname",
  "johndoe", "john.doe", "janedoe", "jane.doe", "joe.bloggs", "foo", "bar", "baz", "abc", "xyz",
  "someone", "somebody", "anyone", "nobody", "myname", "myemail",
];

// `value` may carry a `mailto:` prefix, so strip it before splitting on the last @.
const NORM = `lower(regexp_replace(value, '^mailto:', ''))`;
const WHERE = `
  type IN ('email', 'mailto')
  AND (
    split_part(${NORM}, '@', 2) = ANY($1::text[])
    OR split_part(${NORM}, '@', 1) = ANY($2::text[])
    OR split_part(split_part(${NORM}, '@', 2), '.', 1) = ANY(
         ARRAY['example','domain','yourdomain','mydomain','yoursite','youremail','test','sample'])
  )`;

const { rows: doomed } = await c.query(
  `SELECT id, author_id, value, source, confidence FROM contacts WHERE ${WHERE}`,
  [PLACEHOLDER_DOMAINS, PLACEHOLDER_LOCALS]);

if (!doomed.length) {
  console.log("No placeholder contacts found — nothing to purge.");
} else {
  console.log(`Found ${doomed.length} placeholder contact(s):`);
  for (const r of doomed) {
    console.log(`  ${r.value.padEnd(30)} source=${(r.source ?? "?").padEnd(14)} confidence=${r.confidence} author=${r.author_id}`);
  }

  // Park any queued outreach aimed at one of these BEFORE deleting the contact, so a send run between
  // this script and the next enrichment pass cannot pick it up. followup_skipped stops the follow-up
  // chain too.
  //
  // Matched by author_id, not by address: `outreach_emails` has no `recipient` column. The address is
  // resolved at send time by joining the author's `contacts` (see getDueEmails), so the queued row itself
  // carries no copy of it — only `recipient_override` for admin test-sends, which is exempt by design.
  const authorIds = [...new Set(doomed.map((r) => r.author_id).filter(Boolean))];
  const { rowCount: parked } = await c.query(
    `UPDATE outreach_emails
        SET status = 'failed',
            error = 'Skipped: recipient is a documentation placeholder, not a real mailbox',
            followup_skipped = true
      WHERE author_id = ANY($1::uuid[])
        AND status IN ('ready', 'scheduled', 'draft')
        AND (recipient_override IS NULL OR btrim(recipient_override) = '')`,
    [authorIds]);
  console.log(`Parked ${parked} queued outreach email(s) for ${authorIds.length} affected author(s).`);

  const { rowCount: deleted } = await c.query(
    `DELETE FROM contacts WHERE ${WHERE}`, [PLACEHOLDER_DOMAINS, PLACEHOLDER_LOCALS]);
  console.log(`Deleted ${deleted} placeholder contact(s). Those authors are now eligible for re-enrichment.`);
}

await c.end();
