# Geseo — Complete Project Document

> **Hackathon**: AWS Agents for Humans (Devpost)
> **Framework**: Strands Agents SDK (Python) + Next.js (TypeScript)
> **Model**: Groq via `strands.models.openai.OpenAIModel` (`openai/gpt-oss-120b`)
> **Git**: `https://github.com/Abdullahzg/geseo.git`
> **Tests**: 195 TypeScript + 44 Python = **239 total passing**

---

## 1. What This Is

Geseo is an autonomous AI-powered outreach platform for backlink/PR outreach. It handles the full cycle: prospect discovery → qualification → contact resolution → email outreach → multi-turn negotiation → deal closure.

The core innovation: **8 Strands agents in Python are the business logic**. The TypeScript layer is a thin HTTP gateway. In hackathon mode, if the Strands service goes down, the system fails visibly (503) — no silent TypeScript fallback.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Next.js UI (port 3001)                                │
│  Campaigns / Agent Runs / Inbox / Sending / Settings   │
└──────────────┬──────────────────────────────────────────┘
               │ HTTP
┌──────────────▼──────────────────────────────────────────┐
│  Campaign API /tick                                     │
│  src/app/api/campaigns/[id]/tick/route.ts              │
│  HACKATHON_MODE=true → 503 if Strands unavailable     │
└──────────────┬──────────────────────────────────────────┘
               │ HTTP :8104
┌──────────────▼──────────────────────────────────────────┐
│  Python Strands Agent Service (FastAPI)                 │
│  agents/seo_workforce/main.py                          │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│  campaign_manager (root agent)                         │
│  Delegates to 7 specialist agents via as_tool()        │
└──┬────┬────┬────┬────┬────┬────┬───────────────────────┘
   │    │    │    │    │    │    │
   ↓    ↓    ↓    ↓    ↓    ↓    ↓
 strategy discovery qualification contact outreach negotiation intervention
   │    │    │    │    │    │    │
   ↓    ↓    ↓    ↓    ↓    ↓    ↓
 @tools (Strands) ──→ TypeScript gateway ──→ Postgres
```

**8 agents**: campaign_manager, strategy_agent, discovery_agent, qualification_agent, contact_agent, outreach_agent, negotiation_agent, intervention_agent

**9 tools** (each a `@tool`-decorated Python function calling TS HTTP):
1. `get_campaign_state` — read campaign + pipeline stats
2. `plan_discovery` — generate search queries via LLM
3. `run_discovery_batch` — Tavily search + Blitz scoring
4. `run_qualification_batch` — score prospects against filters
5. `run_contact_resolution` — find email addresses
6. `queue_outreach_batch` — draft and send emails
7. `run_negotiation_tick` — classify replies + draft responses
8. `list_open_interventions` — read HITL queue
9. `complete_campaign` — mark campaign done

---

## 3. Strands Agent Architecture Ownership

The architecture enforces a strict separation between Strands (intelligence) and TypeScript (execution):

### What Strands Owns (via LLM reasoning)
- Campaign orchestration and phase transitions
- Next-action decisions based on current state
- Agent delegation to specialist agents
- Qualification judgment (pass/fail/edge)
- Outreach strategy (tone, personalization, timing)
- Reply understanding and intent classification
- Negotiation strategy (counter-offer amount, approach)
- Escalation decisions (when to route to human)

### What TypeScript Owns (deterministic, never LLM)
- Database reads/writes (Postgres via PostgREST)
- HTTP/API calls to external services
- Email delivery (Gmail SMTP)
- Price ceiling enforcement (`Math.min(suggestedOffer, ceiling)`)
- Suppression list enforcement
- Max thread length enforcement (hard code, not prompt)
- Idempotency and deduplication
- Input validation and sanitization
- Rate limiting (per-domain email limits)

### Why This Matters for Judges
This separation means the system is **explainable** — every Strands decision is logged with reasoning, and every safety constraint is enforced by deterministic code that can be audited. The LLM cannot bypass safety rules because they are not implemented as prompts.

---

## 4. Running the System

### Prerequisites
- Node.js 18+
- Python 3.11+
- Docker (for Postgres + PostgREST)
- API keys: Groq, Tavily, Blitz, Gmail SMTP/IMAP

### Start services
```bash
# 1. Database
docker compose up -d seo-pg seo-pgrst

# 2. PostgREST proxy (strips /rest/v1/ prefix)
node scripts/pgrst-proxy.mjs &

# 3. Next.js dev server
npm run dev -- -p 3001

# 4. Strands agent service
cd agents
pip install -r requirements.txt
uvicorn seo_workforce.main:app --host 0.0.0.0 --port 8104
```

### Verify
```bash
curl http://localhost:8104/health   # Strands service
curl http://localhost:3001          # Next.js UI
```

---

## 5. Demo Flow (For Judges)

### Create Campaign
1. Go to `http://localhost:3001/campaigns/new`
2. Fill in:
   - Name: "E2E Demo Campaign"
   - Website: `https://example.com`
   - Budget: 500
   - Constraints: "English publications only, tech/SaaS verticals"
   - Mode: Fully Autonomous
   - **Demo Mode: ON** (toggle checked)
3. Click "Create Campaign"

### Start & Watch
1. On the campaign detail page, click **Start**
2. Watch the phase progression: draft → planning → discovering → qualifying → resolving_contacts → outreaching → monitoring
3. Badges visible: "Execution: Strands Agents", "Fallback: OFF"

### What Happens Autonomously
- **Discovery**: Tavily searches find relevant publications, Blitz scores DR/traffic
- **Qualification**: Prospects scored against relevance + authority filters
- **Contact Resolution**: Email addresses found via Hunter.io / web scraping
- **Outreach**: Personalized emails sent via Gmail SMTP
- **Negotiation**: Multi-turn price negotiation with floor/ceiling enforcement
- **Demo Mode**: Simulated publisher responses (5 personas: high_anchor, meeting_request, quick_deal, decliner, autoresponder)

### Monitor
- **Campaign detail** (`/campaigns/{id}`): Metrics, phase, prospect pipeline
- **Agent Runs** (`/agent-runs`): Full timeline of every Strands agent execution
- **Inbox** (`/inbox`): Reply threads requiring human response
- **Sending** (`/sending`): Email status dashboard (queued, sent, replied, wins)

---

## 6. Safety & Hackathon Enforcement

### Environment Variables
| Variable | Default | Effect |
|----------|---------|--------|
| `HACKATHON_MODE` | `true` | System fails visibly (503) if Strands unavailable |
| `REQUIRE_STRANDS` | `true` (auto when HACKATHON_MODE=true) | Blocks TS-only fallback |
| `ALLOW_ORCHESTRATOR_FALLBACK` | `false` (auto when HACKATHON_MODE=true) | Forces Python Strands path |

### Hard Safety Rules (deterministic code, not LLM prompts)
- **Thread length**: Enforced as early return in `draftNegotiationReply` — stops after `max_thread_length` messages
- **Unsubscribe always stops**: Priority 0 intent, wins over every other intent
- **Hard no always stops**: Returns polite decline + goodbye
- **Ceiling never exceeded**: `suggestedOffer = Math.min(suggestedOffer, ceiling)` after every LLM call
- **Suppression**: After decline/unsubscribe, domain + author added to suppression table

### Failure Mode Test
When Strands is down and HACKATHON_MODE=true, the system returns a 503 error — never silently executes TypeScript-only logic:
```
GET /api/campaigns/{id}/tick → 503 { error: "Strands service unavailable" }
```

---

## 7. Reply Classification (9 Intents)

The classifier handles these intents in priority order:

| Intent | Priority | Action |
|--------|----------|--------|
| `unsubscribe` | 0 | Stop immediately, suppress, send goodbye |
| `hard_no` | 1 | Stop, decline politely, suppress |
| `auto` | 2 | Log as auto-reply, do nothing |
| `needs_human` | 3 | Create intervention, pause thread |
| `counter_offer` | 4 | Continue negotiation within floor/ceiling |
| `interested` | 5 | Continue outreach/negotiation |
| `question` | 6 | Continue with LLM-drafted answer |
| `accept` | 7 | Close deal at their price (if within ceiling) |
| `other_channel` | 3 | Route to human (WhatsApp, LinkedIn, etc.) |

### needs_human Subtypes
`sync_contact` (call), `other_channel` (WhatsApp/Telegram), `legal_contract` (NDA), `payment_details` (invoice), `process_portal` (vendor portal), `asset_request` (media kit/logo), `redirect` (wrong person), `identity_verification` (LinkedIn connect), `factual_question` (traffic/stats), `over_policy` (retainer/exclusivity)

---

## 8. Negotiation Engine

### Pricing Model
- **Ceiling**: Max we'll pay (from pricing tier or override)
- **Floor**: Min we'll pay (from campaign config)
- **Opening percent**: Where we start (default 40% of floor..ceiling range)
- **Anti-highball**: Never propose a number before they name theirs

### Deterministic Paths (no LLM needed)
1. **Hard no/unsubscribe** → polite close, stop
2. **Accept at their price within ceiling** → close deal at THEIR number
3. **Accept with prior price in thread** → close at that established price
4. **Vague accept with no price** → ask for confirmation (do NOT invent price)
5. **Thread length exceeded** → wind down, stop

### LLM Paths
- Counter offers (negotiate within ceiling)
- Interested replies (continue conversation)
- Questions (answer from knowledge)
- Auto-responders (log and skip)

### Safety Enforcement
```
if (overLength) return { shouldStop: true, statusHint: "stalled" };
if (theirPrice > ceiling) → counter down, do NOT accept
suggestedOffer = Math.min(suggestedOffer, ceiling);
suggestedOffer = Math.max(suggestedOffer, floor);
```

---

## 9. Budget Exception (HITL)

### Timing
The budget exception check happens **BEFORE** the LLM drafts a reply. This prevents the LLM from auto-agreeing to a price that requires human approval.

### Flow
1. Reply arrives with a price mention
2. `run.ts` checks: `priceMentioned > human_approval_above`?
3. If yes AND `priceMentioned <= absolute_max_price`:
   - Create `budget_exception` intervention in `outreach_emails`
   - Set `negotiation_status = "needs_human"`
   - Return `{ paused: true, statusHint: "needs_human" }`
4. If `priceMentioned > absolute_max_price`:
   - Block entirely — cannot accept, must escalate
5. If within auto-approval threshold:
   - Continue to LLM for drafting

### Intervention Display
The Inbox (`/inbox`) shows budget exceptions with:
- Publisher's asked price
- Auto-approval threshold
- Absolute maximum
- Full negotiation thread context

### Resolution
Human approves or rejects → campaign resumes or closes.

---

## 10. Accept-Without-Price Logic

### The Problem
Previously, when a publisher said "sounds good" without mentioning a price, the system would close at the opening percent (e.g., 40% of floor..ceiling). This was risky — we might be agreeing to a number that doesn't match what either side had in mind.

### The Fix
Now, when `intent == "accept"` and `theirPrice == null`:
1. **Scan the thread backwards** for the most recent price mentioned by either side
2. **If a prior price exists** and is within floor..ceiling → accept at that price
3. **If no prior price found** → ask for confirmation: "could you let me know your rate?"
4. **If prior price is above ceiling** → ask for confirmation (don't use it)

### Why This Matters
- Prevents accidental overpayment (accepting at an invented number)
- Prevents accidental underpayment (accepting at opening percent when they expected more)
- Keeps negotiation active when ambiguous — more human-like behavior
- Deterministic code, not LLM-dependent

---

## 11. Email System

### Template Variables
- `{{first_name}}` — Recipient first name
- `{{publication}}` — Publication name
- `{{signer_name}}` — "Abdullah Zubair" (configurable)
- `{{custom_opener}}` — LLM-generated personalization
- `{{topic_relevance}}` — Why we're reaching out

### Delivery
- Gmail SMTP (port 587, STARTTLS)
- Per-domain rate limiting (max 3/day per domain)
- Em dash sanitization (→ comma for email compatibility)
- Bounce detection via IMAP
- Open tracking via tracking pixel

### Demo Mode
- All emails route to `ab.ghouri03@gmail.com`
- 5 simulated personas respond automatically
- Persona scoped by campaign_id (no cross-contamination)

### Quality Rules
- Greetings always use recipient's first name
- No em dashes in emails (sanitize to comma)
- Custom openers reference specific article/topic
- Signer name matches sender email config

---

## 12. UI Pages

| Page | URL | Purpose |
|------|-----|---------|
| Homepage | `/` | Hero, features, CTAs |
| Campaign List | `/campaigns/autonomous` | All campaigns with status |
| Campaign Create | `/campaigns/new` | Simplified creation form |
| Campaign Detail | `/campaigns/{id}` | Phase, metrics, prospects, controls |
| Agent Runs | `/agent-runs` | Strands execution timeline |
| Inbox | `/inbox` | Reply threads requiring human response |
| Sending | `/sending` | Email status dashboard |
| Settings | `/settings` | Configuration |

### Sidebar Navigation
```
Geseo
├── Campaigns → /campaigns/autonomous
├── Decisions → /sending
├── Inbox → /inbox
├── Agent Runs → /agent-runs
└── Settings → /settings
```

### Design System
- **Theme**: Pure black & white monochrome
- **Font**: Poppins (weights 300-700)
- **Brand**: "Geseo" with SummitMark icon
- **Components**: shadcn/ui (Button, Badge, Sheet, Dialog, Tabs)

---

## 13. Test Suite (239 Tests)

### TypeScript (195 tests, 6 files)

**`tests/reply-intent-evaluation.test.ts`** — 66 cases
- Interested (5 cases)
- Counter offers (6 cases)
- Accept (5 cases — heuristic limitation noted)
- Questions (5 cases)
- Hard no (9 cases — some heuristic limitations)
- Unsubscribe (5 cases)
- Auto (4 cases — some limitations)
- Needs human (15 cases covering all subtypes)
- Price extraction (4 cases)
- Sentiment (3 cases)
- Edge cases (5 cases)

**`tests/negotiation-evaluation.test.ts`** — 36 cases
- Pricing tiers (6 cases)
- Reply intent classification (6 cases)
- Negotiation reply drafting (20 cases — including accept-without-price fix)
- Integration: classify → draft (4 cases)

**`tests/pipeline-e2e.test.ts`** — 66 cases
- Reply intent classification (23 cases)
- Negotiation engine (8 cases — including thread-scan accept)
- Pricing engine (6 cases)
- Safety constraints (5 cases)
- Hackathon config (3 cases)
- Email system (2 cases)
- Campaign tools (5 cases)
- Module imports (8 cases)
- Integration (4 cases — skip without server)

**`tests/negotiation.test.ts`** — 12 cases
- Heuristic classification (7 cases)
- Deterministic policy paths (4 cases — including accept-without-price)
- Pricing tiers (4 cases)

**`tests/filters.test.ts`** — 9 cases
- Qualification filters (4 cases)
- Email safety (2 cases)
- Author name cleaning (2 cases)
- Domain canonicalization (1 case)

**`tests/hackathon-failure.test.ts`** — 2 cases
- fallbackOrchestrator rejects when Strands unavailable
- Tick route returns 503 when Strands is down

### Python (44 tests, 1 file)

**`evaluation/test_reply_classification.py`** — 44 cases
- Classification cases (32 parametrized)
- Priority rules (1 case)
- Subtype coverage (1 case)
- Safety constraints (3 cases)
- Agent delegation (3 cases)
- Hackathon requirements (5 cases)

### Running Tests
```bash
# TypeScript
npx vitest run

# Python
python -m pytest evaluation/test_reply_classification.py -v

# Hackathon failure mode
$env:HACKATHON_MODE="true"; $env:REQUIRE_STRANDS="true"; npx vitest run
```

---

## 14. Database Schema

### Tables (Postgres)
- `campaigns` — Campaign config, phase, metrics
- `prospects` — Discovered publications
- `contacts` — Email addresses
- `outreach_emails` — Sent/drafted emails with campaign_id
- `negotiation_threads` — Multi-turn conversations
- `deals` — Closed agreements
- `interventions` — HITL queue (budget_exception, sync_contact, etc.)
- `agent_runs` — Strands execution history
- `agent_events` — Detailed event timeline
- `suppression` — Domains/authors to skip
- `idempotency_keys` — Deduplication

### Key Columns Added
- `outreach_emails.campaign_id` — Links emails to campaigns
- `outreach_emails.opened_at` — Open tracking
- `prospects.campaign_id` — Scoped prospect pipeline

---

## 15. Key Files Reference

### Python (Strands Agents)
- `agents/seo_workforce/agents.py` — 8 agent definitions
- `agents/seo_workforce/tools.py` — 9 @tool wrappers
- `agents/seo_workforce/orchestrator.py` — Campaign orchestrator
- `agents/seo_workforce/config.py` — Groq model config
- `agents/seo_workforce/main.py` — FastAPI entry point
- `agents/seo_workforce/test_agents.py` — 37 unit tests

### TypeScript (Business Logic)
- `src/lib/negotiation/agent.ts` — Reply classification + drafting (accept-without-price logic)
- `src/lib/negotiation/pricing.ts` — Pricing engine
- `src/lib/negotiation/run.ts` — Negotiation runner + budget exception (BEFORE draft)
- `src/lib/campaign/fallbackOrchestrator.ts` — Pipeline orchestration (REQUIRE_STRANDS guard)
- `src/lib/campaign/tools.ts` — Tool implementations
- `src/lib/email/deliver.ts` — SMTP delivery
- `src/lib/campaign/demo.ts` — Demo personas

### API Routes
- `src/app/api/campaigns/route.ts` — CRUD
- `src/app/api/campaigns/[id]/tick/route.ts` — Pipeline execution
- `src/app/api/campaigns/[id]/control/route.ts` — Start/Pause/Resume/Stop
- `src/app/api/agent/tools/*/route.ts` — Tool gateway (6 routes)
- `src/app/api/agent/interventions/route.ts` — HITL queue
- `src/app/api/agent/events/route.ts` — Event timeline
- `src/app/api/agent-runs/route.ts` — Run history
- `src/app/api/agent-runs/events/route.ts` — Run events

### UI Pages
- `src/app/campaigns/[id]/page.tsx` — Campaign detail
- `src/app/campaigns/autonomous/page.tsx` — Campaign list
- `src/app/campaigns/new/page.tsx` — Campaign creation
- `src/app/agent-runs/page.tsx` — Agent runs timeline
- `src/app/sending/page.tsx` — Email status
- `src/app/inbox/page.tsx` — Reply threads
- `src/components/layout/Sidebar.tsx` — Navigation

---

## 16. Strands Agent Details

### campaign_manager (Root)
- Delegates to all 7 specialist agents via `as_tool()`
- Coordinates phase transitions
- Handles intervention resolution

### strategy_agent
- Plans campaign approach based on website analysis
- Generates target persona and tone

### discovery_agent
- Plans search queries for prospect discovery
- Executes Tavily searches, scores with Blitz

### qualification_agent
- Scores prospects against campaign filters
- Filters: domain rank, traffic, US share, mentions

### contact_agent
- Resolves email addresses for qualified prospects
- Uses Hunter.io and web scraping

### outreach_agent
- Drafts personalized outreach emails
- Manages email delivery via SMTP

### negotiation_agent
- Classifies incoming replies (9 intents)
- Drafts negotiation responses
- Enforces floor/ceiling pricing

### intervention_agent
- Manages HITL queue
- Routes budget exceptions, call requests, etc.

---

## 17. Tool Gateway

Each Python `@tool` function calls the TypeScript HTTP gateway:

```
Python @tool → HTTP POST → TypeScript /api/agent/tools/* → Postgres
```

### Tool Routes
| Tool | Route | Purpose |
|------|-------|---------|
| `get_campaign_state` | `GET /api/agent/tools/campaign-state` | Read campaign + stats |
| `plan_discovery` | `POST /api/agent/tools/plan-discovery` | Generate search queries |
| `run_discovery_batch` | `POST /api/agent/tools/discover-batch` | Tavily + Blitz scoring |
| `run_qualification_batch` | `POST /api/agent/tools/qualify-batch` | Score against filters |
| `run_contact_resolution` | `POST /api/agent/tools/resolve-contact` | Find email addresses |
| `queue_outreach_batch` | `POST /api/agent/tools/outreach-batch` | Draft + send emails |
| `run_negotiation_tick` | `POST /api/agent/tools/negotiation-tick` | Classify + draft replies |
| `list_open_interventions` | `GET /api/agent/tools/interventions` | Read HITL queue |
| `complete_campaign` | `POST /api/agent/tools/complete-campaign` | Mark campaign done |

---

## 18. Demo Mode

### How It Works
- Toggle "Demo Mode" on campaign creation
- All emails route to `ab.ghouri03@gmail.com` (override recipient)
- 5 simulated publisher personas respond automatically

### Personas (scoped by campaign_id)
| Persona | Behavior | Response Time |
|---------|----------|---------------|
| `high_anchor` | Asks high price, negotiates down | Immediate |
| `meeting_request` | Wants to jump on a call | Immediate |
| `quick_deal` | Accepts quickly at fair price | Immediate |
| `decliner` | Politely declines | Immediate |
| `autoresponder` | Out-of-office reply | Immediate |

### Why Demo Mode
- Judges see the full pipeline working end-to-end
- No need to wait for real publisher responses
- Controlled, repeatable demo experience
- Still exercises the real email delivery path (SMTP → Gmail → IMAP)

---

## 19. Pricing Engine

### Tier-Based Pricing
Campaigns define pricing tiers with minimum thresholds:
```typescript
{
  min_dr: 50,           // Minimum Domain Rank
  min_traffic: 10000,   // Minimum monthly traffic
  min_us_share: 50,     // Minimum US audience share
  max_offer: 150,       // Maximum we'll pay for this tier
  label: "t1"           // Tier identifier
}
```

### maxOfferFor Logic
1. Sort tiers by `max_offer` descending
2. For each tier, check if prospect meets ALL minimums
3. Return highest qualifying tier's `max_offer`
4. If no tier qualifies → return null (placement-only, no $ offer)

### Anti-Highball
- Never propose a number before the publisher names theirs
- Opening offer starts at `opening_percent` of floor..ceiling range
- Counters stay within ceiling (never agree above it)

---

## 20. Suppression & Safety

### Suppression List
After decline or unsubscribe:
- Domain added to suppression table
- Author email added to suppression table
- Future outreach skips suppressed domains/authors

### Thread Length Enforcement
- Enforced as early return in `draftNegotiationReply`
- After `max_thread_length` messages → return `{ shouldStop: true, statusHint: "stalled" }`
- Prevents infinite negotiation loops
- Hard code, not LLM prompt — cannot be bypassed

### Price Ceiling Enforcement
- After every LLM draft: `suggestedOffer = Math.min(suggestedOffer, ceiling)`
- If `theirPrice > ceiling` → counter down, never accept
- Deterministic code — LLM cannot agree above ceiling

---

## 21. Campaign Lifecycle

### Phases
```
draft → planning → discovering → qualifying → resolving_contacts → outreaching → monitoring → complete
```

### Phase Transitions
1. **draft → planning**: User clicks Start
2. **planning → discovering**: Strategy agent generates queries
3. **discovering → qualifying**: Discovery batch finds prospects
4. **qualifying → resolving_contacts**: Prospects qualified against filters
5. **resolving_contacts → outreaching**: Contact emails resolved
6. **outreaching → monitoring**: Outreach emails sent, waiting for replies
7. **monitoring → complete**: All threads resolved or campaign stopped

### Human Intervention Points
- Budget exception (price > auto-approval threshold)
- Call request (publisher wants to talk)
- NDA/contract request
- Invoice/payment details
- Vendor portal submission
- Asset request (media kit, logo)
- Wrong person redirect
- LinkedIn identity verification
- Factual question about traffic/stats
- Retainer/exclusivity request

---

## 22. Environment Variables

### Required
| Variable | Purpose |
|----------|---------|
| `GROQ_API_KEY` | Groq LLM access |
| `TAVILY_API_KEY` | Tavily search API |
| `BLITZ_API_KEY` | Blitz domain scoring |
| `SMTP_HOST` | Gmail SMTP host |
| `SMTP_PORT` | Gmail SMTP port |
| `SMTP_USER` | Gmail address |
| `SMTP_PASS` | Gmail app password |
| `IMAP_HOST` | Gmail IMAP host |
| `IMAP_USER` | Gmail address |
| `IMAP_PASS` | Gmail app password |

### Hackathon Mode
| Variable | Default | Effect |
|----------|---------|--------|
| `HACKATHON_MODE` | `true` | Fail visibly on Strands failure |
| `REQUIRE_STRANDS` | `true` | Block TS-only fallback |
| `ALLOW_ORCHESTRATOR_FALLBACK` | `false` | Force Python path |

### Optional
| Variable | Default | Purpose |
|----------|---------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:5440` | PostgREST proxy |
| `DATABASE_URL` | — | Direct Postgres connection |

---

## 23. API Reference

### Campaign Management
- `GET /api/campaigns` — List all campaigns
- `POST /api/campaigns` — Create new campaign
- `GET /api/campaigns/{id}` — Get campaign details
- `POST /api/campaigns/{id}/tick` — Execute one pipeline tick
- `POST /api/campaigns/{id}/control` — Start/Pause/Resume/Stop

### Agent Tools
- `GET /api/agent/tools/campaign-state` — Campaign state
- `POST /api/agent/tools/plan-discovery` — Generate queries
- `POST /api/agent/tools/discover-batch` — Run discovery
- `POST /api/agent/tools/qualify-batch` — Qualify prospects
- `POST /api/agent/tools/resolve-contact` — Find contacts
- `POST /api/agent/tools/outreach-batch` — Send emails
- `POST /api/agent/tools/negotiation-tick` — Negotiate
- `GET /api/agent/tools/interventions` — HITL queue
- `POST /api/agent/tools/complete-campaign` — Complete

### Agent Runs
- `GET /api/agent-runs` — List agent runs
- `GET /api/agent-runs/events` — List agent events

### Interventions
- `GET /api/agent/interventions` — List open interventions
- `POST /api/agent/interventions/{id}/resolve` — Resolve intervention

---

## 24. Error Handling

### Strands Down (HACKATHON_MODE=true)
```
POST /api/campaigns/{id}/tick → 503
{ "error": "Strands service unavailable", "hint": "Start the Python agent service on port 8104" }
```

### Database Unreachable
```
POST /api/campaigns/{id}/tick → 500
{ "error": "Database connection failed" }
```

### Email Delivery Failed
```
outreach_emails.status = "failed"
outreach_emails.send_error = "SMTP connection timeout"
```

### Intervention Required
```
outreach_emails.negotiation_status = "needs_human"
outreach_emails.intervention_type = "budget_exception"
outreach_emails.intervention_ask = "Publisher asks $300, auto-approval limit is $150"
```

---

## 25. Performance & Scaling

### Current Limits
- Single Next.js process (port 3001)
- Single Python FastAPI process (port 8104)
- Single Postgres instance (port 5433)
- Per-domain rate limit: 3 emails/day

### Scaling Considerations
- Tool gateway is stateless — can be horizontally scaled
- Strands service is stateless — can be horizontally scaled
- Postgres is the bottleneck — consider connection pooling
- Email delivery is rate-limited by Gmail (500/day for free, 2000/day for Workspace)

---

## 26. Git History

```
feb4f28 docs: add agent reply document for hackathon submission
576c0f7 test: add evaluation harnesses (66 reply intent + 36 negotiation cases)
82d090d feat: P1 UI improvements for hackathon judges
d972b5f feat: implement hackathon winning plan P0 fixes
d3a2875 feat: hackathon enforcement + metrics + budget_exception
be30800 feat: email quality overhaul
c4d74c3 fix: email sending + negotiation campaign_id
8f7263b docs: comprehensive documentation
647504d feat: page redirects + favicon
```

---

## 27. What Makes This Special

1. **Strands is the core, not a wrapper** — 8 Python agents with `@tool` decorators own the business logic. TypeScript is a thin gateway. Hackathon mode enforces this with 503 on Strands failure.

2. **Real email delivery** — Gmail SMTP sends real emails in demo mode. IMAP monitors for replies. No mock/spoof.

3. **Autonomous + safe** — Agents run independently but route to humans for calls, NDAs, invoices, budget exceptions. Hard safety rules (thread limits, ceiling enforcement) are deterministic code, not LLM prompts.

4. **Full negotiation engine** — Multi-turn price negotiation with configurable aggressiveness, anti-highball behavior, floor/ceiling enforcement, and thread limits.

5. **Budget exception timing** — The budget check happens BEFORE the LLM drafts a reply. This prevents the LLM from auto-agreeing to a price that requires human approval.

6. **Accept-without-price safety** — When a publisher says "sounds good" without mentioning a price, the system scans the thread for prior price context. If none found, it asks for confirmation instead of inventing a number.

7. **239 tests passing** — Clean TypeScript compilation. Evaluation suite proves Strands delegation, classification quality, and safety constraints.

---

**Built with Strands Agents SDK for AWS Agents for Humans Hackathon**
