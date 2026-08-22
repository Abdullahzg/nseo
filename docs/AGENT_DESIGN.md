# Agent Design

## Workforce topology

```
campaign_manager (root LlmAgent — Gemini 3.5 Flash)
│  role: drive ONE bounded work unit per tick; honest summaries; no policy authority
├── strategy_agent        plan review, keyword angles, risk notes
├── discovery_agent       bounded web-search batches → deduped prospects w/ provenance
├── qualification_agent   runs deterministic scoring + Gemini semantic relevance
├── contact_intel_agent   enrichment cascade → verified contacts with confidence
├── outreach_agent        queues personalized sends through guarded processor
├── negotiation_agent     reply triage + negotiation inside hard ceilings
└── deal_agent            structured deals + completion checks
```

Sub-agents are registered as ADK sub_agents of the root; each is also independently
invokable. The root's tools are the same gateway tools the sub-agents bind, so a tick
is a single agent deciding + acting, not a chat between agents.

## The tick contract

Every `POST /tick {campaign_id}` executes **at most one batch action**, in this order:

1. **Safety gate** (code): emergency stop / terminal phase → no-op.
2. **Reason** (Gemini): compact state JSON + a deterministic policy recommendation;
   the manager usually executes the recommended action via one tool call.
3. **Transition** (code): funnel counts decide phase changes — never the model.
4. **Record**: an append-only, idempotent (`event_key`) timeline event with duration,
   state before/after, and structured details (no chain-of-thought).

If Gemini is unavailable or times out (240s cap), the identical action runs through
the deterministic fallback policy (`fallbackOrchestrator.ts` locally, `_recommend`
in Python) and events are labeled accordingly. Autonomy degrades; honesty doesn't.

## Deterministic vs. semantic split

| Semantic (Gemini) | Deterministic (code) |
|---|---|
| Discovery query diversity | Query dedupe, host canonicalization |
| Article relevance/fit/spam-risk | DR ≥ min gates, traffic/geography gates |
| Placement angle for outreach | Opportunity-score arithmetic + fair-value range |
| Reply intent ambiguity | Price extraction regex fallback, ceiling clamps |
| Negotiation language/tone | Floor/ceiling enforcement post-generation |
| Strategy commentary | Phase transitions, budget reservation, completion |

## Negotiation authority ladder

```
classify reply (LLM + heuristic backstop + STRONG-cue override)
  ├─ needs_human? ──► park thread, create durable intervention, STOP
  ├─ hard_no/unsubscribe ──► polite close, stop
  ├─ accept ≤ ceiling ──► close at THEIR number (never lowball after yes)
  ├─ accept > ceiling ──► counter instead of agreeing
  └─ otherwise draft (ask-first: never name first number)
        └─ clamp offer to [floor, ceiling] AFTER generation
              └─ fabrication guard: promises w/o backing input ⇒ needs_human
                    └─ agreed ⇒ budget reserve (atomic) ⇒ structured deal row
                          └─ over budget ⇒ intervention "over_policy", never auto-approve
```

## Human-in-the-loop

`interventions` rows are the durable suspend/resume unit: type taxonomy (13 kinds,
from `sync_contact` to `over_policy`), what was asked, why the agent paused, suggested
options, the human's trusted answer, who answered, and the resulting action. Resuming
re-enters `negotiateThread` on the SAME thread with full context plus the assist input —
the human never restarts anything. Thread takeover (existing inbox flow) remains
available at any moment and deliberately deletes unsent AI drafts.

## Memory model

- Session memory: ADK session state (Postgres-backed), keyed per campaign.
- Campaign/prospect/negotiation memory: relational rows — the prompt receives compact
  aggregates (counts, current ask, our last offer, ceiling), never table dumps.
- Policy memory: editable negotiation settings singleton + per-campaign constraints.
