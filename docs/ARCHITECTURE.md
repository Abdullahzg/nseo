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
│   (AGENT_SERVICE_TOKEN)   │            Strands Agent Service                  │
│   discover qualify        ├──────────►  campaign_manager (root, Bedrock)      │
│   contact outreach        │              ├ strategy_agent                    │
│   negotiate interventions │              ├ discovery_agent                   │
│   events state budget     │              ├ qualification_agent                │
│                           │              ├ contact_agent                      │
│                           │              ├ outreach_agent                     │
│                           │              ├ negotiation_agent                  │
│                           │              └ intervention_agent                 │
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
| What to do next (phase, batch choice, strategy) | **Claude via Strands** agents | Semantic judgment, planning |
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
5. Strands sessions persist via FileSessionManager (`campaign-{id}`), so agent memory survives restarts.

## AWS technologies used (and why)

- **Strands Agents SDK** — genuine orchestration: root Campaign Manager + specialist sub-agents,
  @tool-decorated functions bound to the gateway, agents-as-tools delegation, FileSessionManager sessions. Not decorative.
- **Amazon Bedrock** (`anthropic.claude-sonnet-4-20250514-v1:0`) — planning, article understanding,
  reply classification ambiguity, negotiation language. Structured outputs where downstream
  code depends on fields.
- **Vercel / Cloud Run** — hosts the Next.js app and agent service containers.

## Demo mode

Campaigns flagged `demo_mode` run the *entire real pipeline* — discovery, scoring, cascade,
outreach drafting, reply classification, negotiation policy, deals — except that outbound email
is recorded as simulated (labeled everywhere) and inbound replies are injected by scripted
publisher personas at the same entry point the real IMAP sweeper uses. Nothing is faked through
a parallel code path; only the transport boundary is simulated.
