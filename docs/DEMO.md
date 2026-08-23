# Demo script

The demo runs the ENTIRE real pipeline; only the email transport boundary is simulated
(clearly labeled `DEMO MODE · simulated publishers` in the UI). Every downstream step —
classification, negotiation policy, budget ledger, deals, interventions — is production code.

## Setup (one time, ~2 minutes)

```bash
# terminal 1: database + REST (see docs/DEPLOYMENT.md local stack)
docker run -d --name seo-pg  -e POSTGRES_PASSWORD=seo123 -e POSTGRES_DB=seo -p 5433:5432 postgres:latest
docker run -d --name seo-pgrst -p 5441:3000 \
  -e PGRST_DB_URI="postgres://postgres:seo123@host.docker.internal:5433/seo" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=postgres postgrest/postgrest:latest
node scripts/dev-rest-proxy.mjs &
node scripts/run-migrations.mjs

# terminal 2: app   → npx next dev -p 3100
# optional terminal 3: ADK service → uvicorn agents/seo_workforce/main:app --port 8104
```

Seed demo tuning (permissive pricing tier so the scripted arc lands under the ceiling):

```sql
INSERT INTO negotiation_settings (id, ai_autonomy, pricing_rules, opening_percent)
VALUES (true, false, '[{"min_dr":0,"max_offer":250,"label":"demo tier"}]', 40)
ON CONFLICT (id) DO UPDATE SET pricing_rules = EXCLUDED.pricing_rules;
```

## The run (what to show)

1. **Sign in** → sidebar **Autonomous Campaigns** → *New campaign*
   - Website `https://imagine.example`, keywords `AI photo editor, photo restoration`
   - Budget `$1,000`, desired placements `3`, toggle **Demo mode**
2. Press **Start**. The timeline begins narrating:
   - `strategy · plan_queries` → `discovery · search_batch (demo-fixture)` → prospects appear
   - `qualification · prospect_qualified` with score + ceiling per host
   - `contact_intel · contact_resolved` (source labeled `demo-simulated`)
   - `outreach · outreach_sent_simulated`
3. Monitoring ticks bring persona replies through the real reply-recording path:
   - **high_anchor** publisher opens at **$350**
   - Negotiation Agent classifies → policy says counter under the $250 ceiling → Gemini/OpenRouter drafts → counter sent (simulated transport)
   - Publisher concedes $275 → agent counters again
   - Publisher settles **$230 ≤ ceiling** → agent accepts → **deal row + $230 budget commit**, savings vs ask shown
4. Meanwhile a second publisher asks to **hop on a call** → thread parks:
   - Red-tinted **Action required** card: type `sync_contact`, what they asked, why paused
5. Type availability into the intervention box ("Tell them Thursday 3-5pm works") → **Resume agent**
6. The SAME conversation continues truthfully with that input; campaign keeps working toward its goal.

## Headless variant (for CI / video capture)

```bash
node scripts/demo-arc.mjs <campaign_id> 25     # drives ticks until deals/HITL/completion
```

## What judges should notice

- One human action started everything; hundreds of operational steps follow
- Money math visibly deterministic: ceilings enforced even when models drift
- The HITL pause is *targeted* — one negotiation pauses, the campaign doesn't stop
- Every step is on the timeline with structured reasons (`reason_code`), never chain-of-thought
- Emergency stop / pause / takeover available at every level
