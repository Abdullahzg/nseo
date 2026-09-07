# Geseo — Agent Reply Document

## What Geseo Is

Geseo is an autonomous AI-powered outreach platform that handles the entire backlink outreach pipeline from prospect discovery to deal closure. Built for the AWS Agents for Humans hackathon using the **Strands Agents SDK**, it deploys 8 specialized AI agents that work together autonomously.

**Live Demo**: http://localhost:3100  
**Agent Service**: http://localhost:8104  
**Hackathon Mode**: `HACKATHON_MODE=true` (fails visibly if Strands unavailable)

---

## Complete User Flow (With UI Examples)

### Step 1: Access the Platform

**URL**: `http://localhost:3100`

**What you see**: The Geseo homepage with:
- Hero section: "Outreach, automated"
- Stats marquee: "8 AI Agents", "16 Tool endpoints", "5 Pipeline stages", "24/7 Autonomous"
- Features grid: Discover, Qualify, Resolve, Outreach, Negotiate, Monitor
- CTA buttons: "Create campaign" and "View campaigns"

**Click**: "Get started" button (top right) or "Create campaign" button

---

### Step 2: Campaign List Page

**URL**: `http://localhost:3100/campaigns/autonomous`

**What you see**:
- Header: "Autonomous campaigns"
- Description: "An agent workforce researches prospects, resolves contacts, runs outreach and negotiates deals within your budget."
- Button: "+ New campaign"
- Campaign cards (if any exist) showing:
  - Campaign name
  - Phase badge (planning, discovering, qualifying, outreaching, monitoring, completed)
  - Objective text
  - Website URL and keywords
  - Budget progress bar
  - Placements count

**Click**: "+ New campaign" button

---

### Step 3: Create New Campaign

**URL**: `http://localhost:3100/campaigns/new`

**What you see**: Simplified campaign creation form with 3 sections:

#### Campaign Details
- **Campaign Name** (required): e.g., "Tech Blog Outreach Q1"
- **Your Website URL**: e.g., "https://yoursite.com"

#### Budget & Constraints
- **Budget (USD)**: e.g., "500"
- **Constraints & Guidelines** (textarea): 
  ```
  Only English publications. No gambling or adult content. 
  Max $100 per placement. Focus on tech/SaaS verticals.
  ```

#### Agent Mode
- **Autonomy Level** (two buttons):
  - **Fully Autonomous** (default): "Agents run independently. Intervene only when needed."
  - **Supervised**: "Requires approval before sending emails or making offers."
- **Demo Mode** (checkbox): "Test with simulated publisher responses"

**Fill in**: 
- Name: "E2E Demo Campaign"
- Website: "https://example.com"
- Budget: "500"
- Constraints: "English publications only, tech/SaaS verticals"
- Mode: Fully Autonomous
- Demo Mode: Checked

**Click**: "Create Campaign"

**What happens**:
1. `POST /api/campaigns` creates the campaign row in database
2. Campaign starts in `draft` phase
3. You're redirected to the campaign detail page

---

### Step 4: Campaign Detail Page (Initial State)

**URL**: `http://localhost:3100/campaigns/{campaign-id}`

**What you see**: The campaign detail page with these sections:

#### Header
- Campaign name: "E2E Demo Campaign"
- Phase badge: "Draft"
- Badges: "DEMO MODE", "AUTONOMOUS", "Execution: Strands Agents", "Fallback: OFF"
- Objective and website URL
- Constraints badge (if set)

#### Action Buttons (top right)
- **Start** button (green, with Play icon)
- Clone button (Plus icon)
- Export JSON/CSV buttons
- Import button
- Delete button (red)

#### Pipeline Flow
Shows 5 stages with status indicators:
- **Discovery** (circle icon - pending)
- **Qualification** (circle icon - pending)
- **Contact** (circle icon - pending)
- **Outreach** (circle icon - pending)
- **Negotiation** (circle icon - pending)

#### Campaign Settings (collapsible)
- Budget, Max per deal, Min DR
- Geos, Excluded domains
- Constraints, Email template
- A/B test variants

#### Goal Progress
- "0 / ? placements agreed" with progress bar

#### Budget
- "$0 of $500 · $500 left" with progress bar

#### Agents Board (5 cards)
- **Strategy**: "idle"
- **Discovery**: "idle"
- **Qualification**: "idle"
- **Contact**: "idle"
- **Outreach**: "idle"

#### Live Activity (collapsible)
- "No activity yet — press Start."

#### Funnel
- Discovered: 0
- Qualified: 0
- Contacts: 0
- Contacted: 0
- Negotiating: 0
- Replies: 0
- Deals: 0

**Click**: "Start" button

---

### Step 5: Campaign Running (Discovery Phase)

**What happens after clicking Start**:

1. Campaign phase changes from `draft` → `planning` → `discovering`
2. The Strands agent service (or TypeScript fallback) starts executing

**What you see in UI**:

#### Header
- Phase badge: "Discovering" (blue/indigo)
- Badges: "DEMO MODE", "AUTONOMOUS", "Execution: Strands Agents", "Fallback: OFF"

#### Pipeline Flow
- **Discovery**: Spinner icon (active), showing count
- Other stages: Pending

#### Agents Board
- **Strategy**: Green dot (active), "Working..."
- **Discovery**: Green dot (active), "Searched 'AI photo tools review site' — 14 hits, 12 new"
- Other agents: "idle"

#### Live Activity (if expanded)
```
14:32:04  strategy_agent    search_batch     Searched "AI photo tools review" — 14 hits, 12 new
14:32:07  discovery_agent   prospect_found   Found techcrunch.com
14:32:11  discovery_agent   prospect_found   Found producthunt.com
14:32:15  discovery_agent   prospect_found   Found betastartups.io
...
```

#### Funnel
- Discovered: 12 (increasing)
- Others: 0

---

### Step 6: Campaign Running (Qualification Phase)

**What happens**:
- Discovery saturates (3 empty passes or target pool reached)
- Phase transitions: `discovering` → `qualifying`
- Qualification agent scores each prospect

**What you see**:

#### Header
- Phase badge: "Qualifying" (violet)

#### Pipeline Flow
- **Discovery**: Green checkmark (complete), "12"
- **Qualification**: Spinner icon (active), showing count

#### Agents Board
- **Qualification**: Green dot (active), "Qualified techcrunch.com (score 0.91)"

#### Live Activity
```
14:33:20  qualification_agent  prospect_qualified  Qualified techcrunch.com (score 0.91)
14:33:25  qualification_agent  prospect_qualified  Qualified producthunt.com (score 0.87)
14:33:30  qualification_agent  prospect_rejected   Rejected spam-site.com — low score
...
```

#### Funnel
- Discovered: 12
- Qualified: 5 (increasing)
- Rejected: 7 (increasing)

---

### Step 7: Campaign Running (Contact Resolution)

**What happens**:
- All prospects evaluated
- Phase transitions: `qualifying` → `resolving_contacts`
- Contact agent resolves email addresses

**What you see**:

#### Header
- Phase badge: "Resolving contacts" (purple)

#### Pipeline Flow
- **Discovery**: Green checkmark, "12"
- **Qualification**: Green checkmark, "5"
- **Contact**: Spinner icon (active), showing count

#### Agents Board
- **Contact**: Green dot (active), "Found contact for techcrunch.com via Hunter"

#### Live Activity
```
14:34:10  contact_agent  contact_found  Found contact for techcrunch.com via Hunter
14:34:15  contact_agent  contact_found  Found contact for producthunt.com via scrape
...
```

---

### Step 8: Campaign Running (Outreach Phase)

**What happens**:
- Contacts resolved
- Phase transitions: `resolving_contacts` → `outreaching`
- Outreach agent drafts and sends personalized emails

**What you see**:

#### Header
- Phase badge: "Outreaching" (fuchsia)

#### Pipeline Flow
- **Discovery**: Green checkmark, "12"
- **Qualification**: Green checkmark, "5"
- **Contact**: Green checkmark, "5"
- **Outreach**: Spinner icon (active), showing count

#### Agents Board
- **Outreach**: Green dot (active), "Emailed techcrunch.com — 'Partnership opportunity with Geseo'"

#### Live Activity
```
14:35:00  outreach_agent  outreach_sent  Emailed techcrunch.com — "Partnership opportunity with Geseo"
14:35:05  outreach_agent  outreach_sent  Emailed producthunt.com — "Featured on Product Hunt?"
...
```

#### Funnel
- Contacted: 5 (increasing)

---

### Step 9: Campaign Running (Monitoring/Negotiation Phase)

**What happens**:
- Outreach complete
- Phase transitions: `outreaching` → `monitoring`
- Inbox agent monitors for replies (IMAP or demo simulation)
- Negotiation agent handles replies

**What you see**:

#### Header
- Phase badge: "Monitoring" (emerald)

#### Pipeline Flow
- All previous stages: Green checkmarks
- **Negotiation**: Spinner icon (active)

#### Agents Board
- **Inbox**: Green dot (active), "Reply from techcrunch.com"
- **Negotiation**: Green dot (active), "Counter-offer $150 from producthunt.com"

#### Live Activity
```
14:36:00  inbox_agent      reply_detected  Reply from techcrunch.com
14:36:05  negotiation_agent proposal_sent  Sent offer to techcrunch.com at $120
14:36:10  inbox_agent      reply_detected  Reply from producthunt.com
14:36:15  negotiation_agent counter_sent   Sent counter to producthunt.com at $150
...
```

#### Deals (if any)
```
techcrunch.com  asked $200 · agreed $150 · saved $50  [agreed]
producthunt.com  asked $180 · agreed $140 · saved $40  [negotiating]
```

---

### Step 10: Human-in-the-Loop Intervention

**What happens**:
- Reply classified as `needs_human` (call request, asset request, contract, etc.)
- Campaign pauses, intervention record created

**What you see**:

#### Header
- Phase badge: "Monitoring" (emerald)

#### Action Required Card (amber border)
```
Action required (1)

[sync_contact]  Wants a call / video meeting  ·  2 minutes ago
Why paused: Publisher wants to schedule a call

[Your answer becomes the agent's trusted input...]  [Resume]
```

**How to handle**:
1. Read the intervention type and ask
2. Type your response in the input field
3. Click "Resume"

**Example interventions**:

| Type | Example Ask | Your Response |
|------|-------------|---------------|
| `sync_contact` | "Wants a call / video meeting" | "Available Tuesday 2pm EST. Here's my Calendly: cal.com/abdullah" |
| `asset_request` | "Asked for media kit / logo" | "Attached: media-kit.pdf, logo.png" |
| `legal_contract` | "Wants NDA signed" | "Legal team reviewing. ETA 2 business days." |
| `payment_details` | "Wants invoice / PO" | "Invoice #1234 attached. Net 30 terms." |
| `process_portal` | "Submit via vendor portal" | "Portal link: vendor.example.com/signup" |

---

### Step 11: Campaign Completion

**What happens**:
- All prospects either `declined`, `agreed`, or deal target reached
- Phase transitions: `monitoring` → `completed`

**What you see**:

#### Header
- Phase badge: "Completed" (green)

#### Pipeline Flow
- All stages: Green checkmarks

#### Goal Progress
- "3 / 5 placements agreed" with progress bar (60%)

#### Budget
- "$350 of $500 · $150 left" with progress bar (70% spent)

#### ROI Dashboard
```
Total spent: $350
Deal value: $450
Negotiated savings: $120
ROI: +28.6%

3 deals closed · $150 budget remaining
```

#### Deals
```
techcrunch.com  asked $200 · agreed $150 · saved $50  [agreed]
producthunt.com  asked $180 · agreed $140 · saved $40  [agreed]
betastartups.io  asked $100 · agreed $80 · saved $20  [agreed]
```

---

## Navigation & Pages

### Sidebar Navigation (Simplified)

```
Geseo (logo + name)
─────────────────────
Campaigns        → /campaigns/autonomous
Decisions        → /sending
Inbox            → /inbox
Agent Runs       → /site-audit
Settings         → /settings
```

### Page Details

#### Campaigns (`/campaigns/autonomous`)
- Lists all campaigns with phase, budget, placements
- Click campaign card → detail page
- "+ New campaign" button → creation form

#### Decisions (`/sending`)
- Email delivery status dashboard
- Shows sent, delivered, opened, bounced emails
- Per-campaign breakdown

#### Inbox (`/inbox`)
- Reply threads from publishers
- Tabs: Unread, Needs your reply, Responses, Awaiting, Filtered, Dismissed
- Manual reply interface
- Sentiment analysis (positive/negative/neutral)
- Reply intent badges (interested, negotiation, decline, etc.)

#### Settings (`/settings`)
- SMTP/IMAP configuration
- API keys (Tavily, Blitz, Hunter)
- Default negotiation settings
- User preferences

---

## Agent Activity Timeline

The activity timeline shows real-time agent actions with timestamps:

### Example Activity Log
```
14:32:04  strategy_agent    search_batch     Searched "AI photo tools review" — 14 hits, 12 new
14:32:07  discovery_agent   prospect_found   Found techcrunch.com
14:32:11  discovery_agent   prospect_found   Found producthunt.com
14:32:15  discovery_agent   prospect_found   Found betastartups.io
14:33:20  qualification_agent  prospect_qualified  Qualified techcrunch.com (score 0.91)
14:33:25  qualification_agent  prospect_qualified  Qualified producthunt.com (score 0.87)
14:33:30  qualification_agent  prospect_rejected   Rejected spam-site.com — low score
14:34:10  contact_agent     contact_found    Found contact for techcrunch.com via Hunter
14:34:15  contact_agent     contact_found    Found contact for producthunt.com via scrape
14:35:00  outreach_agent    outreach_sent    Emailed techcrunch.com — "Partnership opportunity"
14:35:05  outreach_agent    outreach_sent    Emailed producthunt.com — "Featured on Product Hunt?"
14:36:00  inbox_agent       reply_detected   Reply from techcrunch.com
14:36:05  negotiation_agent proposal_sent    Sent offer to techcrunch.com at $120
14:36:10  inbox_agent       reply_detected   Reply from producthunt.com
14:36:15  negotiation_agent counter_sent     Sent counter to producthunt.com at $150
14:37:00  inbox_agent       reply_detected   Reply from betastartups.io
14:37:05  negotiation_agent deal_agreed      Deal with betastartups.io at $80
```

### Activity Features
- **Search**: Filter by agent, action, or keyword
- **Color coding**: Green (success), Yellow (warning), Red (error)
- **Time stamps**: Local time format
- **Action types**: search_batch, prospect_found, prospect_qualified, contact_found, outreach_sent, reply_detected, proposal_sent, counter_sent, deal_agreed, etc.

---

## Negotiation Flow

### Reply Classification
When a reply arrives, the inbox agent classifies it:

| Intent | Description | Action |
|--------|-------------|--------|
| `interested` | Open to discussion | Send opening offer |
| `counter_offer` | Names their price | Counter or accept |
| `accept` | Agrees to proposal | Close deal |
| `question` | Asks for info | Answer question |
| `hard_no` | Clearly declines | Polite close, suppress |
| `unsubscribe` | Wants to stop | Goodbye, suppress |
| `auto` | Out of office | Wait, no action |
| `needs_human` | Requires human | Pause, create intervention |

### Negotiation Settings
Configurable per campaign:
- **Aggressiveness**: gentle, balanced, firm
- **Opening percent**: Starting offer as % of their rate (e.g., 40%)
- **Max thread length**: Max negotiation turns (e.g., 4)
- **Price floor/ceiling**: Min/max you'll pay
- **Auto-accept below**: Auto-deal if under this price
- **Human approval above**: Require approval if over this price

### Example Negotiation Thread
```
Us: Hi Sarah, loved your article on AI photo editing tools. 
    We'd love to be included. What's your typical rate?

Them: Thanks! Our standard rate is $250 for sponsored content.

Us: Thanks for sharing. We typically work with $120-150 for 
    similar placements. Would $130 work?

Them: That's a bit low. How about $200?

Us: Appreciate the counter. We can do $150, which is our 
    max for this tier. Let me know if that works.

Them: Deal, $150 works.

Us: Perfect, $150 works. I'll follow up with details.
```

---

## Email System

### Template Variables
- `{{first_name}}` - Recipient's first name
- `{{site_name}}` - Publication name
- `{{article_title}}` - Referenced article title
- `{{signer_name}}` - "Abdullah Zubair" (configured)
- `{{product_name}}` - Your product name

### Email Quality Rules
- No em dashes (replaced with commas)
- Clean greetings (remove `.invalid` parts)
- Personalized openers (reference specific article)
- Professional sign-off

### Rate Limiting
- Max 1 email/day per domain
- Max 3 emails/hour total
- Per-domain tracking

### Tracking
- Open tracking via pixel
- Bounce detection
- Reply detection via IMAP

---

## Demo Mode

### What Demo Mode Does
- Simulates publisher responses with realistic personas
- All emails route to `ab.ghouri03@gmail.com`
- Uses configured SMTP (Gmail app password)
- No real API calls needed for testing

### Demo Personas
1. **high_anchor**: Starts high ($250), negotiates down to $150
2. **meeting_request**: Wants a call (routes to human)
3. **quick_deal**: Fast close at good price ($100)
4. **decliner**: Polite decline ("not interested")
5. **autoresponder**: Out-of-office message

### Demo Flow
1. Create campaign with `demo_mode: true`
2. Start campaign
3. Watch pipeline execute
4. See demo replies appear in inbox
5. Watch negotiation agent handle replies
6. See deals close (or interventions created)

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

## Key Features

### 1. Autonomous Pipeline
- Agents run independently with configurable autonomy levels
- Auto-tick via cron or manual Start/Pause/Resume/Stop
- Thread length limits prevent endless negotiation loops

### 2. Human-in-the-Loop
Agents route to humans when they can't handle something:
- Call requests → `sync_contact`
- Asset requests → `asset_request`
- Legal contracts → `legal_contract`
- Payment details → `payment_details`
- Portal submissions → `process_portal`

### 3. Suppression System
- Domain-level suppression after hard_no or unsubscribe
- Author-level suppression
- Prevents re-contacting declined prospects

### 4. Observability
- Real-time agent activity timeline
- Execution engine badges (Strands vs fallback)
- Per-agent metrics
- Campaign-level KPIs

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
- Pipeline progress
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
Agents run independently but route to humans when they can't handle something.

### 4. Full Negotiation Engine
Multi-turn price negotiation with configurable aggressiveness, floor/ceiling enforcement, and thread limits.

### 5. Hackathon-Grade Quality
- 102 tests passing (66 reply intent + 36 negotiation)
- Full documentation
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
- `src/app/inbox/page.tsx` — Reply threads and manual reply interface
- `src/components/layout/Sidebar.tsx` — Navigation

### Tests
- `tests/reply-intent-evaluation.test.ts` — 66 reply classification cases
- `tests/negotiation-evaluation.test.ts` — 36 negotiation pipeline cases
- `tests/negotiation.test.ts` — Core negotiation logic tests

---

## Git History (Recent)

```
feb4f28 docs: add agent reply document for hackathon submission
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
