# BLUEPRINT.md — the full outline of what gets built (from the build brief)

Source of truth for scope. Facts come from RESEARCH.md / PLATFORM.md / FLOW_CHECK.md; product decisions come from the build brief. Anything marked **ASK** is a place where I need your answer before building.

---

## 1. Target repository (≈ 150 files)

```
geseo/
├─ LICENSE (MIT)  README.md  UPDATES.md  DEPLOY.md  FEEDBACK.md  SUBMISSION.md  .env.example
├─ package.json  next.config.ts  tsconfig.json  vercel.json (daily keepalive cron only)  playwright.config.ts  vitest.config.ts
├─ .github/workflows/
│  ├─ tick.yml        schedule */5 * * * * → POST $APP_URL/api/cron/tick  (Bearer CRON_SECRET)
│  ├─ keepalive.yml   daily → GET $APP_URL/api/health?deep=1  (Supabase select + Upstash ping)
│  └─ ci.yml          push → tsc, vitest, next build
├─ supabase/
│  ├─ config.toml
│  └─ migrations/0001_schema.sql        ONE file: every table the campaign flow uses, RLS, indexes, the guest CHECK
├─ src/
│  ├─ proxy.ts                          auth gate: owner (Google) | guest cookie | machine tokens
│  ├─ auth.ts                           NextAuth v5 Google (owner only)
│  ├─ app/
│  │  ├─ layout.tsx  globals.css  page.tsx (→ redirect /setup for guests, /campaigns for owner)
│  │  ├─ (app)/layout.tsx               nav: Setup · Campaign · Needs you (badge) · Deals  (+ Settings, owner only)
│  │  ├─ (app)/setup/page.tsx           screen 1
│  │  ├─ (app)/campaigns/page.tsx       list (only if >1 campaign; else redirects to the active one)
│  │  ├─ (app)/campaigns/[id]/page.tsx  screen 2
│  │  ├─ (app)/needs-you/page.tsx       screen 3
│  │  ├─ (app)/deals/page.tsx           screen 4
│  │  ├─ (app)/settings/page.tsx        owner only: Gmail app password, Nebius/Tavily key health, budget guard
│  │  ├─ login/page.tsx
│  │  └─ api/
│  │     ├─ auth/[...nextauth]/route.ts
│  │     ├─ guest/route.ts                POST → issue guest cookie (rate-limited)
│  │     ├─ campaigns/route.ts            GET list · POST create (+ plan preview when ?preview=1)
│  │     ├─ campaigns/[id]/route.ts       GET state · PATCH controls (pause/resume/stop) · DELETE
│  │     ├─ campaigns/[id]/tick/route.ts  POST one bounded unit (locked, capped, ≤45 s)
│  │     ├─ campaigns/[id]/feed/route.ts  GET human-readable activity (paged, after_id)
│  │     ├─ interventions/route.ts        GET queue · POST {id, answer}
│  │     ├─ deals/route.ts                GET
│  │     ├─ cron/tick/route.ts            GET/POST fan-out to due campaigns (phase-aware intervals)
│  │     ├─ emails/process/route.ts       owner-only real sender (SMTP burst + IMAP sweep), unchanged core
│  │     ├─ track/open/route.ts
│  │     ├─ health/route.ts               ?deep=1 → DB, Redis, Nebius /models, Tavily /usage
│  │     └─ settings/route.ts             owner only
│  ├─ components/
│  │  ├─ ui/*                             shadcn primitives (trimmed to what's used)
│  │  ├─ setup/{SetupForm,PlanPreview,ModeToggle}.tsx
│  │  ├─ campaign/{StatusSentence,FunnelNumbers,BudgetBar,ActivityFeed,ActivityRow,ReasoningDrawer,NebiusBanner}.tsx
│  │  ├─ needs-you/{InterventionCard,AnswerBox,EmptyState}.tsx
│  │  ├─ deals/{DealsTable,SavingsSummary}.tsx
│  │  └─ layout/{Nav,GuestBadge,PageShell}.tsx
│  └─ lib/
│     ├─ ai/nebius.ts                     THE adapter (see §5)
│     ├─ ai/models.ts                     build-time model list + routing table
│     ├─ campaign/{types,queries,policy,orchestrator,tools,outreach,demo,feed,budget}.ts
│     ├─ negotiation/{classify,draft,pricing,settings,run}.ts
│     ├─ enrich/{cascade,pageSignals,patternInfer,personFilter,verify,hunter,blitz,enrichso,domainRating}.ts  (kept: real mode needs them)
│     ├─ email/{smtp,imap,deliver,followup,schedule,roleEmail}.ts   (kept, owner-only)
│     ├─ extract/{fetch,readability,metadata}.ts   (plain fetch; PLAYWRIGHT_ENABLED=false)
│     ├─ search/{tavily,tavilyUsage}.ts          Bearer header
│     ├─ score/qualify.ts
│     ├─ db/{supabase,queries}.ts                queries.ts trimmed to campaign-flow functions
│     ├─ auth/{service,guest,admin}.ts
│     ├─ guard/{tickLock,caps,tokenBudget}.ts
│     ├─ redis.ts  crypto.ts  utils.ts  util/{domain,url}.ts
│     └─ events.ts                        recordEvent + human-readable renderer
├─ tests/  (vitest: nebius adapter, orchestrator transitions, budget concurrency, send gates, guest block, feed renderer)
├─ e2e/    (playwright against the deployed URL)
└─ scripts/{ledger-run.mjs, demo-arc.mjs}
```

**Deleted (Phase 1.3):** `agents/`, `hermes/`, `deploy/`, `docs/seo-department/`, `config/seeds.ts`, `DOCUMENTATION.md`, `seo_email-main.zip`, all `GESEO_*`/`GSEO_*`/`PROJECT_HANDOFF`/`STRANDS_*`/`AGENT_REPLY_*`/`LOCAL_VALIDATION_*`/`Migrate…`/`Fix Local…`/`HOW_TO_USE`/`CHANGES`/`DEPLOYMENT`/`DEPLOY`(old) docs, `docs/*` except what's rewritten, `Dockerfile`, `agents/Dockerfile`, `.github/workflows/{prod,droplet}.yaml`, `migrations/001_initial.sql` + `scripts/0NN_*.mjs` (58), `src/lib/{backlinks,writer,blog,strapi,indexing,linkaudit,seo-agents,media,landing,calendar,digest,adoption,learn,sitemap,pipeline,harvesters,health,hermes,agent}`, `src/lib/ai/gemini.ts`, `src/lib/campaign/fallbackOrchestrator.ts`, all `src/app/(app)/{admin,backlinks,blog,email-finder,emails,handbook,inbox,indexing,link-audit,media,negotiation,notifications,payments,sending,seo-agents,site-audit,workflows,agent-runs,campaigns/{autonomous,compare,new}}`, all `src/app/api/{admin,agent,agent-runs,authors,backlinks,blog,digest,discover,email-templates,emails/*(except process),enrich,export,harvesters,hermes,inbox,inbox-accounts,indexing,landing,learned-sources,link-audit,media,negotiation,notifications,outreach,payments,pipeline,prospects,reprocess,score-stats,seeds,seo-agents,shared-senders,sitemap,sitemap-qa,slack,suppression,usage,user,workflows}`, `src/components/{admin,backlinks,blog,dashboard,landing,pipeline,prospects,site-audit,settings/*(except UserEmailConfig)}`, `tests/*` (rewritten), `evaluation/`, `scripts/probe-nebius.mjs`.
**ASK-1:** the *Inbox* (read/reply to a real human) is not one of the four screens. In real mode a reply that isn't an intervention just gets answered by the agent; a human who wants to take over a thread does it from the Needs-You card ("take over"). Confirm you're OK losing the standalone inbox.

## 2. The four screens — states, data, components

### (1) SETUP `/setup`  (≤ 400 lines incl. components)
- Fields: `website_url` · `what_you_sell` (1 line) · `keywords[3–5]` (chips) · `desired_deals` · `budget_total` · `max_per_deal`. Mode toggle **Demo (default)** / Real. Demo is pre-filled (example site, 3 keywords, 2 deals, $800/$250) → one click.
- Derived/defaulted (never shown): objective sentence, `min_dr=50`, autonomy `autonomous`, template = built-in, currency USD, region any.
- **Plan preview** (`POST /api/campaigns?preview=1`, one Nano call, thinking-off, `json_schema`): "I'll search for ~40 publications about {keywords}, keep the ones with real traffic and topical fit, find a human editor at each, email them, and negotiate up to ${max_per_deal} each. I'll stop at {desired_deals} deals or when ${budget_total} runs out. I'll ask you before anything unusual." Rendered from the *validated* JSON; if Nebius is down the page shows the Nebius banner and Launch is disabled — no canned sentence.
- Validation: URL parses, 3–5 keywords, `max_per_deal ≤ budget_total`, Real mode only for owner with a verified Gmail app password (else the toggle is disabled with the reason).
- States: idle · previewing (button spinner ≤ 5 s, then "Plan is taking longer than usual — retry") · launching · error (message + what to do) · guest-capped ("You've launched 5 demos today; come back tomorrow").
- On launch: create → start → redirect to `/campaigns/{id}`; in demo mode the page itself drives ticks via **"Run next step"** auto-pressed every 20 s while the tab is open **and** the campaign is active and ≤ 60 ticks (demo only — real mode never auto-ticks from the browser).

### (2) CAMPAIGN `/campaigns/[id]`
- Above the fold: **one sentence** (`status_sentence`, generated by deterministic code from counts+phase, NOT by the model — it must be true even when Nebius is down), then four numbers **found / contacted / replied / deals**, then the budget bar (`used / total`, reserved shown hatched).
- Activity feed (`GET /feed?after_id=`), newest first, one line each, rendered from `agent_events.human` (written at event time by `lib/events.ts`); examples in the brief. Expand → `ReasoningDrawer`: model id, tokens in/out, latency, and the `reasoning` string (`reasoning_content`/`reasoning`, truncated to 2 k chars, never raw JSON).
- Controls: Pause / Resume / Stop (confirm) · "Run next step" (demo only, rate-limited 1/20 s) · Nebius/budget banner when paused by the guard.
- Not here: stepper, agent board, raw JSON, ledger table, template editor, CSV import.
- States: loading skeleton (≤ 1 s) · live · paused-by-you · paused-by-guard (why + what to do) · completed (summary + link to Deals) · failed (last error + "retry step").
- Polling: state every 15 s while tab visible (`visibilitychange` stops it).

### (3) NEEDS YOU `/needs-you`
- Card = editor's words (quoted) · what the agent wants to do · what it needs from you · one text box · [Answer & resume] [Take over thread] [Dismiss]. Types: `sync_contact, scheduling, asset_request, payment_details, factual_question, legal_contract, over_policy/budget_exception, thread_limit, other`.
- Answer → `POST /api/interventions {id, answer}` → same thread resumes with `assist_input` (Ultra or Super draft) → card moves to "Resolved" with the sent reply.
- Empty state: "Nothing needs you. {n} conversations in progress." Nav badge = open count (fetched with the layout, 30 s).
- Demo must produce ≥ 1 intervention: the `meeting_request` persona is classified by **Nemotron** (not the regex) — the ledger will show whether it reliably yields `needs_human/sync_contact`; if not, the persona text gets sharpened ("can we hop on a 15-minute call?"), never the classifier faked.

### (4) DEALS `/deals`
- Table: publication · placement type · asked · paid · saved · status · agreed date. Header: total saved, deals / goal, spend / budget. Empty: "No deals yet — {n} conversations in progress."
- `original_ask` is now **always** recorded (first price the publisher named).

### Global rules
- Visual direction: **ASK-2** — `/mnt/skills/public/frontend-design/SKILL.md` does not exist on this machine (Windows; no `/mnt`). I have `artifact-design` (for artifacts) but no frontend-design skill. Tell me where that skill lives, or approve a direction now: warm off-white paper, one ink colour, one accent (deal-green), Inter + a serif for the status sentence, generous whitespace, no cards-in-cards. Same on all four screens; mobile-first grid.
- Numbers: DR/traffic null → "unverified"; score with null authority → `score_basis: "relevance_only"` in the row and a "relevance only" chip.
- Every error state: what broke + what to do. Every list: real empty state.

## 3. Guest access (structural)
- Cookie `geseo_guest` (signed, 30 d). `identifyCaller` → `{kind:"guest", id}`.
- **DB:** `campaigns.guest_id text null`; `CHECK (guest_id IS NULL OR demo_mode = true)`; `outreach_emails.status='scheduled'` insert trigger raises if the campaign is a guest campaign; `/api/emails/process` selects only `campaigns.guest_id IS NULL`. Three independent walls.
- Caps (Redis, fall back to DB count): 2 concurrent / 5 per day per guest · 20/day global · auto-stop at 60 ticks (`campaigns.tick_count`).
- Guests never see Settings; `/needs-you` and `/deals` are scoped to their campaigns.
- Owner = Google OAuth, `ALLOWED_DOMAINS` default empty → allow-list by email (`OWNER_EMAILS`).

## 4. Data model (`0001_schema.sql`, the only migration)
`campaigns` (id, owner_email, guest_id, name, website_url, what_you_sell, keywords[], desired_deals, budget_total, budget_used, budget_reserved, max_per_deal, min_dr, demo_mode, phase, completion_reason, paused, paused_reason, tick_count, ticks_today, last_tick_at, next_tick_after, created_at) · `campaign_prospects` (…, `score_basis` enum `full|relevance_only`, `contact_source`, `contact_confidence`, `demo_persona`) · `domains` · `authors` · `contacts` · `workflows` (1 per campaign) · `outreach_emails` (kind initial/followup/negotiation, parent_id, status, to_email, subject, body, message_id, replied_at, reply_kind, reply_excerpt, **reply_intent, reply_price**, negotiation_status, max_offer, agreed_price, **original_ask**) · `deals` · `budget_ledger` · `interventions` (+ `editor_quote`, `agent_plan`, `agent_needs`) · `agent_events` (+ **`human` text, `model`, `tokens_in`, `tokens_out`, `latency_ms`, `reasoning`, `engine` enum `model|policy|fixture`**) · `negotiation_settings` · `user_email_config` · `app_state` (token budget counters) · `idempotency_keys`. RLS on, service role only. Exactly one FK per relationship.

## 5. Nebius adapter + routing
- `lib/ai/nebius.ts`: `chat({model, messages, tools?, json_schema?, thinking, max_tokens})` → `{content, reasoning?, tool_calls?, usage, model, latency_ms}`; reads `message.content`; `reasoning = message.reasoning_content ?? message.reasoning ?? null`; `thinking:false` → `chat_template_kwargs:{enable_thinking:false}`; `json_schema` validated with a schema validator; **throws** `NebiusError{kind: auth|rate_limit|timeout|invalid_output|budget}` — no fallback. Every call records usage into `app_state.tokens_today` and the event.
- `lib/ai/models.ts`: at build (`scripts/models.mjs` → `models.generated.json`) and at runtime health, `GET /v1/models`; hard-fail if a routed id is missing.
- Routing table: `orchestrator` → Super, thinking on, 1500 tok · `plan_preview, relevance, opener, classify, followup` → Nano (Lightning if Nano 429s), thinking off · `negotiation_counter` → Ultra, thinking on, ≤ 20/campaign then Super.
- Rate limits: Nano RPM 100 → the tick bounds fast calls at 4/tick.

## 6. Orchestrator + tick economics
- `policy.ts` (deterministic): phase transitions, what work is *available* this tick (counts), completion, caps. `orchestrator.ts`: if policy says nothing → `policy_noop` event, return (no model call). Else one Super turn with the compact state + available actions as **tools** (`run_discovery`, `qualify`, `resolve_contacts`, `send_outreach`, `handle_replies`, `schedule_followups`, `complete`); model picks one; code executes it bounded (≤ 4 fast calls, ≤ 45 s wall-clock; work not finished continues next tick); code applies transitions.
- Lock: Redis `tick:{id}` 60 s (DB advisory-lock fallback). Caps: 120 ticks/campaign/day; `NEBIUS_DAILY_TOKEN_BUDGET` global → pause with banner.
- Cron: GitHub Actions 5 min → `/api/cron/tick` selects campaigns where `next_tick_after <= now()`; sets `next_tick_after = now + 5 min` (active) / `+ 20 min` (monitoring) / never (terminal). Demo campaigns are driven by the page's "Run next step" as well.
- Demo transport: no SMTP at all (delete the `DEMO_RECIPIENT` send); persona replies injected on the next tick after send (`DEMO_REPLY_DELAY_MS` default 0 in demo so the arc is ~3 min at 20 s/step ≈ 9 steps).

## 7. Phase checklist (status today)

| # | Item | Status |
|---|---|---|
| 0.1–0.4 | Hobby ceiling / cron / Fluid / Playwright measured | ⏳ **blocked on `vercel login`** (probe app built, PLATFORM.md drafted) |
| 0.5 | meters + projection | ✅ documented; re-verify after deploy |
| 1.1 | rotation | ⏳ you rotate 9 keys (ROTATION.md); I verify each |
| 1.2 | fresh repo + MIT | ⏳ need the new repo URL (personal account) |
| 1.3–1.6 | deletions, vyro=0, one schema, port 3000 | ⏳ not started (waiting on Phase 0 gate) |
| 2.1–2.2 | LEDGER.md | ⏳ FLOW_CHECK.md already shows demo = 0 model decisions; instrumented run comes after the Nebius adapter exists |
| 2.3–2.5 | loud failures, no scripted demo | ⏳ |
| 3.x | adapter, orchestrator, cron, caps, Tavily Bearer | ⏳ (Tavily also needs the Builders credit — key exhausted) |
| 4 | four screens + guest | ⏳ ASK-1, ASK-2 |
| 5 | deploy, keepalive, uptime | ⏳ needs Vercel + Supabase cloud + Upstash accounts (yours) |
| 6 | tests, e2e, README, UPDATES, feedback, video script | ⏳ |

**Open asks:** ASK-1 (drop standalone Inbox?), ASK-2 (design skill path / approve direction), plus the three credentials: `vercel login`, new GitHub repo URL, rotated keys.
