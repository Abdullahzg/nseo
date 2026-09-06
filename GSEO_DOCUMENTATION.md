# Geseo — Comprehensive System Documentation

## Table of Contents
1. Overview
2. Architecture & Tech Stack
3. Complete User Flow (Campaign Lifecycle)
4. All Pages & Navigation
5. Features Guide (with Examples)
6. Campaign Pipeline Phases Explained
7. Tick System Explained
8. Negotiation Agent Deep Dive
9. HITL (Human-in-the-Loop) Intervention Flows
10. Inbox System
11. Email Quality & Template System
12. Metrics & Dashboard
13. Demo Mode Guide
14. Setup Verification Checklist
15. Troubleshooting
16. API Reference
17. How to Verify the System is Working

---

## 1. Overview

Geseo (pronounced "Jes-eo") is an AI-powered outreach platform built for the **AWS/Devpost "Agents for Humans" hackathon** using the **Strands Agents SDK**. The system orchestrates an autonomous campaign pipeline that discovers prospects, qualifies them, resolves contacts, sends personalized emails, receives replies, and negotiates deals — all without human intervention unless explicitly needed (Human-in-the-Loop / HITL).

### What It Does
- Discovers relevant websites/bloggers from keywords (Tavily + Blitz)
- Qualifies prospects using heuristic keyword matching
- Resolves contact emails
- Sends personalized outreach emails via Gmail SMTP
- Detects replies via IMAP (or simulated in demo mode)
- Classifies reply intent (positive, negotiation, meeting request, decline, OOO)
- Negotiates deals autonomously with configurable pricing
- Pauses for human review when AI needs help (HITL)
- Tracks opens, bounces, replies, and deal revenue
- Computes ROI per campaign and per platform

### Who It's For
- **End users**: Marketing agencies, SEO professionals, growth teams
- **Hackathon judges**: Evaluating AI agent autonomy and transparency
- **Agents/systems**: The documentation serves as a verification protocol

### Demo Mode
All testing should use **demo mode** (`demo_mode = true`). This requires no Google OAuth, no paid APIs, and routes all emails to `ab.ghouri03@gmail.com` via configured SMTP.

---

## 2. Architecture & Tech Stack

### High-Level Architecture
```
┌─────────────────────────────────────────────────────────────────────┐
│                    Next.js 16 Frontend (port 3001)                   │
│  Pages: /campaigns/autonomous, /inbox, /sending, /negotiation       │
│  API: /api/campaigns, /api/campaigns/:id/tick, /api/agent/tools/*   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP/JSON
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│          Python Strands Service (port 8104, port 8104)             │
│  - campaign_manager root agent                                      │
│  - 7 specialist sub-agents                                          │
│  - straps.agents.* modules                                          │
│  - straps.models.openai.OpenAIModel (Groq LLaMA 120b)              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ Tool calls via HTTP to /api/agent/tools/*
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│         Next.js API Routes (TypeScript) (same server)               │
│  - /api/agent/tools/discover                                        │
│  - /api/agent/tools/evaluate                                        │
│  - /api/agent/tools/send_email                                      │
│  - /api/agent/tools/negotiate                                       │
│  - /api/agent/tools/resolve_contact                                 │
│  - etc.                                                             │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ Uses supabaseAdmin client
                               ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│  Postgres :5433     │  │ PostgREST :5441     │  │ Proxy :5440        │
│ (seo-pg container)  │  │ (seo-pgrst container)│ │ (scripts/pgrst...) │
│  - campaigns         │  │  REST API for tables │  │  Strips /rest/v1/   │
│  - campaign_prospects│  │  Auto-generated     │  │  Strips auth header │
│  - outreach_emails   │  │                     │  │                     │
│  - user_email_config │  │                     │  │                     │
│  - negotiation_sett..│  └─────────────────────┘  └─────────────────────┘
└─────────────────────┘
                              │ DB queries
                              ▼
              ┌─────────────────────────────┐
              │   External Services          │
              │   (in production, mocked     │
              │    in demo mode)             │
              │   - Tavily (search)          │
              │   - Blitz (LinkedIn data)    │
              │   - Hunter (email finder)     │
              │   - Groq (LLM inference)      │
              └─────────────────────────────┘
```

### Data Flow
1. User clicks a button or the tick endpoint fires
2. Next.js API calls `fallbackOrchestrator.runFallbackTick(campaignId)` or the Strands service
3. The orchestrator (or Strands campaign_manager) decides which phase to run
4. Phase-specific tools execute (discover, evaluate, contact, outreach, monitor)
5. Tools call the same `/api/agent/tools/*` gateway for actual work
6. Business logic is in TypeScript functions (`src/lib/campaign/*.ts`, `src/lib/negotiation/*.ts`)
7. All state is persisted to Postgres

### Key Design Decisions
- **Dual brain**: Strands agents (primary) or TypeScript fallback (`HACKATHON_MODE=false`)
- In demo mode, `HACKATHON_MODE=true` means if Strands is down → 503 visible error
- PostgREST proxy strips `/rest/v1/` and auth headers → simplifies DB access from UI
- Docker containers: `seo-pg` (Postgres), `seo-pgrst` (PostgREST)

### Local Model Provider
- **Provider**: Groq (`https://api.groq.com/openai/v1`)
- **Model**: `openai/gpt-oss-120b` (Strands OpenAIModel wrapper)
- **API Key**: `GROQ_API_KEY` in `.env.local`

### Authentication
- **Demo mode**: No OAuth required. `auth.ts` creates a synthetic session.
- **Production**: Google OAuth via NextAuth.
- Auth middleware checks `GOOGLE_CLIENT_ID` — if missing, falls back to demo session.

---

## 3. Complete User Flow (Campaign Lifecycle)

### Step 1: Access the Platform
- **URL**: `http://localhost:3001/campaigns/autonomous`
- **Auth**: No login needed in demo mode. You'll see "Demo User" in the top right.
- **What you see**: The Autonomous Campaigns dashboard with a "New Campaign" button.

### Step 2: Create a Campaign
1. Click **"New Campaign"** button on the autonomous campaigns page.
2. A form modal or drawer appears with these fields:
   - **Name** (required): e.g., "SaaS Newsletter Campaign"
   - **Goal** (optional): Brief description of what you want
   - **Keywords** (required): Comma-separated, e.g., `AI photo, photo editing, image restoration, photo restoration`
   - **Website URL** (optional): Your website, e.g., `https://geseo.app`
   - **Product name** (optional): e.g., "Geseo"
   - **Product description** (optional): e.g., "AI-powered outreach platform"
   - **Author name** (optional): e.g., "Abdullah Zubair"
   - **Demo mode** (checkbox, required for testing): Check this ON
   - **AI autonomy** (select): `full` (default)
   - **Min price** (number): e.g., `150` (minimum you'll accept)
   - **Currency** (select): USD, EUR, GBP
   - **Opening percent** (number): e.g., `35` (starting offer as % of their rate)
   - **Aggressiveness** (select): `gentle`, `balanced`, `firm`
   - **Max thread length** (number): e.g., `4` (max negotiation turns)
   - **Constraints / Handbook** (textarea, optional): e.g., "Never mention AI regulations"

3. Click **"Create"**.
   - **What happens**: 
     - `POST /api/campaigns` creates the campaign row
     - A workflow record is created
     - Campaign starts in `draft` phase
     - You're redirected to the campaign detail page

### Step 3: Start the Campaign
- On the campaign detail page, the status shows "Draft".
- Click the **"Tick"** button (or wait for auto-tick every 60 seconds).
- **Tick 1** (`draft → planning → discovering`):
  - The orchestrator sees phase `draft` but the TS fallback only handles `planning`.
  - **BUG**: You need to manually set phase to `planning` first.
  - Go to `POST /api/campaigns/:id/tick` — it returns `noop` because phase is still `draft`.
  - **FIX**: The PATCH endpoint should advance draft → planning. Until fixed, manually set phase in DB:
    - `UPDATE campaigns SET phase = 'planning' WHERE id = '...'`
  - Then tick again.
  - **What happens**: `planDiscoveryQueries` runs → phase set to `discovering`.

### Step 4: Discovery Phase
- **Tick 2** (`discovering`):
  - The orchestrator generates keyword-based queries (e.g., "AI photo tools review site").
  - Queries Tavily/Blitz for relevant articles.
  - Creates prospect records with domain, author name, article title.
  - **In demo mode**: Uses `discoverDemoBatch()` which creates 12 deterministic prospects from `DEMO_FIXTURES`.
  - **What happens**: 12 prospects created with status `discovered`.
  - The query also checks keyword match length >= 2 characters (so "AI" matches).

### Step 5: Qualification Phase
- When discovery saturates (3 empty passes or target pool reached), orchestrator transitions: `discovering → qualifying`.
- **Tick 3** (`qualifying`):
  - `heuristicRelevance()` evaluates each prospect.
  - Checks keyword matches in title (term length >= 2).
  - Also checks Tavily/Blitz API results if not in demo mode.
  - Prospects matching >= 2 keyword terms get status `qualified`; others get `rejected`.
  - **Expected result**: ~4-5 qualified out of 12 (depends on keywords).
  - Only 8 prospects processed per tick.

### Step 6: Contact Resolution
- When all prospects evaluated: `qualifying → resolving_contacts`.
- **Tick 4** (`resolving_contacts`):
  - `resolveContactForProspect()` tries Hunter API / SMTP to find contact email.
  - **In demo mode**: Creates a fake author with `sarah.mitchell@<domain>` email.
  - Prospects with resolved contacts get status `ready`.
  - Prospects failing after 3 attempts stay as `resolving_contacts` (will time out later).

### Step 7: Outreach
- When contacts resolved: `resolving_contacts → outreaching`.
- **Tick 5** (`outreaching`):
  - `sendOutreachToProspect()` generates personalized email using templates.
  - Email includes: personal greeting (cleaned of `.invalid` parts), article reference, product mention, {{signer_name}}.
  - Sends via Gmail SMTP (ab.ghouri03@gmail.com → ab.ghouri03@gmail.com in demo).
  - Rate limited: max 3 emails/hour per domain.
  - 5 prospects sent per tick (rate limited).
  - **What you see in UI**: Emails show as "sent" in `/sending` page.

### Step 8: Monitoring
- When outreach queued: `outreaching → monitoring`.
- **Tick 6+** (`monitoring`):
  - `processRepliesTick()` checks for replies:
    - Demo mode: `injectDemoReplies()` inserts 5 deterministic reply personas.
    - Real mode: IMAP sweeper reads `ab.ghouri03@gmail.com` inbox.
  - Reply classification by `classifyReplyIntent()`:
    - Detects intent: `positive`, `negotiation`, `call`, `decline`, `ooo`, `price_question`
    - Uses LLM (Strands) or heuristic fallback (keyword matching).
  - Drafts AI response using `draftNegotiationReply()`:
    - Respects `NegotiationSettings` (min_price, opening_percent, tone, etc.).
    - Sanitizes em dashes but preserves compound-word hyphens.
  - Sends reply via `deliverOutreach()`:
    - Uses sender's Gmail app password or env SMTP fallback.
    - Threads the reply (inReplyTo, references headers).
  - If `needs_human` classification: pauses, creates intervention record.

### Step 9: Completion
- When all prospects are either `declined`, `agreed`, or deal target reached: `monitoring → completed`.
- **What happens**: Campaign marked as complete. Results shown on dashboard.

---

## 4. All Pages & Navigation

### Sidebar Navigation
Only these pages appear in the left sidebar:

#### Outreach
- **Autonomous Campaigns** (`/campaigns/autonomous`): Main workspace. Shows all campaigns, click to view detail.
- **Backlink Outreach** (`/backlinks`): Legacy page (redirects).
- **Status** (`/sending`): Email delivery status dashboard.
- **Inbox** (`/inbox`): Reply threads and manual reply interface.

#### Content
- **Blog** (`/blog`): Content hub list.
- **AI Writer** (`/blog/writer`): AI blog post generator.
- **Clusters** (`/blog/clusters`): Semantic content cluster planner.
- **Landing pages** (`/landing`): Landing page builder.
- **Assets** (`/media`): Image/video asset browser.
- **Voices** (`/blog/voices`): Publication contributor profiles.

#### SEO
- **Site Audit** (`/site-audit`): Technical SEO audit report.
- **Growth Agents** (`/seo-agents`): SEO automation agent dashboard.

#### Workspace
- **Handbook** (`/handbook`): Internal knowledge base.
- **Notifications** (`/notifications`): System alerts and updates.
- **Admin** (`/admin`): Admin configuration panel.
- **Settings** (`/settings`): User preferences and API keys.

### Redirected Pages (Orphaned)
These pages no longer exist and redirect to `/campaigns/autonomous`:
- `/campaigns` (legacy list → redirects)
- `/campaigns/new` (form on autonomous page)
- `/campaigns/compare` (comparison → redirects)
- `/email-finder` (→ redirects)
- `/emails` (→ redirects to `/sending`)
- `/indexing` (→ redirects)
- `/link-audit` (→ redirects)
- `/login` (→ redirects to home, demo mode doesn't need login)
- `/negotiation` (settings part of campaign → redirects)
- `/payments` (→ redirects)
- `/workflows` (→ redirects)

---

## 5. Features Guide (with Examples)

### 5.1 Autonomous Campaign Pipeline
**What it does**: Automatically runs a 6-phase pipeline without human intervention.

**How to use**: Create a campaign in demo mode, then tick or let it auto-tick every 60 seconds.

**Example**: 
- Campaign: "AI Tools Outreach"
- Keywords: "photo restoration, AI image editing"
- Result: Discovers 12 sites, qualifies 4, sends 5 emails, gets 2 replies, negotiates 1 deal at $230.

### 5.2 Demo Personas
**What it does**: Injects 5 deterministic reply patterns to simulate real publisher responses.

**Personas**:
1. **high_anchor**: Replies "$350", then $275, then $230 (3 negotiation rounds)
2. **quick_deal**: Replies "$120, send invoice" → instant deal
3. **meeting_request**: "Can we jump on a call?" → HITL intervention
4. **decliner**: "We don't accept placements" → thread closed
5. **autoresponder**: "OOO until Monday" → skipped

**How to verify**: After ticking monitoring, check `outreach_emails` table. Each outreached prospect should have a `demo_persona` assigned in `campaign_prospects.notes`.

### 5.3 Email Quality
**What it does**: Ensures high-quality email personalization and formatting.

**Features**:
- **Greeting fix**: Strips `.invalid` domain from author names. Example: `pixelcraft.journal.invalid` → `Pixelcraft`.
- **Em dash sanitization**: `sanitizeBody()` replaces separator dashes (surrounded by spaces) with `--`, preserves compound-word hyphens.
- **{{signer_name}}**: All emails sign off as "Abdullah Zubair" (from `author_name` field).
- **Article reference**: Emails reference the specific article title from the prospect's profile.

**Example email body**:
```
Hi Pixelcraft,

I really enjoyed your article "AI Image Tools Every Ecommerce Team Should Know", the way you broke down 
the comparison between Midjourney and DALL-E was spot on.

We're Geseo, an AI-powered outreach platform that helps publications like yours discover relevant tools.
Our feature inclusion rate is $250 (negotiable).

Would you be open to discussing a placement?

Best,
Abdullah Zubair
```

### 5.4 Per-Domain Rate Limiting
**What it does**: Prevents spam flag by limiting emails per domain.

**Limit**: 3 emails/hour per sending domain
**How it works**: Counts emails sent in last hour for same domain, blocks if >= 3.
**Example**: If you outreach 5 sites from `techcrunch.com`, only 3 will send in the first hour.

### 5.5 Negotiation Settings
**How to access**: Create campaign with negotiation fields, or `PUT /api/negotiation/settings`
**Fields**:
- `opening_percent`: Starting bid (e.g., 35% of their rate)
- `aggressiveness`: `gentle` (concedes more), `balanced` (split the difference), `firm` (counter hard)
- `max_thread_length`: Max AI messages before auto-pausing
- `min_price`: Floor price; AI won't go below
- `currency`: Display currency
- `tone`: Writing style for negotiation replies

**Example flow** (high_anchor, $350 rate, 35% opening):
1. Prospect says "$350"
2. AI opens at $350 × 0.35 = $122.5 → "We can do $123"
3. Prospect counters "$275"
4. AI meets at midpoint: ($123 + $275) / 2 = $249
5. Prospect says "$230 final"
6. AI accepts (above min_price of $150)
7. Email marked `agreed`, deal recorded

### 5.6 A/B Testing (Email Templates)
**What it does**: Tests different email templates to see which performs better.

**How to use**: Create 2+ email templates, assign to campaign. The system rotates them.
**Metrics shown**: Open rate, reply rate per template variant.

### 5.7 Multi-Touch Sequences
**What it does**: Sends follow-up emails if no reply.

**Default sequence**: 3 emails at 3-day intervals.
**How to use**: In campaign settings, enable multi-touch and set delay days.

### 5.8 Server-Side Auto-Tick
**What it does**: Automatically ticks campaigns every 60 seconds.

**How to enable**: Ensure `CRON_TICK=true` in `.env.local`.
**How to disable**: Set `CRON_TICK=false` — manual tick only.

### 5.9 Email Open Tracking
**What it does**: Tracks when recipients open emails.

**Method**: Invisible 1x1 tracking pixel embedded in HTML emails.
**How to verify**: Check `opened_at` timestamp on `outreach_emails` row.

### 5.10 Sentiment Analysis
**What it does**: Classifies reply tone (positive/negative/neutral).

**How to view**: In `/inbox`, replies show sentiment badge.
**Agent tool**: `classifyReplyIntent()` uses LLM or keyword heuristic.

### 5.11 ROI Dashboard
**What it does**: Calculates return on investment per campaign.

**Metrics**:
- `total_spent`: Total emails sent cost (SMTP usage)
- `deal_revenue`: Sum of agreed deal prices
- `saved_amount`: AI time saved vs. manual outreach
- `roi_pct`: `((deal_revenue - total_spent) / total_spent) * 100`

**How to access**: Campaign detail page shows ROI card. Compare page (`/campaigns/compare`) shows across campaigns.

### 5.12 Campaign Comparison
**What it does**: Side-by-side campaign performance.

**How to access**: `/campaigns/compare` (redirects until restored; use DB queries instead).

### 5.13 Bounce Detection
**What it does**: Automatically detects bounced emails.

**Method**: Listens for `mailer-daemon@` bounce notifications in inbox.
**How to verify**: Check `bounced_at` timestamp on `outreach_emails` row.

---

## 6. Campaign Pipeline Phases Explained

### Phase 0: Draft
- Campaign just created, not started.
- Phase = `"draft"`.
- `started_at` is NULL.

### Phase 1: Planning
- Strands (or TS fallback) generates keyword queries.
- Calls `planDiscoveryQueries()`.
- Automatically transitions to `discovering`.

### Phase 2: Discovering
- Executes discovery queries against Tavily/Blitz.
- Creates prospect rows with domain, author, article title.
- **Demo mode**: Creates 12 `DEMO_FIXTURES` prospects instantly.
- When 30 prospects in pool or 3 empty passes: transitions to `qualifying`.

### Phase 3: Qualifying
- Calls `evaluateProspect()` on each `discovered` prospect.
- Heuristic: keyword term length >= 2 matches in title.
- Also calls Strands `qualify_prospect` tool in production.
- Qualified → `qualified`; rejected → `rejected`.

### Phase 4: Resolving Contacts
- Calls `resolveContactForProspect()` on each `qualified` prospect.
- Tries Hunter.io, Skrapp, or SMTP verification.
- **Demo mode**: Creates fake author with `sarah.mitchell@<domain>`.
- Resolved → `ready`; stuck after 3 attempts → times out.

### Phase 5: Outreaching
- Calls `sendOutreachToProspect()` on each `ready` prospect.
- Generates personalized email from template.
- Sends via Gmail SMTP.
- Rate limited: max 3 emails/hour per domain.
- Per-domain counter cleared after 1 hour window.

### Phase 6: Monitoring
- Calls `processRepliesTick()`.
- Checks for new replies:
  - **Demo mode**: `injectDemoReplies()` — deterministic persona scripts.
  - **Real mode**: IMAP sweep of `ab.ghouri03@gmail.com` inbox.
- Classifies reply intent.
- Drafts negotiation response.
- Sends response (or pauses for HITL).
- Checks A/B test results, applies multi-touch follow-ups.
- Transitions to `completed` when goal reached or pool exhausted.

### Phase 7: Completed
- Campaign finished.
- All prospects resolved (dealt, declined, or rejected).
- Results shown on dashboard.

### Phase Transition Rules
| From | To | Condition |
|------|-----|-----------|
| draft | planning | Manual (PATCH phase) |
| planning | discovering | After planDiscoveryQueries runs |
| discovering | qualifying | Pool filled (30+ prospects) or saturated (3 empty passes) |
| qualifying | resolving_contacts | All `discovered` prospects processed (count = 0) |
| qualifying | completed | All candidates rejected, none qualified |
| resolving_contacts | outreaching | All `qualified` resolved, `ready` count > 0 |
| resolving_contacts | monitoring | Contacts resolved but none ready |
| outreaching | monitoring | All `ready` prospects sent |
| monitoring | completed | Desired deals reached OR all prospects exhausted (1h quiet period) |

---

## 7. Tick System Explained

### What Is a Tick?
A tick is ONE iteration of campaign work. Each tick processes one unit of work in the current phase.

### Tick Endpoint
- **URL**: `POST /api/campaigns/:id/tick`
- **Method**: POST (no body needed)
- **Response**: JSON with phase before/after, action taken, details

### How Ticks Run
**Manual tick**: User clicks "Tick" button in UI.
**Auto-tick**: Server-side cron (if `CRON_TICK=true`) fires every 60 seconds.

### Tick Routing
```
POST /api/campaigns/:id/tick
  → If AGENT_SERVICE_URL set AND not demo → POST to Strands service
  → Else → runFallbackTick() in TypeScript
```

### Tick Actions by Phase
| Phase | Action | What It Does |
|-------|--------|-------------|
| planning | plan | Generate discovery queries, set phase to discovering |
| discovering | discover | Run queries, add prospects, saturate after 3 empty passes |
| qualifying | qualify(N) | Evaluate N prospects (max 8 per tick), classify as qualified/rejected |
| resolving_contacts | contact(N) | Resolve contacts for N qualified prospects (max 8 per tick) |
| outreaching | outreach(N) | Send emails to N ready prospects (max 5 per tick) |
| monitoring | monitor | Detect replies (demo: inject 5), classify, draft+send negotiation, check follow-ups |

### Tick Example (Verbose)
**Request**: `POST /api/campaigns/1316a33f-2448-49c1-8a9a-6df163a41a77/tick`

**Response**:
```json
{
  "ok": true,
  "mode": "fallback-ts",
  "phase_before": "monitoring",
  "phase_after": "monitoring",
  "action": "monitor",
  "details": {
    "replies": {
      "detected": 5,
      "negotiated": 2,
      "needs_human": 2,
      "errors": []
    },
    "followups": {
      "processed": 0,
      "skipped": 0
    }
  }
}
```

**What happened**: 
- Detected: 5 demo replies injected (one per persona)
- Negotiated: 2 AI negotiation replies drafted + sent
- Needs human: 2 threads paused for intervention

---

## 8. Negotiation Agent Deep Dive

### Architecture
```
processRepliesTick()  [src/lib/negotiation/run.ts]
  → fetch thread (initial email + previous replies)
  → classifyReplyIntent()  [src/lib/negotiation/agent.ts]
    → LLM prompt (Strands OpenAIModel via /api/agent/tools/classify)
    → Fallback: keyword heuristic classification
    → classify by intent: positive, negotiation, call, decline, ooo, price_question
  → if needs_human → create intervention record, pause thread
  → else → draftNegotiationReply()
    → Builds context: their message, our previous offer, ceiling, max_thread_length
    → Calls /api/agent/tools/negotiate (Strands) or uses heuristic draft
    → Returns: statusHint (negotiating/agreed/declined), body, suggestedOffer
  → deliverOutreach() → SMTP send
  → record reply + our reply in outreach_emails table
```

### Classification Intent Detection
When a reply arrives, the agent classifies what the recipient wants:

| Intent | Detection Method | Key Keywords (fallback) | Example Reply |
|--------|-------------------|------------------------|---------------|
| `positive` | LLM / keywords | "interested", "yes", "love it", "count me in" | "This sounds great, I'd like to proceed!" |
| `negotiation` | LLM / keywords | "$", "rate", "price", "can you do", "budget" | "Our rate is $350, can you match?" |
| `call` | LLM / keywords | "call", "meeting", "zoom", "teams", "calendar" | "Let's jump on a quick call Wednesday" |
| `decline` | LLM / keywords | "no", "we don", "not interested", "decline" | "We don't accept placements like this" |
| `ooo` | LLM / keywords | "out of office", "OOO", "away", "unavailable" | "I'm out of office until Monday" |
| `price_question` | LLM / keywords | "how much", "cost", "fee", "invoice" | "What's the cost for this placement?" |

### Negotiation Strategy (by aggressiveness setting)
| Setting | Opening Offer | Counter Behavior | Concession Speed |
|---------|--------------|------------------|-----------------|
| `gentle` | 35% of their rate | Meet at midpoint | Fast (concedes more per round) |
| `balanced` | 35% of their rate | Meet at 60% between | Moderate |
| `firm` | 35% of their rate | Meet at 75% between | Slow (concedes less) |

### Price Calculation Example
- **Their rate**: $350
- **Opening percent**: 35%
- **Opening offer**: $350 × 0.35 = $122.50 → round to $123
- **Their counter**: $275
- **Midpoint (balanced)**: ($123 + $275) / 2 = $199 → round to $200
- **Their counter**: $230
- **Midpoint**: ($200 + $230) / 2 = $215 → round to $215
- **Their final**: $200
- **AI accepts $200** (above min_price $150) → deal agreed at $200

### Negotiation Thread Length Enforcement
- `max_thread_length` = 4 (default)
- **BUG**: Not enforced in scripted demo fallback. AI continues negotiating beyond this limit.
- **Fix needed**: Check thread depth before drafting reply, pause if limit exceeded.

### Sanitization (sanitizeBody)
- Replaces Unicode em dashes (U+2014–U+2015, U+2212, U+FF0D) when used as separators
- Preserves em dashes in compound words (e.g., "well-being", "self-aware")
- Only replaces dashes surrounded by spaces
- Example: "AI — the future" → "AI -- the future"
- Example: "self-aware" → "self-aware" (unchanged)

### Status Hints Returned
| Status | Meaning | Action |
|--------|---------|--------|
| `negotiating` | Thread active, counter-offer made | Continue monitoring |
| `agreed` | Deal closed | Record deal revenue |
| `declined` | They rejected us | Close thread, no deal |
| `needs_human` | Needs review | Create intervention record |
| `stalled` | No progress, max turns reached | Escalate |
| `handoff` | Needs human takeover | Create detailed intervention |

---

## 9. HITL (Human-in-the-Loop) Intervention Flows

### When Interventions Trigger
Interventions are created when the AI classifier determines a reply needs human attention.

### Intervention Types

#### 9.1 `sync_contact` (Call/Scheduling Request)
**Trigger**: Reply contains "call", "meeting", "calendar", "zoom", "teams"
**Example reply**: "Let's jump on a quick call Wednesday at 2pm"
**What AI does**:
1. Classifies as `call` intent
2. Sets `negotiation_status = needs_human`, `intervention_type = sync_contact`
3. Pauses thread — no further negotiation emails sent
4. Creates row in `interventions` table

**How to resolve**:
1. Go to `/inbox`
2. Find the thread (marked with yellow banner "Needs human review")
3. Click **"Review"**
4. Choose:
   - **Approve**: AI sends scheduled counter-reply, thread resumes
   - **Decline**: Thread closes, prospect marked `rejected`
   - **Override**: Send custom reply

**Expected outcome**: After approval, next tick resumes normal negotiation.

#### 9.2 `payment_details` (Invoice/Payment Info Request)
**Trigger**: Reply mentions "invoice", "payment", "bill to", "PO number"
**Example reply**: "Send an invoice to our billing@ address"
**What AI does**:
1. Pauses thread
2. Sets `negotiation_status = needs_human`, `intervention_type = payment_details`
3. Creates intervention

**How to resolve**:
1. Click intervention in inbox
2. Provide billing details
3. Click "Send Invoice" — AI drafts reply with payment info

**Expected outcome**: Invoice sent, negotiation resumes.

#### 9.3 `escalation` (All Rejection Paths Exhausted)
**Trigger**: 3 negotiation rounds with no agreement, or explicit rejection + 2 follow-ups
**What AI does**:
1. Marks thread as `stalled`
2. Campaign manager escalates to `completed`

**How to resolve**:
1. Thread automatically closed
2. No further action needed

---

## 10. Inbox System

### How to Access
- **URL**: `http://localhost:3001/inbox`
- **Purpose**: Read and answer human replies, manage HITL interventions

### What You See
**Thread List** (left sidebar):
- Each thread = one prospect's email conversation
- Color-coded by negotiation status:
  - Blue: `negotiating`
  - Yellow: `needs_human` (intervention pending)
  - Green: `agreed` (deal closed)
  - Gray: `declined` (closed, no deal)
  - Red: `stalled` (max turns exceeded)
- Thread snippet shows last message

**Thread View** (main panel):
- Full conversation history (your emails + their replies)
- Negotiation status badge
- Price tracker (their rate vs. your offers)
- Intervention details (if applicable)

**Manual Reply Box** (bottom):
- Text area to type custom reply
- Send button — sends immediately via SMTP
- "Request human sync" button — creates intervention

### What Happens When You Act
1. **Manual reply**: Creates a new `outreach_emails` entry with `kind = negotiation`, sends via SMTP, marks thread active.
2. **Approve AI suggestion**: Updates the draft email's status to "sent", sets `intervention_type = NULL`.
3. **Mark as spam**: Sets prospect status to `rejected`, closes thread.

### Example Workflow
1. Open `/inbox`
2. See thread: "Pixelcraft Journal — needs_human (sync_contact)"
3. Click thread → read full conversation
4. See intervention: "Prospect requested a call"
5. Click "Review" → "Approve"
6. Next tick: AI sends counter-reply, thread resumes negotiation

---

## 11. Email Quality & Template System

### How Email Personalization Works
The `fillTemplate()` function replaces placeholders in the email body:

| Placeholder | Example Value |
|-------------|---------------|
| `{{name}}` | `Pixelcraft` (cleaned author name) |
| `{{pub_name}}` | `Pixelcraft Journal` (publication name) |
| `{{article}}` | `"AI Image Tools Every Ecommerce Team Should Know"` |
| `{{product}}` | `Geseo` |
| `{{price}}` | `$250` |
| `{{signer_name}}` | `Abdullah Zubair` |
| `{{campaign_goal}}` | "AI-powered outreach platform" |

### Email Template Format
Stored in `email_templates` table. Fields:
- `name`: Template identifier (e.g., "Outreach v2")
- `subject`: Email subject line (e.g., "Re: Loved your piece on {{article}}")
- `body`: Full email HTML body with placeholders
- `is_default`: Boolean, used when no variant assigned

### Greeting Detection
The `cleanAuthorName()` function handles domain-like author names:

```typescript
// Input: "pixelcraft.journal.invalid"
// Output: "Pixelcraft"
// Method: strips known suffixes (.invalid, .creative, .media, etc.)
```

### Em Dash Sanitization
The `sanitizeBody()` function:
```typescript
// Input: "AI — the future of design — will transform..."
// Output: "AI -- the future of design -- will transform..."
//
// Input: "self-aware AI — powered by LLMs"
// Output: "self-aware AI -- powered by LLMs"
//
// Input: "well-designed, self-aware tool"
// Output: "well-designed, self-aware tool"  (unchanged)
```

### Custom Opening Lines
The `buildCustomLine()` function generates personalized openers from Tavily/Blitz search results:
- Finds the specific article mention
- Uses the article title to personalize greeting
- Adds comment about the article's content

### Default Templates (3 in database)
1. **Standard Outreach**: "Loved your piece on [article]"
2. **Value-Add Outreach**: "Saw your roundup on [topic] — here's a tool that fits"
3. **Direct Pitch**: "Quick partnership idea from Geseo"

### A/B Testing
When 2+ templates exist:
- `variant_a` and `variant_b` assigned randomly alternately
- Stats tracked in `email_stats.variants`
- Metric: open rate, reply rate per variant

---

## 12. Metrics & Dashboard

### Campaign Detail Page (`/campaigns/:id`)
Shows these cards:
- **Email Performance**: Sent, opened, bounced, replied counts
- **Qualification Score Breakdown**: How many passed/failed each stage
- **ROI Dashboard**: Revenue, cost, ROI %
- **Pipeline View**: Discovery → Qualify → Outreach → Negotiate → Deal (visual funnel)
- **Agent Cards**: 7 agent tiles showing status (active/idle/error)
- **Activity Feed**: Timeline of all ticks, emails, replies

### Status Page (`/sending`)
Shows per-email:
- Status: `sent`, `failed`, `delivered`, `draft`
- Opens: timestamp of open
- Bounces: detected from mailer-daemon
- Templates used
- A/B variant

### Inbox (`/inbox`)
Shows per-thread:
- Last message snippet
- Negotiation status
- Price tracker
- Intervention status

### ROI Dashboard
Shows:
- Total spend (SMTP/API costs)
- Deal revenue (sum of agreed prices)
- Saved amount (AI time vs manual)
- ROI percentage

### Metrics Definitions
| Metric | Formula | Where Stored |
|--------|---------|-------------|
| Open Rate | (Opened / Sent) × 100 | `outreach_emails.opened_at` |
| Bounce Rate | (Bounced / Sent) × 100 | `outreach_emails.bounced_at` |
| Reply Rate | (Replied / Sent) × 100 | `outreach_emails.kind = reply` |
| Deal Rate | (Deals Closed / Prospects Outreached) × 100 | `campaign_prospects.status = agreed` |
| Avg Deal Value | Sum(agreed_price) / Deals Closed | `outreach_emails.agreed_price` |
| ROI | ((Revenue - Cost) / Cost) × 100 | `campaigns.budget_total - budget_used` |

---

## 13. Demo Mode Guide

### Prerequisites
1. `.env.local` configured with:
   - `SMTP_HOST=smtp.gmail.com`
   - `SMTP_PORT=465`
   - `SMTP_USER=ab.ghouri03@gmail.com`
   - `SMTP_PASS=REDACTED
   - `IMAP_USER=ab.ghouri03@gmail.com`
   - `IMAP_PASS=REDACTED
   - `GROQ_API_KEY=<key>` (for Strands LLM)
2. Docker containers running: `seo-pg`, `seo-pgrst`
3. PostgREST proxy running on port 5440
4. Next.js dev server on port 3001
5. Strands agent service on port 8104

### How to Set Up
```bash
# 1. Start Docker
docker start seo-pg seo-pgrst

# 2. Start PostgREST proxy
node scripts/pgrst-proxy.mjs  # listens on :5440

# 3. Start Next.js
npm run dev -- --port 3001

# 4. Start Strands service (if available)
cd agents/seo_workforce
python -m uvicorn api.main:app --port 8104
```

### Demo Mode Behaviors
| Real Mode | Demo Mode |
|-----------|-----------|
| Discovery via Tavily + Blitz | 12 deterministic DEMO_FIXTURES |
| Contact via Hunter API | Fake author with sarah.mitchell@email |
| Emails sent to prospect's real email | All emails route to ab.ghouri03@gmail.com |
| Replies read via IMAP sweep | 5 persona scripts injected deterministically |
| Negotiation via Strands LLM | Scripted replies + heuristic agent |
| Strands service required | 503 if unavailable (HACKATHON_MODE=true) |

### Demo Mode Gotchas
- `.invalid` domains cause SMTP bounces — this is expected
- `demo@local` sender won't work without SMTP fix — use env fallback
- Persona assignment is deterministic but shared across campaigns
- Thread lengths may exceed `max_thread_length` in scripted mode

---

## 14. Setup Verification Checklist

### Docker Services
- [ ] `docker ps` shows `seo-pg` and `seo-pgrst` running
- [ ] Postgres on port 5433 — `psql -h localhost -p 5433 -U postgres -d postgres`
- [ ] PostgREST on port 5441 — `curl http://localhost:5441/`
- [ ] Proxy on port 5440 — `curl http://localhost:5440/rest/v1/campaigns`

### Services
- [ ] Next.js on port 3001 — `curl http://localhost:3001/api/campaigns`
- [ ] Strands service on port 8104 — `curl http://localhost:8104/`
- [ ] `npx supabase status` shows all services running

### Database State
- [ ] Campaigns table has columns: `phase`, `demo_mode`, `keywords`, `constraints_text`
- [ ] `outreach_emails` has `campaign_id` column (backfilled)
- [ ] `outreach_emails` has `opened_at` column
- [ ] `email_templates` table has 3 default templates
- [ ] `negotiation_settings` table has rows per campaign

### Email
- [ ] SMTP credentials in `.env.local` are correct
- [ ] `ab.ghouri03@gmail.com` Sent label shows test emails
- [ ] Bounce notifications handled by `mailer-daemon`
- [ ] Open tracking pixel loads

### Auth
- [ ] No OAuth login screen (demo session auto-created)
- [ ] "Demo User" shows in top-right corner
- [ ] Can access all pages without auth prompt

---

## 15. Troubleshooting

### "Campaign stuck in draft"
**Symptom**: Tick returns `action: noop`, phase stays `draft`.
**Cause**: TS fallback orchestrator has no `case "draft"` in switch.
**Fix**: Manually set phase to `planning` via `PATCH /api/campaigns/:id` or DB.

### "Emails marked as failed"
**Symptom**: Outreach emails show `status: failed`, `error: "hasn't set a Gmail app password"`.
**Cause**: Sender is `demo@local`, no app password stored for it.
**Fix**: SMTP fallback now uses env `SMTP_USER` (`ab.ghouri03@gmail.com`) in demo mode.

### "Negotiation emails missing campaign_id"
**Symptom**: Negotiation replies exist in `outreach_emails` but campaign email stats show 0.
**Cause**: Insert didn't include `campaign_id` field.
**Fix**: Added `campaign_id: initial.campaign_id ?? null` to insert. Backfill old rows.

### "Negotiation thread runs too long"
**Symptom**: Thread has 10+ AI messages despite `max_thread_length = 4`.
**Cause**: `max_thread_length` not checked before drafting.
**Fix needed**: Add thread depth check in `draftNegotiationReply()`.

### "Personas mixed across campaigns"
**Symptom**: Same domain gets different personas in different campaign ticks.
**Cause**: `listCampaignThreads` joins on `author_id` only, not campaign_id.
**Impact**: Cross-contamination of demo personas.
**Fix needed**: Add `campaign_id` filter to `listCampaignThreads`.

### "Decliner persona not rejected"
**Symptom**: Decliner persona says "We don't accept" but AI keeps negotiating.
**Cause**: Classifier doesn't recognize the phrase, or script fallback missing.
**Fix**: Add "don't accept placements" as decliner keyword in heuristic.

### "Strands service returns 503"
**Symptom**: Tick returns `mode: "strands-fallback"` or explicit error.
**Cause**: `HACKATHON_MODE=true` but Strands service down.
**Fix**: Start Strands service: `python -m uvicorn api.main:app --port 8104`.

### "PostgREST returns 404 for new column"
**Symptom**: Query fails: `column "campaign_id" not found`.
**Cause**: PostgREST cached old schema.
**Fix**: Restart `seo-pgrst` container.

---

## 16. API Reference

### GET /api/campaigns
Returns array of all campaigns.

### POST /api/campaigns
Creates a campaign.
Body: `{ name, keywords[], website_url, demo_mode, ... }`
Returns: created campaign row.

### GET /api/campaigns/:id
Returns full campaign state with prospects, deals, interventions, events.

### PATCH /api/campaigns/:id
Update campaign fields. Supports `phase`, `paused_*`, etc.

### POST /api/campaigns/:id/tick
Advances the campaign one tick.
Returns: `{ ok, mode, phase_before, phase_after, action, details }`

### PUT /api/negotiation/settings
Update negotiation settings for a campaign.
Body: `{ campaign_id, handbook, tone, aggressiveness, max_thread_length, min_price, ... }`

### POST /api/agent/tools/*
Strands agent tool gateway. Each tool is a separate endpoint:
- `/api/agent/tools/discover`
- `/api/agent/tools/evaluate`
- `/api/agent/tools/resolve_contact`
- `/api/agent/tools/send_email`
- `/api/agent/tools/classify`
- `/api/agent/tools/negotiate`

---

## 17. How to Verify the System is Working

### Checklist for Agent Testing
Use this checklist to verify each component works correctly.

#### 1. Campaign Creation
1. `POST /api/campaigns` with demo mode → campaign created with `phase: draft`, `demo_mode: true`
2. `PATCH /api/campaigns/:id` with `phase: planning` → phase updated
3. Verify `campaigns` table has the new row

#### 2. Discovery Phase
1. `POST /api/campaigns/:id/tick` → action becomes `plan` or `discover`
2. 12 prospects created in `campaign_prospects` table
3. All 12 have `demo_persona` assigned in `notes` JSON

#### 3. Qualification Phase
1. `POST /api/campaigns/:id/tick` → action = `qualify(N)`
2. Prospects transition: `discovered` → `qualified` (passes keyword check) or `rejected`
3. Only prospects with >= 2 keyword term matches survive

#### 4. Contact Resolution
1. `POST /api/campaigns/:id/tick` → action = `contact(N)`
2. `qualified` → `ready` (contact_email populated)
3. In demo mode, email is `sarah.mitchell@<domain>`

#### 5. Outreach
1. `POST /api/campaigns/:id/tick` → action = `outreach(N)`
2. Emails created in `outreach_emails` with `kind: initial`, `status: sent`
3. Emails contain:
   - Clean greeting (no `.invalid` in name)
   - Article reference matching prospect
   - {{signer_name}} = "Abdullah Zubair"
4. Emails arrive in `ab.ghouri03@gmail.com` Sent folder
5. Em dashes sanitized (only separators, not compound words)

#### 6. Monitoring / Reply Detection
1. `POST /api/campaigns/:id/tick` → action = `monitor`
2. Response shows `detected: 5` (5 demo replies injected)
3. Each reply persona triggers correct classification:
   - **high_anchor**: `negotiation` intent → `negotiating` status
   - **quick_deal**: `price_question` intent → `negotiating` or `agreed`
   - **meeting_request**: calls intent → `needs_human` + `sync_contact`
   - **decliner**: `decline` intent → `declined` status
   - **autoresponder**: `ooo` intent → no action (skipped)
4. Negotiation replies drafted and sent
5. Negotiation emails have `campaign_id` set

#### 7. HITL Intervention
1. Two threads paused with `needs_human` status
2. Check `intervention_type`: should be `sync_contact` for meeting requests
3. `/inbox` page shows these threads with yellow banner
4. "Review" button available

#### 8. Campaign Completion
1. After all negotiations exhausted: `monitoring → completed`
2. Campaign shows 0 remaining prospects
3. ROI dashboard shows deal revenue

#### 9. Inbox UI
1. Visit `/inbox`
2. See thread list with color-coded statuses
3. Click a thread to see full conversation
4. See negotiation status, price tracker, intervention details
5. Can manually reply if needed

#### 10. Email Deliverability
1. Check Gmail `ab.ghouri03@gmail.com` → Sent folder
2. Verify emails from correct sender
3. Verify subject line includes article title
4. Verify body has personalized content
5. Check for bounce notifications (`mailer-daemon@googlemail.com`)

### Verification SQL Queries
```sql
-- Check campaign phase
SELECT id, phase, demo_mode FROM campaigns WHERE id = '...';

-- Check prospect qualification rate
SELECT status, count(*) FROM campaign_prospects 
WHERE campaign_id = '...' GROUP BY status;

-- Check email delivery
SELECT kind, status, negotiation_status, error 
FROM outreach_emails WHERE campaign_id = '...' ORDER BY created_at;

-- Check negotiation replies
SELECT count(*) FROM outreach_emails 
WHERE kind = 'negotiation' AND campaign_id = '...';

-- Check interventions
SELECT type, status FROM interventions WHERE campaign_id = '...';
```

### What "Working" Looks Like
- ✅ Campaign progresses through phases without getting stuck
- ✅ Emails arrive in Gmail Sent folder with correct content
- ✅ Demo replies are detected within 1-2 monitoring ticks
- ✅ Negotiation replies are drafted and sent
- ✅ HITL interventions trigger for call requests
- ✅ Deals close at negotiated prices
- ✅ ROI dashboard shows accurate revenue

### What "Broken" Looks Like
- ❌ Tick returns `noop` (phase not handled)
- ❌ Emails show `failed` status (SMTP misconfigured)
- ❌ Negotiation emails missing `campaign_id`
- ❌ All prospects rejected (keywords don't match demo fixtures)
- ❌ No replies detected (demo injection not working)
- ❌ Threads run indefinitely (max_thread_length not enforced)
- ❌ Personas mix across campaigns (no campaign_id filter)