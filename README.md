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
pre-filled example, change anything you like in it, press **Launch demo**, and watch a campaign run
to three deals in a few minutes. No account needed. **The demo is the real pipeline** — real web
search, real pages, real judging, real editor lookup — with one difference: no email leaves the
machine, and the editors' replies are written by the model role-playing each editor. You can also
reply as any editor yourself.

---

## What it looks like

Five screens.

| Screen | What it is for |
|---|---|
| **Setup** | Six fields, under a minute. Nemotron 3 Nano writes the plan in plain English and proposes the search angles; **you can edit the plan** before launch — angles, how many publications, the DR floor, the money rules, the tone, and standing answers (a call? traffic?) so the agent need not ask. |
| **Campaign** | One true sentence of current state, a working orb with a live line ("Judge is reading shotkit.com (9 of 16) · Nemotron 3 Super"), **the eight agents as a pipeline** (the working one lit; open any for everything it did), and four tabs: **Activity** (the feed, one line per decision, expandable to the model's reasoning), **Publications** (every page it looked at — link, each check, the reason, the editor, the email, the reply, the deal), **Conversations** (every thread both ways, with its state; in a demo, reply *as* the editor and the agent answers live), **Tools** (which tool each agent used, how, and how much). |
| **Needs you** | The queue. Each card: what the editor said (their words), what the agent wants to do, what it needs from you, one text box. Answer, and the same thread resumes. Empty state is the goal. |
| **Next steps** | What only you can do, derived by rules from deals and the cards you answered: send the blurb, pay once the placement is live, put the call on your calendar, sign the agreement. Tick items off. |
| **Deals** | Publication, what they asked, what you pay, what you saved. Click one: the Writer drafts the blurb you owe the editor; you move it along — blurb sent, live (with the URL), paid. CSV export. |

Bottom-right, on every screen: a panel listing the campaigns running now, and pop-ups for deals,
cards, replies and finished campaigns.

**Real mode, for people who will actually use it:** sign in with any Google account and bring your
own keys (Settings: Nebius, Gmail app password, Tavily, each with a live test; timezone and sending
hours; a "never contact" list). In the plan: *show me each first email before it goes out* (it waits
under Conversations — approve, edit or discard), *email me when something needs me or a deal lands*
(from your own Gmail), standing answers for calls and traffic questions, a follow-up delay. Finished
campaigns can be run again (everything prefilled) or deleted.

**What happens when several things run at once:** every campaign steps under its own Postgres lock
(a browser tab, a second tab and the scheduler cannot double-step it); every editor thread has its
own lock (a Needs-you answer, an inbox reply and a tick cannot answer the same editor twice); every
outgoing email is claimed atomically (two overlapping scheduler runs cannot both send it); the daily
token and search budgets are atomic counters. All four are tested against the real schema
(`tests/db-walls.test.ts`).

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
| **Could this publisher feature us?** — relevance, editorial quality, and page type (a publication vs a vendor's own product page) | `nvidia/nemotron-3-super-120b-a12b` | thinking on, `json_schema` | Once per prospect. Nano (thinking off) judged relevance well but called adobe.com's and canva.com's own feature pages "editorial" in two runs of three; telling a publication from a product page took a moment of reasoning (docs/LEDGER.md, Run F). ~$0.0007 and ~4 s each. |
| Search angles, outreach subject/body, **reply classification**, follow-ups, the plan preview | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` (falls over to `nvidia/Nemotron-3_5-Lightning` on a truncation) | thinking off, `json_schema` | The high-volume calls. With `chat_template_kwargs.enable_thinking=false` Nano answers a structured judgment in 60–110 tokens, ~0.5 s, at $0.06/$0.24 per M. |
| **Counter-offers** against a named price | `nvidia/Nemotron-3-Ultra-550b-a55b` | thinking on | The one place "serious reasoning" changes money. Hard-capped at 20 calls per campaign, then Super. |

Code owns everything that must be true regardless of what a model says: price ceilings and floors,
budget commits (an atomic Postgres function), send safety, the escalation cues (a call, an NDA, an
invoice, a traffic question → a human), phase transitions, completion, and the status sentence.
See [`docs/LEDGER.md`](docs/LEDGER.md) for the decision ledgers — a demo arc is 39 model decisions,
11 policy rules, zero heuristics, about three cents; a real-mode run with ten editor replies of every
kind is there too.

## Where Token Factory accelerated the workflow

- One adapter, [`src/lib/ai/nebius.ts`](src/lib/ai/nebius.ts), one OpenAI-compatible endpoint, four
  models routed by role ([`src/lib/ai/models.ts`](src/lib/ai/models.ts)). Swapping the orchestrator
  from Super to Ultra is an environment variable.
- `response_format: json_schema` on every structured call means the app validates the model's answer
  and **throws** if it is wrong — no fabricated scores, no canned fallbacks.
- Thinking on/off per call let us spend reasoning where it matters (planning, qualification,
  counter-offers) and run the rest at Nano speed. A whole demo campaign — 12 publications judged,
  7 editors emailed, every reply answered, 3 deals — costs about three cents.
- `GET /v1/models` is checked at `/api/health?deep=1`; the app pauses with a visible banner if a
  routed model disappears or the key fails.

## Where Tavily is called at runtime

Discovery — in the demo and in real mode — searches the web with Tavily (`POST
https://api.tavily.com/search`, Bearer auth) in [`src/lib/search/webSearch.ts`](src/lib/search/webSearch.ts),
called from [`src/lib/campaign/tools.ts`](src/lib/campaign/tools.ts) `discoverBatch()` with the
angles from the plan (Nano proposes them; you can edit them) and then angles Nano plans at run time.
Owners' campaigns use their own Tavily key; public demos use the platform key under a daily cap.
Publications the owner listed at Setup load first and cost no credit.

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

**Demo mode rule:** the demo is the real pipeline; only the email transport is simulated. With a
Tavily key the demo searches the real web (3 queries), reads the real pages, judges them with Super,
finds real editors (a site with no public address gets a labelled stand-in), and writes real outreach
— which is never sent. The editors' replies are written by Nemotron 3 Nano role-playing an editor
with a stance (opens high on price, says yes quickly, wants a call, asks about traffic, declines,
out of office); the words are the model's every time. You can replace any editor with yourself from
the Conversations tab. Without any Tavily key the demo falls back to a built-in publication list,
labelled as such. `DEMO_SEARCH_QUERIES` (3) and `TAVILY_DAILY_BUDGET` (150) cap what public demos
spend of the platform's search credits.

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
