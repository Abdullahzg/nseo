# Nseo — an outreach agent that knows what it is not allowed to buy

**Nebius × NVIDIA Global AI Hackathon 2026 · Best Apps and Agents track**

Tell it what you sell and what you can spend. It finds publications about your keywords, judges
which ones are worth it, finds a human editor at each, writes them, reads their replies, negotiates a
price under your ceiling, records the deal — and parks a conversation for you only when it hits
something an email-only agent must not decide alone: a call, a contract, a price above your limit, a
factual question about your business.

Every decision is made by **NVIDIA Nemotron 3** models served on **Nebius Token Factory**, and every
one of them is visible in the product: tap any line of the activity feed to see which model decided
it, the tokens it used, how long it took, and its reasoning.

### Three things that make it different from a demo

**1. It is compliant by construction.** Google's spam policies list *"exchanging money for links, or
posts that contain links"* as link spam — and say paid links are fine *"as long as they are
qualified"* with `rel="sponsored"`. So this agent negotiates for a qualified link and a visible
label, attaches that condition to its own agreement in code-written wording, and **refuses** an
editor who insists on selling a paid do-follow link, who will not disclose, who writes a link into
the contract, or who offers to guarantee a verdict. The rules carry their citations and are applied
by code, never by a model. See `src/lib/compliance/policy.ts` and the **Safety** tab of any campaign.

**2. The model never touches the money, and an email cannot change that.** Ceilings, the budget
commit, send gates and escalations are deterministic. Inbound email is the one input from strangers,
so every reply is stripped of what a reader cannot see and scanned against fixed rules before a model
is asked anything; a reply that reads as an instruction stops the thread and comes to you with the
matched words shown (`src/lib/security/injection.ts`).

**3. It is measured, not demonstrated.** `npm run eval` runs a frozen, hand-labelled set — 20 inbound
replies (10 verbatim from a real run), 8 negotiation scenarios, 9 compliance offers, 18 prompt-injection
attacks and 12 ordinary replies — and reports every proportion with a 95% Wilson interval, because
twenty cases cannot prove a percentage. Latest run:

| Measure | Result | 95% CI |
|---|---|---|
| Injection attacks that got through | 0 / 18 | [0.0%, 17.6%] |
| False positives on ordinary replies | 0 / 12 | [0.0%, 24.3%] |
| Ceiling violations (a figure we offered above the cap) | 0 / 8 | [0.0%, 32.4%] |
| Triage accuracy (intent of an inbound reply) | 19 / 20 | [76.4%, 99.1%] |
| Escalation precision / recall | 100% / 88.9% | — |
| Compliance verdict correct | 9 / 9 | [70.1%, 100.0%] |

The harness earned its place on its first run: it caught a bad metric of mine and three real
classifier weaknesses. Fixing the intent definitions took triage accuracy from **60% to 95%** and
escalation recall from **56% to 89%**. Full table and caveats: `docs/EVALS.md`, or the **/evidence**
page in the running app.

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
| **Setup** | Six fields, under a minute. Nemotron 3 Nano writes the plan in plain English and proposes the search angles; **you can edit the plan** before launch — angles, how many publications, the DR floor, the money rules, the tone, and standing answers (a call? traffic?) so the agent need not ask. Under it, **"Here's what will happen"**: the campaign's journey, agent by agent, day by day, computed by code from the plan — change a number and the consequence shows at once. |
| **Campaign** | One true sentence of current state, a working orb with a live line ("Judge is reading shotkit.com (9 of 16) · Nemotron 3 Super"), **the eight agents as a pipeline** (the working one lit; open any for everything it did), and four tabs: **Activity** (the feed, one line per decision, expandable to the model's reasoning), **Publications** (every page it looked at — link, each check, the reason, the editor, the email, the reply, the deal), **Conversations** (every thread both ways, with its state; in a demo, reply *as* the editor and the agent answers live), **Tools** (which tool each agent used, how, and how much), **Story & replay** (Nemotron 3 Super writes the campaign's story from the ledger, in your voice, with the agents named; a replay scrubber walks every recorded moment with the agents lighting up and the numbers rolling; **Share this story** mints a read-only link with every address scrubbed). First visit: three coach marks. As it runs: **moments** — the first reply, the first deal, the goal — each with the story so far in one line. |
| **Needs you** | The queue. Each card: what the editor said (their words), what the agent wants to do, what it needs from you, one text box. Answer, and the same thread resumes. Empty state is the goal. |
| **Next steps** | What only you can do, derived by rules from deals and the cards you answered: send the blurb, pay once the placement is live, put the call on your calendar, sign the agreement. Tick items off. |
| **Safety** | What the agent would not do: every deal's link attribute, disclosure and compliance verdict with the rule behind it, plus any reply that tried to instruct the agent, with the words that gave it away. |
| **Deals** | Publication, what they asked, what you pay, what you saved. Click one: the Writer drafts the blurb you owe the editor; you move it along — blurb sent, live (with the URL), paid. CSV export. |

Bottom-right, on every screen: a panel listing the campaigns running now, and pop-ups for deals,
cards, replies and finished campaigns.

The agents have faces (DiceBear "bottts" robots, seeded so each agent always looks the same) and so
do the editors ("notionists", seeded by name and publication); both are free for commercial use.
Motion is [Motion](https://motion.dev) (`motion/react`): the working robot nods, numbers roll to
their new values, rows and cards enter in turn, panels crossfade; `prefers-reduced-motion` is
honoured by the library.

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
(`tests/db-walls.test.ts`), and the whole thing was exercised live on 2026-09-21: two guests
launching demos at the same second ran independently to the same point; five parallel ticks on one
campaign produced one step and four "locked"; a guest reading, ticking or deleting another guest's
campaign got 404; a guest asking for a real campaign got 403; a guest opening Settings got 403.

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

## Where Tavily is called at runtime (four endpoints)

Four endpoints, each where it is genuinely the right tool — all in
[`src/lib/search/tavily.ts`](src/lib/search/tavily.ts), in the demo and in real mode alike:

| Endpoint | Agent | What it does here | Credits |
|---|---|---|---|
| `POST /search` | Scout | The angles from the plan, one call each. Platform domains (YouTube, Reddit, stores) are excluded **at the API** and anything scoring under 0.3 is dropped — so a page that was always going to be rejected never costs a Nemotron 3 Super judgement. | 1 each |
| `POST /map` | Finder | Lists a publication's about / contact / team / masthead / author pages, so the agent reads the pages that name a person instead of guessing three URLs. | ~2 per site |
| `POST /crawl` | Finder | Reads those pages in one call with a plain-English instruction (*"find the editorial staff and the pitch address"*); the address is then taken from the result by rule. | ~3 per site |
| `POST /extract` | Judge | Reads an article with the campaign's topic as `query`, so Tavily returns the passages about it rather than the whole page — fewer tokens to judge, and it works on JavaScript-rendered sites a plain fetch cannot read. | 1 per 5 URLs |
| `GET /usage` | — | The key's real credit balance, for the meter. | 0 |

Every call carries `X-Session-Id` (the campaign id, so one run groups together in Tavily's own
dashboard) and `include_usage`, and the credits are counted per endpoint onto the campaign and shown
in the **Tools** tab. Owners' campaigns use their own Tavily key; public demos use the platform key
under a daily cap. Publications the owner listed at Setup load first and cost no credit.

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
src/lib/campaign/story.ts     the story: facts by code, chapters by Super, share token, address scrubbing
src/lib/compliance/policy.ts  the link rules with their citations: what the agent may and may not agree to
src/lib/compliance/footer.ts  CAN-SPAM footer, one-click unsubscribe tokens, List-Unsubscribe headers
src/lib/security/injection.ts the scanner for inbound email: defang, fence, 13 literal rules
src/lib/search/tavily.ts      /search, /extract, /map, /crawl, /usage with per-endpoint credit accounting
src/lib/ai/embeddings.ts      Qwen3-Embedding on Token Factory: same-host dedupe, ranking the Judge's queue
src/lib/campaign/memory.ts    what past campaigns learned about a publication
evals/                        the frozen hand-labelled set and the report generator (npm run eval)
src/lib/campaign/plan.ts · todos.ts · agents.ts   the editable plan, rule-derived to-dos, the agent registry
src/components/setup/Journey.tsx   "here's what will happen", computed from the plan
src/components/campaign/{Tour,Moments,Story}.tsx   coach marks, milestone moments, story + replay
src/components/ui/{Face,motion}.tsx   DiceBear faces, Motion primitives
src/lib/ai/context.ts         per-request key context: an owner's own Nebius/Tavily keys, or the platform key for guest demos
src/lib/email/processor.ts    real-mode transport: IMAP reply sweep, then SMTP send from the owner's Gmail (run by the scheduler)
supabase/migrations/0001_schema.sql   the whole schema, including the guest walls
src/app/(app)/{setup,campaigns,campaigns/[id],needs-you,next-steps,deals,settings}   the screens
src/app/story/[token]     the shared read-only story (no sign-in, no addresses)
src/app/evidence          the measured numbers, the rules and their citations (no sign-in)
src/app/u/[token]         one-click unsubscribe (RFC 8058 POST at /api/u/[token])
docs/LEDGER.md · docs/RESEARCH.md · docs/PLATFORM.md · UPDATES.md · DEPLOY.md · FEEDBACK.md
```

## Honesty notes a judge should know

- Domain Rating comes from Ahrefs in real mode. Without a key it is stored and shown as **unverified**,
  and the score is marked *relevance only* in the data model. Demo fixtures carry labelled DR values.
- Real mode was run end-to-end on 2026-09-20 with the author's own Gmail as both sender and "editor"
  (docs/LEDGER.md, Run D) — no stranger has received a test email from this project.
- The activity feed hides nothing: model errors, truncations, refusals and retries are lines in it.
- Runtime logs on Vercel Hobby last an hour; `agent_events` is the durable record.
- A free-tier Supabase project pauses when idle. The first request after it wakes can arrive before
  PostgREST has its schema; every query retries through that (`src/lib/db/resilient.ts`), so the
  first click on a cold deployment is slow, not broken.
- Hobby is non-commercial. This deployment is a hackathon demo.

MIT — see [`LICENSE`](LICENSE).
