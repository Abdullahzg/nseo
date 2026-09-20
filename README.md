# Nseo — an outreach agent that only comes back when it needs you

**Nebius × NVIDIA Global AI Hackathon 2026 · Best Apps and Agents track**

Tell it what you sell and what you can spend. It finds publications about your keywords, judges
which ones are worth it, finds a human editor at each, writes them, reads their replies, negotiates a
price under your ceiling, records the deal — and parks a conversation for you only when it hits
something an email-only agent must not decide alone: a call, a contract, a price above your limit, a
factual question about your business.

Every decision is made by **NVIDIA Nemotron 3** models served on **Nebius Token Factory**, and every
one of them is visible in the product: tap any line of the activity feed to see which model decided
it, the tokens it used, how long it took, and its reasoning.

**Live demo:** _(URL in the Devpost submission)_ — open it, read the plan the agent wrote for the
pre-filled example, press **Launch demo**, and watch a campaign run to three deals in about three
minutes. No account needed. Nothing is sent anywhere.

---

## What it looks like

Four screens. Nothing else.

| Screen | What it is for |
|---|---|
| **Setup** | Six fields, under a minute. Before launch, Nemotron 3 Nano writes the plan in plain English. Demo is the default and pre-filled. |
| **Campaign** | One true sentence of current state ("Negotiating with 2 editors. 2 deals agreed, $240 of $800 committed. 2 things need you."), four numbers, a budget bar, and a human-readable feed — newest first, one line per decision, expandable to the model's reasoning. |
| **Needs you** | The queue. Each card: what the editor said (their words), what the agent wants to do, what it needs from you, one text box. Answer, and the same thread resumes. Empty state is the goal. |
| **Deals** | Publication, what they asked, what you pay, what you saved. |

Real mode is the same product with real email: it runs for days from a scheduler, and the **Needs you**
badge is how you find out it wants you. It is multi-user and bring-your-own-keys: sign in with any
Google account, save your own Nebius Token Factory key, Gmail app password and (optionally) Tavily key
in **Settings**, and your campaigns run on your accounts. Real-mode Setup also takes **publications
you already know** (a URL each, the editor's address if you have it); with web search switched off,
only those are contacted.

## Which Nemotron model makes which decision, and why

| Decision | Model | Mode | Why this model |
|---|---|---|---|
| **Which action to take this step** (search, evaluate, find editors, email, answer replies) | `nvidia/nemotron-3-super-120b-a12b` | thinking on, tool call | One planning turn per busy step needs judgment across the whole funnel; Super's reasoning is cheap enough to run every step and its `reasoning_content` is shown in the feed. |
| Search angles, **publication relevance & editorial quality**, outreach subject/body, **reply classification**, follow-ups, the plan preview | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` (falls over to `nvidia/Nemotron-3_5-Lightning` on a truncation) | thinking off, `json_schema` | The high-volume calls. With `chat_template_kwargs.enable_thinking=false` Nano answers a structured judgment in 60–110 tokens, ~0.5 s, at $0.06/$0.24 per M. |
| **Counter-offers** against a named price | `nvidia/Nemotron-3-Ultra-550b-a55b` | thinking on | The one place "serious reasoning" changes money. Hard-capped at 20 calls per campaign, then Super. |

Code owns everything that must be true regardless of what a model says: price ceilings and floors,
budget commits (an atomic Postgres function), send safety, the escalation cues (a call, an NDA, an
invoice, a traffic question → a human), phase transitions, completion, and the status sentence.
See [`docs/LEDGER.md`](docs/LEDGER.md) for a run's full decision ledger — 38 model decisions, 8 policy
rules, zero heuristics, $0.005.

## Where Token Factory accelerated the workflow

- One adapter, [`src/lib/ai/nebius.ts`](src/lib/ai/nebius.ts), one OpenAI-compatible endpoint, four
  models routed by role ([`src/lib/ai/models.ts`](src/lib/ai/models.ts)). Swapping the orchestrator
  from Super to Ultra is an environment variable.
- `response_format: json_schema` on every structured call means the app validates the model's answer
  and **throws** if it is wrong — no fabricated scores, no canned fallbacks.
- Thinking on/off per call let us spend reasoning where it matters (planning, counter-offers) and
  run the rest at Nano speed. A whole demo campaign — 12 publications evaluated, 8 editors emailed,
  8 replies negotiated, 2 deals — costs about half a cent.
- `GET /v1/models` is checked at `/api/health?deep=1`; the app pauses with a visible banner if a
  routed model disappears or the key fails.

## Where Tavily is called at runtime

Real-mode discovery searches the web with Tavily (`POST https://api.tavily.com/search`, Bearer auth)
in [`src/lib/search/webSearch.ts`](src/lib/search/webSearch.ts), called from
[`src/lib/campaign/tools.ts`](src/lib/campaign/tools.ts) `discoverBatch()` with queries Nano planned,
under the owner's own Tavily key. Publications the owner listed at Setup load first and cost no
credit; demo mode uses fixture publications so a public demo cannot burn search credits.

## Architecture

```
Browser ── Next.js 16 (Vercel Hobby) ──┬── /api/campaigns/:id/tick   one bounded step (≤45 s, locked, capped)
                                       │       └─ policy.ts: what is available?  none → no model call
                                       │       └─ Nemotron 3 Super picks ONE action (tool call)
                                       │       └─ tools.ts / outreach.ts execute it, writing the feed
                                       ├── /api/cron/tick  ← GitHub Actions every 5 min: tick every due
                                       │                      real campaign, then IMAP reply sweep + SMTP send
                                       ├── /api/interventions  ← Needs-you answers resume threads
                                       └── /api/settings  ← per-owner keys (Nebius, Gmail, Tavily), encrypted at rest
Supabase Postgres: campaigns · campaign_prospects · outreach_emails · deals · interventions · agent_events
Nebius Token Factory: Nemotron 3 Nano / Super / Ultra (+ 3.5 Lightning)   Tavily: web search (real mode)
```

**Demo mode rule:** fixture data is fake, every decision is real. The publications, editors and
scripted replies are fixtures; relevance, classification, outreach wording, counter-offers and deal
recording are genuine Nemotron calls or the same policy rules as real mode. Only the email transport
is simulated.

**Guests** can run demos only, and that is enforced in the database, not in a permissions check: a
`CHECK` constraint forbids a guest campaign from being real, and a trigger forbids scheduling real
email on any demo or guest campaign. Caps: 2 concurrent / 5 per day per guest, 20 per day globally,
60 steps per demo, and a global daily Nebius token budget that pauses everything with a banner.

**Owners** are any Google account (or an allow-list, if the deployment sets one). Every model and
search call in an owner's campaign runs under that owner's own keys — a per-request key context
([`src/lib/ai/context.ts`](src/lib/ai/context.ts)) wraps each tick, plan preview and Needs-you answer,
so one deployment serves many people without a platform key paying for them.

## Run it yourself (from zero)

```bash
git clone <this repo> && cd nseo
npm install
cp .env.example .env.local        # fill NEBIUS_API_KEY (tokenfactory.nebius.com → API keys); that's the only required key for the demo

# Database — either local:
npx supabase start                 # needs Docker; prints anon/service keys → paste into .env.local
#   (the schema in supabase/migrations/0001_schema.sql is applied automatically)
# …or a free hosted project: create one at supabase.com, then
npx supabase link --project-ref <ref> && npx supabase db push

npm run dev                        # http://localhost:3000 — you are the owner locally (no Google needed)
```

Then open **Setup** and press **Launch demo** (the plan is already written for the pre-filled example). `npm test` runs the unit and
database-wall tests (`DATABASE_URL` in `.env.local` enables the latter); `npm run e2e` drives the
deployed demo (`E2E_BASE_URL`).

Real mode additionally needs: Google OAuth (`GOOGLE_CLIENT_ID/SECRET`; `OWNER_EMAILS` only if you
want a private deployment), each owner's own keys entered in Settings (Nebius, Gmail app password,
Tavily), and the scheduler (see [`DEPLOY.md`](DEPLOY.md)). Locally, `DEV_OWNER_EMAIL` makes you the
owner without Google.

## Repository map

```
src/lib/ai/nebius.ts          the adapter (reasoning_content | reasoning, thinking on/off, json_schema, tools, NebiusError)
src/lib/ai/models.ts          model routing + official prices
src/lib/campaign/policy.ts    deterministic: available actions, transitions, tick interval, status sentence
src/lib/campaign/orchestrator.ts  one tick: guards → policy → Super chooses → execute bounded → transition
src/lib/campaign/tools.ts     discover (Tavily / fixtures), qualify (Nano), resolve contacts
src/lib/campaign/outreach.ts  draft (Nano), send/queue, replies → negotiation → deals & interventions
src/lib/negotiation/agent.ts  classify (Nano) · strong-cue escalations · counter-offers (Ultra) · policy closings
src/lib/negotiation/run.ts    one negotiation step with persistence
src/lib/campaign/guard.ts     tick lock, daily caps, global token budget
src/lib/ai/context.ts         per-request key context: an owner's own Nebius/Tavily keys, or the platform key for guest demos
src/lib/email/processor.ts    real-mode transport: IMAP reply sweep, then SMTP send from the owner's Gmail (run by the scheduler)
supabase/migrations/0001_schema.sql   the whole schema, including the guest walls
src/app/(app)/{setup,campaigns/[id],needs-you,deals,settings}   the screens
docs/LEDGER.md · docs/RESEARCH.md · docs/PLATFORM.md · UPDATES.md · DEPLOY.md · FEEDBACK.md
```

## Honesty notes a judge should know

- Domain Rating comes from Ahrefs in real mode. Without a key it is stored and shown as **unverified**,
  and the score is marked *relevance only* in the data model. Demo fixtures carry labelled DR values.
- Real mode was run end-to-end on 2026-09-20 with the author's own Gmail as both sender and "editor"
  (docs/LEDGER.md, Run D) — no stranger has received a test email from this project.
- The activity feed hides nothing: model errors, truncations, refusals and retries are lines in it.
- Runtime logs on Vercel Hobby last an hour; `agent_events` is the durable record.
- Hobby is non-commercial. This deployment is a hackathon demo.

MIT — see [`LICENSE`](LICENSE).
