# Summit — Autonomous SEO Deal Acquisition Workforce

**Google All Things Agentic Hackathon 2026 · Taskmaster category**

Give an agent workforce an objective, constraints, and a budget — it autonomously researches
editorial opportunities, identifies the right human at each publication, runs personalized
outreach, negotiates commercial terms inside hard policy ceilings, and returns with structured
deals. Humans are involved only when policy or capability genuinely requires them, through
durable, resumable interventions.

## Problem

Acquiring high-quality backlinks/editorial placements is brutally manual: search dozens of
queries, open hundreds of pages, judge site quality, find the author, hunt for their email,
verify it, write outreach, send, watch the inbox, classify replies, ask prices, counteroffer,
follow up, track budget, close. Days of fragmented work per deal.

## Solution

One click: **Start campaign**.

```
User:  "Acquire 3 quality placements. Budget $1,000. Keywords: AI photo editor…"
Agent: plans → discovers 47 candidate pages → qualifies → resolves contacts →
       sends outreach → reads replies → negotiates ($350 → $275 → $230 accepted,
       under the $240 ceiling) → parks ONE thread for a human when a publisher asks
       for a call → records structured deals → reports savings.
```

The primary UI is not a chat window. It is a **live workforce view**: agents' current actions,
a granular event timeline, funnel counters, budget burn, deals with negotiated savings, and a
human-decisions queue.

## Why this is agentic (not a chatbot)

- **Multi-step autonomous workflow** — planning → discovery → qualification → contact
  intelligence → outreach → reply triage → negotiation → deal recording, executed without
  step-by-step instruction.
- **Real tools** — web search providers, Ahrefs DR API, article fetch/extraction, a nine-step
  contact-enrichment cascade, SMTP/IMAP email transport.
- **Persistent state & async execution** — bounded idempotent ticks; every action recorded to an
  append-only timeline; work survives restarts and continues across hours/days.
- **Policy-bounded autonomy** — Gemini reasons; deterministic code owns money math, send safety,
  ceilings, and completion conditions. The model cannot overspend or over-promise.
- **Honest HITL** — meeting requests, contracts, invoices, over-ceiling terms park that one
  negotiation as a structured intervention; your answer resumes the same thread mid-flight.

## Google technologies

| Tech | Role |
|---|---|
| **Google ADK (Python)** | The orchestration brain: Campaign Manager root agent + 7 specialist sub-agents, function tools, durable Postgres-backed sessions |
| **Gemini 3.5 Flash** (`GEMINI_MODEL`, Gemini API) | Strategy, article understanding, relevance scoring, reply classification, negotiation language |
| **Cloud Run** | Hosts both the Next.js app and the ADK agent service |
| **Cloud Scheduler** | Drives the send/reply/follow-up processor every 30 minutes |
| **Artifact Registry + Secret Manager + Cloud Build** | Deployment plumbing |

## Architecture (short version)

```
Browser ─ Next.js (Cloud Run) ─ /api/agent/* tool gateway ──► ADK Agent Service (Cloud Run)
                     │                                          campaign_manager (+7 sub-agents)
                     │◄──────────── tool calls over HTTP ───────┘   model: Gemini 3.5 Flash
             Proven engine (unchanged):
             discovery pipeline · enrichment cascade · guarded SMTP/IMAP ·
             negotiation policy engine
                     │
             Supabase Postgres (campaigns, prospects, deals, interventions,
             agent_events timeline, budget ledger)
```

Full diagram + authority model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
Agent design details: [`docs/AGENT_DESIGN.md`](docs/AGENT_DESIGN.md).

## What was pre-existing vs. built for the hackathon

This repo began as a production-used SEO-outreach platform. All proven machinery (discovery,
enrichment, email transport, negotiation engine) is **pre-existing** and reused deliberately;
the autonomous campaign layer, ADK service, observability UI, demo mode, tests and cloud assets
are new. Full disclosure: [`docs/PREEXISTING_WORK.md`](docs/PREEXISTING_WORK.md).

## Setup

Prereqs: Node 20+, Python 3.10+, a free Supabase project, a Google OAuth client, a Gemini API key.

```bash
npm install
cp .env.example .env.local          # fill in values (names documented inline)
npx supabase init && npx supabase start   # OR use your cloud Supabase project
node scripts/run-migrations.mjs     # idempotent; creates core + agentic schema
npm run dev
```

Optional full-agent mode:

```bash
python -m venv .venv && .venv/Scripts/pip install -r agents/requirements.txt
set GEMINI_API_KEY=... & set AGENT_SERVICE_TOKEN=REDACTED & set AGENT_BASE_URL=http://localhost:3000
uvicorn seo_workforce.main:app --port 8104   # from agents/
set AGENT_SERVICE_URL=http://localhost:8104  # for Next.js
```

Without `AGENT_SERVICE_URL` the identical tick policy runs in-process (TypeScript fallback),
so the product is fully functional either way.

### Key environment variables

See [`.env.example`](.env.example) for every name with inline notes. Core:
`NEXT_PUBLIC_SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY`, `DATABASE_URL`, `AUTH_SECRET`,
`GOOGLE_CLIENT_ID/SECRET`, `ALLOWED_DOMAINS`, `CRON_SECRET`, `GEMINI_API_KEY`,
`GEMINI_MODEL`, `AGENT_SERVICE_TOKEN`. Everything else degrades gracefully when absent —
missing provider keys never block the workflow (capability detection throughout).

## Run locally (demo path)

1. Sign in → **Autonomous Campaigns** → *New campaign*
2. Enter website, keywords, budget $1,000, desired placements 3 → toggle **Demo mode**
3. Press **Start**, then watch the live timeline: discovery batches → qualification scores →
   contacts → simulated outreach → persona replies → an autonomous negotiation closing at $230
   under a $240 ceiling → one meeting-request intervention → resolve it → resume.
4. Inspect everything: events, deals, budget ledger, audit trail. Pause/stop/take-over anytime.

Details + the exact scripted scenario: [`docs/DEMO.md`](docs/DEMO.md).

## Deploy

```bash
export GCP_PROJECT=your-project GCP_REGION=us-central1
# plus secrets per script header
bash deploy/deploy.sh
```

Provisions Cloud Run services, secrets, scheduler; prints both service URLs.
Guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Tests

```bash
npx vitest run        # legacy edge-case regression suite (negotiation policy, filters, gates)
```

The suite encodes real-world failures from the previous implementation so they can never
regress — catalogued in [`docs/LEGACY_EDGE_CASES.md`](docs/LEGACY_EDGE_CASES.md).

## Hackathon requirements checklist

Live checklist: [`docs/HACKATHON_REQUIREMENTS.md`](docs/HACKATHON_REQUIREMENTS.md).
