# Legacy Edge Cases → Regression Tests

The pre-existing codebase encoded real production failures as comments and guards. Each entry
below documents the original failure, where it lives now, and the test that keeps it dead.

| # | Historical failure | Where it's handled now | Test |
|---|---|---|---|
| 1 | **Auto-reply runaway**: a clock-based `replied_at` stamp advanced on every IMAP sweep, so the AI re-answered the same autoresponder forever. | `imap.ts` stamps replies with the envelope Date, clamped to now; `recordReplyOnAnchor` refuses same-or-older dates (idempotent + monotonic). | covered by reply-recording unit semantics (monotonic guard) |
| 2 | **"Needs your reply" ghost threads**: manual inbox replies aren't outreach rows, so hand-answered threads looked unanswered forever. | `inbox_state.last_reply_at` + self-heal from last outbound IMAP message on thread open. | inbox logic (manual check §53-style) |
| 3 | **Guessed-email bounces burned the sending domain** (~24% bounce rate measured). | Send-time trust gate parks `pattern`/`pattern-catchall` addresses unless `ALLOW_GUESSED_EMAILS=1`. | filters.test: placeholder/role gates |
| 4 | **Documentation placeholders reached the DB at high confidence** (`user@domain.com` scraped off docs pages tagged `page-scrape` = highest trust). | Triple-guarded extraction + `isPlaceholderEmail` gate of last resort with NO override. | filters.test: catches `user@`, `example@`, asset filenames |
| 5 | **Duplicate initial sends raced**: DB guard only saw SENT rows; parallel sends passed the check before either was marked sent. | In-run `claimedInitialTo` set + DB `addressHasOtherSentInitial`. | send-processor guards (manual) |
| 6 | **Seeds failed relevancy**: seed articles got relevance=1 against a 40 bar (0/141 passed). | Seeds forced relevance=100 in pipeline. | pipeline behavior (manual) |
| 7 | **Checkpoint deletion caused full restarts**: resume deleted the checkpoint, losing ~210s of work mid-run ("restarts everything" bug). | Checkpoints are never deleted at resume start; discovery route never falls back to a fresh run while hits are pending. | checkpoint lifecycle (manual) |
| 8 | **Hunter/enrich.so confidence string bug**: `confidence` is an enum string ('high'/'medium'/'low'); numeric compare silently discarded EVERY result (same class of bug that blanked a 25-domain DR backfill). | Explicit enum→score mapping (90/70/45), catch-all capped ≤60. | provider adapters (manual) |
| 9 | **Byline junk stored as names** (`Alistair CampbellSocial Links Navigation`, `By Pierre DeBois`). | `cleanAuthorName()` strips prefixes/suffix junk; title phrases rejected from person-only paths. | filters.test ✔ |
| 10 | **Alt-contact misaddressing**: Hunter domain-search returned a DIFFERENT person; pitch greeted the byline — "the one mistake a recipient cannot un-see". | Cascade carries `ownerName/ownerPosition`; UI shows "Goes to". | cascade result contract (manual) |
| 11 | **Catch-all domains fake confirmed finds**: Reoon catch-all accepts anything. | `enrichso-catchall` downgraded ≤60 and labeled unconfirmed. | adapter scoring (manual) |
| 12 | **Cascade threw away socials when no email found** (13/15 prospects "unreachable" though contactable). | `onContact` flushes every signal at every return path. | cascade flush (manual) |
| 13 | **Runaway AI back-and-forth**: re-marked replies made the AI answer N times. | Thread-length cap (`max_thread_length`) escalates to needs_human instead. | negotiation tests (cap path) + cron guard mirrored in campaign tick |
| 14 | **Hollow promises**: model promised attachments/calls/stats it cannot perform. | Prompt rules + `FABRICATION_RE` post-generation guard → routes to human instead of sending. | fabrication guard (manual) + prompt contract |
| 15 | **Lowball after yes**: agent countered below their accepted price. | Accept-close path takes THEIR price verbatim when within `[floor, ceiling]`. | negotiation.test ✔ "never lowballs after a yes" |
| 16 | **Waive-fee phantom debt**: free editorial placements marked with owed payment. | Waiver regex forces agreed_price 0 / null payment. | waive handling in deal creation |
| 17 | **Ceiling drift**: models proposed above tier caps. | Offer clamped to `[floor, ceiling]` AFTER generation, plus deterministic accept/counter policy. | pricing tiers + clamp tests ✔ |
| 18 | **Role mailboxes spammed one org inbox repeatedly**. | Role emails rejected at extraction AND send time; parked with follow-ups suppressed. | filters.test ✔ role list |
| 19 | **Free-tier Ahrefs: missing traffic metrics wrongly disqualified everyone** (and in the hackathon build: missing DR key did the same). | "Unverified ≠ fail" semantics; DR gate passes-as-unverified only when NO provider is configured (`drUnavailable`), tightening automatically once data exists. | filters.test ✔ unverified semantics |
| 20 | **Weak-model drift parked real negotiations** (hackathon): free LLMs labeled plain price quotes `needs_human`. | Deterministic demotion: price present + zero capability cues ⇒ counter_offer, never HITL. Strong-cue override still forces parking for calls/invoices/etc. | demotion guard (manual) + heuristic precedence tests |

## Rule

Any behavioral change to these paths must update or extend `tests/*.test.ts`. The comments in
the legacy files are specifications, not decoration.
