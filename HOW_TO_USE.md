# HOW TO USE THE WEBAPP — Complete User Guide

## TL;DR

```
# 1. Start everything (Docker + Next.js + Strands)
.\scripts\start-local.ps1

# 2. Open browser
#    http://localhost:3100

# 3. Go to Campaigns
#    Click "Autonomous Campaigns" in the sidebar
#    Click "New Campaign"

# 4. Fill in the form (see below) and click Create

# 5. Click "Start Campaign" on the campaign card

# 6. Watch the agents work — ticks run every few seconds
```

---

## Prerequisites (one-time setup)

| Requirement | How to check | Fix if missing |
|---|---|---|
| Docker Desktop running | `docker ps` shows containers | Open Docker Desktop from Start Menu |
| Node.js installed | `node --version` shows v18+ | Install from nodejs.org |
| Python 3.12+ | `python --version` | Install from python.org |
| .venv activated | `pip list` shows strands-agents | `python -m venv .venv` then `.venv\Scripts\activate` |
| Dependencies installed | `pip list` shows fastapi, httpx | `pip install -r agents\requirements.txt` |
| Groq API key | `.env.local` has `GROQ_API_KEY=gsk_...` | Get free key at console.groq.com |

---

## Step-by-Step: Starting the System

### Option A: One command (recommended)
```powershell
.\scripts\start-local.ps1
```
This starts:
- Docker containers (Postgres, PostgREST, Kong, etc.)
- REST proxy (port 5440)
- Next.js dev server (port 3100)
- Python Strands agent service (port 8104)

### Option B: Manual startup
```powershell
# 1. Start Docker containers
docker start seo-pg seo-pgrst

# 2. Start REST proxy
node scripts/dev-rest-proxy.mjs

# 3. Start Next.js
npx next dev -p 3100

# 4. Start Strands service
$env:GROQ_API_KEY="gsk_..."
$env:MODEL_PROVIDER="groq"
$env:HACKATHON_MODE="true"
$env:AGENT_BASE_URL="http://localhost:3100"
cd agents
python -m uvicorn seo_workforce.main:app --host 0.0.0.0 --port 8104
```

---

## Step-by-Step: Creating Your First Campaign

### 1. Open the webapp
Go to **http://localhost:3100** in your browser.

You'll see the **Dashboard** with tabs: Overview, Prospects, Pipeline.

### 2. Navigate to Autonomous Campaigns
Click **"Autonomous Campaigns"** in the left sidebar under "Outreach".

This shows a grid of all agentic campaigns.

### 3. Click "New Campaign"
You'll see a form with these fields:

| Field | Example | What to put |
|---|---|---|
| **Campaign Name** | `Demo: AI Photo Restoration` | Anything descriptive |
| **Website URL** | `https://example.com` | Your site to get backlinks for |
| **Objective** | `Acquire 2 high-quality backlinks` | What you want to achieve |
| **Keywords** | `AI photo restoration, photo tools` | Comma-separated search terms |
| **Budget (USD)** | `500` | Max spend per deal |
| **Desired Deals** | `2` | How many backlinks you want |
| **Min DR** | `50` | Domain Rating minimum (rejects lower) |
| **Max per Deal** | `300` | Price ceiling per placement |
| **Demo Mode** | Toggle ON | Uses fake publishers (no real emails) |

### 4. Click "Create Campaign"
The campaign appears in the grid with status **"Draft"**.

### 5. Click "Start Campaign"
This flips the campaign to **"Planning"** phase and kicks the agent service.

### 6. Watch the agents work
The campaign detail page shows:
- **Phase badge** (planning → discovering → qualifying → ...)
- **Agent board** (8 agents, shows which one is active)
- **Funnel counts** (discovered, qualified, ready, etc.)
- **Live activity timeline** (every tick is logged)

---

## Understanding the Campaign Phases

```
draft → planning → discovering → qualifying → resolving_contacts → outreaching → monitoring → completed
```

| Phase | What happens | Agent involved |
|---|---|---|
| **planning** | Agent analyzes objective, notes strategy | strategy_agent |
| **discovering** | Searches web for prospects matching keywords | discovery_agent |
| **qualifying** | Scores prospects (DR gate, relevance, pricing) | qualification_agent |
| **resolving_contacts** | Finds author/editor emails | contact_agent |
| **outreaching** | Queues personalized emails | outreach_agent |
| **monitoring** | Watches for replies, negotiates | negotiation_agent |
| **completed** | Goal reached or budget exhausted | — |

Each tick does **one bounded action** in the current phase, then stops.

---

## What the Agents Actually Do (live demo proof)

When you create a campaign and tick it, here's what happens under the hood:

```
1. Strands service receives POST /tick with campaign_id
2. Orchestrator fetches campaign state from Next.js API
3. Campaign manager agent (Groq LLM) reads state + recommends action
4. Agent calls the right tool (e.g., run_discovery_batch)
5. Tool calls Next.js API endpoint (e.g., POST /api/agent/tools/discover)
6. TypeScript code runs the real pipeline (search, score, save to DB)
7. Tool returns result to agent
8. Agent summarizes what it did
9. Orchestrator checks if phase should advance
10. Returns TickResult with phase_before, phase_after, agent_mode
```

---

## The Webapp Pages (what each one does)

### Outreach (main workflow)
| Page | URL | What it does |
|---|---|---|
| **Dashboard** | `/` | Overview stats, prospect cards, pipeline controls |
| **Autonomous Campaigns** | `/campaigns/autonomous` | Agentic campaign list (your main page) |
| **Backlink Outreach** | `/backlinks` | Manual link building workspace |
| **Status** | `/sending` | Email queue: queued, sent, replied, won |
| **Inbox** | `/inbox` | Read and reply to real humans |

### Content
| Page | URL | What it does |
|---|---|---|
| **Blog** | `/blog` | Manage blog posts |
| **AI Writer** | `/blog/writer` | Generate articles with AI |
| **Clusters** | `/blog/clusters` | Keyword cluster analysis |
| **Landing Pages** | `/landing` | Create/manage landing pages |
| **Assets** | `/media` | Image generation and management |
| **Voices** | `/blog/voices` | Brand voice profiles for AI writer |

### SEO
| Page | URL | What it does |
|---|---|---|
| **Site Audit** | `/site-audit` | Check indexability, speed, health |
| **Growth Agents** | `/seo-agents` | Internal links, content refresh, GEO, rank watcher |

### Workspace
| Page | URL | What it does |
|---|---|---|
| **Handbook** | `/handbook` | Negotiation rules, pricing, tone settings |
| **Notifications** | `/notifications` | Author watches, alerts |
| **Admin** | `/admin` | Seed tools, harvesters, suppression, API keys |
| **Settings** | `/settings` | AI config, email config, user settings |

---

## Running Tests (proving it works)

### Quick validation (all tests)
```powershell
.\scripts\test-local.ps1
```

### Individual tests
```powershell
# Proves Groq LLM responds + uses tools
python scripts\groq-strands-smoke.py

# Proves DR gate rejects low-quality prospects
python scripts\test-dr-gate.py

# Proves system fails visibly when services are down
python scripts\test-failure-scenarios.py

# Full Python unit tests (37 tests)
python -m pytest agents\seo_workforce\test_agents.py -v

# Full TypeScript tests (24 tests)
npx vitest run
```

### What each test proves

| Test | What it proves |
|---|---|
| `groq-strands-smoke.py` | Groq returns "4" for 2+2, uses add_numbers tool for 17+25=42 |
| `test-dr-gate.py` | DR_MIN=50 rejects 7/12 prospects (DR 22-47), accepts 5 (DR 55-76) |
| `test-failure-scenarios.py` | Service down = 503, invalid campaign = error, no silent fallback |
| `test_agents.py` | 8 agents exist, 16 tools wired, delegation chain works, tick loop works |

---

## The "AI Back" You Can Show Someone

### What to demonstrate

**1. The Groq smoke test (30 seconds)**
```powershell
python scripts\groq-strands-smoke.py
```
Shows: Groq LLM responds, uses tools, all 5 checks pass.

**2. The webapp campaign creation (1 minute)**
- Open http://localhost:3100
- Go to Autonomous Campaigns
- Create a campaign with demo mode ON
- Start it
- Show the phase transitions in the detail page

**3. The Python tick (30 seconds)**
```powershell
# In another terminal:
$env:GROQ_API_KEY="gsk_..."
$env:MODEL_PROVIDER="groq"
$env:HACKATHON_MODE="true"
$env:AGENT_BASE_URL="http://localhost:3100"
cd agents
python -c "
import asyncio
from seo_workforce.orchestrator import CampaignOrchestrator
orch = CampaignOrchestrator()
result = asyncio.run(orch.tick('YOUR_CAMPAIGN_ID'))
print(f'Phase: {result.phase_before} -> {result.phase_after}')
print(f'Mode: {result.agent_mode}')
print(f'Action: {result.action_taken}')
"
```
Shows: Strands agent runs with Groq, ticks in 2-20 seconds.

**4. The test suite (1 minute)**
```powershell
python -m pytest agents\seo_workforce\test_agents.py -v
npx vitest run
```
Shows: 37 Python + 24 TypeScript tests all pass.

### Key talking points

- **Framework:** Strands Agents SDK (not LangChain, not AutoGen)
- **LLM:** Groq (free tier, OpenAI-compatible, `openai/gpt-oss-120b`)
- **Architecture:** 8 agents, 16 tools, agents-as-tools delegation
- **Safety:** Money math enforced in code, DR gate rejects bad prospects, HACKATHON_MODE fails visibly
- **37+24 tests** prove the system works

---

## Stopping Everything

```powershell
.\scripts\stop-local.ps1
```

This stops:
- Python Strands service (port 8104)
- Next.js dev server (port 3100)
- REST proxy (port 5440)
- Leaves Docker containers running (data preserved)

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `docker ps` fails | Open Docker Desktop, wait for it to start |
| Port 5433 down | `docker start seo-pg` |
| Port 5440 down | `node scripts/dev-rest-proxy.mjs` |
| Port 3100 down | `npx next dev -p 3100` |
| Port 8104 down | `cd agents; python -m uvicorn seo_workforce.main:app --port 8104` |
| Campaign creation 500 | Check Postgres is up on 5433 |
| Tick returns 503 | Check Strands service is up on 8104 |
| Groq error | Check `GROQ_API_KEY` in `.env.local` |
| `Bearer ` error | Fixed in gateway.py — restart Strands service |
