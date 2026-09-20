# LEDGER.md — every decision a campaign made, and who made it

Two demo campaigns run end-to-end on **2026-09-20** against live Nebius Token Factory, read back from
`agent_events` (the append-only feed every decision writes to). Numbers are the database's, not estimates.

## Run A — first arc after the rebuild (`52959f9a`)
Goal 2 placements, budget $800, max $250/placement. **Completed on tick 12 — goal reached.**

| | |
|---|---|
| Events | 70 |
| Decisions by engine | **model 38** · policy 8 · fixture 22 (loading demo publications/editors/replies) · system 2 |
| Model calls by model | Nemotron 3 Super (orchestrator) 13 · Nemotron 3 Nano (fast) 25 |
| Tokens in / out | 14,682 / 3,743 |
| Cost (official Nebius prices) | **$0.0049** |
| Mean model latency | 1.4 s |
| Deals | restorereview.invalid $120 · genstack.weekly.invalid $120 |
| Parked for a human | 3 (sync_contact ×1, budget_exception ×2) |

## Run B — after the negotiation-policy fix (`778d1ea0`)
Goal 3, same budget. 22 ticks, still in monitoring when captured (2 deals, 2 threads negotiating).

| | |
|---|---|
| Events | 89 |
| Decisions by engine | **model 51** · policy 8 · fixture 25 · system 5 (2 of them recoverable Ultra truncations, since fixed) |
| Model calls by model | Super 23 · Nano 24 · **Ultra 4 (counter-offers: $280→$220, $280→$200, $220→$190, $220→$190)** |
| Tokens in / out | 24,647 / 8,139 |
| Cost | **$0.0201** |
| Parked for a human | factual_question ×1 (open) · sync_contact ×1 (**answered by the owner → thread resumed, reply drafted by Super**) |

Two runs together: **60,019 tokens**, about **$0.025**, tracked live in `app_state` by the token-budget guard.

## Decision points — MODEL or HEURISTIC?

| Decision | Engine | Model | Evidence |
|---|---|---|---|
| Which action to take this step | **MODEL** | Nemotron 3 Super, thinking on | 35 `manager/decided` events, each with a one-line "why" and the full reasoning trace in the feed |
| Search angles (real mode) | **MODEL** | Nano, thinking off, json_schema | `strategy/plan_queries` |
| Publication relevance / editorial quality | **MODEL** | Nano, json_schema | 24 `qualification` events; rejections read "relevance 10/100 — no overlap between garden beds and photo restoration" |
| Authority (DR) | **DATA** | — | fixture value in demo, Ahrefs in real mode, otherwise **"unverified"** and `score_basis = relevance_only` |
| DR gate, relevance threshold, spam gate | **POLICY** | — | `min_dr`, ≥ 40 relevance, `is_editorial && spam_risk != high` |
| Editor contact | **DATA** | — | demo: fixture editor (labelled *simulated*); real: enrichment cascade |
| Outreach subject + body | **MODEL** | Nano, json_schema | 16 `outreach` events, body visible in the feed |
| Reply intent, price named, tone | **MODEL** | Nano, json_schema | every `negotiation` event carries the classification |
| Escalation cues (call, NDA, invoice, traffic facts) | **POLICY** | — | `strongCue()` overrides the model; the feed labels these `policy rule` |
| Counter-offer wording | **MODEL** | Nemotron 3 Ultra (≤ 20/campaign), thinking on | 4 Ultra events in Run B |
| Ceiling / floor clamp, "agreed" only inside bounds | **POLICY** | — | `draftNegotiationReply` clamps the model's number |
| Accept in-bounds price / polite decline / wind down | **POLICY** | — | the three closings, tagged `engine=policy` |
| Budget commit | **POLICY** | — | `commit_budget()` in Postgres, atomic |
| Phase transitions, completion, tick interval | **POLICY** | — | `policy.ts`, unit-tested |
| Status sentence on the Campaign screen | **POLICY** | — | `statusSentence()`, never model-written |

**Heuristic substitutions for a model call: none.** The previous implementation's keyword relevance, regex intent classifier, static query list, canned outreach body and scripted negotiation are gone; when Nebius fails the event says so and the step retries next tick.

## What "fixture" means in a demo
Fixture events are data loads, not decisions: 12 publications with titles, blurbs and DR values (three deliberately below the DR floor, two deliberately off-topic), one editor per publication, and scripted editor replies (a high anchor at $280, a quick $120 deal, a call request, a traffic/do-follow question, a decline, an out-of-office). Every judgment on top of them is a real Nemotron call, which is why the two rejections above have model-written reasons.
