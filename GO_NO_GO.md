# GO / NO-GO — Nebius x NVIDIA hackathon migration (2026-09-20, 40 days to deadline)

## Recommendation: **CONDITIONAL GO** — technically sound, blocked on two non-technical decisions that are yours

**Technically the migration is small and low-risk.** All four Nemotron models on Token Factory pass tool calling, tool round-trips, `json_schema`, `json_object` and streaming today (RESEARCH.md §C5; the May bug report is stale). Strands' documented Nebius path is `OpenAIModel(base_url=…tokenfactory…)` — the exact class `agents.py` already uses for Groq. The TS side has one LLM adapter (`src/lib/ai/gemini.ts`) that every campaign call goes through. Estimated migration effort for the *model layer*: **1–2 days**.

**What actually decides GO/NO-GO:**

| # | Blocker | Owner | Status |
|---|---|---|---|
| 1 | **IP ownership** (PROVENANCE.md). ~75 % of files are the unmodified Vyro-era baseline and the new layer cannot run without them. Rules require "solely owned… no other person or entity having any right or interest." | **You** (and whoever can speak for Vyro) | ⛔ Unresolved. I made no legal call. If you had/get written permission to reuse and relicense, it's a GO with a disclosure paragraph; if not, this repo cannot be the submission. |
| 2 | **Secrets in pushed history** (ROTATION.md). Full Gemini key + `CRON_SECRET` in `2e63454` on `origin/master`; `CRON_SECRET` still in HEAD. Repo is private today. | You rotate; I need your OK to rewrite/republish | ⛔ Rotate 9 keys, then publish a fresh clean repo (recommended) or `filter-repo`. |
| 3 | **15-second browser auto-tick** would burn $2.40/h (Super) – $7.90/h (Ultra) per open tab; one session already ran ~870 ticks. | Me, after GO | 🔴 Fix designed (RESEARCH.md §C8): server-side phase-aware scheduler, no model call on no-op ticks, daily caps + global token budget guard, manual "Run next step". |
| 4 | Tavily key exhausted (1001/1000) → discovery is dead; Builders Program gives $25 Tavily + $25 TF. | You (claim credits) | 🟠 15 min. |

## Track (P8): **Best Apps and Agents — agree.** Reasoning
- Coding & Agentic Engineering requires "agents that write, run, and test code in Token Factory Sandboxes" — we don't touch code or Sandboxes.
- Personal AI wants "always-on, private assistant… your data under your control" with NemoClaw/OpenShell/Hermes Agent — ours is a multi-tenant outreach workflow, not a personal assistant (our `hermes/` folder is an unrelated namesake).
- Physical AI — no hardware.
- Best Apps & Agents: "a workflow that runs itself… Power it with Nemotron… Ultra for serious reasoning, Nano/Super for fast everyday calls" — that is literally our architecture after routing (Super = campaign manager, Nano/Lightning thinking-off = tool calls, Ultra = negotiation counters). The "not just a technical proof of concept" Design criterion favours a full product UI, which we have.

## Nebius Serverless (Endpoints / Jobs) — honest effort estimates
Serverless AI is a **Nebius AI Cloud** product (separate account & per-second billing; hackathon credits are Token Factory only — I could not find any AI Cloud credit in the resources). "Encouraged, not required."
- **Python Strands service on a Serverless Endpoint:** containerise (`agents/Dockerfile` exists) → push to registry → create endpoint → wire `AGENT_SERVICE_URL`. **2–3 days** including auth/secret plumbing and cold-start tuning, *if* an AI Cloud account with credit exists. Cost unknown until you see the AI Cloud price list; a CPU-only container idling for the Dec judging window is the risk.
- **Campaign ticks as Serverless Jobs:** a job-runner script that pulls active campaigns and POSTs `/tick`, triggered by a scheduler. **2–4 days** plus scheduler wiring; overlaps with the tick-scheduler rewrite we need anyway, so marginal cost ~1–2 days.
- **Recommendation:** ship Vercel (Next.js) + a small always-on host for the Python service first; attempt the Serverless Endpoint **only after** the demo is stable (week 4), and only if AI Cloud credits are confirmed. It's a judging bonus, not a gate.

## Inventory of what must change (no code touched yet)
- **P3 wrong-hackathon artefacts:** 11 root docs (`GESEO_*`, `GSEO_DOCUMENTATION`, `AGENT_REPLY_DOCUMENT`, `STRANDS_MIGRATION_REPORT`, `PROJECT_HANDOFF`, `LOCAL_VALIDATION_REPORT`, `Migrate GenAI Scout…`, `HOW_TO_USE`, `Fix Local Supabase Startup`, `CHANGES`, `DOCUMENTATION`), `docs/{HACKATHON_REQUIREMENTS,PREEXISTING_WORK,ARCHITECTURE,AGENT_DESIGN,DEPLOYMENT,DEMO}.md` (rewrite), `README.md` (rewrite), `HACKATHON_MODE`/`REQUIRE_STRANDS`/`ALLOW_ORCHESTRATOR_FALLBACK`/Bedrock/`STRANDS_MODEL_ID`/`AWS_REGION` in `.env.example`, `agents/seo_workforce/{config,agents,orchestrator,main}.py`, `src/app/api/campaigns/[id]/tick/route.ts`, `src/lib/campaign/fallbackOrchestrator.ts`, `tests/hackathon-failure.test.ts`, `scripts/{start,stop,test}-local.ps1`, `scripts/*strands*`, `deploy/deploy.sh` (GCP), `.github/workflows/*` (Vyro Vercel). The "503 fail-visibly" mode becomes the P5 Nebius-unreachable banner.
- **P4 findings:** (a) Ports: `.env.local` says 3001 (APP_URL, AGENT_BASE_URL) and 3000 (NEXT_PUBLIC_BASE_URL); code fallbacks say 3100 (`cron/tick`, `outreach.ts`) and 3000 (`sendProcessor`, harvesters, settings page); scripts/docs say 3100; Playwright 3001; `.claude/launch.json` 3000. **Pick 3000** (Next default; fewest edits: 2 code fallbacks, 3 scripts, HOW_TO_USE, playwright, .env.local). (b) The Gemini `AQ.` key + `gemini-3.6-flash` **does work** (HTTP 200) — that claim was wrong; still burned, still removed in P5. (c) Silent heuristic substitutions found at: `tools.ts::evaluateProspect` (relevance → keyword heuristic, labelled `source:"heuristic"` in breakdown but the *score* still looks real), `tools.ts::planDiscoveryQueries` → `pipeline/queries.ts` (**only calls an LLM if `OPENROUTER_API_KEY` is set**, else a static query list, while `llmProviderName()` labels it "gemini"), `outreach.ts::draftOutreachEmail` (canned opener + canned body, `provider:"fallback-template"`), `negotiation/agent.ts::classifyReplyIntent` (regex classifier on any LLM failure), `negotiation/run.ts` (`heuristicOnly` for demo), `extract/relevance.ts`. All must become loud failures + UI badges. (d) Vitest: **195 passing, zero `vi.mock`** — but it only imports pure functions and the heuristic paths (`classifyReplyIntentHeuristicOnly`, `maxOfferFor`, `qualifyProspect`, filters); `hackathon-failure.test.ts` asserts env-flag behaviour; nothing exercises the orchestrator, tools, DB, tick route or Strands. Green ≠ tested.
- **P5:** delete `gemini/openrouter/groq/bedrock` branches in `src/lib/ai/gemini.ts` (rename to `nebius.ts`), `agents/seo_workforce/agents.py::_build_model`, `src/app/api/settings/ai`, `src/components/settings/AIProvider.tsx`, `scripts/063_app_settings.mjs`/`064_groq_settings.mjs` columns, `.env.example` vars; add a `nebius_status` health check + banner (`KeyHealthBanner` already exists).
- **P6:** DR/traffic/US-share already flow as `null → "unverified"` in `score_breakdown`; the UI (`campaigns/[id]/page.tsx`, `ProspectTable.tsx`) must render "unverified" and the opportunity score must be labelled "relevance-only" when authority is null. Also drop the `reachProxy = 50` constant that inflates every score.
- **P7 guest mode design:** keep Google OAuth for the owner; add a `GUEST_MODE=1` path where `identifyCaller` returns `{kind:"guest", id:<cookie>}`; guests can create **demo-mode campaigns only**, capped at 2 concurrent / 5 per day per guest cookie and 20/day global; guests cannot reach Settings, Inbox send, or real-send toggles; all guest campaigns auto-stop after 60 ticks; a global token budget (P3 item) hard-stops everything. Real SMTP/IMAP stays owner-only, so a stranger can never send email from your Gmail.

## Timeline if GO is given this week
| Week | Work |
|---|---|
| 1 (Sep 22–28) | Rotate secrets; strip Vyro/AWS artefacts; fresh public repo; port fix; Nebius adapter (TS + Strands); loud-failure refactor; tick scheduler + budget guard |
| 2 | Guest mode; unverified-metrics UI; P6; README/ARCHITECTURE rewrite; "what changed since Aug 26" write-up |
| 3 | Real integration tests (tools → Nebius), Playwright on the public demo, Tavily via Builders credit, feedback doc |
| 4 | Serverless Endpoint attempt (optional); video; submission text; buffer |
| Oct 30 | Submit. Keep demo alive to Dec 15. |

**Stopping here as instructed. Nothing in the codebase was modified except: `RESEARCH.md`, `PROVENANCE.md`, `ROTATION.md`, `GO_NO_GO.md`, `CODEBASE_GUIDE.md` (earlier) and the throwaway `scripts/probe-nebius.mjs`.**
