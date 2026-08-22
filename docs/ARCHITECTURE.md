# Architecture

## The product in one sentence

An autonomous SEO deal-acquisition workforce: the user gives an objective, constraints and a
budget; a coordinated agent workforce researches prospects, resolves human contacts, runs
personalized outreach, negotiates within hard policy ceilings, and returns with structured
deals — escalating to a human only when policy or capability genuinely requires it.

## System diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ User (browser)                                                               │
│  /campaigns/autonomous   /campaigns/[id]  ·  inbox · negotiation · payments  │
└──────────────┬───────────────────────────────────────────────────────────────┘
               │ NextAuth v5 session (Google OAuth, domain-restricted)
┌──────────────▼───────────────────────────────────────────────────────────────┐
│ Next.js app on Cloud Run ("web")                                             │
│                                                                              │
│  Observability UI ── polls ──► /api/campaigns/[id]  (state + agent_events)    │
│  Campaign control ──► /api/campaigns/[id]/{start,tick}                        │
│                          │                         │                         │
│  Tool gateway /api/agent/*│                         ▼                         │
│   (AGENT_SERVICE_TOKEN)   │            ADK Agent Service on Cloud Run          │
│   discover qualify        ├──────────►  campaign_manager (root, Gemini)      │
│   contact outreach        │              ├ strategy_agent                    │
│   negotiate interventions │              ├ discovery_agent                   │
│   events state budget     │              ├ qualification_agent                │
│                           │              ├ contact_intel_agent                │
│                           │              ├ outreach_agent                     │
│                           │              ├ negotiation_agent                  │
│                           │              └ deal_agent                         │
│  Proven business engine ◄─┘              (tools call back over HTTP)         │
│   pipeline/* discovery · enrich/cascade contacts · email/* send+IMAP          │
│   negotiation/* classify→draft→clamp→send · score/* qualification            │
└──────────────┬───────────────────────────────────────┬───────────────────────┘
               │                                       │
     Supabase Postgres                    External providers
     campaigns, prospects, deals,         Gemini API · Ahrefs DR · Tavily/CSE/
     outreach_emails, negotiations,       Serper search · Hunter/enrich.so/Blitz
     agent_runs/events, budget_ledger,    enrichment · Reoon verification
     interventions, idempotency_keys      Gmail SMTP/IMAP (per-user app passwords)
               ▲
     Cloud Scheduler → /api/emails/process (burst sends + reply detection + follow-ups)
```

## Division of authority (the important part)

| Concern | Owner | Why |
|---|---|---|
| What to do next (phase, batch choice, strategy) | **Gemini via ADK** agents | Semantic judgment, planning |
| How much money may move | **Code** — pricing tiers (`negotiation/pricing.ts`), atomic budget reservation (`campaign/queries.reserveBudget`) | LLMs never decide money math |
| Whether an email goes out | **Code** — burst processor trust gates (role/placeholder/guessed rejection, duplicate-inbox guards, per-user SMTP) | Idempotent, auditable delivery |
| When humans get involved | **Both** — classifier detects capability gaps (`needs_human` taxonomy); code parks threads and creates durable `interventions` | No hollow promises |
| Deal truth | **Structured `deals` rows** with terms JSON + ledger entries | "Sounds good" ≠ closed |

## Long-running execution model

Campaigns run for days. Nothing assumes one request:

1. Work happens in **bounded ticks** (one phase action per tick), each idempotent and resumable.
2. Every tick writes an append-only **agent_events** row (deduped by `event_key`) so the UI can
   replay exactly what happened.
3. Phase transitions are computed from funnel counts by deterministic code — crash-safe.
4. Inbound email is event-shaped: Cloud Scheduler triggers `/api/emails/process`, which runs IMAP
   reply detection, records replies idempotently onto thread anchors (envelope-date stamped,
   monotonic — a legacy runaway fix), then the monitoring tick answers within policy.
5. ADK sessions persist in Postgres (`DatabaseSessionService`), so agent memory survives restarts.

## Google technologies used (and why)

- **Google ADK (Python)** — genuine orchestration: root Campaign Manager + specialist sub-agents,
  function tools bound to the gateway, durable sessions. Not decorative.
- **Gemini 3.5 Flash** (configurable via `GEMINI_MODEL`) — planning, article understanding,
  reply classification ambiguity, negotiation language. Structured outputs where downstream
  code depends on fields.
- **Cloud Run** — both web and agent service containers.
- **Cloud Scheduler** — drives the send/reply/follow-up processor every 30 minutes.
- **Secret Manager** — all credentials at deploy time.
- Supabase Postgres remains the system of record (pre-existing infrastructure; not replaced).

## Demo mode

Campaigns flagged `demo_mode` run the *entire real pipeline* — discovery, scoring, cascade,
outreach drafting, reply classification, negotiation policy, deals — except that outbound email
is recorded as simulated (labeled everywhere) and inbound replies are injected by scripted
publisher personas at the same entry point the real IMAP sweeper uses. Nothing is faked through
a parallel code path; only the transport boundary is simulated.
