# LEDGER.md — every decision a campaign made, and who made it

Three demo campaigns and one real-mode campaign run on **2026-09-20** against live Nebius Token Factory,
read back from `agent_events` (the append-only feed every decision writes to). Numbers are the
database's, not estimates.

## Two things a reader of the conversations found (2026-09-21, morning)
The owner opened a demo thread with experte.com and saw two agent emails in a row and only the
editor's last line. Two real faults behind that screen:

1. **Only the latest editor reply was stored** (`reply_excerpt` on the anchor was overwritten), so
   earlier editor messages vanished from the conversation — on screen, on the Needs-you card, and
   in what the Negotiator itself read. Fixed: every reply is kept (`reply_history`, oldest first),
   and one thread builder (`src/lib/negotiation/thread.ts`) serves the Negotiator, the demo editors,
   the Conversations tab and the cards. Existing demo threads were backfilled from the ledger's
   `demo_reply_written` events (33 anchors).
2. **The model was allowed to haggle a second time over a price we could pay.** The editor asked
   $280 (ceiling $250) → the Negotiator countered $240 (right) → the editor came down to "$200,
   which is as low as I can go this month" → the model countered $190, then $185 against "I'm
   willing to consider $200, please send the blurb". Now a code rule: an in-bounds price is
   countered at most once; after our counter, or on a floor signal ("as low as I can go", "lowest",
   "final", "firm"), an in-bounds number is taken at their number by policy, no model call
   (`tests/negotiation-policy.test.ts`).

## Concurrency check (2026-09-21)
Two fresh guests (separate cookies) launched demos at the same second: distinct campaigns, both at
"qualifying" with 4 ticks and 19 pages found after 90 s. Five parallel `POST /tick` on one campaign:
`["run_discovery","locked","locked","locked","locked"]`. Guest B on guest A's campaign: GET 404, threads
404, tick 404, DELETE 404. Guest creating a real campaign: 403. Guest reading Settings: 403. The
per-thread negotiator lock and the atomic send claim are covered by `tests/db-walls.test.ts` (5
concurrent Postgres clients each; exactly one wins).

## Run H — REAL mode, approval mode (2026-09-21)
One listed publication (shotkit.com) with the author's own address as the editor; plan: *show me each
first email before it goes out*. 4 ticks → the Writer's draft waited as "awaiting approval" (the
owner was emailed about it from their own Gmail); approved with an edited subject through the API;
the next scheduler pass sent it through Gmail (the send window had first moved it to 09:00 — sending
hours are now a Setting). Message-ID recorded.

## Run G — demo, after the qualification and negotiation changes (2026-09-20, evening)
Goal 3, budget $800, max $250. Browser-driven with one unscripted editor reply typed in the inbox.
**Goal reached: 3 deals, $480 committed.** 78 events · **model 39** · policy 11 · fixture 24 · system 4 ·
**0 idle model calls**. Super 25 (manager + 12 qualifications) · Nano 13 · Nano+Ultra 3 · Nano+Super 3.
Tokens 23,309 in / 17,213 out · **$0.0286**. The unscripted reply ("$220 if you send two before/after
examples") was parked by rule as an asset request — the agent did not promise files it cannot attach.

## Run F — page-type gate check (2026-09-20)
Six real pages, no addresses, evaluated only. **Nano, thinking off:** all six "editorial_article" (twice).
**Super, thinking on:** adobe.com, canva.com, picsart.com → `vendor_product_page`, rejected; the Yahoo PR
item → rejected on relevance; the letsenhance and photoglory roundups → qualified. Qualification is
routed to Super since this run.

## Run E — REAL mode, ten editors, ten kinds of reply (2026-09-20)
Ten real pages seeded with plus-addresses of the author's own Gmail (`ab.ghouri03+maya@…`), search off.
Ten outreach emails sent through Gmail; the author replied as each editor from the same mailbox,
threaded with `In-Reply-To`, and the IMAP sweep read them back (9 replies + 1 autoresponder).

| Editor said | What the agent did |
|---|---|
| "$280 … with a do-follow link" | Ultra countered $220 → editor "$200" → Super agreed at $200 (saved $80) |
| "$120 works, send a blurb" | (first pass: countered $85 — fixed) → policy accept at their number |
| "hop on a 15-minute call?" | parked: *Wants a call* → owner "email only" → Super resumed the thread |
| "what's your monthly traffic, do-follow?" | parked: *Asks a fact* → owner's numbers → Super answered → editor "$160" → policy accept |
| "we don't take sponsored placements" | polite close, domain suppressed |
| out-of-office (Auto-Submitted header) | classified `auto`, ignored |
| "$600 standard rate" | parked: above the $300 absolute maximum → owner "counter at $250" → Ultra countered → editor accepted $250 → agreed (owner-approved figure honoured) |
| "legal needs an NDA" | parked: *Wants a contract* → owner's line → Super resumed |
| "$140 includes a do-follow link" | (first pass: parked as a factual question — fixed) → policy accept |
| "what budget do you have in mind?" | Super asked what they charge → "$180" → Ultra countered $130 |

40 model events · $0.027 · every reply delivered through the owner's Gmail with a Message-ID. On
completion the four still-open threads received one fixed closing line each (`thread_withdrawn`).
What this run fixed is listed in the commit `negotiation fixes from Run E`.

## Run D — REAL mode, seed-only, sending to the author's own address (2026-09-20)
Goal 1 placement, budget $300, max $150. Owner `ab.ghouri03@gmail.com` (Gmail app password, own Nebius
and Tavily keys saved in Settings). One publication listed at Setup — a real article,
`restorephotosapp.com/best-photo-restoration-apps` — with the "editor" address set to the author's
other mailbox, `abdullahzubair@chrio.site`. Web search off. Driven by `POST /api/cron/tick` exactly as
the GitHub Actions scheduler calls it (with `next_tick_after` advanced by hand between rounds instead
of waiting 5 minutes each).

| | |
|---|---|
| Steps to first send | 4 ticks: load the listed publication → evaluate → resolve contact → draft + queue; the scheduler's transport pass sent it in the same round |
| Model calls | Super 5 (one per busy step; one of them an idle-monitoring call since removed) · Nano 2 (relevance on the fetched page: **92/100, DR unverified, score basis relevance-only**; the outreach draft) |
| Tokens / cost | 4,204 in / 638 out · **$0.0014** |
| Tavily calls | **0** (seed-only) |
| Transport | SMTP through the owner's Gmail, `Message-ID <a7a25384-…@gmail.com>`, received in the chrio.site inbox; the IMAP sweep logs into the sender mailbox every round (`accountsChecked: 1`) |
| What it fixed | the scheduler had never sent queued mail; an outreach draft named the product after the publication; idle real campaigns spent a Super call every 20 minutes; black-on-black active nav label |
| Reply leg | superseded by Run E (the same mailbox, replying as ten editors) |

## Run C — clean database, browser-driven, after the review fixes
Goal 3 placements, budget $800, max $250/placement. **Completed on tick 13 in ~3 minutes — goal reached.**

| | |
|---|---|
| Events | 60 · **model 38** · policy 9 · fixture 13 · **0 idle model calls** (no `policy_noop` needed) |
| Model calls | Super 11 (one decision per busy step) · Nano 24 · Ultra 3 (one Ultra runaway retried on Super, visible in the feed) |
| Deals | restorereview.invalid $120 · creativetech.invalid **$280 → $180** · designdigest.creative.invalid **$280 → $180** — saved $200 |
| Parked for a human | sync_contact (call request) · factual_question (traffic / do-follow) |
| Status sentence at the end | "Goal reached. 3 deals agreed, $480 of $800 committed." |

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
| Publication relevance / editorial quality / could this publisher feature us | **MODEL** | Super, thinking on, json_schema (Nano until Run F) | `qualification` events; rejections read "relevance 10/100 — no overlap between garden beds and photo restoration" or "vendor product page, not a publication that could feature us" |
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
