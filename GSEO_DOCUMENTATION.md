# Geseo: AI-Powered Outreach Platform

## Overview
Geseo is an AI-powered outreach platform designed for the "Agents for Humans" hackathon. It provides an autonomous campaign pipeline with full negotiation, inbox management, and email delivery. The system is built on the Strands Agents SDK with a Next.js frontend, Python backend service on port :8104, and Postgres database.

## Color Scheme: Pure Monochrome (Black & White)
- Brand color: Geseo black on white background
- Font: Poppins (weights 300, 400, 500, 600, 700)
- All UI elements use only black text on white background, or white on black (inverted sections)
- SVG icons use currentColor, inheriting the text color

## Quick User Flow

### 1. Create Campaign
- Go to `/campaigns/autonomous` → click **New Campaign**
- Enter campaign name, goal, keywords (comma-separated), website URL
- Set demo mode: `true` for testing without real API keys
- Configure negotiation settings: min price, opening percent, aggressiveness (gentle/balanced/firm), max thread length
- Click **Create** — campaign starts in `draft` phase

### 2. Run Campaign Tick
- In `/campaigns/autonomous`, the campaign runs on an automatic `/tick` endpoint
- Each tick advances the campaign through phases:
  - `draft` → `planning` → `discovering` → `qualifying` → `resolving_contacts` → `outreaching` → `monitoring` → `completed`
- The tick processes 1 cycle of: discovery, qualification, contact resolution, email outreach, and reply detection
- Click **Tick Manually** to advance one phase

### 3. Monitor Results
- **Status tab** (`/sending`): Shows email delivery status, opens, bounces
- **Inbox** (`/inbox`): Reply threads with human classifications and negotiation status
- **Campaign page** (`/campaigns/autonomous`): Live pipeline view with agent cards and activity feed

### 4. Human Intervention (HITL)
When a reply is classified as `needs_human`:
- **`sync_contact`**: AI requested a call/meeting — pauses negotiation, marks for human sync
- **`payment_details`**: AI requested invoice/payment info — pauses for human handling
- Intervention appears as a yellow banner on the thread
- Click **Review** to approve/reject the AI's suggested response
- After approval, campaign resumes automatically

### 5. Negotiation Flow
Each prospect persona follows a deterministic arc:

| Persona | Initial Reply | AI Counters | Outcome |
|---------|--------------|-------------|---------|
| **high_anchor** | "$350 rate" | $275 → $230 (3 rounds) | Settle at $230 |
| **quick_deal** | "$120 invoice" | Instant accept at quoted price | Deal closed |
| **meeting_request** | "Quick call?" | Flagged `needs_human`/`sync_contact` | Human schedules call |
| **decliner** | "We don't accept" | Graceful goodbye, thread closed | Rejected |
| **autoresponder** | "Out of office" | OOO handling, resume later | No action |

### 6. Email Quality Features
- **Greeting detection**: Strips `.invalid` domain fragments from author names (e.g., "genstack.weekly.invalid" → "Genstack")
- **Em dash sanitization**: Preserves compound-word hyphens, only replaces separator dashes (spaces around dash)
- **{{signer_name}}**: All emails sign off as "Abdullah Zubair"
- **Campaign handbook context**: `constraints_text` passed to negotiation agent via `NegotiationSettings.handbook`

## Technical Structure

### Architecture
```
Next.js UI (port 3001)
  → /api/campaigns/:id/tick — campaign orchestrator
  → /api/agent/tools/* — Strands agent tool gateway
  → Python Strands Service (port 8104)
    → campaign_manager → 7 specialist agents
  → Postgres (port 5433 via seo-pg container)
  → PostgREST (port 5441 via seo-pgrst container)
  → PostgREST proxy (port 5440 via scripts/pgrst-proxy.mjs)
```

### Key Tables
- **campaigns**: Master campaign state, `demo_mode`, `keywords`, `constraints_text`, `phase`
- **campaign_prospects**: 12 prospect slots per campaign, `notes->>demo_persona` assignment
- **outreach_emails**: All sent/received emails with `kind` (initial/negotiation/reply), `status` (sent/failed/draft), `negotiation_status`
- **user_email_config**: SMTP credentials and app passwords per user
- **negotiation_settings**: Per-campaign settings (handbook, tone, aggressiveness, pricing rules)

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/campaigns` | POST | Create new campaign |
| `/api/campaigns/:id` | GET | Get campaign state |
| `/api/campaigns/:id` | PATCH | Update campaign (resume from draft) |
| `/api/campaigns/:id/tick` | POST | Advance campaign one phase |
| `/api/negotiation/settings` | PUT | Update negotiation settings |
| `/api/agent/tools/*` | POST | Strands agent tool calls |

### 7 Specialist Agents (Strands SDK)
The Python Strands service runs 7 agents that process each tick:
1. **Discovery Agent** — Generates search queries from keywords, queries Tavily/Blitz
2. **Qualification Agent** — `heuristicRelevance` scores prospects against keywords (`>= 2` term match)
3. **Contact Resolution Agent** — Resolves contact emails via Hunter API / SMTP verification
4. **Outreach Agent** — Generates personalized email copy using LLM, respects rate limits (3 emails/hour/domain)
5. **Negotiation Agent** — `classifyReplyIntent`, `draftNegotiationReply`, `sanitizeBody` (Unicode dash handling)
6. **Sentiment Agent** — Analyzes reply sentiment (positive/negative/neutral)
7. **ROI Agent** — Calculates deal revenue, saved amount, ROI percentage per campaign

### Demo Mode
When `demo_mode = true`:
- No Google OAuth required — synthetic session with `demo@local` user
- All emails route to `ab.ghouri03@gmail.com` via SMTP config
- 5 demo personas injected: high_anchor, meeting_request, quick_deal, decliner, autoresponder
- Reply templates are deterministic (pre-written scripts per persona)
- Negotiation flows follow the persona arcs above
- SMTP sends to real Gmail, but recipient addresses are `.invalid` domains (expected bounces)
- Strands service unavailable → 503 error (visible failure, no silent TS fallback)

## Negotiation Settings
Set via `/api/negotiation/settings` or in campaign creation:

| Field | Description |
|-------|-------------|
| `handbook` | Text constraints passed to negotiation agent (from `constraints_text` on campaign) |
| `tone` | Gentle / balanced / firm |
| `aggressiveness` | How aggressively AI counters |
| `opening_percent` | Opening bid as % of market rate |
| `max_thread_length` | Max AI messages before thread capped (default 4) |
| `min_price` | Absolute minimum price AI will accept |
| `currency` | USD / EUR / GBP |
| `pricing_rules[]` | Per-domain pricing overrides |

## HITL (Human-in-the-Loop) Intervention Types

1. **`sync_contact`** — AI requested a call or meeting
   - Pauses negotiation thread
   - Shows "Review" button in inbox
   - After human review, campaign resumes with AI's next counter

2. **`payment_details`** — AI requested invoice/payment info
   - Pauses for human to provide correct billing details
   - AI then resumes negotiation at agreed price

3. **`escalation`** — All rejection paths exhausted
   - Marks campaign as completed
   - All prospects classified as `rejected`

## Email Performance Metrics

### Per Campaign
- **Sent**: Emails successfully dispatched
- **Opened**: Tracking pixels fired
- **Replied**: Human replies detected
- **Negotiated**: Negotiation threads completed
- **Closed**: Deals won (agreed status)
- **Bounced**: Invalid email addresses

### Overall Platform
- **Open Rate**: (Opened / Sent) × 100
- **Bounce Rate**: (Bounced / Sent) × 100
- **Average Deal Value**: Total revenue / Closed deals
- **ROI**: (Revenue - Cost) / Cost × 100%

## Troubleshooting

### "Dev server on port 3001 occupied by Docker Desktop"
- AGENTS.md rule: Never use `-RedirectStandardOutput` with `Start-Process`
- Solution: Use `Start-Process ... -WindowStyle Hidden` and move on
- Or run dev on alternate port

### "Strands service unavailable"
- In demo mode: visible 503 error, no silent fallback
- Set `HACKATHON_MODE=true` in `.env.local`
- Ensure `strands.models.openai.OpenAIModel` is configured with Groq key

### "Emails marked as failed"
- SMTP requires per-user app password in DB
- If no app password found, falls back to env `SMTP_USER`/`SMTP_PASS`
- Ensure `user_email_config` table has entries for sending identities

### "Campaign stuck in draft"
- Must advance to `planning` phase before tick processes
- Use PATCH `/api/campaigns/:id` with `phase: "planning"` 
- Or tick enough times to auto-advance (3 empty discovery passes → discovery_saturated)

### "Negotiation thread too long"
- `max_thread_length` defaults to 4 but may not be enforced in scripted demo fallback
- The orchestrator does not auto-terminate threads beyond this limit
- Manual intervention required to close stale threads

## Development Notes

### Adding New Demo Persona
1. Add persona to `PERSONAS` array in `src/lib/campaign/demo.ts`
2. Add reply script in `nextPersonaMessage()` switch
3. Ensure `assignDemoPersona()` assigns reliably via count % length
4. Test `injectDemoReplies()` processes correctly

### Fixing Email Sending
1. Configure SMTP in `.env.local`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`
2. Store app password in `user_email_config` DB table for per-user sending
3. `deliverOutreach()` falls back to env SMTP when no per-user password found

### PostgREST Schema Cache
After adding DB columns:
1. Restart `seo-pgrst` Docker container
2. Run `npx supabase stop && npx supabase start` to refresh cache
3. Verify new columns appear in PostgREST queries

### Campaign ID Backfill
After adding `campaign_id` to `outreach_emails`:
1. Run migration to backfill `campaign_id` from `workflow_id` join
2. Restart `seo-pgrst` container
3. Verify email stats query uses `campaign_id` column directly