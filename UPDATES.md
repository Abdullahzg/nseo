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
| 195 tests of pure functions and the heuristic paths | 44 tests: the Nebius adapter (both reasoning field names, thinking-off wire format, tool round-trip, json_schema validation, failure kinds), the policy, negotiation rules, and the database walls under concurrency. |

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
- _(subsequent entries are added as commits land)_

## What was kept from before

The parts of the old engine that are transport, not judgment: Gmail SMTP sending and IMAP reply
detection, the contact-finding cascade for real mode, HTML fetch/readability extraction, the
role/placeholder email filters, and the pricing-tier function. They are called by the new code and
carry no model logic.
