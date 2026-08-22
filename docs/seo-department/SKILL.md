---
name: imagineart-seo-department
description: Research new SEO page and blog opportunities for ImagineArt (imagine.art) — AI Image, AI Video, Imagine Computer, any Studio (Ad/Audio/Film/Fashion/Image/Music/new), plus blog content clusters supporting a landing page or topic. Checks imagine.art for duplicate pages first, then runs Ahrefs keyword research (1 primary + 2 secondary keywords with real volume/difficulty for single pages; a pillar + 3-5 supporting posts with intent-based keywords, SERP proof, and interlinking rules for blog clusters), drafts FAQs, and logs it into the house Notion databases. Use when a teammate asks for new page ideas, cluster/featured pages, content gaps, blog topics, a cluster to support a landing page, or SEO opportunities for any ImagineArt product/studio launch — even without the word "SEO". Trigger on "what pages should support Imagine Computer," "blog opportunities for the studio we're launching," "cluster pages for AI video," "build a blog cluster around this landing page." Always dedupe-check before proposing a title.
---

# ImagineArt SEO Department

This skill is meant to act like a standing SEO researcher for the ImagineArt team — the person you hand a
vague ask to and get back validated, Ahrefs-backed research logged in the right place. It currently covers
two related but distinct asks, both logged into the same Notion workspace:

- **Workflow A — single page opportunities.** A vague ask like "we need pages to support Imagine
  Computer" becomes a list of validated, non-duplicate page ideas — each with a primary keyword, two
  secondary keywords, real Ahrefs volume/difficulty, and recommended FAQs — logged into the "Page
  List+KW research" database.
- **Workflow B — blog content clusters.** A topic, or a specific landing page someone wants to rank #1,
  becomes a full pillar + 3-5 supporting-post blog cluster — keyword-researched by intent, explicitly
  interlinked, logged as one page into the "Blog Clusters" database.

Figure out which one the person means before you start (see "Which workflow?" below), then follow that
workflow's steps.

The three things that make this valuable, in order of importance:

1. **It never suggests something that already exists.** ImagineArt's site is large and grows fast (there
   are already 100+ dedicated Music Studio pages alone). Suggesting a page that's already live wastes
   writing time and creates cannibalization. The dedupe check in Step 1 is not optional.
2. **The keywords are real, not guessed.** Every number comes from Ahrefs. Nobody has to double check
   your work before writing a brief off it.
3. **It fits into the existing workflow.** The Notion database already has ~150 rows written in a
   specific format (see `references/notion-database.md`). New research should look like it was written
   by the same person who did the rest, not like a one-off experiment.

## Before you start: read the reference files

- `references/notion-database.md` — both Notion DB URLs/schemas, content templates, and how to query/write to each.
- `references/ahrefs-playbook.md` — which Ahrefs tools to call, with working parameters (the API is easy to
  call wrong; this file has copy-pasteable examples for every step below).
- `references/imagineart-landscape.md` — the studios/product lines that exist today, their live URL
  patterns, and their known named competitors, so you don't have to rediscover this from scratch every time.
  Update this file when you learn something new (a new studio launches, a competitor page goes live, etc.)
  so the next run starts smarter.
- `references/blog-cluster-template.md` — read this one before doing any Workflow B (blog cluster) work.
  It has the full structure and a complete worked example to match the level of detail on.
- `references/templates/index.md` — saved page templates (Video T1, Image T7, MCP, Ad Studio, ...) for
  Workflow C (drafting content). Check this whenever someone names a template.
- `references/brand-voice/index.md` — the three saved tone-of-voice options for Workflow C. Read this
  before drafting any content — Workflow C requires presenting these as a choice, never defaulting silently.

## Which workflow?

If the person names a single page/topic idea, or asks generally "what pages should we build for X" — that's
Workflow A. If they name (or imply) a **landing page that needs to rank**, ask for a **cluster of blog
posts**, or talk about a pillar with supporting content around it — that's Workflow B. When genuinely
ambiguous, ask; most of the time the phrasing makes it obvious.

## Workflow A — single page opportunities

### Step 0 — Scope the request

Figure out which pillar the teammate means: AI Image, AI Video, Imagine Computer, or a specific Studio
(Ad Studio, Audio Studio, Film Studio, Fashion Studio, Image Studio, Music Studio, or a brand-new one that
just launched). If they said "any studio we've launched," check `references/imagineart-landscape.md` for
the current list and ask only if it's genuinely ambiguous which one they mean — most of the time the
request itself makes it clear.

If they gave a number ("find me 5 opportunities"), respect it. If they didn't, default to quality over
quantity: 3-8 well-validated opportunities beat 20 shallow ones.

### Step 1 — Pull what's already been proposed (Notion) and what's already live (site)

Do both of these before brainstorming a single title. Skipping this step is the single most common way
this research goes wrong.

**Notion side:** Fetch the "Cluster Page + Blog Research" page and its "Page List+KW research" inline
database (URLs and query syntax in `references/notion-database.md`). Query existing `Page Title` + `Relevance` values relevant to the pillar
in scope. Anything that's a close semantic match to an idea you're about to propose gets dropped — don't
re-propose "AI Song Generator" if it's already a row, even if the exact keyword differs.

**Site side:** Use Ahrefs `site-explorer-crawled-pages` filtered by `url` `isubstring` on the candidate
product/keyword term (mode=`subdomains`, `http_code eq 200`), and cross-check with a `site:imagine.art
"<term>"` web search. Use both — Ahrefs' crawl cache can lag a page that just shipped, and a plain web
search sometimes surfaces pages Ahrefs hasn't recrawled yet. If a close match is already live, either drop
the idea entirely or reframe it around a genuinely different keyword/angle — never write it up as if it
were still open.

This step is also how you find *gaps*: e.g. if Ad Studio and Audio Studio both already have
"ImagineArt [Studio] vs [Named Competitor]" rows in Notion, and Film Studio doesn't, that asymmetry itself
is a signal — Film Studio is missing a comparison page it should have.

### Step 2 — Find the opportunities

Use whichever of these fits the pillar in scope; usually a mix of two or three:

- **Competitor-gap:** Pick 2-4 named competitors for the pillar (see `references/imagineart-landscape.md`
  for the current list per studio). Run `keywords-explorer-related-terms` and `site-explorer-organic-keywords`
  against them to see what they rank for that ImagineArt has no page for.
- **Keyword expansion:** Run `keywords-explorer-related-terms` (both `also_rank_for` and `also_talk_about`)
  and `keywords-explorer-search-suggestions` off the pillar's seed terms (e.g. "ai video generator",
  "imagine computer", "ai agent").
- **Use-case / audience mining:** Narrow, job-specific angles convert well even at modest volume — the
  existing sheet is full of these ("Agentic AI for Healthcare Marketing," "AI Wedding Photo Editor"). Think
  about who's searching and why, not just what has the biggest number.

For every candidate, before it earns a spot on the list, pull real numbers with
`keywords-explorer-overview`. Favor real volume (roughly 100+ monthly searches) at an achievable difficulty,
but branded "X vs Y" comparison pages are a deliberate exception — they intentionally target a competitor's
brand modifier and accept low standalone volume because they convert on competitive/bottom-funnel intent
(see the many `ImagineArt vs [Competitor]` rows already in the sheet).

### Step 3 — Keyword research: exactly 1 primary + 2 secondary

- **Primary keyword:** the single term the page should be built to rank for. Usually the highest-volume,
  most directly on-topic term with a difficulty that's actually achievable — not just the biggest number
  you found.
- **Secondary keywords (2):** supporting terms. Good choices are a close variant, an informational
  "how to" angle, or (for comparison pages) the competitor's branded modifier. Pull all numbers from
  `keywords-explorer-overview` — never estimate or round from memory.
- Report every keyword as `keyword — GSV: <volume> | KD: <difficulty>`, using `KD: N/A` when Ahrefs returns
  a null difficulty. This exact notation matches the existing ~150 rows in the sheet — consistency matters
  because other people read this sheet.

### Step 4 — Recommended FAQs

Write 3-5 questions the way an actual prospect would type them into Google or ask a sales rep — not generic
filler. For comparison pages, lead with differentiation ("what's the difference between X and Y").
For feature/capability pages, lead with "can it do X" / "does it support Y" questions. Always include at
least one buying-decision question (pricing, free tier, "is there a catch").

### Step 5 — Write it into Notion

Full mechanics (property names, exact markdown template, how to create vs. update a row) are in
`references/notion-database.md`. In short:

- **New opportunity:** create a page under the database's data source with `Page Title` and `Relevance`
  set (`Status` defaults to "Not started" unless told otherwise), then insert the research using the exact
  template block (Primary Keyword / Secondary Keywords / Recommended FAQs / Notes).
- **Existing blank/stub row found during Step 1:** fill that row in instead of creating a new one — don't
  leave duplicate empty rows lying around.
- The `Notes` section should always state the dupe-check result in one line (what you checked, what you
  found) so the next person doesn't have to redo that work to trust the row.

### Step 6 — Report back

Tell the person what you added: how many opportunities, which pillar/studio, any standout finds (unusually
high volume, unusually low difficulty), and anything you explicitly rejected as a duplicate and why. Link
the Notion page. Keep this summary short — the detail lives in Notion, not in the chat reply.

## Workflow B — blog content clusters

Read `references/blog-cluster-template.md` fully before doing this — it has the exact section-by-section
structure and a complete worked example (the "AI for F&B Creatives" cluster) to calibrate the level of
detail against. The summary:

### Step 0 — Get the target

You need either a money/landing page URL to support, or a topic. If it's a URL, actually open/read it (or
at least its metadata via Ahrefs `site-explorer-organic-keywords` on that exact URL) so the cluster's
supporting posts map to real sections/features of the page, not guessed ones.

### Step 1 — Ground it in reality before writing anything

Pull the target domain's DR (`site-explorer-domain-rating` or from any Ahrefs call that returns it) and
form a one-line view on whether that DR is competitive for the space. Then check for existing pages that
already touch the topic (`site-explorer-organic-keywords` + `site-explorer-crawled-pages` on imagine.art,
scoped to the topic) — these become "route around, don't duplicate" entries, and they're often also where
you find natural internal-link targets for the new cluster.

### Step 2 — Design the cluster: 1 pillar + 3-5 supporting posts

Supporting posts should map roughly 1:1 to sections/features of the money page. For each post (pillar
included) work out: title, slug, primary + secondary keywords **with real Ahrefs volume/KD**, search intent,
and SERP proof (who ranks now, at what DR, and why that means the target domain can compete — a named
example beats an abstract KD score). The pillar targets the broadest, easiest term in the space since
everything else links up to it; supporting posts skew informational→commercial as the bridge between
research and product use.

### Step 3 — Interlinking rules + rollout order

Write explicit interlinking rules (every post → money page, every post ↔ pillar, adjacent-only cross-links,
links to any "route around" pages you found in Step 1, money page links back to the pillar) and a
suggested rollout order (lowest-KD/clearest-proof posts first, pillar once it has posts to link down to,
then the rest). Full detail on what these rules should cover is in the reference file.

### Step 4 — Write it into Notion

One cluster = one page in the "Blog Clusters" database (schema + creation mechanics in
`references/notion-database.md`), titled after the cluster, with the entire plan as the page body.

### Step 5 — Report back

Summarize what you built (pillar + how many supporting posts, the money page, any standout keyword finds)
and link the Notion page — keep the chat reply short, the detail lives in Notion.

## A note on judgment

Today's models are good at this kind of research when they understand *why* each step matters, not just
that it's a checklist. If a request doesn't map cleanly onto "pillar + studio" (e.g. someone asks for
something cross-cutting, like "pages that would help all our studios at once"), use your judgment about
how to scope the work rather than forcing it into the Image/Video/Computer buckets — those are the current
`Relevance` options in Notion, but the underlying goal is always "find real, non-duplicate, well-targeted
page opportunities," and the buckets are a means to that end, not the point of the exercise.

## Workflow C — drafting the content itself

This extends the skill past research into actually writing the page/post, using the logged keyword/FAQ
research plus two saved ingredients: a structural template and a tone of voice.

### Step 0 — Match the template

`references/templates/index.md` is the lookup table (currently Video T1, Image T7, MCP, and Ad Studio; more
get added the same way whenever the person hands over a new one). If someone says "I need content for video
T1" or names any other template in that index, that's your structural spec — follow it exactly (heading
levels, word counts, section order, formatting quirks like Image T7's bulleted sections or MCP's fixed
setup-step copy). If they name a template that isn't in the index yet, ask for it and save it the same way
rather than improvising a shape that seems close.

### Step 1 — Present the tone-of-voice choice before writing anything

This step is mandatory and comes before any drafting, every time. Read `references/brand-voice/index.md`
and present the three saved options to the person — Misher Writer, ImagineArt Blog Tone of Voice, and
ImagineArt Landing Page Tone of Voice — and wait for them to pick. It's fine to name the obvious house
default for the content type (blog post → Blog Tone of Voice; feature/landing page → Landing Page Tone of
Voice) as a suggestion, but never silently apply a default or guess — always surface all three and let the
person choose or override.

Do not draft a single word of prose until this choice is made. If drafting multiple pages in one batch, ask
once up front whether the same tone applies to all of them or whether it varies per page.

### Step 2 — Write the draft

Combine the matched template's structure with the page's existing keyword/FAQ research and the chosen
tone-of-voice file (`references/brand-voice/misher-writer-tone.md`, `blog-tone-of-voice.md`, or
`landing-page-tone-of-voice.md`). Beyond the specific guide picked, always enforce the constraints all three
guides agree on (also summarized in `brand-voice/index.md`): no em dashes, no random mid-sentence bolding,
sentence case in headings, no banned generic-AI phrases, every claim backed by a number/name/mechanism
rather than an adjective, and — if using a wittier register — at most one joke per section.

### Step 3 — Flag anything that doesn't fit cleanly

If a template calls for a section the research doesn't actually support (e.g. a testimonial count with no
real testimonials on hand), say so rather than inventing detail that reads as filler. Placeholder
testimonials should be clearly marked as placeholders, not presented as real.
