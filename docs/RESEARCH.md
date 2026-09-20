# RESEARCH.md — Nebius x NVIDIA Global AI Hackathon migration

Research date: **2026-09-20**. Every claim below was checked against the live source named; where the brief was wrong I say so. Raw probe dumps are in the session scratchpad (`…/scratchpad/probe/*.json`, `…/scratchpad/probe2/*.json`); the probe script is `scripts/probe-nebius.mjs` (throwaway — delete before submission).

---

## C1. Dates — brief is CORRECT (one clarification)

| Item | Live source (Official Rules + overview page) |
|---|---|
| Submission period opens | **Wed Aug 26 2026, 9:00 am PT** |
| Deadline | **Fri Oct 30 2026, 10:00 am PT** (= 1:00 pm EDT as shown on the overview page — same instant) |
| Judging period | **Dec 1 2026 9:00 am PT – Dec 15 2026 12:00 pm PT** |
| Winners announced | on/around **Jan 11 2027** |
| Updates page | 6 posts (kickoff tips, build-session recordings, "how judging works"). **No extension, no rule change, no credit change.** |

Implication the brief missed: the project must stay **up and free** through **Dec 15** — 6½ weeks after the deadline. Credits and hosting must last until then, not just until Oct 30.

## C2. Eligibility — brief is CORRECT; three things it missed

Verified verbatim from the Rules page:

- "Entrants must create a working software application that runs on either Nebius Token Factory or Nebius AI Cloud and uses at least one NVIDIA open source model." "Runs on" = "makes a runtime call to the Token Factory inference API, or is deployed/run using Nebius AI Cloud compute (Serverless Jobs, Serverless Endpoints, or DevPods)."
- Public repo with "an open source license (such as Apache 2.0, MIT, or MPL 2.0), visible at the top of the repository page" — i.e. GitHub must *detect* it (a root `LICENSE` file; ours exists, but see PROVENANCE.md).
- README "with setup instructions and clear guidance for running your project."
- Demo: "a URL to a working demo, hosted application, or test build."
- Video: "3-minute or shorter public YouTube video showing your project working, with audio covering how you used Nebius Token Factory and NVIDIA Nemotron or other NVIDIA open source models."
- Availability: "make the Project available free of charge and without any restriction, for testing, evaluation and use by the Sponsor, Administrator and Judges until the Judging Period ends."

**Missed by the brief:**
1. **Text description** is a required submission component ("what you created, why, how it works").
2. **Feedback on Nebius Token Factory / AI Cloud / NVIDIA tools** is a listed submission item (also feeds the $100 "Most Valuable Feedback" awards).
3. README must "highlight how you've used NVIDIA Nemotron…, where Token Factory accelerated your workflow, and any other Nebius Tools or Services used."
4. Stage-one judging is pass/fail on "fits theme and applies required APIs/SDKs"; stage two is four equal criteria: Technological Implementation, Design, Potential Impact, Quality of the Idea — the first and last both explicitly score "how effectively" Token Factory + Nemotron are used.

## C3. Tavily bonus — brief is CORRECT

- "$3,000 Best Use of Tavily … All Eligible Submissions that make a functional, runtime call to the Tavily API as part of its solution."
- "Each Project is eligible for one (1) Overall Award OR one (1) Track Award and one (1) Bonus Award." (Overall and Track are mutually exclusive; a Bonus stacks on either.)
- **Operational finding:** the Tavily key in `.env.local` is **exhausted** — `GET https://api.tavily.com/usage` → `plan_usage: 1001 / plan_limit: 1000` on the free "Researcher" plan; search returns HTTP 432. Live discovery in the app is therefore dead today. The Builders Program grants **$25 Tavily credit** (see C8). Also: Tavily docs now show `Authorization: Bearer tvly-…`; `src/lib/search/webSearch.ts` still sends `api_key` in the JSON body — both forms returned the same quota error, so the body form is still accepted, but switch to the header form.

## C4. Pre-existing projects — brief is CORRECT; exact wording

Rules: "Projects must be either newly created by the Entrant or, if the Entrant's Project existed prior to the Hackathon Submission Period, must have been significantly updated after the start of the Hackathon Submission Period."
Submission list: "If your project existed before the Submission Period, include a written explanation of what was significantly updated during the Submission Period."
There is **no definition of "significantly"**. Our repo's first commit is Aug 22 (4 days *before* the window opened); the entire Strands/AWS layer predates Aug 26 too. The Nebius migration itself will be the "significant update" and must be documented as such.

## C5. Nemotron capability matrix — brief is PARTLY WRONG (stale)

Source of the claim: `nebius/api#211` (opened 2026-05-08, still **open**). A maintainer-adjacent comment on 2026-06-07 retested and reported 5/6 models fixed. I did not trust either; probe results below are from **our key, today**.

Method: `scripts/probe-nebius.mjs`, global host, `temperature:0`, `max_tokens:600` (then a follow-up with `enable_thinking:false` and larger budgets). One tool (`get_domain_rating`), one `json_schema`, one `json_object`, one stream, and a full tool **round-trip** (tool result fed back, expect a final answer). Total spend ≈ **$0.0075**.

### Matrix (global host `https://api.tokenfactory.nebius.com/v1`)

| Model ID (from `GET /v1/models`) | plain | reasoning field | tool_call (thinking on, 600 tok) | tool_call (`enable_thinking:false`) | tool round-trip | json_schema (thinking on) | json_schema (`enable_thinking:false`) | json_object | stream | latency plain/tool/json | features advertised |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `nvidia/nemotron-3-super-120b-a12b` | ✅ "391" | `reasoning_content` (+ mirror `reasoning`) | ✅ structured `tool_calls` | ✅ (37 tok, 1.6 s) | ✅ | ✅ valid | ✅ (109 tok) | ✅ | ✅ 23 chunks, TTFB 590 ms | 0.9 / 1.0 / 1.7 s | tools, reasoning |
| `nvidia/Nemotron-3-Ultra-550b-a55b` | ✅ | `reasoning_content` | ✅ | (not tested — expensive) | ✅ | ✅ (358 reasoning tok) | — | ✅ | ✅ 11 chunks, TTFB 634 ms | 0.7 / 0.8 / 1.7 s | tools, reasoning |
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | ✅ | **`reasoning`** (no `reasoning_content` key) | ⚠️ `finish_reason: length` at 600 tok — reasoning ate the budget; **✅ at 2000 tok** (285 tok) | ✅ **26 tok, 0.47 s** | ✅ | ✅ | ✅ (58 tok) | ✅ | ✅ 60 chunks, TTFB 223 ms | 0.7 / 4.9 / 2.2 s | tools, reasoning |
| `nvidia/Nemotron-3_5-Lightning` (new, not in #211) | ✅ | `reasoning_content` | ✅ | ✅ 26 tok, 0.29 s | ✅ | ⚠️ at 600 tok: **thinking leaked into `content`**, no JSON, `finish=length`; **✅ at 3000 tok** (1136 tok) | ✅ (101 tok, 0.54 s) | same as json_schema | ✅ 159 chunks, TTFB 223 ms | 1.4 / 0.3 / 2.4 s | tools, reasoning |
| control `openai/gpt-oss-120b` (today's Groq model) | ✅ | `reasoning` | ✅ | — | ✅ | ✅ | — | ✅ | ✅ TTFB 185 ms | 0.3 / 0.3 / 0.6 s | tools, json_mode, structured_outputs, reasoning |

### Verdict on the brief's claims
- "empty `content` + populated `reasoning_content`": **NOT true today** for any of the 4 Nemotrons on a plain prompt. It *does* happen on Nano/Lightning when `max_tokens` is too small for the thinking trace (finish_reason `length`), and on Lightning the truncated thinking lands in `content`. This is a budget problem, not a wrapper bug.
- "400 errors on tool calls": **NOT true today**. All four returned HTTP 200 with structured `tool_calls`, and all four completed a tool round-trip.
- The two models #211 still flags (`Llama-3_1-Nemotron-Ultra-253B-v1`, `Cosmos3-Super-Reasoner`) and `Nemotron-3-Nano-Omni` are **not on our key's `/v1/models` at all** — irrelevant.

### Design rules derived from the matrix (not from the brief)
1. Read `message.content`; treat `reasoning_content` **or** `reasoning` as optional (Nano uses the latter). Never assume the field name.
2. For every "fast everyday" call (relevance scoring, opener drafting, reply classification, follow-ups) send `chat_template_kwargs: { enable_thinking: false }` on Nano or Lightning → 26–110 completion tokens, ~0.3–0.7 s.
3. When thinking is on, set `max_tokens ≥ 2000` (Nano) / `≥ 3000` (Lightning) or you'll get truncated traces.
4. `response_format: json_schema` works on all four *without* being advertised in `supported_features` — but pair it with thinking-off or a large budget.
5. Strands `OpenAIModel(base_url="https://api.tokenfactory.nebius.com/v1/")` is the documented integration (`pip install 'strands-agents[openai]'`); pass `params={"extra_body": {"chat_template_kwargs": {...}}}` if you want thinking-off there. The URL in the brief (`…/documentation/docs/community/model-providers/…`) is dead; the live page is `https://strandsagents.com/docs/integrations/model-providers/nebius-token-factory/`.

## C6. Base URL / regional host — brief CORRECT, with data

| Host | `/v1/models` | TTFB from this machine | models visible |
|---|---|---|---|
| `https://api.tokenfactory.nebius.com/v1` (documented) | 200 | 0.82 s | **24** |
| `https://api.tokenfactory.us-central1.nebius.com/v1` | 200 | **0.28 s** | 17 (missing DeepSeek-V4-Pro/V4.1-Flash, Kimi-K3, GLM-5.2/5.3/5.3-Flash) |
| `https://api.studio.nebius.com/v1` (legacy name) | 200 | 0.77 s | (not compared) |

Auth: `Authorization: Bearer <key>` on all three. The same key works everywhere. `?verbose=true` on `/v1/models` returns pricing, per-model RPM/TPM, the **serving region** and `supported_features` — use it instead of blog posts. All four Nemotrons are visible on both hosts; Super and Ultra are served from `us-central1`, Nano and Lightning from `eu-north1`. **Recommendation:** use the documented global host (it is what the rules/docs name and what judges will grep for); the ~0.5 s TTFB difference on `/models` is a control-plane call, not inference.

## C7. Real Nemotron model IDs (from `GET /v1/models`, 2026-09-20)

```
nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B     ctx 262,144   eu-north1     RPM 100 / TPM 800k
nvidia/Nemotron-3_5-Lightning             ctx 1,048,576 eu-north1     RPM 600 / TPM 400k   (not in the brief; newest)
nvidia/nemotron-3-super-120b-a12b         ctx 262,144   us-central1   RPM 300 / TPM 200k
nvidia/Nemotron-3-Ultra-550b-a55b         ctx 1,048,576 us-central1   RPM 300 / TPM 200k
```
The hackathon copy says "Reach for Nemotron 3 Ultra when you need serious reasoning, and let Nano or Super handle the fast, everyday calls." Note the casing inconsistency (`NVIDIA-Nemotron-…`, `Nemotron-…`, `nemotron-…`) — copy IDs verbatim; never normalise.

## C8. Pricing and credit budget

### Official Nebius prices (from `/v1/models?verbose=true`, USD per 1M tokens)
| Model | input | output | notes |
|---|---|---|---|
| Nemotron 3 Nano 30B | **$0.06** | **$0.24** | cheapest; RPM only 100 |
| Nemotron 3.5 Lightning | **$0.06** | **$0.24** | same price, 1M ctx, RPM 600 |
| Nemotron 3 Super 120B | **$0.30** | **$0.90** | (brief/OpenRouter "$0.08/$0.45" is DeepInfra, not Nebius) |
| Nemotron 3 Ultra 550B | **$1.00** | **$3.00** | (OpenRouter shows $0.50–0.60/$2.20–2.40 on *other* providers; Nebius is 1.0/3.0) |
| gpt-oss-120b (control) | $0.15 | $0.60 | |
| Qwen3-30B-A3B-Instruct | $0.10 | $0.30 | non-NVIDIA — not eligible as "the" model |

Rate limits: 429 with `Retry-After`; limits auto-scale ×1.2 after 15 min at ≥80% usage, up to 20× base.

### Credits
Resources page: **$25** Token Factory via promo form (code `NEBIUS-DEVPOST-GLOBAL26` at nebius.com/promo-code) **+ $25** via the Builders Program (which also gives **$25 Tavily**, $100 LangSmith, $100 Toloka). Brief's "~$50" matches if both are claimed. **Expiry is not stated anywhere I could find — ask in Discord**; the judging window is Dec 1–15.

### Measured token profile of one campaign tick (Strands service)
- Root agent system prompt: 1,287 chars (~320 tok). Tool surface: **17 tools** (10 real + 7 `as_tool()` sub-agents) = 6,167 chars of JSON schema (**~1,550 tok every turn**).
- State prompt ~350 tok. Strands default `SlidingWindowConversationManager(window_size=40)` keeps ~10 ticks of history (~4 messages/tick × ~300 tok) ≈ **10–12k tok** of history at steady state.
- Each tick = 2 model turns (tool call, then summary). Steady-state ≈ **28k prompt + 0.6–1.5k completion per tick** on the orchestrator alone.
- In-tool TS calls per busy tick (relevance ×8, opener ×5, classify/draft per reply) ≈ 15k prompt / 3k completion — negligible on Nano-nothink.
- Evidence of the burn: `agents/.strands_sessions/session_campaign-7f658736…` holds **1,739 message files (7.7 MB)** — one campaign was ticked ~870 times by the browser's 15 s timer.

### Cost per tick (orchestrator + tools) and burn at the current 15 s browser auto-tick
| Orchestrator model | $/tick | $/hour with a campaign page open (240 ticks) | hours of $50 |
|---|---|---|---|
| Super (thinking on) | ≈ $0.010 | ≈ $2.40 | ≈ 21 h |
| Ultra | ≈ $0.033 | ≈ $7.90 | ≈ 6 h |
| Nano / Lightning (thinking off) | ≈ $0.002 | ≈ $0.50 | ≈ 100 h |

Note the orchestrator invokes the model **on every tick, including no-op monitoring ticks** (`orchestrator.py::tick` only short-circuits on emergency stop / terminal phase).

### 🔴 BLOCKER — auto-tick
`src/app/(app)/campaigns/[id]/page.tsx:150-158` fires `POST /tick` every **15 s** while the page is open; `/api/cron/tick` can also be pointed at a 30–60 s external cron (the route's own comment suggests it). A judge who leaves one tab open overnight on Super costs **$29**; on Ultra **$95**.

**Proposed fix (to implement after GO):**
1. Remove the browser interval entirely. UI gets a **"Run next step"** button (rate-limited server-side to 1 per 20 s per campaign) plus a read-only auto-refresh of state.
2. Server-side scheduler (Vercel cron / QStash) with **phase-aware interval**: planning→outreaching every **3 min**; monitoring every **20 min** *or* event-driven when the IMAP sweep records a new reply; completed/stopped never.
3. **Skip the model when the deterministic policy has nothing to do** (no `discovered` to qualify, no `ready` to send, no unanswered replies) — record a `policy_noop` event instead of paying for a "nothing to do" summary.
4. Hard caps in code: `max_ticks_per_campaign_per_day` (default 120), global `NEBIUS_DAILY_TOKEN_BUDGET` accumulated from `usage` in every response and stored in `app_settings`; on breach, campaigns pause with a visible banner (this doubles as the "Nebius unreachable → stop" behaviour in P5).
5. Model routing: **Super** for the campaign-manager turn (thinking on, `max_tokens` 1500); **Nano or Lightning with thinking off** for relevance/opener/classify/follow-up; **Ultra** only for negotiation counter-offer drafting (≤ 20 calls per campaign) so the "Ultra for serious reasoning" story is true and cheap.
6. Shrink the tool surface for the tick loop (drop the 7 `as_tool()` duplicates from the *tick* agent; keep them for the narrative/observability view) → −1k tok/turn.

### Recommended budget (≈ $50, 5 weeks + judging)
| Bucket | Assumption | Cost |
|---|---|---|
| Development & probing | ~800 ticks Super-routed + tool calls | ≈ $10 |
| Demo video capture | 3 full demo campaigns | ≈ $1 |
| Public demo, Sep 20 → Oct 30 | 20 stranger campaigns × 40 ticks | ≈ $8 |
| Judging Dec 1–15 | 30 judge campaigns × 40 ticks + slack | ≈ $12 |
| Reserve | | ≈ $19 |
With the fixes above, budget is comfortable. Without them, it is not.

---

## Other verified items

- **Strands provider**: `OpenAIModel` with Nebius `base_url` is the officially documented path — no code change to the agent framework needed, only `MODEL_PROVIDER=nebius` plumbing. (`agents/seo_workforce/agents.py` already builds `OpenAIModel` for Groq; the Nebius case is ~10 lines.)
- **Gemini config claim (P4)**: the brief says `gemini-3.6-flash` + the `AQ.…` key "was probably never executed". **Wrong** — one live call returned HTTP 200 with a valid answer (it is a Vertex-style "AQ." key, not an AI Studio `AIza` key). It's still a burned key (see ROTATION.md) and it goes away in P5 anyway.
- **Project gallery**: not published yet — no competitor signal available.
- **Nebius Serverless (Endpoints/Jobs)**: part of **Nebius AI Cloud**, per-second usage billing, containerised workloads, "available in all AI Cloud regions". It is a separate product/billing from Token Factory; the hackathon credits are Token Factory only. See GO_NO_GO.md for the effort estimate.
