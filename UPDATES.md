# UPDATES.md — what changed after the submission period opened (Aug 26, 2026)

Per the Official Rules, a project that existed before the Submission Period must explain what was
significantly updated during it. This one existed before: an internal SEO-outreach tool, and an
earlier agent layer built for a different hackathon in late August. **Everything a judge sees was
rebuilt between September 20 and the deadline.** The git history is the evidence; the commits are
dated and unsquashed.

## The short version

| Before Aug 26 | After |
|---|---|
| Model decisions on Google Gemini / OpenRouter / Groq / Bedrock, with silent keyword/regex fallbacks | **All decisions on NVIDIA Nemotron 3 via Nebius Token Factory. No other provider, no heuristic fallback — failures throw and are shown.** |
| A second service in Python (Strands) doing the planning, calling Next.js back over HTTP | Deleted. The TypeScript orchestrator is the engine: one model turn per busy step, none on idle steps. |
| ~700 files, 58 incremental migrations, 190 API routes, 30 pages (blog writer, CMS, media, link audit, indexing, payments…) | ~150 files, one schema file, 12 routes, four screens. |
| Demo mode with scripted negotiation and heuristic classification (zero real model decisions) | Demo mode where fixture data is fake but **every decision is a real Nemotron call** (docs/LEDGER.md). |
| A 1,783-line campaign page with phase steppers, agent boards, ledgers, template editors | Setup · Campaign · Needs you · Deals. |
| Browser auto-ticked every 15 s; no lock; no caps | Tick lock in Postgres, per-campaign daily cap, per-demo step cap, global daily token budget, phase-aware intervals, scheduler in GitHub Actions. |
| Scores blended a constant `reachProxy=50`; fixture DR labelled "measured"; static query list labelled "gemini" | `score_basis = relevance_only` when authority is unverified; every event carries `engine` (model / policy / fixture / system) and the model id. |
| Google-domain login or no auth at all | Owners via Google; everyone else a guest who can run demos only — enforced by a database CHECK and a trigger. |
| 195 tests of pure functions and the heuristic paths | 50 tests: the Nebius adapter (both reasoning field names, thinking-off wire format, tool round-trip, json_schema validation, failure kinds), the policy, negotiation rules, per-owner key isolation, and the database walls under concurrency. |

## Dated log

- **2026-09-20** — Research and decision (docs/RESEARCH.md): verified Nemotron capabilities on Token
  Factory empirically (all four models: tools, tool round-trip, json_schema, streaming); official
  prices from `/v1/models?verbose=true`; found the May tool-calling report stale; measured the
  15-second auto-tick burn; found negotiation was silently broken by a duplicate foreign key.
- **2026-09-20** — Clean slate: deleted the Python service, every unrelated surface, all prior
  hackathon material and third-party defaults; one schema; `src/lib/ai/nebius.ts`; model routing;
  policy + orchestrator; guest walls; negotiation on Nano/Ultra with code-owned rules; the feed with
  model metadata.
- **2026-09-20** — Four screens; plan preview; Needs-you loop verified end-to-end (owner answers a
  call request, Super drafts the resumed reply); two full demo arcs on live Nebius (docs/LEDGER.md).
- **2026-09-20** — Tests, GitHub Actions scheduler/keepalive/CI, dependency prune (421 packages
  removed), docs.
- **2026-09-20** — Product, not a personal tool: any Google account is an owner; each owner's Nebius,
  Gmail and Tavily credentials live encrypted in Settings and every call in their campaigns runs
  under their keys (`src/lib/ai/context.ts`). Real-mode Setup takes publications you already know,
  with web search optional.
- **2026-09-20** — First real-mode run since the rebuild, sending to the author's own addresses
  (docs/LEDGER.md, Run D). It found that the scheduler never sent queued mail — the transport lived
  only behind a route nothing called. `/api/cron/tick` now ticks, sweeps IMAP and sends. Also fixed
  from that run: an outreach draft that called the product by the publication's name; a black-on-black
  active nav label; idle real campaigns spending a Super call every 20 minutes.
- **2026-09-20 (evening)** — Renamed to **Nseo**. Ten-editor real run (LEDGER Run E) with every kind
  of reply, through Gmail both ways; nine negotiation fixes from it. "You be the editor" on demo
  campaigns. Qualification moved to Super after Nano passed vendors' product pages (Run F).
  Completion winds down open threads politely.
- **2026-09-21 (night)** — The demo runs the real pipeline (real Tavily search, real pages, Super
  judging, real editor lookup; only the email transport is simulated; editors played by Nano).
  Editable plan; Next steps (your real-world to-dos); notifications; the agents as a pipeline you
  can open; Publications / Conversations / Tools tabs; for real mode: approve each first email,
  owner alerts from your own Gmail, sending hours, a never-contact list; deals you can act on (blurb
  drafted by the Writer, live, paid); run again / delete; CSV exports. Concurrency: one negotiator
  per thread (DB lock) and atomic send claims. Lint clean, production build verified, deployment
  checklist and clean-publish script.
- **2026-09-21 (morning)** — The journey. **Story & replay** tab: Super writes the campaign's story
  from the real ledger (facts computed by code, chapters by the model, cached per step, rewrite on
  demand); **Share this story** mints a read-only page at `/story/<token>` with every address
  scrubbed; **Replay** scrubs through every recorded moment with the agents lighting up and the
  numbers rolling. Faces for the agents (DiceBear bottts) and editors (notionists); Motion
  everywhere (nodding working agent, rolling numbers, staggered lists, crossfading panels, sliding
  notifications). On Setup, **"Here's what will happen"**: the campaign's journey computed by code
  from the plan, updating as the plan is edited. A **first-run tour** (three coach marks, once per
  browser) and **moments** — first reply, first deal, goal reached — shown as they happen with the
  story so far.
- **2026-09-21 (mid-morning)** — From reading a demo conversation: every editor reply is now kept
  (only the latest had been stored, so earlier messages vanished from the thread and from what the
  Negotiator read); the Negotiator counters an in-bounds price at most once and takes a floor
  ("as low as I can go") at their number — a $10 haggle was losing placements. Needs-you cards show
  the whole conversation and, when the agent held its own draft back, the draft it wanted to send.
  Pop-ups point at the exact thing — the thread, the card, the deal — which opens, scrolls into
  view and glows; each says what clicking it does.
- **2026-09-30** — A database that is still waking up no longer dead-ends a screen. A paused
  Supabase project, a resumed laptop or a restarted container answers the first request with
  PostgREST's "Could not query the database for the schema cache"; every query now waits and tries
  again (`src/lib/db/resilient.ts`), and Setup says "The database is waking up — give it a few
  seconds and try again" instead of the raw sentence. A write is only retried when the statement
  provably never ran (PGRST002); a bare 502/503 retries reads only, so nothing is applied twice.
  Verified against the real stack: with PostgREST stopped, a request issued during the outage
  returned 200 after 2.0 s.
- **2026-10-15** — A competition-grade pass, driven by research into what the hackathon rewards,
  what Google and the FTC actually require, and how agents are evaluated in practice.
  **Compliance by construction:** the agent negotiates for a qualified link (`rel="sponsored"`) and
  a visible label, attaches that condition to its own agreements, and refuses paid do-follow links,
  undisclosed coverage, links written into contracts and bought verdicts - with the citation behind
  each rule (`src/lib/compliance/policy.ts`, Safety tab).
  **Security:** inbound email is defanged (zero-width, bidi, Unicode tag block, HTML comments),
  fenced with an unguessable nonce and scanned against 13 literal rules; a reply that reads as an
  instruction stops the thread with no model call at all.
  **Evals:** `npm run eval` over a frozen hand-labelled set with 95% Wilson intervals, writing
  `docs/EVALS.md` and `public/evals.json`. It found a bad metric and three classifier weaknesses on
  its first run - triage accuracy went 60% -> 95%, escalation recall 56% -> 89%.
  **Tavily:** four endpoints instead of one (`/search` with platform exclusion and a score floor,
  `/map` + `/crawl` to find editors, `/extract` to read articles), with per-endpoint credit
  accounting and `X-Session-Id` per campaign.
  **Embeddings:** Qwen3-Embedding ranks the Judge's queue and drops same-host duplicates; the 0.92
  threshold was calibrated against real vectors.
  **Memory:** publications are remembered across campaigns - editor, ask, agreed price, link policy.
  **CAN-SPAM:** a real footer with a postal address, one-click unsubscribe (RFC 8058 POST) and
  `List-Unsubscribe` headers on first contact.
  **For judges:** a landing page and an `/evidence` page, both without sign-in.
- _(subsequent entries are added as commits land)_

## What was kept from before

The parts of the old engine that are transport, not judgment: Gmail SMTP sending and IMAP reply
detection, the contact-finding cascade for real mode, HTML fetch/readability extraction, the
role/placeholder email filters, and the pricing-tier function. They are called by the new code and
carry no model logic.
