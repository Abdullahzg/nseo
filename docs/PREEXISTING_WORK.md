# Pre-existing Work Disclosure

This project entered the **Google All Things Agentic Hackathon 2026** as an existing,
production-used internal tool. This document declares exactly what existed before the
competition period, what was reused, and what was newly built — so the competition
contribution is defensible and honestly labeled.

## 1. What existed before the hackathon

The repository baseline (git commit `fb4e48f` — "Baseline: seo_email-main … unmodified")
is a complete Next.js 16 application, distributed to us as `seo_email-main.zip`
("GenAI Scout", internally the ImagineArt/Vyro SEO-outreach platform). It was used in
production for real SEO outreach and negotiation against real publishers.

Everything in that baseline is pre-existing work, including but not limited to:

- **Auth**: NextAuth v5 Google OAuth with domain restriction (`auth.ts`), route
  protection middleware (`src/proxy.ts`), admin allow-list (`src/lib/auth/*`).
- **Database layer**: Supabase Postgres schema (`migrations/001_initial.sql`) and ~60
  incremental migration scripts (`scripts/0NN_*.mjs`); query layer
  (`src/lib/db/queries.ts`).
- **Discovery pipeline**: LLM query generation (`src/lib/pipeline/queries.ts`),
  eight discovery harvesters (`src/lib/harvesters/*`), web-search provider adapters
  (`src/lib/search/webSearch.ts`), article fetch/extract/score pipeline
  (`src/lib/pipeline/run.ts`, `src/lib/extract/*`, `src/lib/score/*`),
  checkpoint/resume + live event buffer + cross-instance stop flag.
- **Contact enrichment cascade**: `src/lib/enrich/cascade.ts` and its provider
  adapters (Blitz, Hunter, enrich.so, Reoon verification, AI page-scrape,
  domain-pattern inference, LinkedIn finding) plus safety filters
  (`personFilter.ts`, role-email rejection).
- **Email engine**: per-user encrypted Gmail SMTP sending, pooled transports,
  IMAP reply detection/bounce/auto classification, follow-up scheduling,
  burst send processor with idempotency locks (`src/lib/email/*`,
  `src/app/api/emails/process/route.ts`), inbox UI + manual takeover.
- **Negotiation agent (semi-autonomous)**: reply-intent classifier with
  human-intervention taxonomy, deterministic pricing tiers/ceiling clamps,
  fabrication guard, assist-input flow (`src/lib/negotiation/*`, negotiation UI).
- **Backlink outreach funnel** (`src/lib/backlinks/*`, `/backlinks` UI),
  payments ledger UI, SEO analytics agents (`src/lib/seo-agents/*`),
  blog writer/cluster tooling, landing-page generator, media generation.
- **Hermes**: a separate Python stealth-browser agent service (`hermes/`)
  used by the enrichment cascade.
- **Deployment**: Vercel workflow + Dockerfile + QStash/Upstash scheduling.

## 2. What was reused as-is or adapted during the hackathon

- All of the above remains the implementation of its subsystem. The new agentic
  system **calls into it** through an internal tool API rather than replacing it:
  proven side-effect logic (sending mail, negotiating, pricing policy, contact
  resolution, discovery) stays in exactly one place.
- The existing inbox / negotiation / payments UIs remain the operational surfaces;
  the new campaign observability UI links to them.

## 3. What was newly built for the hackathon

- **Campaign objective model**: `campaigns`, `campaign_prospects`, `deals`,
  `interventions`, `agent_runs`, `agent_events` tables + budget ledger; campaign
  lifecycle state machine with autonomous completion conditions.
- **Tool gateway API** (`/api/agent/*`): token-authenticated, policy-enforcing
  wrappers around the legacy capabilities, with centralized Gemini-based LLM
  configuration (`GEMINI_MODEL`, default `gemini-3.5-flash`).
- **Google ADK agent service** (`agents/`, Python): Campaign Manager root agent +
  specialized sub-agents orchestrating plan → discover → qualify → contacts →
  outreach → replies → negotiation → deals, with persistent ADK sessions
  (Postgres-backed), bounded resumable work units, and durable human-in-the-loop
  intervention requests/resolutions.
- **Observability UI**: live campaign execution view (per-agent status board,
  event timeline, budget/goal progress, completion summary, pause/resume/stop/
  emergency controls, per-campaign prospect explorer).
- **Demo mode**: simulated publisher personas injected at the inbound-reply
  boundary so the entire real pipeline runs end-to-end on demand, clearly labeled.
- **Tests**: regression suite porting the legacy codebase's hard-won edge cases
  (`docs/LEGACY_EDGE_CASES.md`) plus workflow tests (crash-resume, duplicate
  events, HITL resume, auth scoping).
- **Google Cloud deployment assets**: Cloud Run services, Artifact Registry,
  Secret Manager, Cloud Scheduler, Pub/Sub event flow (`deploy/` + docs).

## 4. Provenance conventions

- New files live under clearly named locations: `agents/` (ADK service),
  `src/app/campaigns/[id]/**` (observability UI), `src/lib/campaign/**`,
  `src/lib/ai/gemini.ts`, `src/app/api/agent/**`, `deploy/`, `tests/`.
- Where a pre-existing file was materially modified (e.g. lazy Supabase client
  init so builds succeed without credentials), the change is minimal, behavior-
  preserving, and called out in commit messages.
