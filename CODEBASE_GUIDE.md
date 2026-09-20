# Geseo / Summit — Codebase Guide for Agents

> Single-file orientation for an AI agent (or new engineer) working in this repo.
> Everything here was derived by reading the code on 2026-09-20. File paths are repo-relative.
> When this doc and the code disagree, the code wins — update this file.

---

## 0. TL;DR

- **What it is:** an autonomous SEO backlink/placement-acquisition platform. A user creates a *campaign* (website, keywords, budget, desired deal count). An agent workforce then discovers candidate publications, qualifies them, finds a human contact, sends personalized outreach email, reads replies, negotiates price under hard ceilings, records structured deals, and parks a thread for a human only when it must (meeting request, contract, over-budget ask, etc.).
- **Two processes:** a **Next.js 16 app** (`src/`) that owns the UI, all business logic, all side effects, and the database; and an optional **Python FastAPI "Strands agent service"** (`agents/`) that holds the LLM reasoning loop and calls back into Next.js over HTTP through a token-guarded tool gateway (`/api/agent/*`). If the Python service is absent, an in-process TypeScript orchestrator runs the *same* phase policy.
- **Database:** Supabase Postgres (accessed via `supabase-js` service-role client; local dev can use bare Postgres + PostgREST + a tiny proxy).
- **LLMs:** Gemini (primary in TS code) → OpenRouter → Groq fallbacks, resolved in `src/lib/ai/gemini.ts`. The Python service uses Strands Agents SDK with Groq / Bedrock / Gemini providers. Anthropic SDK is used only by the (legacy) blog writer.
- **Design rule that explains everything:** *the model chooses what to do; deterministic code owns money math, send safety, phase transitions, and completion.* The LLM cannot overspend, cannot send an email directly, cannot skip a gate.

---

## 1. Product & Naming

| Name | Where you'll see it |
|---|---|
| **Geseo** | Current brand in the UI (`src/app/layout.tsx` metadata, sidebar, landing page copy) |
| **Summit** | Older brand (README title, `docs/`, `SummitMark` logo component, Hermes docs, `.env.example` header) |
| **GenAI Scout** | Original internal name (`package.json` `"name": "genai-scout"`, `migrations/001_initial.sql` comments) |
| **SEO Workforce** | Name of the Python agent service (`agents/seo_workforce/`) |

They are all the same product. The repo began as a production-used internal SEO outreach tool for imagine.art (Vyro) and was extended for the **AWS "Agents for Humans" Hackathon 2026** with the autonomous campaign layer. `docs/PREEXISTING_WORK.md` is the honest split of old vs new.

---

## 2. Technology Stack (and where each piece lives)

### Frontend / app framework
| Tech | Version | Where / notes |
|---|---|---|
| **Next.js (App Router)** | 16.2.9 | `src/app/**`. **This is a newer Next than most training data** — read `node_modules/next/dist/docs/` before writing framework code. Notable: `src/proxy.ts` replaces `middleware.ts`; route `params` are `Promise`s (`await params`); `after()` from `next/server` for post-response work. |
| **React** | 19.2.4 | Client components marked `"use client"`. |
| **TypeScript** | 5 | `strict: true`. Path aliases: `@/* → src/*`, `@auth → ./auth.ts`, `@config/* → ./config/*` (`tsconfig.json`). |
| **Tailwind CSS v4** + `tw-animate-css` | 4 | `src/app/globals.css` (`@import "tailwindcss"`, `@theme inline`, monochrome design tokens). PostCSS via `@tailwindcss/postcss`. |
| **shadcn v4 on Base UI** | shadcn 4.12, `@base-ui/react` 1.6 | `src/components/ui/*` (button, card, dialog, sheet, select, tabs, etc.). Uses `class-variance-authority`, `clsx`, `tailwind-merge` (`src/lib/utils.ts` → `cn()`). |
| **lucide-react** | 1.22 | Icons everywhere. |
| **next-themes** | 0.4 | Dark default (`src/app/layout.tsx`). |
| **sonner** | 2 | Toasts (`src/components/ui/sonner.tsx`, `<Toaster>` in `src/app/(app)/layout.tsx`). |
| **recharts** | 3.9 | `src/components/dashboard/Charts.tsx`. |
| **cmdk** | 1.1 | `src/components/ui/command.tsx`, `src/components/layout/SearchDialog.tsx` (global search). |
| **Poppins** via `next/font/google` | — | Root layout. |

### Backend (inside Next.js)
| Tech | Where / notes |
|---|---|
| **Next.js Route Handlers** | `src/app/api/**/route.ts` — ~190 endpoints. All server logic runs here or in `src/lib/**`. |
| **NextAuth v5 (beta.31)** + Google provider | `auth.ts` (repo root). Domain-restricted sign-in via `ALLOWED_DOMAINS`. **If `GOOGLE_CLIENT_ID` is unset the app runs in "demo auth" mode**: no login, synthetic `demo@local` user, every API allowed. |
| **Supabase JS** (`@supabase/supabase-js` 2.108, `@supabase/ssr`) | `src/lib/db/supabase.ts` exports `supabase` (anon) and `supabaseAdmin` (service role, bypasses RLS). **Lazily constructed via Proxy** so `next build` doesn't need credentials. |
| **pg** (node-postgres) | Only used by migration scripts in `scripts/*.mjs` via `DATABASE_URL`. |
| **Upstash Redis** (REST) | `src/lib/redis.ts` — distributed lock for the send processor, daily send counters, digest config, live progress. **Optional**: returns `null` when unset; callers degrade to in-memory. |
| **Upstash QStash** | `src/lib/qstash.ts` — self-continuation of long jobs on Vercel (publish a POST to our own endpoint with `CRON_SECRET`). Optional. |
| **nodemailer** | `src/lib/email/smtp.ts` — Gmail SMTP (app passwords), pooled per-user transports. |
| **imapflow** | `src/lib/email/imap.ts` — IMAP reply detection + bounce/auto-reply classification. |
| **AES-256-GCM** (`node:crypto`) | `src/lib/crypto.ts` — encrypts stored Gmail app passwords; key derived from `AUTH_SECRET`. |
| **p-queue** | Concurrency control in pipelines/send processor. |
| **cheerio, jsdom, linkedom, @mozilla/readability, metascraper\*** | `src/lib/extract/*` — HTML fetch/parse/article extraction/metadata. `serverExternalPackages` in `next.config.ts` keeps jsdom/readability/playwright out of the bundle. |
| **playwright / playwright-core** | `src/lib/extract/fetch.ts` (rendered fetch fallback), `src/lib/indexing/fetchRendered.ts`. Gated by `PLAYWRIGHT_ENABLED`. |
| **rss-parser, fast-xml-parser** | Harvesters and sitemap parsing. |
| **scrapegraph-js** | `src/lib/harvesters/scrapegraph.ts` (optional, `SGAI_API_KEY`). |
| **deep-email-validator, string-similarity, fastest-levenshtein** | Enrichment/verification heuristics. |
| **google-auth-library** | GSC (`src/lib/indexing/gsc.ts`), Google Calendar (`src/lib/calendar/google.ts`). |
| **@octokit/rest** | `src/lib/indexing/repo.ts` / `prNotify.ts` — opens PRs on a target repo for SEO fixes. |
| **@anthropic-ai/sdk** | **Only** `src/lib/writer/anthropic.ts` (blog writer agent). Not used by the campaign layer. |
| **openai** (npm) | Present in deps; the Gemini/OpenRouter/Groq calls in `src/lib/ai/gemini.ts` use raw `fetch`. |
| **ai** (Vercel AI SDK 7) | In deps; not central. |

### Python agent service (`agents/`)
| Tech | Where / notes |
|---|---|
| **Strands Agents SDK** (`strands-agents[openai]>=1.0`) | `agents/seo_workforce/agents.py` (8 `Agent` objects), `tools.py` (`@tool(context=True)` functions), `orchestrator.py` (`FileSessionManager`, per-tick agent). |
| **FastAPI + uvicorn** | `agents/seo_workforce/main.py` — endpoints `/health`, `/tick`, `/campaigns/{id}/start|stop|emergency-stop`, `/interventions/{id}/resolve`. Default port **8104**. |
| **httpx** | `gateway.py` — HTTP client to Next.js `/api/agent/*`. |
| **boto3** | Bedrock provider when `MODEL_PROVIDER=bedrock`. |
| **python-dotenv** | `config.py` loads repo-root `.env.local`. |
| Model providers | `groq` (default in `config.py`, OpenAI-compatible endpoint), `bedrock` (`anthropic.claude-sonnet-4-20250514-v1:0`), `gemini`. |

### Hermes (`hermes/`) — separate, optional
An Anthropic tool-use agent + stealth-browser service (Camoufox/CDP) on its own host (port 8103, `SUMMIT_*` env). Next.js talks to it through `src/lib/hermes/client.ts` (`/v1/research`, `/v1/scrape`). Used as enrichment cascade step "5.5" and by the writer. Degrades to no-op when `HERMES_BASE_URL` unset. Deployed to a DigitalOcean droplet via `.github/workflows/droplet.yaml`.

### Infra / tooling
| Tech | Where |
|---|---|
| **Vercel** | `vercel.json` (one cron: `/api/emails/process` daily 13:00 UTC; git deployments disabled — deploys via GitHub Action `.github/workflows/prod.yaml` using `vercel build/deploy --prebuilt`). |
| **Docker** | `Dockerfile` (Next.js self-host image), `agents/Dockerfile` (Cloud Run image), `hermes/Dockerfile`. |
| **Google Cloud Run** | `deploy/deploy.sh`, `docs/DEPLOYMENT.md` (alternative hosting for both services). |
| **Supabase CLI** | `supabase/config.toml` (project_id `seo`, API port 54321), `supabase/migrations/002_campaign_layer.sql`. |
| **Vitest 4** | `vitest.config.ts`, `tests/*.test.ts` (runs with LLM keys blanked so deterministic paths are tested). |
| **Playwright Test** | `playwright.config.ts` (baseURL `http://localhost:3001`), `e2e/*.spec.ts`. |
| **pytest** | `agents/seo_workforce/test_agents.py`, `evaluation/test_reply_classification.py`. |
| **ESLint 9** (`eslint-config-next`) | `eslint.config.mjs`. |

---

## 3. Repository Layout (annotated)

```
seo/
├─ auth.ts                     NextAuth v5 config (Google OAuth or demo bypass). Aliased as "@auth".
├─ next.config.ts              images.remotePatterns=*, serverExternalPackages (playwright/jsdom/readability)
├─ vercel.json                 cron: /api/emails/process @ 13:00 UTC daily; git.deploymentEnabled=false
├─ package.json                "genai-scout"; next 16.2.9 / react 19.2.4
├─ tsconfig.json               aliases @/*, @auth, @config/*
├─ vitest.config.ts / playwright.config.ts
├─ Dockerfile                  self-host Next.js
├─ .env.example                EVERY env var with inline notes (authoritative list)
├─ .env.local                  (gitignored) real values
├─ CLAUDE.md / AGENTS.md       agent operating rules (see §16). NOTE: CLAUDE.md's remote info is stale (see §17)
├─ README.md                   hackathon-facing overview
├─ docs/                       ARCHITECTURE, AGENT_DESIGN, DEMO, DEPLOYMENT, HACKATHON_REQUIREMENTS,
│                              LEGACY_EDGE_CASES, PREEXISTING_WORK, CRON_SETUP, GSC_SETUP, various PRDs
├─ HOW_TO_USE.md               local run walkthrough (ports 3100 / 8104 / 5433 / 5441 / 5440)
├─ *.md at root                many hackathon/handoff docs (GESEO_*, PROJECT_HANDOFF, STRANDS_MIGRATION_REPORT, …)
│
├─ src/
│  ├─ proxy.ts                 Next 16 "middleware": auth gate + machine-token bypass (CRON_SECRET / HERMES_TOKEN)
│  ├─ app/
│  │  ├─ layout.tsx            root: fonts, ThemeProvider (dark default), metadata "Geseo"
│  │  ├─ page.tsx              PUBLIC marketing landing page ("Backlinks, automated")
│  │  ├─ login/page.tsx        just redirect("/")
│  │  ├─ landing/page.tsx      landing-page generator UI (legacy feature)
│  │  ├─ globals.css           Tailwind v4 theme tokens
│  │  ├─ (app)/                AUTHENTICATED APP SHELL (route group → no URL segment)
│  │  │  ├─ layout.tsx         Sidebar + TopNav + KeyHealthBanner + loaders + Toaster; SessionProvider
│  │  │  ├─ campaigns/autonomous/page.tsx   campaign list (nav "Campaigns")
│  │  │  ├─ campaigns/new/page.tsx          create form → POST /api/campaigns → POST /start
│  │  │  ├─ campaigns/[id]/page.tsx         1,783-line live observability view (timeline, prospects,
│  │  │  │                                  deals, interventions, controls, template editor, auto-tick)
│  │  │  ├─ sending/page.tsx                nav "Decisions": queue/sent/replied/wins + manual overrides
│  │  │  ├─ inbox/page.tsx                  read & reply to real humans, takeover from AI
│  │  │  ├─ agent-runs/page.tsx             agent_runs + agent_events explorer
│  │  │  ├─ settings/page.tsx               Gmail app password, AI provider keys, Tavily pool, digest
│  │  │  └─ (legacy pages still routable, not in nav): admin, backlinks, blog/{,writer,clusters,voices},
│  │  │     campaigns/{,compare}, email-finder, emails, handbook, indexing, link-audit, media,
│  │  │     negotiation, notifications, payments, seo-agents, site-audit, workflows
│  │  └─ api/                  ~190 route handlers (see §8)
│  ├─ components/
│  │  ├─ layout/               Sidebar (NAV_GROUPS), TopNav, SearchDialog, KeyHealthBanner, UsageTracker,
│  │  │                        LoadingProvider/GlobalLoader/RouteProgress, PageContainer
│  │  ├─ ui/                   shadcn/base-ui primitives
│  │  ├─ campaigns/ProspectTable.tsx, prospects/*, dashboard/*, settings/*, blog/*, backlinks/*,
│  │  │  site-audit/*, pipeline/*, landing/*, admin/*, brand/SummitMark.tsx
│  └─ lib/                     ALL business logic (see §9)
│
├─ agents/                     Python Strands agent service (see §7)
│  ├─ requirements.txt, Dockerfile
│  └─ seo_workforce/{main,config,agents,tools,gateway,orchestrator,test_agents}.py
├─ hermes/                     separate Anthropic browser-agent service (optional)
├─ migrations/001_initial.sql  core discovery tables (domains, authors, articles, contacts, …)
├─ supabase/migrations/002_campaign_layer.sql   campaign/agentic tables (campaigns, deals, interventions, …)
├─ scripts/
│  ├─ 000_core_bootstrap.mjs … 064_groq_settings.mjs   incremental idempotent migrations (run in order)
│  ├─ run-migrations.mjs       runs migrations/*.sql then scripts/NNN_*.mjs against DATABASE_URL
│  ├─ start-local.ps1          one-shot local startup (Docker pg + PostgREST + proxy + Next + Strands)
│  ├─ dev-rest-proxy.mjs       strips /rest/v1 and forwards to bare PostgREST (local dev w/o Supabase)
│  ├─ demo-arc.mjs             headless demo driver (ticks a campaign to completion)
│  ├─ e2e-campaign-test.py, groq-strands-smoke.py, agent-verbose-test.mjs, edge-case-test.mjs
│  └─ probes/*.mts             one-off investigation scripts (excluded from tsconfig)
├─ tests/                      vitest suites (negotiation, filters, pipeline e2e, hackathon failure mode)
├─ e2e/                        Playwright specs (campaigns, dashboard, inbox, navigation, ux)
├─ evaluation/                 pytest reply-classification eval
├─ config/seeds.ts             SEED_DOMAINS for legacy discovery
├─ deploy/deploy.sh            GCP Cloud Run provisioning
└─ .github/workflows/          prod.yaml (Vercel), droplet.yaml (Hermes)
```

---

## 4. Runtime Topology

```
┌─────────────┐   HTTPS    ┌──────────────────────────────────────────────────────────┐
│  Browser    │──────────▶│  Next.js app  (port 3000 prod / 3100 local)               │
│  (React UI) │◀──poll────│  src/proxy.ts → auth gate                                 │
└─────────────┘           │  /api/campaigns/*        user-facing campaign API          │
                          │  /api/agent/*            TOOL GATEWAY (Bearer AGENT_SERVICE_TOKEN)
                          │  /api/emails/process     burst SMTP sender + IMAP sweep    │
                          │  src/lib/**              all business logic                │
                          └───────┬───────────────────────────┬───────────────────────┘
                                  │ supabase-js (service role) │ HTTP (fire-and-forget kick + /tick)
                                  ▼                            ▼
                   ┌──────────────────────┐     ┌──────────────────────────────────────┐
                   │ Supabase Postgres    │     │ Strands agent service (Python, :8104) │
                   │ (or local pg+PostgREST)│    │ campaign_manager + 7 specialists      │
                   └──────────────────────┘     │ tools → httpx → back to /api/agent/*  │
                                                └──────────────────────────────────────┘
   External: Gemini/OpenRouter/Groq · Tavily/Google CSE/Brave/Serper · Ahrefs DR ·
             Hunter/Blitz/enrich.so/Reoon · Gmail SMTP+IMAP · Upstash Redis/QStash ·
             Hermes (:8103) · Strapi CMS · GSC · Linear · GitHub · fal.ai · Slack webhooks
```

**Who ticks a campaign?** Three possible drivers, all hitting `POST /api/campaigns/[id]/tick`:
1. The **browser**: `src/app/(app)/campaigns/[id]/page.tsx` fires a tick every **15 s** while the page is open and the campaign `is_active` (and polls state every 10 s).
2. **External cron**: `GET /api/cron/tick` (Bearer `CRON_SECRET`) loops all active campaigns and POSTs their tick endpoint.
3. **Manual**: "Tick" button on the campaign page, or `scripts/demo-arc.mjs`.

**What a tick does** (`src/app/api/campaigns/[id]/tick/route.ts`):
- If `AGENT_SERVICE_URL` is set → `POST {AGENT_SERVICE_URL}/tick {campaign_id}` (5 s timeout). Response is tagged `execution_engine: "strands"`.
- If that fails (or URL unset) and `ALLOW_ORCHESTRATOR_FALLBACK !== "false"` → `runFallbackTick()` from `src/lib/campaign/fallbackOrchestrator.ts`, tagged `execution_engine: "fallback-ts"`.
- If fallback is disabled → **503** (`strands-required`). This is the hackathon "fail visibly" mode.
- Execution metadata is written into `campaigns.policy` JSON for the UI.

---

## 5. User Flow (what a human does, page by page)

1. **`/`** — public marketing page. CTA → `/campaigns/autonomous`.
2. **Auth** — `src/proxy.ts`: if `GOOGLE_CLIENT_ID` is set and no session → redirect to `/login` (which itself just redirects to `/`; NextAuth's Google flow lives at `/api/auth/*`). Sign-in is rejected unless the email domain is in `ALLOWED_DOMAINS` (default `imagine.art`). If `GOOGLE_CLIENT_ID` is **unset**, there is no auth at all (demo user).
3. **`/campaigns/autonomous`** (nav: **Campaigns**) — card grid of campaigns with phase badge, budget bar, deal progress. Polls `GET /api/campaigns` every 15 s. "New campaign" → `/campaigns/new`.
4. **`/campaigns/new`** — form: name, objective, website URL, keywords (chips), seed domains, constraints text, budget, autonomy mode, **Demo mode toggle (default ON)**. Submit → `POST /api/campaigns` (creates row, `phase: "draft"`) → immediately `POST /api/campaigns/{id}/start` → router push to `/campaigns/{id}`.
5. **`/campaigns/[id]`** — the main observability surface:
   - Polls `GET /api/campaigns/{id}` (10 s) → `{campaign, prospects_by_status, deals, interventions, events[300], prospects, emailStats, metrics}`.
   - Auto-ticks every 15 s while active.
   - Controls: Start / Tick / Pause / Resume / Stop / **Emergency stop** (`PATCH /api/campaigns/{id}` with `paused_*` / `emergency_stopped` / phase), Clone (`POST` with `action: "clone"`), Delete.
   - Tabs/sections: phase stepper, per-agent status board, event timeline (`agent_events`), prospect table (`src/components/campaigns/ProspectTable.tsx`), deals + negotiated savings, budget ledger, **Action required** cards for open `interventions` → answer box → `POST /api/agent/interventions {id, assist_input}` → the same negotiation thread resumes.
   - Email template editor (`/api/campaigns/{id}/template`), prospect CSV import (`/api/prospects/import`), negotiation thread viewer (`/api/negotiation/threads`, `/api/negotiation/{id}`).
6. **`/sending`** (nav: **Decisions**) — operational queue: upcoming scheduled sends, recent sent, follow-ups, replied, wins. Manual actions: send now, unschedule, reschedule by timezone, toggle follow-ups, mark success, "Process now" (`POST /api/emails/process`).
7. **`/inbox`** — per-author threads of real replies. Read, reply (`POST /api/inbox/{authorId}/reply` → sends via that user's Gmail), dismiss, **takeover** from the AI negotiator.
8. **`/agent-runs`** — browse `agent_runs` and `agent_events` per campaign (`/api/agent-runs`, `/api/agent-runs/events`).
9. **`/settings`** — `UserEmailConfig` (Gmail app password, encrypted at rest, send window/timezone/caps), `AIProvider` (Gemini/Groq keys + model stored in `app_settings`), `TavilyKeyManager` (key pool with quota rollover), `DailyDigestCard`.

Legacy surfaces remain reachable by URL (blog writer, backlinks funnel, indexing/page-health, link audit, SEO agents, media, landing, payments, negotiation, workflows, email-finder, handbook, admin). They are documented in §12.

---

## 6. Campaign Lifecycle (the state machine)

Types: `src/lib/campaign/types.ts`.

### Campaign phases (`campaigns.phase`)
```
draft → planning → discovering → qualifying → resolving_contacts → outreaching → monitoring → completed
                                                                                      ↘ stopped / failed
```
`ACTIVE_PHASES = [planning, discovering, qualifying, resolving_contacts, outreaching, monitoring]`.

### Prospect statuses (`campaign_prospects.status`)
```
discovered → qualified | rejected
qualified → resolving_contact → ready (contact_email set) | back to qualified (attempt++ ; max 3)
ready → outreached → replied → negotiating → deal | lost | escalated
```

### What each phase does per tick (identical policy in TS and Python)
| Phase | Action (TS: `fallbackOrchestrator.ts`; Py: `orchestrator._recommend`) | Transition rule (deterministic, code-owned) |
|---|---|---|
| draft | `planDiscoveryQueries` → set `planning` | — |
| planning | plan queries (strategy) | → discovering |
| discovering | `discoverBatch(campaign, ≤10 queries, 8/query)` | pool ≥ `max(30, desired_deals*12)` OR discovery saturated (0 created, 3 empty passes) → qualifying |
| qualifying | `evaluateProspect` × 8 | no `discovered` left → resolving_contacts (or completed if all rejected) |
| resolving_contacts | `resolveContactForProspect` × 8 (attempts < 3) | none actionable → outreaching if any `ready`, else monitoring if outreach in flight, else completed |
| outreaching | `sendOutreachToProspect` × 5 | no sendable `ready` → monitoring |
| monitoring | `processRepliesTick` (IMAP sweep or demo injection → negotiate each thread) + `processDueFollowUps` + send-processor hint | deals ≥ desired → completed (`goal_reached`); pool empty + 1 h quiet → completed (`prospects_exhausted`); budget headroom < $5 → completed (`budget_exhausted`) |

Every tick emits an `agent_events` row (`agent: "campaign_manager", action: "tick"`) with `state_before/after`, and each tool emits fine-grained events (`prospect_found`, `prospect_qualified`, `contact_resolved`, `outreach_queued`, `reply_sweep`, `negotiation_*`, `intervention_*`, `campaign_completed`). Events dedupe on `event_key`.

### Safety rails (all in code, never in the prompt)
- `emergency_stopped` short-circuits every tool.
- `paused_discovery / paused_outreach / paused_negotiation` are honored per phase.
- Budget: `reserveBudget()` in `src/lib/campaign/queries.ts` is atomic; `budget_ledger` entries (`commit | spend | release | adjust`).
- Price ceiling per prospect: `min(pricing-tier max_offer, campaign.max_per_deal)` computed in `evaluateProspect`, stored as `campaign_prospects.ceiling`, copied to `outreach_emails.max_offer`.
- Send gates (`sendOutreachToProspect`): role mailbox refused, placeholder refused, cross-campaign duplicate inbox refused, 3 emails/domain/hour, and in real mode the row is only **scheduled** — actual SMTP happens in `/api/emails/process`.
- Negotiation guards (`processRepliesTick`): skip autoresponders, thread-length cap → intervention, "never answer twice" (latest our-send newer than their reply → skip).

---

## 7. The Two Execution Engines

### 7a. Strands agent service (`agents/seo_workforce/`) — primary when `AGENT_SERVICE_URL` is set
- `config.py`: `MODEL_PROVIDER` (default **groq**), `GROQ_MODEL` (default `openai/gpt-oss-120b`), `STRANDS_MODEL_ID` (Bedrock Claude Sonnet 4), `GEMINI_MODEL`, `AGENT_BASE_URL` (Next.js URL), `AGENT_SERVICE_TOKEN`, `SESSION_STORAGE_DIR=.strands_sessions`, `HACKATHON_MODE` (default **true** here), port 8104.
- `agents.py`: builds one `MODEL` then 8 `strands.Agent`s: `campaign_manager` (root) + `strategy_agent, discovery_agent, qualification_agent, contact_agent, outreach_agent, negotiation_agent, intervention_agent`. Root gets all tools **plus** each specialist via `agent.as_tool()` (agents-as-tools).
- `tools.py`: 10 `@tool(context=True)` async functions — `get_campaign_state, plan_discovery, run_discovery_batch, run_qualification_batch, run_contact_resolution, queue_outreach_batch, schedule_followups, run_negotiation_tick, list_open_interventions, complete_campaign`. `campaign_id` arrives via `tool_context.invocation_state`, never from the model.
- `gateway.py`: httpx client → `/api/agent/campaigns/{id}` (GET/PATCH), `/api/agent/tools/{discover,qualify,contact,outreach,negotiate,followups}`, `/api/agent/interventions`, `/api/agent/events`, `/api/emails/process`.
- `orchestrator.py` `CampaignOrchestrator.tick()`:
  1. `GET` state; noop if `emergency_stopped` or inactive.
  2. Build a **fresh** `Agent` per tick with `FileSessionManager(session_id=f"campaign-{id}")` so conversation memory persists across ticks.
  3. Prompt = compact JSON state + `POLICY-RECOMMENDED ACTION THIS TICK: <_recommend()>`; `invoke_async(..., invocation_state={"campaign_id"})` under a 240 s timeout.
  4. `_maybe_transition()` — code-enforced phase transitions (mirrors §6).
  5. Emit a `tick` event with `framework: "strands-agents"`, `model_provider`, `run_id`, `duration_ms`.
- In `HACKATHON_MODE`, any agent error is re-raised → HTTP 500 (no silent degrade).

### 7b. TypeScript fallback (`src/lib/campaign/fallbackOrchestrator.ts`)
Same phase switch, same tool functions (`src/lib/campaign/tools.ts`, `outreach.ts`), no LLM planning loop (LLM is still used *inside* tools for relevance scoring, drafting, reply classification). Refuses to run when `HACKATHON_MODE=true && REQUIRE_STRANDS=true`.

### Flags that pick the engine
| Env | Effect |
|---|---|
| `AGENT_SERVICE_URL` | set → try Strands first |
| `ALLOW_ORCHESTRATOR_FALLBACK` | `"false"` → never fall back (503) |
| `HACKATHON_MODE` / `REQUIRE_STRANDS` | `true` → TS fallback refuses; Python raises on agent failure |

---

## 8. API Surface (grouped)

All handlers live at `src/app/api/<path>/route.ts`. Auth helpers: `identifyCaller()` (`src/lib/auth/service.ts`) for user-facing routes; `authorizeAgent()` (`src/lib/agent/gateway.ts`) for the tool gateway. Both accept: session cookie, `Bearer CRON_SECRET` / `?key=`, `Bearer AGENT_SERVICE_TOKEN` (gateway) or `Bearer HERMES_TOKEN` (service), and allow everything when `GOOGLE_CLIENT_ID` is unset.

### Campaign layer (new)
| Route | Purpose |
|---|---|
| `GET/POST /api/campaigns` | list / create (`phase: draft`, objective fields, `demo_mode`, `email_template_id`) |
| `GET/PATCH/POST/DELETE /api/campaigns/[id]` | full UI state / controls & phase / `action: clone` / delete |
| `POST /api/campaigns/[id]/start` | draft→planning; fire-and-forget kick of Strands `/campaigns/{id}/start` + `/tick` |
| `POST /api/campaigns/[id]/tick` | one bounded work unit (see §4) |
| `POST /api/campaigns/[id]/discover` | manual discovery trigger |
| `GET/PUT /api/campaigns/[id]/template` | campaign email template |
| `GET/PATCH /api/agent/campaigns/[id]` | gateway: state for the agent / phase+controls |
| `POST /api/agent/tools/discover` | `planDiscoveryQueries` (if no queries) + `discoverBatch` |
| `POST /api/agent/tools/qualify` | `evaluateProspect` × limit (or single `prospect_id`) |
| `POST /api/agent/tools/contact` | `resolveContactForProspect` × limit |
| `POST /api/agent/tools/outreach` | `sendOutreachToProspect` × limit |
| `POST /api/agent/tools/followups` | `scheduleNextSequenceTouch` for outreached prospects |
| `POST /api/agent/tools/negotiate` | `processRepliesTick` (campaign) or `negotiateCampaignThread` (single anchor) |
| `GET/POST /api/agent/interventions` | list HITL queue / resolve (`{id, assist_input}` or `{id, dismiss:true}`) → `resumeFromIntervention` |
| `GET/POST /api/agent/events` | timeline feed / record events (dedup on `event_key`) |
| `GET /api/agent-runs`, `/api/agent-runs/events` | UI explorer |
| `GET /api/cron/tick` | tick every active campaign |

### Email engine (legacy, reused)
| Route | Purpose |
|---|---|
| `POST /api/emails/process` | **THE sender.** Redis-locked burst: IMAP reply detection first, then drain `scheduled` rows through trust gates and per-user pooled Gmail SMTP; follow-up scheduling. Vercel cron + QStash + "Process now" all hit this. |
| `/api/emails/{status,followups,autopilot,reschedule,test,ai-manage}`, `/api/emails/[id]/{send-now,followup-toggle}` | queue management |
| `/api/inbox`, `/api/inbox/[id]/{reply,dismiss,takeover}`, `/api/inbox/compose`, `/api/inbox-accounts` | inbox |
| `/api/negotiation/{draft,settings,threads}`, `/api/negotiation/[id]/{,asset}` | negotiation UI + settings (pricing tiers, tone, thresholds) |
| `/api/user/email-config{,/test}`, `/api/shared-senders`, `/api/admin/shared-senders` | per-user SMTP config |
| `/api/track/open` | 1×1 open-tracking pixel |
| `/api/email-templates` | template CRUD |

### Discovery / enrichment (legacy)
`/api/pipeline/{,live,stop,checkpoint}` (harvester pipeline), `/api/discover`, `/api/prospects/{,manual,import,ai-search}`, `/api/enrich/{run,runs,status,stop,pending}`, `/api/authors/[id]/*`, `/api/seeds`, `/api/harvesters`, `/api/learned-sources`, `/api/suppression`, `/api/score-stats`, `/api/export`, `/api/reprocess`, `/api/workflows/**` (workflow-based outreach: prospects, generate emails/LinkedIn, send config, send).

### Other product surfaces (legacy)
`/api/backlinks/**`, `/api/blog/**` (drafts, writer sessions, clusters, voices, Strapi sync/publish), `/api/indexing/**` (page health, GSC, PR/Linear/Slack), `/api/link-audit/**`, `/api/seo-agents/**` (backlinks, content-refresh, geo, internal-links, page-quality, rank-watcher), `/api/media/**` (fal.ai image gen), `/api/landing/**`, `/api/payments/**`, `/api/notifications/**` (author watches), `/api/digest/**`, `/api/sitemap/sync`, `/api/sitemap-qa`, `/api/slack/test`, `/api/hermes/status`, `/api/health{,/keys}`, `/api/usage`, `/api/settings/ai`, `/api/admin/{adoption,tavily-key,wipe}`, `/api/cron/daily` (fans out to link-audit, digest, email-finding, notifications).

---

## 9. Core Library Modules (`src/lib/`)

### Campaign layer (new — hackathon work)
| File | Responsibility |
|---|---|
| `campaign/types.ts` | Phase/status/deal enums, `ScoreBreakdown`, `AgentEventInput`, `DealTerms` |
| `campaign/queries.ts` | All DB access for campaigns/prospects/deals/ledger/interventions/runs/events; `reserveBudget`, `setCampaignPhase`, `recordAgentEvent`, idempotency keys |
| `campaign/tools.ts` | `planDiscoveryQueries`, `discoverBatch` (+ `discoverDemoBatch` with 12 `.invalid` fixtures), `evaluateProspect` (fetch → readability → Ahrefs DR → Gemini relevance JSON → `qualifyProspect` gates → pricing ceiling → opportunity score), `ensureProspectAuthor`, `resolveContactForProspect` (author cascade → domain-level fallback → demo synthesized), `emitEvent` |
| `campaign/outreach.ts` | `ensureAgenticWorkflow`, `draftOutreachEmail` (template `{{vars}}` + LLM opener), `sendOutreachToProspect` (gates; real → `status: scheduled`; demo → simulated sent + best-effort SMTP to `DEMO_RECIPIENT`), multi-touch sequences (`scheduleNextSequenceTouch`, `processDueFollowUps`; 0/+2d/+4d), `negotiateCampaignThread` (wraps `negotiateThread`, creates `deals` + budget commit, interventions), `processRepliesTick`, `resumeFromIntervention`, `checkCampaignCompletion` |
| `campaign/fallbackOrchestrator.ts` | TS tick engine (§7b) |
| `campaign/demo.ts` | Persona scripts (`high_anchor`, `quick_deal`, `meeting_request`, `decliner`, `autoresponder`) injected via `recordReplyOnAnchor` — the same entry point IMAP uses |
| `campaign/sendProcessor.ts` | `runSendProcessorHint()` — nudges `/api/emails/process` |
| `agent/gateway.ts` | `authorizeAgent`, `unauthorized`, `badRequest` |
| `ai/gemini.ts` | **Central LLM adapter for all TS code.** `llmText()`, `llmJson<T>()` with validator; provider order Gemini → OpenRouter → Groq; runtime keys from `app_settings` (Settings UI) override env; strips `<think>` blocks; results carry `{provider, model}` for provenance |

### Negotiation engine (legacy, reused)
| File | Responsibility |
|---|---|
| `negotiation/run.ts` | `negotiateThread(emailId, opts)` — loads thread, classifies latest reply, applies policy (ceiling/floor/thresholds/autonomy), drafts via LLM, sanitizes, persists as draft or sends via `deliverOutreach`, sets `negotiation_status` (`agreed | declined | needs_human | stalled | handoff`) and intervention fields |
| `negotiation/agent.ts` | `classifyReplyIntent` (LLM) / `classifyReplyIntentHeuristicOnly`; `ReplyIntent` = `interested | counter_offer | accept | question | hard_no | unsubscribe | auto | irrelevant | needs_human`; `InterventionType` taxonomy; `draftNegotiationReply`; `sanitizeBody` (fabrication guard) |
| `negotiation/pricing.ts` | `maxOfferFor(dr, traffic, usShare, rules)` — highest matching tier; unverified metrics never fail a tier |
| `negotiation/settings.ts` | `negotiation_settings` singleton row: tone, aggressiveness, `opening_percent`, `max_thread_length`, `max_placement_price`, `auto_accept_below`, `human_approval_above`, `absolute_max_price`, `pricing_rules[]` |

### Email engine (legacy, reused)
`email/smtp.ts` (server SMTP + `createPooledUserTransport`, `sendEmailAs`), `email/deliver.ts` (pick identity: per-user Gmail vs server; CC shared sender; threading headers), `email/imap.ts` (`runReplyDetection` across every configured mailbox; classify `reply | bounce | auto`; out-of-office alt-contact extraction; `recordReplyOnAnchor`), `email/followup.ts`, `email/schedule.ts` + `timezones.ts` + `inferTz.ts` (send-window scheduling per recipient TZ), `email/autopilot.ts` (daily N-emails top-up), `email/roleEmail.ts` (`isRoleEmail`), `email/inbox.ts`, `email/genBuffer.ts`.

### Discovery & extraction (legacy, reused)
- `search/webSearch.ts` — provider order **Tavily → Google CSE → Brave → Serper → Gemini grounding**; Tavily key pool with quota rollover (`search/tavilyUsage.ts`).
- `pipeline/run.ts` — the original harvester pipeline (seeds → 9 harvesters → fetch → extract → score → authors/contacts), with checkpoint/resume (`pipeline/checkpoint.ts`), live event buffer, abort flag, QStash continuation. `pipeline/queries.ts` → `generateDiscoveryQueries` (LLM or heuristic).
- `harvesters/*` — rss, gdelt, hackernews, reddit, wordpress, ghost, commoncrawl, wayback, brave, googlenews, duckduckgo, scrapegraph, websearch.
- `extract/*` — `fetch.ts` (plain fetch → Playwright fallback, shared browser), `readability.ts`, `metadata.ts` (metascraper), `mentions.ts`, `contacts.ts`, `archetype.ts`, `relevance.ts`, `safety.ts`.
- `score/qualify.ts` — the 4 gates: DR ≥ 50, traffic ≥ 10k, US share > 50 %, relevance ≥ 40; `null` = unverified ≠ fail; `drUnavailable` passes when no Ahrefs key. `score/index.ts` legacy scoring.
- `enrich/cascade.ts` — **9-step author email cascade**: article/author-page scrape → LinkedIn find → Blitz (LinkedIn→email) → socials scrape → domain pattern inference → AI scrape → Hermes stealth scrape (5.5) → Hunter domain search → enrich.so; verification via Reoon (`enrich/verify.ts`); `personFilter.ts` (`isPlaceholderEmail`, `isLikelyPersonName`); `domainRating.ts` (Ahrefs DR); `run.ts` (batch enrichment runs UI).
- `learn/index.ts` — learned sources (domains that produced good prospects).

### Auxiliary product modules (legacy; see §12)
`backlinks/*`, `writer/*` (Anthropic blog writer agent with tools/provenance/voices/clusters), `blog/*` (draft editor state/autosave/diff/markdown), `strapi/*` (CMS client), `indexing/*` (page-health/CWV/GSC/PR/Linear/Slack), `linkaudit/*`, `seo-agents/*` (report-only SEO analyzers), `media/*` (fal.ai image planning/generation), `landing/*`, `calendar/*`, `digest/daily.ts`, `adoption/report.ts`, `sitemap/store.ts`, `health/keys.ts` (key presence for the banner), `hermes/client.ts`, `db/queries.ts` (huge legacy query layer: domains/authors/articles/contacts/workflows/outreach_emails/user config/replies), `util/*`, `crypto.ts`, `redis.ts`, `qstash.ts`.

---

## 10. Database Schema (key tables)

Source of truth: `migrations/001_initial.sql` (core) → `supabase/migrations/002_campaign_layer.sql` (campaign layer, consolidated) → `scripts/0NN_*.mjs` (incremental ALTERs; `run-migrations.mjs` runs all in order). RLS is enabled with permissive policies for `service_role/anon/authenticated`; the app always uses `supabaseAdmin`.

### Identity graph (legacy)
`domains` (host, dr, organic_traffic, us_traffic_share, metrics_source) · `authors` (full_name, primary_domain_id, safety_*, timezone, discarded, contacted_override) · `articles` · `article_authors` · `contacts` (author_id, type `mailto|linkedin|twitter|form|…`, value, confidence, source) · `mentions` · `links` · `discovery_hits` · `scores` · `suppression` · `seed_tools` · `pipeline_runs` · `harvester_config` · `enrichment_runs` · `flagged_content`.

### Campaign layer
| Table | Key columns |
|---|---|
| `campaigns` | `phase`, `completion_reason`, `objective`, `keywords[]`, `website_url`, `owner_email`, `budget_total/used`, `desired_deals`, `max_per_deal`, `min_dr`, `paused_*`, `emergency_stopped`, `demo_mode`, `autonomy_mode`, `email_template_id`, `ab_variant_ids`, `policy` (json: execution_engine, last_tick_at), seed fields |
| `campaign_prospects` | `campaign_id`, `author_id`, `domain_host` (unique per campaign), `prospect_url`, `provenance` json, `status`, `opportunity_score`, `score_breakdown`, `qualification` json (title, why_fit, angle, checks), `ceiling`, `contact_email/source/confidence`, `notes` json (contact_attempts, demo_persona) |
| `workflows` / `workflow_prospects` | outreach container; agentic campaigns get one `Agentic · <name>` workflow |
| `outreach_emails` | **every email**: `kind` (`initial | followup | negotiation`), `parent_id` (thread anchor), `status` (`draft | ready | scheduled | sent | failed`), `sender_email`, `sent_by_email`, `to_email`, `message_id`, `replied_at`, `reply_kind/from/subject/excerpt/sentiment/intent`, `negotiation_status`, `intervention_*`, `max_offer`, `agreed_price`, `payment_*`, `success_*`, `opened_at`, `bounced_at`, `ai_managed`, `email_template_id` |
| `deals` | `campaign_id`, `anchor_email_id`, `terms` json, `original_ask`, `agreed_price`, `status` (`terms_agreed → … → closed | cancelled`) |
| `budget_ledger` | `entry_type` (`commit | spend | release | adjust`), `amount`, `deal_id` |
| `interventions` | `type` (sync_contact, scheduling, asset_request, payment_details, factual_question, legal_contract, budget_exception, over_policy, thread_limit, other …), `ask`, `reason`, `status`, `assist_input`, `resolved_by`, `result_action` |
| `agent_runs` / `agent_events` | observability; events have `agent`, `action`, `tool`, `prospect_id`, `thread_id`, `state_before/after`, `duration_ms`, `detail` json, unique `event_key` |
| `idempotency_keys` | at-least-once dedupe |
| `negotiation_settings` (singleton `id=true`) / `negotiation_activity` | policy + audit |
| `email_templates`, `email_send_config`, `user_email_config` (encrypted app password), `inbox_state`, `linkedin_messages`, `author_watches`, `author_watch_notifications`, `app_settings` (runtime AI keys) |
| Other products | `backlink_prospects`, `internal_link_opportunities`, `blog_drafts`, `writer_*`, `media_assets`, `landing_pages`, `usage_events`, `link_audit_*`, `indexing_reports`, `payments`, … |

---

## 11. Auth & Security Model

- **Humans:** NextAuth v5 Google OAuth (`auth.ts`); `signIn` callback rejects emails outside `ALLOWED_DOMAINS`; session carries `user.id`. `src/proxy.ts` redirects unauthenticated page loads to `/login`.
- **Machines:** `CRON_SECRET` (Vercel cron, QStash, external cron, `/api/cron/*`), `AGENT_SERVICE_TOKEN` (Strands → `/api/agent/*`), `HERMES_TOKEN` (Hermes → app APIs). Compared constant-time in `identifyCaller`.
- **Admins:** `ADMIN_EMAILS` (`src/lib/auth/admin.ts`) — send-as-teammate, adoption report, wipe.
- **Demo/no-auth mode:** when `GOOGLE_CLIENT_ID` is empty, `auth()` returns a synthetic user and every guard passes. **Do not deploy publicly like this.**
- **Secrets at rest:** Gmail app passwords AES-256-GCM encrypted with a key derived from `AUTH_SECRET` (`src/lib/crypto.ts`) — changing `AUTH_SECRET` invalidates stored passwords.
- `robots: noindex` on the whole app.

---

## 12. Legacy / Auxiliary Product Surfaces (still routable)

| URL | What it is | Key code |
|---|---|---|
| `/campaigns`, `/campaigns/compare` | older campaign dashboards (harvester pipeline era) | `src/app/(app)/campaigns/page.tsx`, `lib/pipeline/*` |
| `/workflows`, `/emails`, `/email-finder`, `/sending` | manual outreach: pick prospects → generate emails → schedule → send | `/api/workflows/**`, `lib/email/*`, `lib/enrich/run.ts` |
| `/negotiation`, `/payments`, `/handbook` | semi-autonomous negotiation UI, payments ledger, negotiation handbook/settings | `lib/negotiation/*`, `/api/payments/**` |
| `/backlinks` | backlink target discovery → pitch → link-live check | `lib/backlinks/*`, `lib/seo-agents/backlinkTargets.ts` |
| `/blog`, `/blog/writer`, `/blog/clusters`, `/blog/voices` | Anthropic-powered blog writer with voices, topic clusters, Strapi publish, autosave editor | `lib/writer/*`, `lib/blog/*`, `lib/strapi/*` |
| `/media` | fal.ai image generation with SEO-aware planning | `lib/media/*` |
| `/landing` | landing-page brief → vibe-code → template → draft → publish workflow | `lib/landing/*` |
| `/indexing`, `/site-audit`, `/link-audit` | page-health reports (raw vs rendered, CWV, GSC), sitemap QA, daily broken-link audit → Slack/Linear/GitHub PR | `lib/indexing/*`, `lib/linkaudit/*` |
| `/seo-agents` | report-only analyzers: internal links, GEO checks, content refresh, page quality, rank watcher | `lib/seo-agents/*` |
| `/notifications` | author watches (new article alerts) | `/api/notifications/**` |
| `/admin` | adoption report, shared senders, Tavily pool, wipe | `lib/adoption/report.ts` |

---

## 13. Demo Mode (important for testing)

`campaigns.demo_mode = true` (default ON in the new-campaign form):
- Discovery uses the 12 hard-coded `.invalid` fixtures in `campaign/tools.ts` (DR 53–78) — never live search.
- Qualification skips the LLM (heuristic relevance) because fixture URLs can't be fetched.
- Contact resolution synthesizes `sarah.mitchell@<host>` if the cascade finds nothing.
- Outreach rows are inserted as `sent` with a `<demo-…@simulated.local>` message id; a best-effort real SMTP send goes to `DEMO_RECIPIENT` (default `demo@geseo.ai`) if `SMTP_*` is configured.
- Replies are **injected** by `campaign/demo.ts` personas through `recordReplyOnAnchor` (same path as IMAP); negotiation runs `heuristicOnly + demoScripted` so the arc ($280 → $220 → $180 etc.) is deterministic.
- Everything downstream (classification, ceilings, deals, ledger, interventions) is production code. Docs: `docs/DEMO.md`; headless driver: `node scripts/demo-arc.mjs <campaign_id> 25`.

---

## 14. LLM Provider Resolution

**TypeScript side** (`src/lib/ai/gemini.ts`): `app_settings.gemini_api_key` → `GEMINI_API_KEY` → `OPENROUTER_API_KEY` → (`app_settings.groq_api_key` | `GROQ_API_KEY`) → `"none"` (deterministic heuristics). Default Gemini model in code: `gemini-3.5-flash` (`.env.example` says `gemini-2.5-flash`; env wins). Used for: discovery query generation, prospect relevance JSON, outreach opener, reply classification, negotiation drafting, blog autofill, etc.

**Python side** (`agents/seo_workforce/config.py`): `MODEL_PROVIDER` = `groq` (default) | `bedrock` | `gemini`. Used only for the campaign-manager reasoning loop.

**Anthropic SDK**: `src/lib/writer/anthropic.ts` only (blog writer), `ANTHROPIC_API_KEY`. Hermes also uses Anthropic (its own env).

Vitest blanks `GEMINI_API_KEY` and `OPENROUTER_API_KEY` so tests exercise the heuristic paths.

---

## 15. Environment Variables (grouped; full list with notes in `.env.example`)

| Group | Vars |
|---|---|
| Core DB | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (scripts only) |
| Auth | `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_DOMAINS`, `APP_URL`, `NEXTAUTH_URL`, `AUTH_TRUST_HOST`, `NEXT_PUBLIC_BASE_URL`, `ADMIN_EMAILS` |
| Jobs | `CRON_SECRET`, `UPSTASH_REDIS_REST_URL/TOKEN`, `QSTASH_TOKEN` |
| LLM (TS) | `GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENROUTER_API_KEY/MODEL`, `GROQ_API_KEY/MODEL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` |
| Agent service | `AGENT_SERVICE_URL` (Next→Py), `AGENT_BASE_URL` (Py→Next), `AGENT_SERVICE_TOKEN`, `MODEL_PROVIDER`, `STRANDS_MODEL_ID`, `AWS_REGION`, `HACKATHON_MODE`, `REQUIRE_STRANDS`, `ALLOW_ORCHESTRATOR_FALLBACK`, `SESSION_STORAGE_DIR` |
| Search | `TAVILY_API_KEY`, `GOOGLE_CSE_KEY/CX`, `BRAVE_SEARCH_API_KEY`, `SERPER_API_KEY`, `TAVILY_MONTHLY_LIMIT` |
| SEO data | `AHREFS_API_KEY`, `PAGESPEED_API_KEY`, `GSC_PROPERTY`, `GSC_SA_JSON[_BASE64]` |
| Enrichment | `BLITZ_API_KEY`, `HUNTER_API_KEY`, `ENRICHSO_API_KEY`, `REOON_API_KEY`, `ENRICH_ON_DISCOVERY`, `ALLOW_GUESSED_EMAILS`, `HERMES_BASE_URL/TOKEN/ALLOW_ADMIN` |
| Email | `SMTP_HOST/PORT/USER/PASS/FROM_EMAIL/FROM_NAME` (server fallback identity), `IMAP_*` (present in `.env.local`), `DEMO_RECIPIENT`, `DEMO_REPLY_DELAY_MS` |
| Integrations | `SLACK_BROKEN_LINKS_WEBHOOK`, `GITHUB_BOT_TOKEN`, `TARGET_REPO_BASE_BRANCH`, `LINEAR_*`, `FAL_KEY`, `SGAI_API_KEY`, `MEDIA_PREFILL_MODEL`, `STRAPI_*`, `CALENDAR_SA_JSON`, `PLAYWRIGHT_ENABLED` |

Rule from `AGENTS.md`: **missing keys never block work** — every provider has `xEnabled()` capability detection and a degrade path.

---

## 16. Local Development

Ports used by `scripts/start-local.ps1` / `HOW_TO_USE.md`:
| Port | Service |
|---|---|
| 5433 | Postgres (Docker `seo-pg`) |
| 5441 | PostgREST (Docker `seo-pgrst`) |
| 5440 | `scripts/dev-rest-proxy.mjs` (adds `/rest/v1` prefix so `supabase-js` works against bare PostgREST; strips auth headers) — set `NEXT_PUBLIC_SUPABASE_URL=http://localhost:5440` |
| 3100 | `npx next dev -p 3100` (README/launch.json use 3000; scripts use 3100) |
| 8104 | Strands service `uvicorn seo_workforce.main:app` (run from `agents/`, `.venv` at repo root) |
| 54321 | Supabase CLI local stack (`npx supabase start`) — alternative to the pg+PostgREST pair |

Commands:
```
npm install
node scripts/run-migrations.mjs            # needs DATABASE_URL
npm run dev                                 # or npx next dev -p 3100
.\.venv\Scripts\pip install -r agents\requirements.txt
cd agents && python -m uvicorn seo_workforce.main:app --port 8104
npx vitest run                              # unit/regression
npx playwright test                         # e2e (expects app on :3001)
npm run lint
```

**Operating rules from `AGENTS.md` (mandatory for agents working here):** never run servers/watchers in the foreground (use `Start-Process -WindowStyle Hidden`), every shell command gets an explicit timeout ≤ 60 s, no sleep-polling, never `-RedirectStandardOutput` with `Start-Process`, don't chain spawn+sleep+port-check in one call, if a port is already listening treat it as success, and before declaring work complete re-verify the local Supabase checklist in `Fix Local Supabase Startup.md` (`npx supabase status` healthy) and test each of the 8 agents through `/api/agent/tools/*` with verbose output.

---

## 17. Deployment & Git

- **Vercel**: `.github/workflows/prod.yaml` on push to `main` → `vercel pull/build/deploy --prebuilt`. `vercel.json` has git deployments off and one cron.
- **Hermes**: `.github/workflows/droplet.yaml` → SSH to droplet, `pm2 restart hermes`.
- **Cloud Run** (alternative): `deploy/deploy.sh`, `docs/DEPLOYMENT.md`.
- **Git reality check (2026-09-20):** local branch is `master`; the only configured remote is `origin → https://github.com/Abdullahzg/geseo.git`. `CLAUDE.md` still says the live remote is `vyro → Vyro-ai/seo_email` on `main` — that remote is **not configured** in this clone. Confirm with the user before pushing anywhere.
- Working tree currently has a large uncommitted refactor: pages moved from `src/app/<page>` into the `src/app/(app)/` route group, new `e2e/`, `supabase/migrations/`, `src/components/campaigns/`, layout loaders. Deleted-file entries in `git status` are the old locations.

---

## 18. Tests

| Suite | Runner | What it covers |
|---|---|---|
| `tests/negotiation.test.ts`, `negotiation-evaluation.test.ts`, `reply-intent-evaluation.test.ts` | vitest | ceiling clamps, intent classification heuristics, intervention taxonomy (from `docs/LEGACY_EDGE_CASES.md`) |
| `tests/filters.test.ts` | vitest | role/placeholder email filters, person-name filters |
| `tests/pipeline-e2e.test.ts` | vitest | campaign phase policy end-to-end (mocked DB) |
| `tests/hackathon-failure.test.ts` | vitest | 503 when Strands required & unavailable |
| `e2e/*.spec.ts` | Playwright | navigation, campaigns, inbox, dashboard, UX |
| `agents/seo_workforce/test_agents.py` | pytest | agent/tool wiring |
| `evaluation/test_reply_classification.py` | pytest | reply classifier eval |
| `scripts/demo-arc.mjs`, `scripts/e2e-campaign-test.py`, `scripts/groq-strands-smoke.py`, `scripts/agent-verbose-test.mjs` | manual | full-arc smoke tests |

---

## 19. Conventions & Gotchas

- **Next 16 specifics:** `src/proxy.ts` not `middleware.ts`; `params` is a Promise in route handlers and pages; `after()` for post-response work; `export const maxDuration` per route (300 s on heavy ones).
- **Never call an LLM endpoint directly in TS** — go through `src/lib/ai/gemini.ts` so provider/provenance stays centralized.
- **Never send email directly from campaign code** — insert `outreach_emails` rows; `/api/emails/process` is the only real sender (Redis lock, trust gates). Demo mode is the one exception and it's labeled.
- **Every prospect must have an `authors` row** (`ensureProspectAuthor`) — the legacy inbox/threading/enrichment machinery keys on `author_id`. Byline or `"<host> Editorial"` pseudo-author.
- **Deterministic > model:** phase transitions, budget, ceilings, gates, completion are code. If you add an agent capability, put policy in TS tools, not in the prompt.
- **Unverified ≠ fail:** null DR/traffic/US-share never disqualifies; only measured failures do. Don't "fix" this.
- **Idempotency:** events dedupe on `event_key`; ticks are safe to repeat; migrations are `IF NOT EXISTS`.
- **Lazy Supabase client:** don't create clients at module scope; import `supabaseAdmin` and let the Proxy construct on first use.
- **Client-safe leaf modules:** files imported by client components must not import `supabaseAdmin`/google-auth (see `lib/landing/stages.ts`, `lib/blog/markdown.ts` comments) or the build fails with `Can't resolve 'child_process'`.
- **Docs drift:** README/docs say "Bedrock primary"; actual defaults are Groq (Py) and Gemini (TS). README says `docs/AGENT_DESIGN.md` for details. Landing copy says "8 AI agents / 16 tool endpoints". Treat `.env.example` and code as truth.
- **Big files:** `src/app/(app)/campaigns/[id]/page.tsx` (1.8k lines), `src/lib/db/queries.ts`, `DOCUMENTATION.md` (566 KB legacy dump — search it, don't read it whole).

---

## 20. "Where do I look for…" quick index

| Question | Go to |
|---|---|
| How does a campaign advance? | `src/lib/campaign/fallbackOrchestrator.ts` (TS) / `agents/seo_workforce/orchestrator.py` (Py) |
| What does the model see each tick? | `orchestrator.py::_tick_prompt`, `agents.py` system prompts |
| Discovery/search providers | `src/lib/search/webSearch.ts`, `src/lib/campaign/tools.ts::discoverBatch` |
| Qualification math | `src/lib/campaign/tools.ts::evaluateProspect`, `src/lib/score/qualify.ts`, `src/lib/negotiation/pricing.ts` |
| Finding an email | `src/lib/enrich/cascade.ts`, `src/lib/campaign/tools.ts::resolveContactForProspect` |
| Drafting/sending outreach | `src/lib/campaign/outreach.ts`, `src/app/api/emails/process/route.ts`, `src/lib/email/deliver.ts` |
| Reply detection | `src/lib/email/imap.ts::runReplyDetection`, `db/queries.ts::recordReplyOnAnchor` |
| Negotiation policy | `src/lib/negotiation/run.ts::negotiateThread`, `agent.ts`, `settings.ts` |
| HITL interventions | `src/lib/campaign/queries.ts::createIntervention/resolveIntervention`, `outreach.ts::resumeFromIntervention`, `/api/agent/interventions` |
| Deals & budget | `src/lib/campaign/queries.ts::createDeal/reserveBudget`, `outreach.ts::negotiateCampaignThread` |
| Timeline/observability | `agent_events` table, `/api/agent/events`, campaign page timeline |
| Auth | `auth.ts`, `src/proxy.ts`, `src/lib/auth/service.ts`, `src/lib/agent/gateway.ts` |
| Nav / app shell | `src/components/layout/Sidebar.tsx` (`NAV_GROUPS`), `src/app/(app)/layout.tsx` |
| Schema | `migrations/001_initial.sql`, `supabase/migrations/002_campaign_layer.sql`, `scripts/0NN_*.mjs` |
| Env vars | `.env.example` |
| Local startup | `scripts/start-local.ps1`, `HOW_TO_USE.md` |
| Hackathon narrative | `README.md`, `docs/ARCHITECTURE.md`, `docs/HACKATHON_REQUIREMENTS.md`, `docs/PREEXISTING_WORK.md`, `AGENT_REPLY_DOCUMENT.md` |
