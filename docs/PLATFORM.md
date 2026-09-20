# PLATFORM.md — Vercel Hobby + free tiers: what the docs say vs what we measured

Status **2026-09-20**: probe app is written and builds (`scratchpad/vercel-probe`, Next 16.2.9 — same as the product). **Deploy is blocked: the Vercel CLI on this machine has no credentials** (`vercel whoami` → "No existing credentials found") and `vercel login` is interactive. Every row marked ⏳ is *documented*, not measured, until you either run `npx vercel login` in a terminal or give me a `VERCEL_TOKEN` (Account → Settings → Tokens, scope: your personal Hobby team). Then it's one command per probe (see §7).

## 1. Function duration ceiling (0.1)

| Source | Value |
|---|---|
| Docs `/docs/functions/configuring-functions/duration` (updated 2026-08-24) | With **Fluid compute (enabled by default on new projects)**: Hobby **default 300 s, maximum 300 s**. |
| Docs `/docs/limits` (updated 2026-09-16) | Projects "deployed before April 23rd 2025 and **not** using Fluid compute": Hobby **default 10 s, max 60 s**. |
| The "live Aug 2026 build failure says 60 s" you saw | Consistent with a **non-Fluid** project (or a project created via a path that left Fluid off). This is the exact ambiguity the probe resolves. |
| **Measured** | ⏳ `measure.mjs` sleeps 10/55/65/120/250/305 s on a route declaring `maxDuration = 300`. If 65 s returns 200 we have 300 s; if it 504s we're on the 60 s ceiling and Fluid must be toggled on in project settings. |

**Design consequence regardless of outcome:** a tick must complete in **≤ 45 s wall-clock** (safe under the 60 s case, and leaves headroom under 300 s for cold start + DB writes). Bound work per tick: 1 orchestrator turn (Super, ≤ 1500 tok) + at most 4 fast Nano calls, then return. Anything longer continues on the next tick — the phase policy is already resumable.

## 2. Cron (0.2)

| Source | Value |
|---|---|
| Docs `/docs/cron-jobs/usage-and-pricing` (2026-07-15) | Hobby: 100 crons/project, **minimum interval once per day**, precision **±59 min**. "Expressions like `0 * * * *` … will fail deployment with the error: *Hobby accounts are limited to daily cron jobs.*" |
| **Measured** | ⏳ `vercel-probe-cron/` declares `*/5 * * * *`; a second deploy of that folder should fail at deploy time with that exact message. |

**Decision (already in the brief, confirmed viable):** GitHub Actions `schedule` → `POST /api/cron/tick`. GitHub facts (docs, verified): shortest interval **5 min**; "can be delayed during periods of high loads… include the start of every hour"; runs **only on the default branch**; **"In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days."** Oct 30 → Dec 15 is 46 days, so one commit in mid-November (or a manual re-enable) keeps it alive — this goes in DEPLOY.md as a dated reminder. Vercel's daily cron stays for the Supabase keepalive + daily digest only.

## 3. Fluid compute (0.3)

| Source | Value |
|---|---|
| Docs | Fluid is **on by default** for new projects; "Vercel can reuse function instances and process multiple invocations in the same instance (optimized concurrency)"; **Active CPU** is billed only while code executes and **pauses while waiting on I/O**; **Provisioned Memory** is billed for running instances. |
| **Measured** | ⏳ `/api/inflight` keeps module-level state; `measure.mjs` fires 6 concurrent 8 s requests. Same `instance` id across them ⇒ Fluid concurrency is on. `/api/env` reports `totalmem_mb`, `cpus`, `VERCEL_REGION`, node version. |

**What Fluid changes for us:** (a) the 300 s ceiling; (b) LLM wait time (the bulk of a tick) costs ~zero Active CPU — the 4 h/month CPU allotment is spent on JSON parsing, HTML extraction and DB round-trips, not on waiting for Nemotron; (c) module-level caches (Nebius model list, negotiation settings) survive across invocations; (d) concurrent ticks for two campaigns can share one instance — our per-campaign Redis lock is what prevents double-ticking, not instance isolation.

## 4. Playwright (0.4)

| Source | Value |
|---|---|
| Prior knowledge | Vercel functions have no Chromium binary; `playwright-core` imports but `chromium.launch()` fails (no executable). `@sparticuz/chromium` is the usual workaround and is ~50 MB, near the 250 MB bundle limit with our deps. |
| **Measured** | ⏳ `/api/playwright` imports `playwright-core` and attempts `chromium.launch()`; returns `launch_ok` / `launch_error`. |

**Decision (assume no, as the brief says):** every rendered-fetch path degrades to plain `fetch` behind `PLAYWRIGHT_ENABLED=false`; `playwright`/`playwright-core` leave `dependencies` (Playwright Test stays in devDependencies for e2e). `src/lib/extract/fetch.ts` already has the plain-fetch-first path; `src/lib/indexing/fetchRendered.ts` is deleted in Phase 1 anyway.

## 5. Hobby monthly meters (0.5) — documented (`/docs/limits/fair-use-guidelines`, 2026-09-14)

| Resource | Hobby included / month | Our cost driver |
|---|---|---|
| Function invocations | **1,000,000** | ticks + page loads + polling |
| Active CPU | **4 hours** | CPU-bound work only (I/O wait excluded) |
| Provisioned memory | **360 GB-hrs** | wall-clock × instance memory |
| Fast data transfer | 100 GB | negligible |
| Fast origin transfer | 10 GB | negligible |
| Runtime logs | **1 hour retention** | → every failure path must write `agent_events` |
| Deployments | 100/day | fine |
| Build time | 45 min/deploy | fine |
| Commercial use | **"Hobby teams are restricted to non-commercial personal use only."** Commercial = "any Deployment used for the purpose of financial gain of anyone involved… including a paid employee or consultant writing the code." Donations excluded. | Noted for DEPLOY.md; a hackathon entry is non-commercial; a sold product is not. |

### Projection (assumes Fluid on and instance memory ≈ 1.7 GB — confirmed by `/api/env` when measured)

Per tick: GitHub Actions cron hits `/api/cron/tick` every 5 min = **8,640 cron invocations/month**. Each cron fan-out calls `/api/campaigns/{id}/tick` once per *active* campaign.

| Scenario | Ticks/month | Wall-clock/tick | Provisioned mem | Active CPU | Invocations |
|---|---|---|---|---|---|
| No-op tick (policy says nothing to do; **no model call**) | most of them | ~0.5 s | 8,640 × 0.5 s × 1.7 GB ≈ **2 GB-h** | ~0.3 h | 8,640 |
| Busy tick (1 Super turn + 4 Nano calls + fetches) | 5 campaigns × 40 busy ticks = 200 | ~20 s | 200 × 20 s × 1.7 GB ≈ **1.9 GB-h** | ~0.2 h | 200 |
| Demo campaign (3-min arc, ~12 ticks driven by the campaign page's "Run next step", 1/20 s) | 30 demos × 12 | ~15 s | 360 × 15 s × 1.7 ≈ **2.6 GB-h** | 0.2 h | 360 |
| UI polling (campaign page every 10 s while open; needs-you badge) | 300 sessions × 10 min | 0.3 s | ≈ 1 GB-h | 0.3 h | 18,000 |
| **Total / month** | | | **≈ 8 GB-h of 360** | **≈ 1 h of 4** | **≈ 30k of 1M** |

Sept 20 → Dec 15 spans three billing windows; every window is ≈ 2 % of the memory allotment and ≈ 25 % of CPU. **CPU is the meter to watch** (article extraction with jsdom/readability is CPU-heavy: ~1–2 s CPU per page × 8 pages per qualifying tick). Mitigation: cap qualifying batches at 4 pages/tick and skip Readability when the page is under 20 KB. A usage check that reads the Vercel usage API weekly and posts to `agent_events` is in Phase 5.3.

## 6. Other free tiers we depend on (documented; will be verified in Phase 5)
- **Supabase free**: projects **pause after 7 days of inactivity**; a daily `select 1` via the Vercel daily cron + a GitHub Actions daily ping (belt and braces) — Phase 5.2 verifies the pause actually doesn't happen across a 7-day window.
- **Upstash Redis free**: 10k commands/day, enough for the tick lock + daily counters (≈ 9k cron ticks/month ≈ 300/day).
- **Nebius**: $25 + $25 credits, judged budget in RESEARCH.md §C8.

## 7. How to run the measurement (once credentials exist)
```
# one-time, interactive, by you:
npx vercel login
# then I run (each ≤ 60 s, deploy in background with a log file):
cd <scratchpad>/vercel-probe && npx vercel --prod --yes            # main probe → URL
node measure.mjs https://<url>                                      # 0.1 / 0.3 / 0.4 / env
cd ../vercel-probe-cron && npx vercel --prod --yes                  # 0.2 — expected to FAIL with the Hobby cron error
```
Alternatively paste a `VERCEL_TOKEN` and I'll pass `--token`.

## 8. Decisions locked by this document
1. Tick budget ≤ 45 s wall-clock; bounded work per tick; resumable by design.
2. Scheduling = GitHub Actions 5-min cron (+ mid-November activity commit); Vercel cron = daily only.
3. `PLAYWRIGHT_ENABLED=false` in production; plain fetch everywhere.
4. Fluid on; per-campaign Redis lock is the concurrency guard.
5. Watch **Active CPU**, not memory; cap extraction work per tick.
6. Non-commercial only on Hobby (DEPLOY.md).
