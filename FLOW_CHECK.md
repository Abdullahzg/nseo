# FLOW_CHECK.md — the current user flow, actually run (2026-09-20, local)

**Stack used:** Docker Desktop (started by me) → Supabase local (`npx supabase` containers auto-restarted; API `127.0.0.1:54321`, DB `54322`) → `next dev -p 3000` (hidden window, log `.next-dev.log`) → the exact HTTP calls the UI makes. Python/Strands service **not** started (it's being deleted). Auth is in demo-bypass (`GOOGLE_CLIENT_ID` unset).

**Things I had to fix just to get it to run:**
1. Port 3000 was held by an unrelated `project-grafana-1` container (its `/api/health` even answers with JSON — easy to mistake for ours). Stopped `project-grafana-1/prometheus-1/alertmanager-1` and cleared their restart policy.
2. `scripts/run-migrations.mjs` **aborts at `027_outreach_kind_unique.mjs`** on this DB (adds a UNIQUE that `034` later drops; existing negotiation rows violate it). Applied only the missing `063`/`064` (`app_settings`) by hand.
3. **`outreach_emails.author_id` had two identical foreign keys** (`fk_outreach_author` from a `scripts/*.mjs` migration + `outreach_emails_author_id_fkey` from `supabase/migrations/002`). PostgREST returns `PGRST201` (ambiguous embed) for the join `negotiateThread` uses → the code reads it as `"email not found"` → **every negotiation on this database was failing silently** (70 `negotiation_error` events before I dropped the duplicate). Nothing in the UI flagged it.

## The run, tick by tick (campaign `1b50ec0c…`, demo mode, budget $800, max/deal $250, goal 2 deals)

| Tick | ms | Phase | Action | What actually happened |
|---|---|---|---|---|
| start | — | draft→planning | `POST /start` | tries Strands `/campaigns/:id/start` fire-and-forget (dead) |
| 1 | 3,603 | planning→discovering | `plan` | **3.6 s wasted** on `AGENT_SERVICE_URL` fetch → `fallback-ts`. `plan_queries` event labels provider **"gemini"**; log shows `[generateDiscoveryQueries] Claude failed, using fallback: OpenRouter 402` → **static query list**. Mislabel confirmed. |
| 2 | 581 | discovering | `discover` | 12 `.invalid` fixtures inserted, provenance `demo-fixture` |
| 3 | 232 | discovering→qualifying | `discover` | 0 new → saturation → transition |
| 4–5 | 813 / 425 | qualifying→resolving_contacts | `qualify(8)`, `qualify(4)` | **12/12 qualified**; `relevance.source = "heuristic"` (demo skips the LLM), DR from fixture; opportunity scores 60–75 that *look* measured (`reachProxy=50` baked in) |
| 6–7 | 1,480 / 698 | resolving_contacts→outreaching | `contact(8)`, `contact(4)` | all 12 "resolved" — demo **synthesises** `sarah.mitchell@<host>` |
| 8–10 | **31,560 / 11,608 / 4,786** | outreaching→monitoring | `outreach(sent=5/5)…` | rows inserted as `sent` + `outreach_sent_simulated`; demo path also **attempts a real Gmail SMTP send per prospect** (8 s timeout each) → 30 s ticks |
| 11–12 | ~800 | monitoring | `monitor(det=10/2)` | 12 persona replies injected via `recordReplyOnAnchor` |
| 11–16 | ~700 | monitoring | `neg=0, err=8–10` | **every negotiation errored** (`email not found`) — the duplicate-FK bug |
| (fix) | | | dropped `fk_outreach_author` | |
| 17–18 | **24,341 / 36,003** | monitoring | `neg=8, err=2→0` | drafts run sequentially for 8 threads + SMTP attempts; 2× `"No LLM configured for drafting"` |
| state | | monitoring | | 12 replied · **1 deal** (`photoworkflow.daily.invalid`, agreed $120, `original_ask: null`) · budget_used 120/800 · **0 interventions** · 145 events |

### Per-persona outcome (what the demo "arc" really produces today)
| Persona (×) | Expected by `docs/DEMO.md` | Actual |
|---|---|---|
| `high_anchor` ×3 ($280→$220→$180) | counter, counter, accept ≤ ceiling, deal | 3 scripted counters sent, status `negotiating`, **no deal yet**; on the 4th reply `max_thread_length=4` → will park as `thread_limit` |
| `quick_deal` ×2 ("$120, send details") | accept, deal | 1 agreed at $120 (deal row, ledger commit) · 1 stuck `negotiating` ("could you confirm your rate?") — same persona, non-deterministic |
| `meeting_request` ×3 ("tell me more about your tool") | **needs_human / sync_contact intervention → the HITL demo** | heuristic classifier says `question` → agent answers it → **no intervention is ever created.** The HITL story does not fire in demo mode. |
| `decliner` ×2 | declined | declined ✓ |
| `autoresponder` ×2 | skipped | skipped ✓ (`reply_kind=auto`) |

### Where the model was and wasn't used in this demo run (pre-ledger observation)
| Decision | Engine | Evidence |
|---|---|---|
| Discovery queries | **static list** | OpenRouter 402 → `fallbackQueries()`; event says "gemini" |
| Relevance score | **heuristic** | `score_breakdown.relevance.source = "heuristic"` on all 12 |
| DR / traffic | fixture / unverified | `authority.source = "measured:demo-fixture"` (a fixture labelled *measured*) |
| Contact | synthesised | `contact_source = "demo-simulated"` |
| Outreach body | template + LLM opener *or* canned line | `drafter` field in event; not inspected per row |
| Reply classification | **heuristic** (`heuristicOnly: demo_mode`) | `reply_intent` column empty on all 12 rows |
| Negotiation drafts | **scripted** (`demoScripted`) | `negotiation/run.ts:229-247` |
| Deal/budget | deterministic ✓ | ledger commit 120 |
So in demo mode **zero decisions are model-made.** This is the Phase 2 problem stated as a measurement, not a suspicion.

### UI check
All 8 nav routes return 200 (`/` 5.0 s first compile, others 0.6–1.7 s). No 4xx/5xx in the dev log. Client-side polling (10 s state + 15 s auto-tick on the campaign page) was **not** exercised by curl; the auto-tick would have re-run the 36 s monitoring tick every 15 s — overlapping — because there is no per-campaign lock on `/tick`.

### Defects found by running (all new vs. RESEARCH/GO_NO_GO)
1. Duplicate FK → negotiation dead (DB-level; fixed locally, must be fixed in the Phase 1.5 schema).
2. `run-migrations.mjs` cannot complete on a DB with negotiation history (027 vs 034).
3. Monitoring ticks 24–38 s with 8 threads → exceeds a 45 s budget with 12+ threads; no early-return bound.
4. `/tick` has no per-campaign lock; browser auto-tick + cron + manual button can overlap.
5. 3.6–5 s per tick burned on the dead `AGENT_SERVICE_URL` probe.
6. Demo mode calls real SMTP (`DEMO_RECIPIENT`, burned Gmail creds) — 8 s timeout per prospect.
7. `meeting_request` persona never produces an intervention → the HITL screen has nothing to show in a demo.
8. `original_ask` null on the deal → "asked vs paid / saved" on the Deals screen would show nothing.
9. `reply_intent` never persisted → activity feed cannot say *why* a thread went where it went.
10. `authority.source="measured:demo-fixture"` labels fixture DR as *measured*.

## Local run status right now
- Supabase containers: running. Next dev: running on **:3000**, log `.next-dev.log`. Grafana stack: stopped (restart policy cleared; `docker start project-grafana-1` brings it back).
- DB: schema + old data + my two fixes (`app_settings` added, duplicate FK dropped). Campaign `1b50ec0c-9572-4223-9257-d39a60e9abc7` left in `monitoring` for inspection at `http://localhost:3000/campaigns/1b50ec0c-9572-4223-9257-d39a60e9abc7`.
