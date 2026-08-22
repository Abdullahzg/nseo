// Fold the SEO department's own tone-of-voice rules into the writer voices.
//
// Source: the `imagineart-seo-department` skill the SEO team has been running by hand. Its three brand
// voice guides (blog / landing page / Misher Writer) independently converged on the same banned-language
// list, which is a much stronger signal than one person's preference — and it is roughly 5x longer than
// what these rows were seeded with. Every term below is theirs, not invented here.
//
// Why this is a migration and not a code constant: the lists live in `writer_voices` so the team can edit
// them in-app at /blog/voices without a deploy. Hard-coding them would take that away. This migration is
// the one-time import of institutional knowledge that predates the tool.
//
// `banned_words` and `banned_phrases` are PROMPT-BEARING (see PROMPT_BEARING_FIELDS in
// src/lib/writer/voice.ts) — they render into system[1], which is cached with a 1h TTL. So this bumps
// prompt_revision, deliberately invalidating that cache. That costs one cache write per voice and is
// unavoidable: leaving the revision alone would serve the OLD list from cache for up to an hour while
// the database claimed the new one was live, which is worse than the write.
//
// Idempotent by construction: it unions with whatever is already there and de-duplicates, so re-running
// cannot create duplicates and cannot drop a term someone added by hand in the meantime.
import * as dotenv from "dotenv";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

// Single words / short compounds. From blog-tone-of-voice.md "Words we don't use", which the other two
// guides echo. Kept lowercase because voiceBannedWords() lowercases and sorts before rendering, so the
// prompt is byte-identical regardless of the order they went in.
const BANNED_WORDS = [
  "elevate", "leverage", "unlock", "unleash", "embark", "delve", "streamline", "supercharge",
  "empower", "ecosystem", "synergy", "holistic", "seamless", "robust", "cutting-edge",
  "state-of-the-art", "world-class", "best-in-class", "next-level", "game-changing", "game-changer",
  "revolutionize", "revolutionary", "transformative", "disruptive", "frictionless", "effortlessly",
  "plethora", "myriad", "boundless", "tapestry", "realm", "unparalleled", "unrivaled", "meticulously",
  "curated", "utilize", "stakeholders", "unpack",
];

// Multi-word constructions. These matter more than the single words: a banned word can occasionally be
// the honest term for something, whereas these are almost always filler standing in for a real point.
const BANNED_PHRASES = [
  "harness the power of", "endless possibilities", "testament to", "navigate the complexities of",
  "at the intersection of", "in today's fast-paced world", "ever-evolving landscape",
  "when it comes to", "in order to", "actionable insights", "pain points", "in conclusion",
  "it's important to note", "whether or not", "the future is here", "double-click on", "circle back",
  "low-hanging fruit", "north star", "table stakes", "move the needle", "top-of-mind", "value-add",
  "deep dive", "thought leadership", "in this day and age", "boil the ocean",
  // Retired openers, from the same guide.
  "in this article, we'll explore", "let's dive in", "let's unpack", "as we've seen",
  "at the end of the day",
];

// Deliberately NOT banned here: "moreover", "furthermore", "additionally", "not only ... but also".
// The guide lists those under *sentence shapes*, and is explicit that they "are individually harmless and
// collectively a tell". A flat ban would flag ordinary English — and because a flagged draft disables
// Publish, that turns a style preference into a broken publish path. Density is the real signal, so it
// belongs in a validator gate that counts them (see the stacked_transitions gate in
// src/lib/writer/validate.ts), not in a list that fires on the first occurrence.

const { rows: voices } = await c.query(
  `SELECT id, slug, banned_words, banned_phrases, prompt_revision FROM writer_voices`);

for (const v of voices) {
  // Union, not replace. Someone may have added a term through the UI since seeding, and silently
  // dropping it would be a regression disguised as an import.
  const words = [...new Set([...(v.banned_words ?? []), ...BANNED_WORDS].map((s) => String(s).trim().toLowerCase()).filter(Boolean))].sort();
  const phrases = [...new Set([...(v.banned_phrases ?? []), ...BANNED_PHRASES].map((s) => String(s).trim().toLowerCase()).filter(Boolean))].sort();

  const changed = words.length !== (v.banned_words ?? []).length || phrases.length !== (v.banned_phrases ?? []).length;

  await c.query(
    `UPDATE writer_voices
        SET banned_words = $2, banned_phrases = $3,
            prompt_revision = prompt_revision + CASE WHEN $4 THEN 1 ELSE 0 END
      WHERE id = $1`,
    [v.id, words, phrases, changed]);

  console.log(
    `${v.slug.padEnd(20)} words ${String((v.banned_words ?? []).length).padStart(3)} -> ${String(words.length).padStart(3)}` +
    `   phrases ${String((v.banned_phrases ?? []).length).padStart(3)} -> ${String(phrases.length).padStart(3)}` +
    `   ${changed ? `prompt_revision -> ${v.prompt_revision + 1}` : "unchanged"}`);
}

await c.end();
