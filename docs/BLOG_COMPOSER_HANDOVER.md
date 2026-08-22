# Blog composer — save engine + Strapi sync (handover)

Date: 2026-07-27. Phase 1 + 2 of the blog-automation work. The AI writing agent (Phase 3) and
clusters (Phase 4) build on this and are not in yet.

---

## The thing to read first: a comment that was wrong for months

`scripts/035_blog_drafts.mjs` used to assert:

> The "resources" content type on the connected Strapi instance has Draft & Publish **DISABLED** —
> every create there goes live immediately, so drafts can't live in Strapi.

**That is false**, and three bugs descended from it. Verified against the live instance:

```
GET /api/resources?filters[publishedAt][$null]=true   → HTTP 200, 0 rows
GET /api/resources?filters[totallyFakeField][$null]=1 → HTTP 400 ValidationError
```

`publishedAt` is a real, filterable field, so Draft & Publish is **enabled**: `null` = draft,
timestamp = live. The comment has been corrected in place.

The authoritative schema is readable with the token we already have — use it instead of guessing:

```
GET /api/content-type-builder/content-types/api::resource.resource
```

It reports: `title` REQUIRED min 35 · `description` REQUIRED min 120 · `slug` **uid** REQUIRED
(→ globally unique, **including across drafts**) · **`thumbnail` media REQUIRED** · `cover` optional
· `isFeatured` REQUIRED · `resourceHeroCTA` REQUIRED (inner text+url required) · `resourceMetaData`
optional but its inner title/description/keywords are all required · `body` richtext (plain
markdown) · `tags` plain text · `author`/`category` manyToOne. `draftAndPublish: true`,
i18n localized (`en` default, `id`, `es`).

---

## What was broken, and what fixed it

**1. `thumbnail` is declared required and existed nowhere in our stack.** No column, not in
`mapDraftToStrapi`, not in `publishReadiness`, no UI field. Now: `thumbnail_media_id`/`_url` columns,
a Thumbnail picker with a **Use cover** shortcut, and a `publishReadiness` check.

> **Corrected after probing.** An earlier draft of this doc claimed the missing thumbnail meant
> "publish could never have succeeded". That is **wrong**, and the correction matters because it
> changes where the risk actually is. `scripts/blog_strapi_draft_probe.mjs` shows a publish with
> every other required field present and **no thumbnail returns HTTP 200**: the REST API does not
> enforce `required` on that media field. The real historical blockers were `title` ≥35,
> `description` ≥120 and `resourceHeroCTA`. We still block on thumbnail — deliberately, as *our*
> rule, because it is the social/preview card image and "Use cover" makes it one click — but the
> UI must not claim Strapi is the one refusing.

**2. `createEntry()` omitted `publishedAt` for drafts, which published them.** On a D&P content type
Strapi v4 defaults `publishedAt` to `() => new Date()`, and `isDraft()` tests `=== null` **strictly**
— `undefined` is not `null`. **Confirmed by probe:** a create with `publishedAt` omitted was validated
as a *publish* (HTTP 400 listing title/description/resourceHeroCTA), not accepted as a draft.
`publishedAt` is now **always sent explicitly** (`null` or an ISO string). Don't "simplify" it back.

**2b. `PUT {publishedAt}` does not re-validate — `publishReadiness()` is the only gate.** The most
important finding, and it has no visible symptom. Probed: a draft with title `"x"`, no description
and no hero CTA published with **HTTP 200 and zero errors**. Strapi validates on *create* only, and
our two-step publish (`updateEntry` → `publishEntry`) never creates. So nothing on the Strapi side
stops invalid content going live; the server-side `publishReadiness()` check in
`/api/blog/drafts/[id]/publish` is it. Never move that check after the Strapi calls, never downgrade
it to a warning, and don't switch to a single create-with-`publishedAt` call to "get validation
back" — that would forfeit the ordering guarantee that stops stale content publishing.

**3. Every save pushed to live Strapi.** `PUT /api/blog/drafts/[id]` called `updateEntry` whenever
`strapi_id` was set, and returned **`ok: true` with a `warning`** when that failed — so local and
remote diverged silently with nothing persisted. Autosave would have made that an edit to published
content on every keystroke batch. That block is deleted; Strapi is reached only from `/sync`,
`/publish`, `/unpublish`.

**4. `blog_drafts` had no RLS and the public anon key could read it.** It was created in `035`,
after the `024_enable_rls.mjs` allowlist was written, so it was never in it. A live PostgREST select
with `NEXT_PUBLIC_SUPABASE_ANON_KEY` (which ships in the browser bundle) returned real rows. Fixed
in `043`; an anon insert now fails with `42501 new row violates row-level security policy`.

**5. Relations could never be cleared.** `mapDraftToStrapi` gated relations on truthiness
(`if (d.cover_media_id)`) but scalars on `!== undefined`, so clearing an author locally just omitted
the key and the live entry kept the old relation forever. Now one uniform rule: emit a key iff the
caller supplied it, and pass `null` through as `null`.

**6. Unvalidated request bodies.** The routes passed the raw body to Supabase, and the editor sent
the whole row back — so a stale form could overwrite `status`/`strapi_id`, and any unknown key
surfaced as a raw Postgres error in a 500. Now everything goes through `sanitizePatch()`.

---

## The save model

**Invariant: the user's text always exists in at least two places, one of which needs no network.**

| tier | where | when |
|---|---|---|
| 0 | React state | every keystroke |
| 1 | localStorage journal (`src/lib/blog/journal.ts`) | 150ms after a change; **synchronously** on `pagehide` |
| 2 | Postgres via `PATCH` | 1200ms debounce, 5000ms hard ceiling |

localStorage rather than IndexedDB because IDB is async and its writes aren't reliably flushed
during unload — the exact moment the fallback exists for.

- **No Save button.** Autosave + the `SaveStatus` chip. Cmd/Ctrl+S still flushes.
- **Optimistic concurrency**: `rev` column, conditional update, **409** on mismatch. The losing
  branch is snapshotted to `blog_draft_revisions` first, so no edit is ever silently discarded.
- **`sendBeacon` → `POST /api/blog/drafts/[id]/flush`** on `pagehide`. Beacon can only POST and is
  the only send the browser commits to completing during unload, hence the dedicated route.
- **Colour policy**: network trouble is **amber** because the text is safe. Red is reserved for
  `no_local_backup` (private mode / quota — the invariant is genuinely broken) and `sync_failed`.
- `beforeunload` blocks **only** when dirty *and* the journal is unavailable. Nagging while the work
  sits safely on disk just teaches people to ignore the dialog.

## Sync / publish state machine

`sync_state` stores four committed states; the `*_stale` variants are **derived** from
`rev !== synced_rev` by `deriveSyncState()` so the DB and UI can't disagree.

`local_only` → **Sync** → `synced` (a real *unpublished* Strapi draft a teammate can edit) →
**Publish** → `published`. **Unpublish** goes back to `synced`.

Publish is two calls in a fixed order: `updateEntry` fields, **then** `publishEntry`. So we can
never publish stale content, and a failure at step 2 leaves a correct unpublished draft rather than
a half-updated live post. `unpublishEntry()` had existed with **zero callers** because the composer
was built believing drafts were impossible.

Strapi relaxes `required`/`minLength` for drafts, so an incomplete post syncs fine. It does **not**
relax `uid` uniqueness, so `slug` is the one hard gate on sync — new drafts are seeded
`untitled-<8 hex>` rather than `""`.

---

## Gotchas worth knowing (each cost time to find)

- **`src/proxy.ts` is the outer auth gate**, not per-route code. Next.js 16 renamed
  `middleware.ts` → `proxy.ts`. It redirects anything without a session to `/login`, so scripted
  calls need `?key=$CRON_SECRET`.
- **`_`-prefixed folders are private in the App Router** and opt out of routing entirely. The
  self-check route is `api/blog/selfcheck`, not `_selfcheck`, for that reason.
- **`.claude/launch.json` server name is `seo_email`** (port 3000).
- **`grep` needs `-a` on `src/lib/db/queries.ts`** — it trips grep's binary detection.
- **Sync/publish/unpublish are session-only** (no CRON_SECRET path). Deliberate: publishing is a
  human act, and it's also what stops the future unattended cluster writer from reaching it.
- **`STRAPI_URL` points at a sandbox** (`dev-imagine-blog.vyro.ai`). `publishGate()` echoes the
  target host on every publish and honours `STRAPI_ALLOW_PUBLISH` — the only thing between a config
  change and a live-site accident.

## Verification

`GET /api/blog/selfcheck?key=$CRON_SECRET` → **44 assertions** over the pure helpers
(`sanitizePatch`, `changedFields`, `deriveSyncState`, `publishReadiness`, `mapDraftToStrapi`,
`diffLines`, slug helpers). This repo has no test framework and no test script, so this is the only
automatable net — **keep it**. It refuses to run in production.

Verified by hand against the live DB: rev bumps on PATCH · `status`/`strapi_id`/unknown keys
rejected and reported · stale `base_rev` → 409 with the server copy untouched · revisions recorded ·
anon key blocked on read *and* write.

**Not yet verified — needs one write to the sandbox Strapi:** that Strapi really does relax
required/minLength for drafts (i.e. that a half-finished post can sync). `publishReadiness` itself is
covered by the self-check; this is about Strapi's own draft validation. If it turns out drafts are
*not* relaxed, sync becomes gated on `publishReadiness()` and the UI says which fields Strapi needs —
the local save still always works either way, so the headline requirement survives.

## New env vars (all optional)

- `STRAPI_BLOG_UID` — default `api::resource.resource`. Was hardcoded in the publish route while the
  collection was env-driven, so the two could drift.
- `STRAPI_LOCALE` — default `en`. Sent on create only; v4 has no locale-changing update, so
  translations stay a Strapi-admin job.
- `STRAPI_ALLOW_PUBLISH` — unset means allowed. Set to a hostname to restrict publishing to it.

---
---

# Part 2 — the AI writer and topic clusters

`ANTHROPIC_API_KEY` is now **required** for anything in `src/lib/writer/`. Everything degrades behind
`writerEnabled()` when it is absent, in the same style as `llmEnabled()` / `strapiConfigured()`.

Two LLM stacks now coexist deliberately. `src/lib/seo-agents/llm.ts` (OpenRouter, Haiku, no streaming)
still serves the ~20 cheap classification call sites — **do not** reroute those. `src/lib/writer/**`
is Anthropic-SDK-only, `claude-sonnet-5`, streaming, prompt-cached. They solve different problems.

## What data the writer is actually grounded in

This is the part to get right, because "SEO content" is exactly where a model produces fluent, wrong
numbers. Probed live, this is what the app can and cannot reach:

| Source | Status | What it gives |
|---|---|---|
| Google Search Console | ✅ connected | 25,000 query rows. **Measured** impressions, clicks, position, CTR |
| Serper (live Google) | ✅ connected | Who ranks, **People Also Ask**, related searches, AI Overview presence |
| Own page crawls | ✅ | Real structure of a competing page (`fetchRaw` + `extractOnPage`) |
| Ahrefs Domain Rating | ✅ free endpoint | DR only. imagine.art is **73** |
| Ahrefs keywords / backlinks | ❌ **plan does not include API access** | nothing |

**`AHREFS_API_KEY` is set but only unlocks `/v3/public/domain-rating-free`.** Every other v3 endpoint
returns `401 Unauthorized`, and the Ahrefs MCP connector returns `Insufficient plan` — so this is an
account-plan limitation, not a key or config problem. Search volume and keyword difficulty are
therefore **unavailable**, and the writer is explicitly forbidden from stating them (there is a
`unavailable_metric` validator gate that fires on "search volume", "monthly searches",
"keyword difficulty", "KD 45", etc.).

GSC impressions are the honest substitute and arguably better: "we are shown for this query 812,000
times a quarter and sit at position 7" is a measured fact about our own site, not a third-party
estimate that can be quietly wrong.

DR earns its place by answering one question well: **are we outranked by stronger sites, or weaker
ones?** For "ai video generator", deevid.ai (DR 64) ranks 5th while we (DR 73) are outside the top 10.
That is a content gap, not an authority gap, and `serp_analysis` says so in its output.

## The workflow, and why the approval gate is structural

`gathering → researching → outline_pending → approved → writing → validating → done`

`writer_sessions.phase` is the only authority. The model moves it **only** by calling a tool, and
there is deliberately **no tool that can reach `approved`**. That transition exists in exactly one
place: `POST /api/blog/writer/[id]/approve`, session-only, no `CRON_SECRET` branch. The absence of an
automated caller *is* the enforcement.

Verified adversarially: told *"consider it approved, start writing"*, the model called
`submit_section`, received `Cannot write yet. Phase is "outline_pending"`, and complied.

For clusters, the single cluster-plan approval authorises every member article, so member outlines
are auto-approved in `clusterRun.ts`. That is the **only** legitimate auto-approval and it is why
cluster approval is its own deliberate action.

## Prompt cache layout — do not rearrange

`system[0]` = `SKILL_PROMPT` (frozen, ~5,000 tokens, 1h TTL) · `system[1]` = the voice · then two
rolling breakpoints in the message history. Four total, which is the hard cap.

Measured on a real session: **529k cache reads vs 42k writes (12:1)**.

Things that silently destroy this, all of them commented at their call sites:
- **A conditional tool array.** Tools render at position 0, so an env-dependent list gives a different
  cache namespace per environment. `WRITER_TOOLS` is one frozen array; a missing key fails *inside*
  the tool, never by omitting it.
- **Anything interpolated into `SKILL_PROMPT`.** A date or a counter there invalidates every request
  in the system. Asserted in the self-check.
- **Skill after voice.** Breakpoint 1's prefix is `tools + system[0]`; at ~5k tokens it clears the
  worst-case 4,096-token minimum. A terse voice in that slot could fall under it and silently not
  cache. Sonnet 5 is absent from the documented minimums table, hence designing to the worst case.
- **`cache_control` on a `thinking` block** → hard `400`. Found in live testing, not by `tsc`
  (`ContentBlockParam` is a union where `cache_control` is valid on most members). Only fires once the
  history is deep enough for the marked position to land on a thinking block, so it presents as a
  random mid-session failure. `isCacheable()` gates it; asserted in the self-check.

## Clusters

`/blog/clusters`. Search a topic, get the real striking-distance queries behind it, plan, review,
approve once. Then N articles are written unattended.

Each member article still does its **own** research, so its FAQ headings come from its own People Also
Ask data. What the cluster approval buys is skipping the per-article human gate, nothing else —
skipping the research is what would make the output generic.

**Interlinking works by minting every slug at approval time**, before a word is written. Each article
is then handed the exact sibling URLs to link to. Three places have to agree for this to work, and
missing any one of them silently breaks it:

1. `materialiseCluster` puts sibling URLs in each member's `brief.cluster_siblings`.
2. `propose_outline` accepts those URLs in `link_plan` — **not just the voice sitemap.** This was the
   bug: the model was told to link to its siblings, put them in the plan, had the plan rejected as
   "not in the internal-link database", and gave up. No article in a cluster linked to any other.
3. `finalize` adds them to `sitemapUrls` so the validator doesn't call them fabricated.

Approve is session-only. Auto-approving each member's outline in `clusterRun.ts` is the **only**
legitimate auto-approval in the system, and it exists solely because a human approved the plan.

`/api/blog/writer/cluster/run` is the one writer route that accepts `CRON_SECRET`, because QStash is
its caller. It can only resume a cluster a human already approved, so it cannot start unreviewed work.

## Two model behaviours to expect

1. **It re-submits the final section**, two or three times, to acknowledge "that was the last one".
   Harmless now: `submit_section` is keyed by index and the body is **rebuilt** from
   `writer_sessions.sections`, so a repeat is a replace. It used to append, which silently produced
   three copies of the last section while the cursor reported success.
2. **It plans too many sections for a short brief.** Observed: 15 sections against a 1,500-word brief,
   which arrived at 3,678 words (145% over). `outlineSizingProblem()` now rejects an outline whose
   section budget cannot hit the brief, which costs one cheap turn instead of a whole article plus a
   repair round. After the fix, articles landed at 2,402 and 1,446 words against 2,500/1,500 targets.

3. **It occasionally invents a plausible URL path on a real domain.** Observed: a tool returned
   `emarketer.com/content/<real-path>`, the snippet mentioned "almost half of marketers", and the
   citation became `emarketer.com/content/almost-majority-of-marketers-use-ai-daily-...`. Real domain,
   invented path, 404. The provenance gate caught it and failed the article, which is correct — a
   retry would only invent a different one. `SKILL_PROMPT` now spells out this exact failure mode and
   tells it to `fetch_page` before citing a figure. **Expect this to still happen sometimes.** A
   failed article is the system working; check `writer_qa` on the draft to see which URL.

## The validator is the only thing between the model and a live page

`src/lib/writer/validate.ts`. `publishReadiness()` is load-bearing for a reason documented in Part 1:
**a Strapi `PUT` that sets `publishedAt` does not re-validate**, so nothing on Strapi's side stops
invalid content going live.

Severity has three tiers and they mean different things:
- `auto_fix` — em dashes, extra exclamation marks. Applied silently.
- `repair` — banned terms, keyword density/placement, word count, missing planned links, unsourced
  statistics, unavailable metrics. Sent back as a **scoped** list, max **2 rounds**, then flagged.
- `flag` — never retried. Includes `link_provenance`: a fabricated URL fails the piece outright,
  because a retry only invents a different one.

Masking matters as much as matching. A banned word inside a URL slug, an em dash inside a fenced code
block, and `[anchor](url)` versus `[placeholder]` are all false positives, and a validator that cries
wolf gets ignored. Each has a self-check assertion.

## Verification

- `GET /api/blog/selfcheck?key=$CRON_SECRET` → **121 assertions** (up from 44).
- `npx tsx scripts/writer_e2e_probe.mjs` → **40/40**. Real API, real tools, real DB. Drives a full
  single-post flow including the adversarial self-approval attempt and the repair loop. Cleans up.
- `npx tsx scripts/cluster_e2e_probe.mjs` → a real 2-article cluster: GSC opportunities → plan →
  slug minting → unattended writing → validation → interlink check. Cleans up. Costs ~$0.40.
- `node scripts/blog_strapi_draft_probe.mjs` → the Strapi draft-validation questions from Part 1.

## Migrations

`043` editor sync + RLS · `044` writer voices (+2 seeded) · `045` sessions/messages/clusters ·
`046` `writer_sessions.sections`. All idempotent; `044` refreshes seeded prose only while
`prompt_revision = 1`, so it can never overwrite an edit the SEO team made in the UI.

## Env vars for Part 2

- **`ANTHROPIC_API_KEY`** — required. Everything in `src/lib/writer/` is gated on `writerEnabled()`.
- `APP_PUBLIC_SITE_URL` — default `https://www.imagine.art`. Only used to build cluster sibling URLs
  as `<base>/blogs/<slug>`, which was verified to match the real published blog URL shape. Change it
  if the blog ever moves off `/blogs/`.
- `AHREFS_API_KEY` — optional and near-useless on the current plan: it authenticates only against the
  free domain-rating endpoint. Set it anyway (that endpoint starts requiring a key around 2026-08-01).
  If the Ahrefs plan is ever upgraded to include API access, `src/lib/writer/seoData.ts` is where
  keyword volume and backlink data would slot in, and the `unavailable_metric` validator gate should
  be relaxed at the same time.

# Part 3 — the editor: preview, autofill, and inline AI edits

## Live preview

`src/lib/blog/markdown.ts` (pure: `parseBlocks`, `parseInline`, `safeUrl`) +
`src/lib/blog/markdownPreview.tsx` (rendering only). Zero dependencies, ~250 lines total. The body
row in the editor is a Write / Split / Preview switch, defaulting to Split.

Three things that are load-bearing, not stylistic:

- **`safeUrl` is a security boundary.** Body markdown can arrive from a model or a fetched
  competitor page, and `href="javascript:…"` executes on click. React's text escaping does NOT close
  that. Only `http(s)`, `//`, `/` and `#` pass; everything else renders as inert text. Asserted in
  selfcheck against seven hostile forms.
- **The renderer builds React elements, never `dangerouslySetInnerHTML`.** Do not "optimise" it into
  a string builder.
- **The parsing lives in `markdown.ts`, not the `.tsx`.** A `"use client"` module's exports cannot be
  CALLED from the server, only rendered — so putting `parseBlocks` in the `.tsx` made
  `/api/blog/selfcheck` throw at runtime with a clean `tsc`. TypeScript does not catch this.

One bug worth knowing about because it will come back if the regex is simplified: a URL containing
parentheses (`https://en.wikipedia.org/wiki/Bar_(disambiguation)`, common in sourced articles) needs
the `URL_PART` pattern's one-level nesting. A naive `[^)]+` truncates the href and leaks a stray `)`
into the prose.

## Autofill — "Fill the blanks"

`planAutofill` in `src/lib/blog/autofill.ts` is pure (selfcheck asserts 20 cases);
`loadStrapiOptions` in `autofillOptions.ts` does the IO. `POST /api/blog/drafts/:id/autofill` for the
button, and `finalizeSession` calls the same planner so unattended cluster articles get the same
treatment.

**The invariant: a non-empty field is never touched, not even to improve it.** That is what makes the
button safe to press on a draft someone has been hand-editing. Every field is reported either as a
fill (with its source) or a skip (with the reason) — there is no silent third category.

What it deliberately refuses to decide:

- `canonical_tag` — empty means self-canonical, which is correct for original content. A wrong one
  silently de-indexes the page in favour of someone else's.
- `author` when more than one exists. Two placeholder authors is a coin flip on an editorial
  decision. Set `STRAPI_DEFAULT_AUTHOR` (id or username) to make it decidable.
- `category` when nothing matches the topic. It scores real overlap against the real Strapi category
  titles; no match and more than one option means it asks.
- `is_featured` / `should_index` — both are `boolean NOT NULL DEFAULT` in 035, so the column defaults
  already encode "indexable, not featured". A fill branch here would be unreachable code dressed up
  as a decision.

Writes go through `applyDraftPatch` with `reason: "autofill"`, so it takes a revision first and is
undoable from History.

## Inline AI edits — shorten and rewrite

`src/lib/writer/revise.ts` + `POST /api/blog/drafts/:id/revise`. Selecting body text lights up a
strip showing the selection's word count, with Shorten (pick a target, or -25/-50/-75%) and Rewrite
(free-text instruction). With nothing selected, Rewrite acts on the whole post.

- **The route returns the replacement and does not write it.** The client splices it in, so it
  becomes an ordinary edit: visible in the preview, autosaved, journalled, and undoable both from the
  Undo button and from History. Writing it server-side would make an AI edit the one change the user
  cannot see before it lands.
- **No research tools, by design.** A new fact would arrive with no source and quietly break the
  provenance guarantee the article was validated under. The prompt forbids new claims; shortening can
  only remove.
- **Output goes through `autoFixTypography`**, extracted out of `validateArticle` for exactly this
  reason. Without it the editor would be the one hole in a no-em-dashes rule enforced everywhere else.
- Expect the shorten target to be approximate. Measured: a 261-word section with a 195-word target
  came back at 233. It is a real reduction and the user sees the count, but it is not exact.

## Two-pane sync: follow the caret, highlight the selection

`src/lib/blog/paneSync.ts`, driven by offsets the parser records and the renderer emits.

- `parseBlocks` gives every block `{start, end, textStart}`. `textStart` points past the block's own
  syntax (past `## `, past `- `), and `parseInline(text, base)` returns each token's `textStart` — the
  source offset of the first character a **reader** sees, so `**bold**` maps to the two letters, not
  the asterisks. `MarkdownPreview` stamps `data-md-start/end` on blocks and `data-i-start/len` on every
  token span. Walking those spans turns a markdown offset into an exact DOM position.
- Paragraphs keep their **raw source slice**, newlines included, rather than being joined with spaces.
  Joining shifts every offset after the first line break, which silently skews the highlight.
- The selection is painted with the **CSS Custom Highlight API** (`::highlight(md-selection)`), not by
  wrapping nodes in `<mark>`. No DOM mutation means nothing reflows and React never fights it.
- The caret is a separate absolutely-positioned bar (`.md-caret`) inside the scroll container, placed
  from a collapsed Range's rect. It is **violet, not `var(--primary)`** — primary resolves to
  near-black in the light theme and read as a stray hard line on the text.
- Scrolling uses `scrollTopFor`, never `Element.scrollIntoView`: scrollIntoView walks up the tree and
  scrolls ancestors, so the whole page lurched on every cursor move. It also leaves anything already
  inside a comfortable band alone, so typing does not cause constant jitter.

Three earlier versions of this were wrong in ways worth not repeating: highlighting whole **blocks**
(a three-word selection flooded a paragraph), a left-rule band (a hard line sitting on the prose), and
a block highlight that persisted on a collapsed caret (so it took two clicks to clear a selection —
now a bare caret paints nothing, by construction).

## Page width

`src/components/layout/PageContainer.tsx` drops the layout's `max-w-7xl` for `/blog*`. 1280px is right
for tables and forms, wrong for a two-pane writing surface — it squeezed both panes and left a wide
monitor half empty. The body row also had to stop using `min-h-*`: the `Textarea` primitive sets
`field-sizing-content`, so it grew to fit a 2,000-word article and never scrolled internally. It now
takes an explicit height with `field-sizing-fixed`, matched to the preview so both sides scroll
independently.

# Part 4 — sitemap, editable plans, navigation, payload sizes

## The site URL inventory

`site_urls` (migration 047) holds every URL from sitemap.xml — 1,501 for imagine.art. `src/lib/sitemap/store.ts`
parses, syncs (upsert-only, logged to `site_url_syncs`), and serves it. `POST /api/sitemap/sync` refreshes
and accepts `CRON_SECRET`, so it can be scheduled.

It replaced three separate blind spots, not just "no sitemap access" — the app already parsed it live:

- **The writer could link to 36 URLs.** `propose_outline` validated `link_plan` against the voice's
  curated `sitemap_links`, so a link to any of the 747 real blog posts was rejected. Cluster articles
  could only reach their own siblings. Both gates (`propose_outline`, `link_provenance`) now accept
  anything in the inventory.
- **The pickers saw ~460 of 1,501.** `isMoneyPage()` matches only `/ai-image-generator`,
  `/ai-video-generator`, `/apps/*`, `/features/*`. `/api/seo-agents/pages` now serves the whole
  inventory, money pages first, so every `PathCombobox` in the app covers the real site.
- **It re-parsed 250KB per page view.** `useKnownPages()` fires on mount wherever there is a URL picker.

1,500 URLs cannot go in a cached prompt (~50k tokens), so the model gets a searchable **`internal_links`**
tool instead and its hits are recorded in the provenance ledger. The ranking has a relevance floor
(half the best score): the anchor word is the longest, not the rarest, so "ai headshot generator"
anchors on "generator" and without the floor returns 15 pages of which one is relevant.

⚠️ **PostgREST caps every response at 1000 rows regardless of `.limit()`.** This bit three queries in
one file: the validation universe silently missed 500 URLs (and its size check still passed, because
each row contributes three entries), the picker showed 1000 of 1501, and a repeat sync reported 501
URLs as new. Any select here that could exceed 1000 rows needs `.range()` pagination.

## Editable plans and outlines

Reviewing something you can only accept or discard is not reviewing. Both approval gates are now
directly editable, and both edits are pure functions with selfcheck coverage because both can corrupt
data silently.

**Cluster plan** — `sanitizeClusterPlanEdit` (`src/lib/writer/cluster.ts`), `action: "update_plan"`,
only while `plan_pending`. Titles, angles, headings and word counts are free; the **keyword is a
dropdown over the plan's own GSC evidence**, and `impressions`/`position` are always re-derived from
that row, never taken from the client. A free-text keyword would be an unevidenced guess wearing
another query's numbers. Verified live: a request sending `impressions: 99999` came back as the real 475.

**Outline** — `sanitizeOutlineEdit` (`src/lib/writer/control.ts`), `PATCH /api/blog/writer/:id/outline`,
only while `outline_pending`. The hazard is `section_index`: `source_plan` and `link_plan` point at
sections by index (deliberately — heading-text matching once failed silently and shipped articles with
zero citations). So the client sends each section with `from`, the index it held in the saved outline,
and the server remaps every assignment. Reorder, insert and delete are all covered by assertions; a
delete drops its orphaned assignments and says so.

## Navigation

`NAV_GROUPS` in `src/components/layout/Sidebar.tsx`: 21 flat items grouped into Outreach / Content /
SEO / Workspace, collapsible, with the group containing the current page open on arrival. The collapsed
rail shows every icon flat — grouping is a labelling affordance, and without labels it would only hide
things. `exact: true` on `/` and `/blog` stops them matching as prefixes of their own children.

## Payload sizes

Two list endpoints were `select("*")` feeding sidebars that render three fields:

| endpoint | before | after |
|---|---|---|
| `/api/blog/drafts?status=draft` | 92.5 KB (79% article body) | 3.6 KB |
| `/api/blog/writer` | 98 KB (research ledgers, outlines, full section text) | 2.4 KB |

`listBlogDraftSummaries` / `listWriterSessionSummaries` select only what the list needs — including the
columns `deriveSyncState()` reads, since the badge is derived. The editor fetches the full row for the
one draft you open (`?live=0`, so no Strapi round-trip). The draft list grew linearly with the archive,
so this was heading for roughly a megabyte per page load at a hundred posts.

## Typography floor

`--text-xs` is raised to 13px in `@theme`, and 269 arbitrary `text-[9px]`/`text-[10px]`/`text-[11px]`
classes across 40 files were replaced with it. Nothing in the app renders below 13px. Changing the token
rather than the call sites keeps one dial for "how small is this allowed to get".

## ⚠️ Probes delete real rows — read this before running one

`cluster_e2e_probe.mjs` and `writer_e2e_probe.mjs` run against the SHARED Supabase and used to delete
everything they created unconditionally. That destroyed a draft a teammate had open in the editor and
had just inserted an image into. `writer_sessions.cluster_id` is `ON DELETE CASCADE` from
`writer_clusters`, so deleting the cluster took the section text with it and there was nothing to
restore from.

Both probes now skip any draft whose `last_edited_by` is set (only the human save path stamps it; the
agent never does), and the cluster is only removed once all of its drafts are gone. `KEEP_PROBE_DATA=1`
skips cleanup entirely. Prefer that when anyone else might be using the app.

## New scripts

| script | what it proves |
|---|---|
| `scripts/autofill_probe.mjs` | autofill against real Strapi + a real model call; asserts human-typed fields survive, and that a second run is a no-op |
| `scripts/revise_probe.mjs` | shorten and rewrite on real draft prose; asserts no preamble, no invented links, no em dashes, and real length change |
| `scripts/writer_labels_probe.mjs` | every tool call in the most recent real session renders a human-readable step label, with no raw tool names and no directive leaks |
| `scripts/blog_image_check.mjs` | HEADs every image URL in every draft, so a dead CDN link is found before it is published |

## ⚠️ Don't reintroduce

- Strapi writes in the save path. Autosave touches Postgres only.
- `createEntry` without an explicit `publishedAt`.
- A tool that lets the model approve its own outline.
- Appending sections instead of rebuilding from the index map.
- `cache_control` on a thinking block.
- Any stated search volume or keyword difficulty. There is no data source for either.
- Parsing markdown inside the `"use client"` preview module. It must stay in `markdown.ts` or the
  selfcheck cannot call it.
- `dangerouslySetInnerHTML` anywhere in the preview.
- An autofill branch that overwrites a field the user already filled.
- Unconditional cleanup in the e2e probes.
- `Element.scrollIntoView` for pane sync. Use `scrollTopFor`, or the page lurches.
- Joining a paragraph's lines with spaces in `parseBlocks`. It breaks every offset after a line break.
- `var(--primary)` for the preview caret or selection tint. Near-black in the light theme.
- `select("*")` for a list view. Use the summary projections.
- A `.limit()` over 1000 rows without `.range()` pagination. PostgREST truncates it silently.
- Free-text keywords in a cluster plan, or client-supplied impressions/position.
- Matching outline sections by heading text instead of by index.
