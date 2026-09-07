# Geseo — Agent Reply Document

## What Geseo Is

Geseo is an autonomous AI-powered outreach platform that handles the entire backlink outreach pipeline from prospect discovery to deal closure. Built for the AWS Agents for Humans hackathon using the **Strands Agents SDK**, it deploys 8 specialized AI agents that work together autonomously.

**Live Demo**: http://localhost:3100  
**Agent Service**: http://localhost:8104  
**Hackathon Mode**: `HACKATHON_MODE=true` (fails visibly if Strands unavailable)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Geseo Platform                        │
├─────────────────────────────────────────────────────────┤
│  Next.js UI (Port 3100)                                 │
│  └─ Campaign API /tick → Python Strands Agent Service   │
│                          (Port 8104)                    │
│                          └─ campaign_manager.py         │
│                              └─ 8 Specialist Agents     │
│                                  └─ @tools              │
│                                      └─ TypeScript      │
│                                          business logic  │
│                                      └─ Postgres (5433) │
└─────────────────────────────────────────────────────────┘
```

### Strands Agents SDK Integration

All agents are defined in `strands_agent_service/agents/`:

1. **strategy_agent** — Creates search angles and prospecting strategy
2. **discovery_agent** — Finds publications via Tavily search API
3. **qualification_agent** — Scores prospects on DR, traffic, relevance
4. **contact_agent** — Resolves email addresses via scraping + AI
5. **outreach_agent** — Drafts personalized emails from templates
6. **inbox_agent** — Monitors IMAP for replies, classifies intent
7. **negotiation_agent** — Handles price negotiation within budget
8. **campaign_manager** — Orchestrates the full pipeline

Each agent uses `@tool` decorators for TypeScript tool access via the `/api/agent/tools/*` gateway.

---

## How It Works (Demo Flow)

### Step 1: Create Campaign
```
POST /api/campaigns
{
  "name": "Tech Blog Outreach",
  "website_url": "https://yoursite.com",
  "constraints_text": "Only English publications. No gambling. Max $100/placement.",
  "budget_total": 500,
  "autonomy_mode": "autonomous",
  "demo_mode": true
}
```

### Step 2: Start Campaign
```
POST /api/campaigns/{id}/control
{ "action": "start" }
```

### Step 3: Watch Pipeline Execute
The 8 agents work sequentially:

1. **Strategy Agent** creates 6 search angles
2. **Discovery Agent** searches Tavily, finds 14 candidates
3. **Qualification Agent** scores each prospect (0.0-1.0)
4. **Contact Agent** resolves email addresses
5. **Outreach Agent** drafts personalized emails
6. **Inbox Agent** monitors for replies
7. **Negotiation Agent** handles counteroffers
8. **Campaign Manager** tracks progress and metrics

### Step 4: Monitor & Intervene
- Real-time activity timeline shows agent actions
- Dashboard displays pipeline metrics (discovery → qualification → outreach → deals)
- Human-in-the-loop interventions appear for:
  - Call requests (`sync_contact`)
  - Asset requests (`asset_request`)
  - Legal contracts (`legal_contract`)
  - Payment details (`payment_details`)
  - Portal submissions (`process_portal`)

---

## Key Features

### 1. Autonomous Pipeline
- Agents run independently with configurable autonomy levels
- Auto-tick via cron or manual Start/Pause/Resume/Stop
- Thread length limits prevent endless negotiation loops

### 2. Demo Mode
- Simulates publisher responses with realistic personas:
  - `high_anchor`: Starts high, negotiates down
  - `meeting_request`: Wants a call (routes to human)
  - `quick_deal`: Fast close at good price
  - `decliner`: Polite decline
  - `autoresponder`: Out-of-office
- All demo emails route to `ab.ghouri03@gmail.com`
- Real SMTP sending via Gmail app password

### 3. Email System
- Multi-step sequences (3-touch outreach)
- Per-domain rate limiting (1 email/day/domain)
- Email open tracking via tracking pixels
- Bounce detection and handling
- Template variables: `{{first_name}}`, `{{site_name}}`, `{{signer_name}}`

### 4. Negotiation Engine
- Configurable aggressiveness: `gentle`, `balanced`, `firm`
- Price floor/ceiling enforcement
- Anti-highball protection
- Automatic suppression after decline/unsubscribe
- Human intervention for calls, contracts, payments

### 5. Suppression System
- Domain-level suppression after hard_no or unsubscribe
- Author-level suppression
- Prevents re-contacting declined prospects

### 6. Observability
- Real-time agent activity timeline
- Execution engine badges (Strands vs fallback)
- Per-agent metrics (searches, qualifications, emails sent)
- Campaign-level KPIs (deals closed, budget spent, ROI)

---

## Test Coverage

### Reply Intent Classification (66 cases)
Tests the heuristic classifier across all intent types:
- `interested` (5 cases)
- `counter_offer` (6 cases)
- `accept` (5 cases — documented as heuristic limitation)
- `question` (5 cases)
- `hard_no` (9 cases)
- `unsubscribe` (5 cases)
- `auto` (4 cases)
- `needs_human` (15 cases)
- Price extraction (4 cases)
- Sentiment analysis (3 cases)
- Edge cases (5 cases)

### Negotiation Evaluation (36 cases)
Tests the full negotiation pipeline:
- Pricing tiers (6 cases)
- Reply intent classification (6 cases)
- Negotiation reply drafting (20 cases)
- Integration: classify → draft (4 cases)

### Key Findings
1. **Heuristic classifier limitations**: `accept`, `no-reply`, `do-not-reply` fall through to `interested`
2. **LLM required for**: `counter_offer`, `question`, `interested`, `needs_human` reply drafting
3. **Deterministic paths**: `hard_no`, `unsubscribe`, `accept` (with price), `auto` (some cases)

---

## Environment Variables

```bash
# Required
HACKATHON_MODE=true          # Fail visibly if Strands unavailable
AGENT_SERVICE_URL=http://localhost:8104
AGENT_SERVICE_TOKEN=REDACTED

# Email (demo mode)
GMAIL_USER=ab.ghouri03@gmail.com
GMAIL_SMTP_PASS=REDACTED
GMAIL_IMAP_PASS=REDACTED

# Search
TAVILY_API_KEY=tvly-xxx

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres
```

---

## Running the Demo

### 1. Start Services
```bash
# Docker (Postgres + PostgREST)
docker start seo-pg seo-pgrst

# PostgREST proxy
node scripts/pgrst-proxy.mjs

# Strands Agent Service
cd strands_agent_service
python main.py

# Next.js Dev Server
npm run dev
```

### 2. Create Demo Campaign
```bash
curl -X POST http://localhost:3100/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Demo Campaign",
    "website_url": "https://example.com",
    "constraints_text": "English publications only",
    "budget_total": 500,
    "demo_mode": true
  }'
```

### 3. Start Campaign
```bash
curl -X POST http://localhost:3100/api/campaigns/{id}/control \
  -H "Content-Type: application/json" \
  -d '{"action": "start"}'
```

### 4. Watch Activity
Open http://localhost:3100/campaigns/{id} to see:
- Real-time agent activity timeline
- Pipeline progress (discovery → qualification → outreach → deals)
- Email sending via SMTP
- Demo persona responses
- Negotiation threads

---

## What Makes This Special

### 1. True Strands Native
Not a TypeScript app with Strands bolted on. The 8 agents ARE the business logic, defined in Python with `@tool` decorators that call TypeScript functions.

### 2. Real SMTP + IMAP
Demo mode sends real emails via Gmail SMTP. Inbox monitoring via IMAP detects replies in real-time.

### 3. Autonomous + Human-in-the-Loop
Agents run independently but route to humans when they can't handle something:
- Call requests → `sync_contact`
- Asset requests → `asset_request`
- Legal contracts → `legal_contract`
- Payment details → `payment_details`
- Portal submissions → `process_portal`

### 4. Full Negotiation Engine
Multi-turn price negotiation with:
- Configurable aggressiveness
- Price floor/ceiling enforcement
- Anti-highball protection
- Thread length limits
- Automatic suppression after decline

### 5. Hackathon-Grade Quality
- 102 tests passing (66 reply intent + 36 negotiation)
- Full documentation (1082 lines)
- Clean TypeScript compilation
- Proper error handling and fallbacks

---

## Files Reference

### Core
- `src/lib/campaign/fallbackOrchestrator.ts` — Campaign pipeline orchestration
- `src/lib/negotiation/run.ts` — Negotiation reply handling
- `src/lib/negotiation/agent.ts` — Reply classification and drafting
- `src/lib/negotiation/settings.ts` — Negotiation configuration
- `src/lib/email/deliver.ts` — SMTP email delivery
- `src/lib/campaign/demo.ts` — Demo persona simulation

### API Routes
- `src/app/api/campaigns/route.ts` — Campaign CRUD
- `src/app/api/campaigns/[id]/tick/route.ts` — Pipeline execution
- `src/app/api/campaigns/[id]/control/route.ts` — Start/Pause/Resume/Stop
- `src/app/api/agent/tools/*/route.ts` — Strands agent tool gateway

### UI
- `src/app/campaigns/[id]/page.tsx` — Campaign detail page
- `src/app/campaigns/autonomous/page.tsx` — Campaign list
- `src/app/campaigns/new/page.tsx` — Campaign creation form
- `src/components/layout/Sidebar.tsx` — Navigation

### Tests
- `tests/reply-intent-evaluation.test.ts` — 66 reply classification cases
- `tests/negotiation-evaluation.test.ts` — 36 negotiation pipeline cases
- `tests/negotiation.test.ts` — Core negotiation logic tests

---

## Git History (Recent)

```
576c0f7 test: add evaluation harnesses (66 reply intent + 36 negotiation cases)
82d090d feat: P1 UI improvements for hackathon judges
d972b5f feat: implement hackathon winning plan P0 fixes
be30800 feat: email quality overhaul
c4d74c3 fix: email sending + negotiation campaign_id
8f7263b docs: comprehensive documentation
647504d feat: page redirects + favicon
```

---

**Built with Strands Agents SDK for AWS Agents for Humans Hackathon**
