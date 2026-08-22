# Hermes for Summit — the tool surface

How to give Summit a Hermes brain **without touching forge**, and what tools it should get.

Written after reading forge at `48e84b2`. It copies forge's *pattern*, never its *instance*.

---

## 1. Isolation from forge — read this first

forge's Hermes is a live service the ads team depends on. Nothing here goes near it.

| | forge | Summit |
|---|---|---|
| Host | `imagine-forge` VPS, `forge.imagine.art` | **your own** host (Fly / Render / a VM) |
| Service | `forge-hermes.service`, port **8003** | separate process, **any port** — pick 8103 to avoid muscle-memory collisions |
| Proxy path | Caddy `/hermes/*` → 8003 | your own reverse proxy, own domain |
| Engine it calls | `FORGE_API_URL` → forge's FastAPI on 8002 | **`SUMMIT_API_URL`** → Summit's Next.js API |
| Auth header | `X-Forge-Service-Token` | **`Authorization: Bearer`** (as built — Summit's proxy and routes already speak Bearer, so a custom header would have needed a second code path for no gain) |
| Database | forge's managed Postgres | Summit's Supabase |
| Tool file | `apps/hermes/forge_tools.py` (43 tools) | **`hermes/summit_tools.py`** (13 tools) — own file, zero shared code |

**The three rules that keep them apart:**

1. **Separate deployment.** Do not add Summit tools to `Vyro-ai/forge`. Do not point Summit at
   `forge.imagine.art/hermes`. Copy `apps/hermes/` into a new repo (or a `hermes/` directory in
   `seo_email`) and edit from there. forge's repo is never modified.
2. **Separate env namespace.** Every var is `SUMMIT_*`, never `FORGE_*`. If both ever land on one box,
   a shared name is how Summit's agent starts publishing Meta ads.
3. **Separate credentials.** Its own `ANTHROPIC_API_KEY` budget line, its own service token. A revoked
   forge token must never break Summit and vice versa.

What you legitimately copy: `agent_loop.py` (the Anthropic tool-use loop — model, streaming, parallel
fan-out, history), `server.py` (the `/health`, `/chat`, `/chat/stream`, `/chat/stop`, `/chat/reset`
shape), and the `@_tool` registration idiom. That is architecture, not forge's product.

---

## 2. The shape, in one paragraph

Hermes is **not** a research service. It is an Anthropic tool-use loop whose tools are thin async HTTP
clients onto *your own API* — the same endpoints your pages call. forge's own file says it: *"Every
tool is a thin async HTTP client onto the Forge engine — the same surface the manual pages use."* The
agent is an operator, not an oracle. That is why it is useful: it can do anything the product can do,
and it needs no new business logic.

```
Summit web (Next.js)  ──chat──▶  Summit Hermes (:8103)
                                   │  Anthropic tool-use loop, claude-opus-4-8
                                   │  system = SOUL.md + skill docs (cached per process)
                                   ▼
                                 tools = thin HTTP clients
                                   │  X-Summit-Service-Token
                                   ▼
                                 Summit API (/api/*)  ──▶  Supabase, GSC, fal, Strapi
```

**This prerequisite is now BUILT** (it was the blocker for everything else). `src/lib/auth/service.ts`
holds one `identifyCaller(req)` that recognises a signed-in person, `CRON_SECRET`, or `HERMES_TOKEN`,
compares secrets in constant time, and hands back an actor string for attribution.

The part that is easy to miss: the token must be recognised in **two** places. `src/proxy.ts` runs
*before* any route and redirects anything it does not recognise to `/login` — so a token known only to
the route gets login HTML back with a **200**, no error and no explanation. Both are wired.

---

## 3. Augment, never replace

The standing rule, applied to both areas you asked about.

### Backlink discovery

Current path stays exactly as it is: `runBacklinkDiscovery()` → `runBacklinkTargets()` → our
harvesters. Hermes adds a **second source** whose results merge into the same
`backlink_prospects` table and are scored by the same `authorScoring`.

```
runBacklinkDiscovery(target)
  ├─ runBacklinkTargets()          ← unchanged, always runs
  └─ hermes_discover_prospects()   ← additive, only when hermesEnabled()
       └─ merge → dedupe on domain → score with authorScoring → same table
```

Why augment is genuinely correct here and not just caution: our harvesters are cheap, fast and already
tuned; Hermes is a browser session per page. Hermes earns its cost on the pages our plain `fetch`
**cannot read** — the ones behind bot protection, which are disproportionately the high-DR publishers
worth having. So it is a specialist, not a replacement.

Already live, and the model for the rest: **cascade step 5.5** in `src/lib/enrich/cascade.ts`. Steps
1–5 (cheap) run first; Hermes only fires when they have all failed, *before* we fall back to a
constructed guess. It is the single point where bounces are manufactured, so it is the highest-value
augmentation in the codebase.

### GenAI news / model launches

Current path stays: the writer's `web_search` + `fetch_page` on Tavily/Serper with a provenance
ledger. Hermes adds `hermes_research()` for **sources that block a plain fetch**, and a scheduled sweep
that fills a news table.

Be clear-eyed about the value: for ordinary pages Tavily is cheaper and already grounded. Hermes wins
on rendered/protected pages. Wiring it as the *primary* research path would spend a browser session to
do what Tavily does for a fraction of the cost.

---

## 4. The tool surface for Summit

Grouped by what they operate. Each is a thin HTTP client onto an existing route — no new logic.

### Research & discovery (the augmenting half)
| Tool | Calls | Notes |
|---|---|---|
| `research_topic` | Hermes-internal (browser) | Returns `{answer, sources[]}`. Sources kept separate from prose so the writer's no-invented-citations rule can check them. |
| `discover_backlink_prospects` | `POST /api/backlinks/[id]/action {discover}` | Additive to the existing harvesters. |
| `scrape_page` | Hermes-internal (Camoufox) | Last-resort page read. Already used by cascade 5.5. |
| `find_email` | `POST /api/enrich/run` | Runs the existing cascade; does not reimplement it. |

### Content
| Tool | Calls |
|---|---|
| `list_ideas` / `capture_idea` | the news/ideas table (§5) |
| `start_draft` | `POST /api/blog/drafts` |
| `plan_cluster` / `run_cluster` | `POST /api/blog/writer/cluster*` |
| `launch_landing_page` | `POST /api/landing/[id]/launch` |
| `generate_asset` | `POST /api/media/generate` — pass `surface` so it inherits the art-direction preset |

### Outreach
| Tool | Calls |
|---|---|
| `list_stalled_threads` | `GET /api/negotiation/threads` |
| `take_over_thread` | `POST /api/inbox/[id]/takeover` |
| `start_thread` | `POST /api/inbox/compose` |
| `queue_status` | `GET /api/emails/status` |

### Measurement / the brain
| Tool | Calls |
|---|---|
| `gsc_performance` | the existing `searchAnalytics` wrapper |
| `adoption_report` | `GET /api/admin/adoption` |
| `refresh_brain` | the nightly scoring job (forge's `schedule_brain_update` equivalent) |

### Two pure-UI tools, worth copying verbatim in spirit
forge has `show_options` and `show_metrics` — tools that **never touch the engine** and exist purely so
the model can put structured, clickable output in front of a person. They are why forge's Hermes feels
like an operator console rather than a chat box. Summit should have the same: `show_options` (a set of
choices the human picks from) and `show_table` (rows the human can act on).

### Hard rule on write tools
Anything that spends money or reaches a real person — sending email, publishing to Strapi, generating a
paid image — must either be **draft-only** or gated on the same human approval the UI enforces. forge
does this literally: ads always publish **PAUSED**. Summit's equivalents: pitches land as `ready` and
never `scheduled`; drafts never auto-publish; the email-trust gate still applies.

---

## 5. News → prompt → AI writer

The flow you asked for, end to end.

**Data.** A `content_ideas` table: `id, kind ('news'|'model_launch'|'gsc_gap'), title, summary,
source_url, source_name, published_at, entities (jsonb — model/company names), score,
status ('new'|'used'|'dismissed'), draft_id, created_at`. Hermes's sweep upserts on `source_url` so a
re-run doesn't duplicate.

**Discovery (autoruns).** A nightly job asks Hermes for launches/announcements relevant to
imagine.art's surface area, scores each by overlap with our money pages and freshness, and writes rows.
Runs alongside the existing GSC striking-distance data — augment, not replace.

**The page.** `/content/ideas`: cards showing title, source, age, why-it-matters. Each card has a
prompt box and a single action — **"Turn into blog"** / **"Turn into landing page"**.

**The handoff — this is the important part.** The idea becomes *context*, not the brief:

```
POST /api/content/ideas/[id]/to-writer  { prompt, kind: 'blog'|'landing' }
  → create a writer session
  → seed it with a context block:
      <source_context>
        title / source_name / source_url / published_at
        summary
        Extracted facts — cite ONLY these, and only with the URL above.
      </source_context>
      <operator_prompt>{prompt}</operator_prompt>
  → mark the idea used, link draft_id
  → redirect to /blog/writer?session=…
```

Two constraints that matter:

- **The news goes in the trailing user turn, not the system prompt.** `system[0]` is the frozen
  `SKILL_PROMPT` and `system[1]` the voice, both on 1h cache TTL. Per-article context in either would
  invalidate the cache on every article — the single most expensive mistake available here.
- **Source facts are a closed set.** The writer's link-provenance gate already treats external URLs as
  a set-membership test against the tool ledger. The seeded source URL must be added to that ledger, or
  the writer's own citation of it gets flagged as fabricated.

---

## 6. Order to build

1. **Service-token auth on `/api/*`.** Nothing works before this.
2. **`content_ideas` table + the ideas page + the to-writer handoff.** Works with Tavily/GSC alone —
   no Hermes required — so it delivers value before any deployment exists.
3. **Deploy Summit Hermes** (copied loop, `summit_tools.py`, own env) with the research/discovery tools.
4. **Wire the augmenting calls**: discovery second source, news sweep.
5. **The nightly brain job** — last, because it has nothing to learn from until posts are published and
   accumulating GSC rank data.

---

## 7. Env

`.env.example` is gitignored by `.env*`, so this table is the tracked copy. Keep it correct.

**Summit-side.** Every Hermes path is inert until `HERMES_BASE_URL` is set, so these are safe to ship
unset — that was deliberate.

| var | required | what it does |
|---|---|---|
| `HERMES_BASE_URL` | to enable Hermes at all | where the service lives. Unset = Hermes is never called and existing paths are untouched. |
| `HERMES_TOKEN` | yes | one shared secret, **both** directions. Must equal the Hermes side's `SUMMIT_SERVICE_TOKEN`. |
| `HERMES_ALLOW_ADMIN` | no | `1` lets the agent read `/api/admin/adoption`. **Off by default**: that is per-colleague activity, and deploying an agent should not quietly widen who can read it. |

**Hermes-side** — `SUMMIT_*`, never `FORGE_*`. Full notes in `hermes/README.md`.

| var | required | what it does |
|---|---|---|
| `SUMMIT_API_URL` | yes | Summit's origin. Never `forge.imagine.art`. |
| `SUMMIT_SERVICE_TOKEN` | yes | equals Summit's `HERMES_TOKEN`. |
| `ANTHROPIC_API_KEY` | yes | its own budget line, not forge's. |
| `HERMES_INBOUND_TOKEN` | no | falls back to `SUMMIT_SERVICE_TOKEN`. Set only for a separate per-direction secret. |
| `HERMES_MODEL` | no | default `claude-opus-4-8`. Verified working. |
| `PORT` | no | default `8103`. Not forge's 8003. |

---

## 8. Status — what is built and verified

Verified 2026-07-30 against the live Summit dev server, not asserted.

| | state |
|---|---|
| Service-token auth (routes + proxy) | **done** — `identifyCaller`, constant-time, agent token distinct from `CRON_SECRET` |
| `hermes/` service | **done** — 13 tools, `/chat`, `/chat/stream`, `/v1/research`, `/v1/scrape` |
| Live turn through the loop | **verified** — real tool call, real numbers, prompt cache reading 3,641 tok/turn |
| Multi-turn history | **verified** — after fixing `model_dump()`, which does not round-trip |
| `/v1/scrape` | **verified** — pulled a real address off a live contact page |
| `/v1/research` | **verified** — 11–30 cited sources, search narration stripped from the answer |
| Refuses to send | **verified** — asked to send 106 queued emails with explicit authorisation; declined and explained |
| `content_ideas` table + `/content/ideas` page + news→writer handoff | **not built** — §5 is still the design |
| Nightly brain job | **not built** — nothing to learn from until posts publish and accumulate rank data |

Three routes had to be converted to the shared gate before their tools worked at all
(`/api/backlinks`, `/api/landing`, `/api/admin/adoption`). `/api/landing`'s `GET` took no `req`
argument, so a Bearer token was invisible to it — Hermes could never have listed pages to launch.
`/api/backlinks`'s hand-rolled `authorized()` also returned `true` when `CRON_SECRET` was unset; the
shared helper does not fail open.

---

## 9. Enrichment provider keys

`.env.example` is gitignored by `.env*`, so this is the tracked list.

| var | what it does |
|---|---|
| `HUNTER_API_KEY` | Hunter email-finder + domain-search. Free tier is 50 searches/month — needs a paid plan for campaign scale. |
| `ENRICHSO_API_KEY` | enrich.so email-finder (`sk_live_…`, 64 chars). 10 credits per lookup. Chained after Hunter; both are name+domain finders covering overlapping but different slices of the market. |
| `BLITZ_API_KEY` | LinkedIn URL → email. Currently produces 57% of all found addresses. |
| `REOON_API_KEY` | Verifies a constructed pattern address before it is trusted. |
