// Re-point existing backlink templates at the direct paid-collaboration pitch.
//
// The template body lives in `email_templates` rows created when each campaign was set up, so changing
// the code only affects campaigns created AFTER the change. Four campaigns already exist with the old
// wording, and 106 pitches are drafted and unsent against it — without this migration the change would
// look applied while every real send used the old text.
//
// What changed and why: the old ask was "would you consider adding ImagineArt as an option?" offering a
// free account, assets or data. To a publisher who sells placements that is not an incentive — it asks
// them to work for nothing. Measured win rate: 0.4%. The target of 50 links a week cannot be reached by
// volume (it needs ~12,500 sends against a ~3,430/week ceiling), so the reply rate is the only lever
// available, and burying the incentive is the most likely reason it is that low.
//
// No figure is quoted, on purpose. Naming one first either overpays a small site or insults a large one,
// and it spends the negotiation before they have said what they want.
//
// The 106 already-drafted pitches are NOT rewritten here. Each body has an LLM-written opener baked into
// it, so regenerating means re-running the drafter — see scripts/redraft_pitches.mjs, which is separate
// precisely because it costs model calls and should be a deliberate run.
import * as dotenv from "dotenv";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

const { rows: camps } = await c.query(`
  SELECT bc.template_id, bc.target_path, bc.target_url, bc.topic
    FROM backlink_campaigns bc
   WHERE bc.template_id IS NOT NULL`);

const GUIDANCE =
  "This is PAID backlink outreach. Write ONLY a 1-2 sentence opener referencing the recipient's specific " +
  "article (title given) — something that shows a person read it, naming a detail a skim would miss. " +
  "Warm and plain. Do NOT pitch, do NOT mention money, payment, budget or a rate, do NOT write the ask, " +
  "links, greeting or sign-off — the template supplies all of that immediately after your sentences. " +
  'Never open with "I hope this finds you well" or "I came across your article".';

let updated = 0;
for (const cam of camps) {
  const topic = cam.topic || (cam.target_path ?? "").split("/").filter(Boolean).pop()?.replace(/[-_]+/g, " ") || "our tool";
  const url = cam.target_url;

  const subject = `Paid collaboration on your ${topic} piece`;
  const body =
    `Hi {{author_name}},\n\n{{custom_line}}\n\n` +
    `I'll be direct, since I know you get a lot of these: we'd like to pay for a collaboration. ` +
    `ImagineArt is an AI image and video generator (${url}), and we'd like to be included in that piece. ` +
    `We have budget allocated for this and we're happy to work to your usual rate and terms.\n\n` +
    `If you're open to it, reply with what you charge and how you prefer to handle it, and I'll get it moving.\n\n` +
    `The piece I mean: {{article_link}}\n\nThanks,\nThe ImagineArt team`;

  const { rowCount } = await c.query(
    `UPDATE email_templates SET subject = $2, body = $3, guidance = $4 WHERE id = $1`,
    [cam.template_id, subject, body, GUIDANCE]);
  if (rowCount) { updated++; console.log(`  ${cam.target_path} → "${subject}"`); }
}

const { rows: pending } = await c.query(`
  SELECT count(*)::int n FROM outreach_emails WHERE status = 'ready' AND sent_at IS NULL`);

console.log(`\nUpdated ${updated} template(s).`);
console.log(`${pending[0].n} drafted pitches still carry the old wording — run scripts/redraft_pitches.mjs to regenerate them.`);

await c.end();
