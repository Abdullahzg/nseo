# Blog content cluster template

This is the format the team has standardized on for blog clusters (superseding an older, much lighter
"pillar + 3 bullet points" version — if you ever see that older style in Notion under a page called
"Clusters," it's legacy; build new clusters in the format below instead).

## Input shape

The person asking for this will give you one of:
- A **money/landing page URL** to support (most common — e.g. an industry or product landing page that
  should rank #1 for its commercial terms), or
- A **topic** with no specific URL yet (build the cluster around the topic itself, and note that a landing
  page should eventually anchor it).

Either way, the deliverable is the same: one pillar post + 3-5 supporting posts, fully keyword-researched,
explicitly interlinked, logged as a single page in the **Blog Clusters** Notion database (schema in
`notion-database.md` — it's intentionally just a title; everything else lives in the page body).

## What goes in the plan, in order

1. **Header block:** money page (linked), the goal in one sentence ("build topical authority around this
   page so it can rank #1 for its core commercial terms"), and the target domain's DR with a one-line
   read on whether that DR can compete for the keywords you're about to propose (check current SERP
   composition in Ahrefs — don't assume).
2. **Existing pages to route around:** pull the site's current organic keywords for terms adjacent to the
   topic (`site-explorer-organic-keywords` on imagine.art, plus a scan of `site-explorer-crawled-pages` for
   URLs that already touch the topic). List any page that's already ranking (even weakly) for adjacent
   terms, in a small table (page → keywords it touches). The new cluster should **link to** these pages
   to reinforce them, not duplicate or cannibalize them. This step is where you decide the cluster's real
   boundaries — if something's already covered, that's not part of your open lane.
3. **Cluster structure — 1 pillar + 3 to 5 supporting posts.** Supporting posts should map 1:1 to natural
   sections/features of the money page wherever possible, so every one of them has an obvious, non-forced
   link into it. For each post (pillar and every supporting post):
   - Title (working title is fine)
   - Slug suggestion (`/blogs/...`, matching existing site conventions)
   - Primary target keyword with **volume and KD from Ahrefs** (never estimate)
   - Secondary target keyword(s) with volume/KD
   - Search intent (informational, commercial, informational→commercial, etc.) — this is what "keyword
     research according to intent" means: a pillar is usually broad/informational since it needs to rank
     on the biggest, easiest term in the space and hand traffic downward; supporting posts skew toward
     informational→commercial since they're the bridge between someone researching and someone ready to
     use the product; only the money page itself is fully commercial/transactional.
   - SERP proof: who currently ranks for the primary keyword, at what DR, and why that means the target
     domain can (or can't, or can with caveats) compete. This is the single most persuasive part of the
     plan — a specific competitor example ("packify.ai, DR 36, ranks #1") is worth more than an abstract
     KD number.
   - What section of the money page this post supports / links into
   - Which other posts in the cluster it links to (see interlinking rules below)
   - (Pillar only) a content outline — the sections a writer would actually draft, each tied to a
     supporting post it should link out to.
4. **Interlinking rules**, as an explicit numbered list, always covering:
   - Every supporting post links to the money page at least once (varied anchor text).
   - Every supporting post links up to the pillar; the pillar links down to every supporting post.
   - Supporting posts cross-link only to topically adjacent neighbors, not a full mesh — keeps anchor text
     natural and avoids link-spam patterns.
   - Any post that overlaps with an "existing page to route around" links to that page instead of
     competing with it.
   - The money page itself should link back down into the pillar somewhere (FAQ or footer), closing the loop.
5. **Suggested rollout order** — which posts to publish first. Default heuristic: lowest KD + clearest
   SERP proof first (fastest wins, and they give the pillar something to link down to once it publishes),
   then the pillar, then the remaining supporting posts.
6. **Next steps / open items** — always flag: confirm slugs against actual CMS conventions, note the date
   the Ahrefs data was pulled (volumes/KD drift), and offer to turn any single post into a full content
   brief or draft.

## Writing it into Notion

Create one page in the Blog Clusters database (`data_source_id` in `notion-database.md`) titled after the
cluster (e.g. "AI for F&B Creatives — Content Cluster Plan"). Put the entire plan above into that page's
body as the content, using headings for each section and a real Markdown table for the "existing pages"
list. Don't split the cluster across multiple Notion pages — one cluster, one page, so it reads the same
way a person would hand it over as a single doc.

## Worked example (the canonical reference — match this level of detail)

See the "AI for F&B Creatives — Content Cluster Plan" page in the Blog Clusters database for a full,
real example built to this spec: a money page at `/business/industries/ai-for-fb-creatives`, DR 73,
4 existing pages routed around, a pillar ("Food & Beverage Marketing in the AI Era") plus 4 supporting
posts (food photography, product photography, POS/packaging, advertising) each mapped to a landing-page
section, full interlinking rules, and a rollout order. When building a new cluster, aim to match its level
of specificity — real Ahrefs numbers, named SERP competitors with their DR, and concrete link targets
rather than generic advice.
