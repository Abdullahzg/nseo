# What of this skill is embedded in Summit, and what is not

The rest of this directory is the `imagineart-seo-department` skill, vendored verbatim. It is the SEO
team's own accumulated practice, built up before Summit existed and still run by hand today.

This file is the map between that knowledge and the product: what has been wired in, what has not, and
which parts are deliberately never going to be. Without it, the next person has to diff a skill against a
codebase to find out.

## Wired in

### Banned language (migration `scripts/051_seo_department_voice.mjs`)

All three brand-voice guides independently converge on the same banned list, which is a far stronger
signal than one person's preference. `writer_voices` was seeded with 17 words / 15 phrases; the skill has
roughly five times that.

| voice | banned_words | banned_phrases |
|---|---|---|
| `imaginearts-house` | 17 → 39 | 15 → 41 |
| `misher-fnb` | 10 → 39 | 13 → 42 |

It unions rather than replaces, so a term someone added in the UI survives a re-run, and it bumps
`prompt_revision` because these fields render into `system[1]` — leaving the revision alone would serve
the old list from a 1h cache while the database claimed the new one was live.

Kept editable in the database rather than hard-coded, so the team can still change it at `/blog/voices`
without a deploy.

### Four new validator gates (`src/lib/writer/validate.ts`)

`SKILL_PROMPT` already asked for sentence case twice, but nothing enforced it — so it was advice the model
could ignore silently, which is the failure mode this codebase has been bitten by before. These are now
gates with fixtures in `src/app/api/blog/selfcheck/route.ts`.

| gate | severity | note |
|---|---|---|
| `title_case_heading` | auto_fix | Lowercases Title Case headings. Needs 3+ capitalised words **and** a ≥60% ratio, so "Ad Studio pricing" and "Why Runway and Sora both struggle with hands" both pass untouched. |
| `emoji` | auto_fix | Pictographic ranges only. Arrows and bullets are punctuation and are left alone. |
| `ellipsis_suspense` | auto_fix | Trailing ellipsis only; a mid-line elision is legitimate. |
| `mid_sentence_bold` | repair | Bold at the start of a line or bullet is a structural label (Image T7 is built that way) and is exempt. |
| `stacked_transitions` | flag | Density, not presence — see below. |

The false-positive fixtures matter more than the positive ones. A flagged draft blocks Publish, so a gate
that fires on ordinary prose does not merely annoy, it stops the tool working.

### One place the skill was deliberately NOT followed literally

The guides list "moreover", "furthermore", "additionally" and "not only X, but also Y" under *sentence
shapes*, and say plainly that they "are individually harmless and collectively a tell". Adding them to
`banned_phrases` would have fired on the first occurrence in ordinary English and blocked Publish on
correct prose.

They are instead a `stacked_transitions` gate that counts them against a word-count budget (~1 per 500
words) and only **flags**, never repairs — at that density the problem is a section listing points instead
of making an argument, and a scoped rewrite turn swaps the words rather than fixing the structure.

## Not wired in, and why

- **Workflows A and B (Notion research logging).** The skill writes page opportunities and blog clusters
  into two Notion databases with ~150 existing rows in a specific format. Summit has its own cluster
  planner built on real GSC striking-distance data (`src/lib/writer/cluster.ts`). These are two systems
  of record for the same thing, and picking one is a team decision, not a code change. Doing both would
  guarantee they drift.
- **The Ahrefs playbook.** Summit calls Ahrefs through its own MCP connector for Domain Rating and SERP
  data, not through these endpoints. Two gotchas in `references/ahrefs-playbook.md` are worth reading
  before writing any new Ahrefs call, because both fail silently rather than erroring:
  `mode: "domain"` excludes `www.` and every other subdomain (which is most of imagine.art), and
  `terms` on `related-terms` takes an enum, not the keyword.
- **Page templates (Video T1, Image T7, MCP, Ad Studio).** These are landing-page structures. Summit's
  landing pipeline goes through Strapi templates instead, and the `imagine-landing` skill covers building
  the pages themselves.
- **The tone-of-voice *choice* step.** Workflow C requires presenting all three voices and waiting for a
  pick, never defaulting. Summit already does this structurally: voice is a selectable column on
  `writer_voices` chosen per piece, with `imaginearts-house` as the marked default. The skill's rule is
  satisfied by the UI, so nothing was added.

## Worth knowing

`references/brand-voice/index.md` records that the 20 content pages already written into Notion predate
these tone guides and use em dashes and bold-label bullet stacks throughout. They have never been
re-passed for voice. If someone asks why old pages violate the rules the tool now enforces, that is the
answer — and the guides say explicitly not to silently rewrite pages nobody asked to have redone.
