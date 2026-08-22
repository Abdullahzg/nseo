# Notion: "Cluster Page + Blog Research" workspace

Parent page: `https://app.notion.com/p/3aa0152cd769809ba82cc1079e7444b2` (titled "Cluster Page + Blog
Research" — it was renamed from "Cluster Page Research" once the Blog Clusters database was added; don't
be thrown if you see either name in old notes). Ancestor chain: CPDH - ImagineArt Web → Organic Campaigns
→ SEO → ImagineArt SEO → SEO/Content → Cluster Page + Blog Research.

That page contains **two** inline databases. Fetch the parent page first with the Notion `fetch` tool to
confirm both database URLs still resolve the same way — Notion IDs are stable but the page could be
restructured, so treat the values below as a fast path, not gospel:

- **"Page List+KW research"** — single-page opportunities (Step-by-step workflow in the main SKILL.md).
  Data source: `collection://3aa0152c-d769-80aa-a47b-000bbb7d5071`
- **"Blog Clusters"** — full pillar+supporting blog cluster plans (see `blog-cluster-template.md`).
  Data source: `collection://3aa0152c-d769-809a-a172-000b34883d6a`

## Page List+KW research: schema

| Property | Type | Values / notes |
|---|---|---|
| `Page Title ` (note trailing space in the property name) | title | The proposed page's working title |
| `Status` | status | `Not started` / `In progress` / `Written` / `Published` — tracks whether the *actual site page* has been built, not whether the research is done. Don't assume "Not started" means the row is empty; check the page body. |
| `Relevance` | select | `Image` / `Video` / `Computer` — the pillar this page supports. Studio-specific ideas get tagged under whichever pillar they support (Ad Studio & Audio Studio comparison pages → `Video`; Imagine Computer features → `Computer`). |
| `Owner` | person | Usually unset for freshly-researched rows |
| `Position 2 weeks` | text | SERP tracking field, not something this skill needs to fill in |

## Querying existing rows (dedupe check)

Use `notion-query-data-sources` in SQL mode against the collection URL. Example — get every title already
proposed for a pillar before brainstorming new ones:

```json
{
  "data": {
    "data_source_urls": ["collection://3aa0152c-d769-80aa-a47b-000bbb7d5071"],
    "query": "SELECT \"Page Title \" FROM \"collection://3aa0152c-d769-80aa-a47b-000bbb7d5071\" WHERE Relevance = 'Computer' ORDER BY \"Page Title \""
  }
}
```

Note the trailing space inside the quoted column name — it's easy to drop and the query will fail to find
the column. If you get rate-limited (`429`, `rate_limited`), wait ~30s and retry once; don't hammer it.

To check for a genuinely blank/stub row worth reusing instead of creating a new page, look for rows where
`Page Title` is null or empty.

## The content template (page body)

Every researched row's page body uses this exact Markdown structure — match it precisely so the sheet
reads consistently across ~150+ rows written by different sessions:

```markdown
### Primary Keyword
**<primary keyword>** — GSV: <volume, comma-formatted> | KD: <difficulty or "N/A">
### Secondary Keywords
- <secondary keyword 1> — GSV: <volume> | KD: <difficulty or "N/A">
- <secondary keyword 2> — GSV: <volume> | KD: <difficulty or "N/A">
### Recommended FAQs
- <question 1>
- <question 2>
- <question 3>
### Notes
<1-3 sentences: why this is a good opportunity, and one line confirming the dedupe check you ran
(what you checked against imagine.art, and what you found).>
```

Real example already in the sheet (row: "AI Agent Platform (Imagine Computer)"):

```markdown
### Primary Keyword
**ai agent platform** — GSV: 2,200 | KD: 46
### Secondary Keywords
- agentic ai — GSV: 101,000 | KD: 76
- ai agent — GSV: 18,000 | KD: 83
### Recommended FAQs
- What's the difference between an AI agent and a chatbot?
- Can Imagine Computer connect to my existing marketing and design tools?
- Does it support multi-step, multi-app workflows?
- What integrations and MCP servers are supported?
### Notes
Best primary-KW opportunity in this bucket: real volume (2,200) at moderate KD (46).
```

## Writing new rows

**Creating a brand-new opportunity** — use `notion-create-pages` with the database's data source as the
parent (`{"type": "data_source_id", "data_source_id": "3aa0152c-d769-80aa-a47b-000bbb7d5071"}`), set
`properties` to `{"Page Title ": "<title>", "Relevance": "<Image|Video|Computer>"}`, and pass the template
markdown above as `content`. `Status` will default; only set it explicitly if you have a reason to mark it
something other than "Not started."

**Filling in a blank/stub row found during the dedupe check** — use `notion-update-page` with
`command: "update_properties"` to set the title/relevance, then a second call with
`command: "insert_content"` and `position: {"type": "end"}` to add the template body. Don't create a new
row when a usable blank one already exists.

## Blog Clusters: schema

Deliberately minimal — one property:

| Property | Type | Notes |
|---|---|---|
| `Name` | title | The cluster's name, e.g. "AI for F&B Creatives — Content Cluster Plan" |

Everything else — money page, goal, DR read, existing-pages table, the pillar + supporting post specs,
interlinking rules, rollout order, next steps — goes in the page body as one continuous document. Full
content structure and a worked example are in `blog-cluster-template.md`. One cluster = one Notion page;
don't split a cluster across multiple rows or sub-pages.

Create with `notion-create-pages`, parent `{"type": "data_source_id", "data_source_id":
"3aa0152c-d769-809a-a172-000b34883d6a"}`, `properties: {"Name": "<cluster title>"}`, and the full plan as
`content`.
