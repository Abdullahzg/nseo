# GESEO — Final Hackathon Corrections

## Purpose

This document is the next implementation pass for Geseo after reviewing the latest `AGENT_REPLY_DOCUMENT.md`.

The project is significantly improved. Do **not** add more unrelated features.

The goal of this pass is to remove the remaining credibility and judging risks and make the submission clearly demonstrate that **Strands is the real agent execution layer**.

Work through the items below in order.

---

# P0 — MUST FIX BEFORE SUBMISSION

## 1. Remove TypeScript Orchestration Fallback From Hackathon Mode

The current documentation still says:

- Strands runs the campaign **or TypeScript fallback**
- `fallbackOrchestrator.ts` remains core orchestration
- the UI shows `Execution: Strands Agents` and `Fallback: OFF`

These cannot contradict each other.

### Required behavior

When:

```text
HACKATHON_MODE=true
```

the campaign must behave like:

```text
Start Campaign
    ↓
Strands service
    ↓
Strands campaign manager / graph
    ↓
specialist Strands agents
    ↓
tools
```

If Strands is unavailable:

```text
FAIL VISIBLY
```

Do NOT silently run TypeScript orchestration.

### Required environment behavior

Use something equivalent to:

```text
HACKATHON_MODE=true
REQUIRE_STRANDS=true
ALLOW_ORCHESTRATOR_FALLBACK=false
```

### Important distinction

TypeScript may still perform deterministic work such as:

- database writes
- API calls
- email sending
- hard budget validation
- suppression enforcement
- parsing
- persistence

But TypeScript must not decide:

- which phase to execute
- which agent to call next
- whether a prospect is good
- how to negotiate
- whether another discovery pass is useful
- whether to escalate

Those decisions belong to Strands.

### Acceptance test

Create an automated test:

```text
Start campaign in hackathon mode
↓
Stop Strands service
↓
Campaign must fail
↓
TypeScript fallback must NOT execute
```

Also record per run:

```json
{
  "execution_engine": "strands",
  "fallback_used": false
}
```

---

## 2. Fix the Metrics Dashboard

The current dashboard still shows:

```text
Total spent
Deal value
Negotiated savings
ROI
```

The agreed publisher price is a **cost**, not revenue.

Unless the user explicitly enters the monetary value of a placement, Geseo cannot calculate real ROI.

### Remove

```text
Deal value
ROI
```

### Replace with

```text
Total publisher asking price
Final placement spend
Negotiated savings
Savings percentage
Placements agreed
Average agreed price
Reply rate
Agreement rate
Autonomy rate
Human interventions
Manual actions avoided
```

### Example

```text
Publisher asking total:     $470
Final placement spend:      $350
Negotiated savings:         $120
Savings:                    25.5%

Placements agreed:          3
Autonomy rate:              94%
Human interventions:        1
Manual actions avoided:     37
```

Do not invent business-value metrics.

---

## 3. Add the Main Demo HITL: `budget_exception`

The existing human intervention flow for calls, legal requests, invoices, etc. is useful.

Keep it.

But the main judge-facing intervention should be a **budget boundary**.

### Add intervention type

```text
budget_exception
```

### Example scenario

Publisher originally asks:

```text
$350
```

Agent negotiates to:

```text
$230
```

Campaign automatic approval limit:

```text
$200
```

The agent must pause.

### Required decision card

Display something close to:

```text
Action required

Pixelcraft Journal

Initial publisher ask: $350
Current publisher ask: $230
Automatic approval limit: $200
Publication fit: 91%

Agent recommendation:
Counter at $200

Why you're seeing this:
The publisher's current price exceeds the amount
Geseo is authorized to approve automatically.

[Accept $230]
[Counter $200]
[Decline]
[Take over]
```

### Expected behavior

If user selects:

```text
Counter $200
```

then:

```text
human decision saved
↓
campaign resumes
↓
negotiation agent sends counter
↓
monitoring continues automatically
```

This should be the strongest moment in the demo.

---

## 4. Build a Real `/agent-runs` Page

Do not point `Agent Runs` to `/site-audit`.

Create:

```text
/agent-runs
```

### Campaign run list

Each run should show:

```text
Campaign
Started
Finished / Running
Execution engine
Fallback status
Agent decisions
Tool calls
Human interventions
Errors
```

### Run detail

Example:

```text
Run: E2E Demo Campaign
Execution: STRANDS
Fallback: OFF
Status: Running

strategy_agent        completed     1.8s
discovery_agent       completed     3.2s
qualification_agent   completed     4.1s
contact_agent         completed     2.7s
outreach_agent        completed     2.2s
inbox_agent           monitoring
negotiation_agent     waiting

Agent decisions:       31
Tool calls:            18
Human interventions:   1
Errors:                0
```

### Event timeline

Show real execution events such as:

```text
strategy_agent
  generated discovery strategy

discovery_agent
  called search tool

qualification_agent
  qualified publication, score 0.91

outreach_agent
  generated personalized email

inbox_agent
  classified counter offer

negotiation_agent
  proposed $180

negotiation_agent
  created budget_exception
```

Do not expose chain-of-thought.

Only show concise structured action summaries.

---

## 5. Add Strands-Specific Evaluation

The current evaluation suite is useful, but much of it proves heuristic behavior.

The hackathon needs proof that the **Strands agents themselves work**.

Create a dedicated evaluation folder if one does not already exist:

```text
evaluation/
```

### Required evaluation groups

#### A. Strands Qualification Evaluation

Test at least 20 prospects.

Measure:

```text
correct qualification decision
structured output validity
evidence present
```

#### B. Strands Reply Classification Evaluation

Test at least 30 replies.

Include:

```text
interested
counter_offer
accept
question
hard_no
unsubscribe
OOO
meeting
payment
legal
ambiguous
```

#### C. Strands Negotiation Evaluation

At least 30 scenarios.

Verify:

```text
never accepts over absolute max
auto-accepts valid low price when allowed
escalates price above approval threshold
stops after max negotiation turns
stops after unsubscribe
stops after hard decline
preserves currency
does not invent agreement
```

Hard financial constraints should be 100% deterministic.

#### D. Tool Routing Evaluation

Verify the correct Strands agent calls the correct tools.

Example:

```text
discovery request
→ discovery_agent
→ search tool

publisher counter
→ inbox_agent
→ negotiation_agent

budget boundary
→ budget_exception
```

#### E. End-to-End Strands Campaign Evaluation

This is the most important test.

One automated run:

```text
create campaign
→ Start
→ strategy
→ discovery
→ qualification
→ contact
→ outreach
→ demo incoming replies
→ negotiation
→ budget exception
→ human response
→ resume
→ completion
```

Assertions:

```text
execution_engine == "strands"
fallback_used == false
manual DB modifications == 0
campaign reaches expected final state
```

---

# P1 — IMPORTANT POLISH

## 6. Make the Agent Activity Claims Accurate

Do not show fake activity like:

```text
qualification_agent qualified techcrunch.com (score 0.91)
```

unless that event actually came from the real agent run.

Every visible timeline entry should be derived from persisted execution events.

Store fields like:

```text
run_id
campaign_id
agent_name
action
tool_name
status
decision_summary
duration_ms
timestamp
```

If available, also include:

```text
model
token_usage
```

---

## 7. Make Qualification Clearly Agentic

Do not make keyword heuristics the primary qualification method shown to judges.

The Strands qualification agent should evaluate:

```text
topical relevance
audience fit
editorial quality
publication legitimacy
placement fit
contactability
risk
```

Structured output:

```json
{
  "overall_score": 0.91,
  "decision": "qualify",
  "reason": "The publication frequently covers AI creative tools and recently published content directly relevant to the campaign.",
  "evidence": [
    {
      "title": "Example article",
      "url": "https://..."
    }
  ],
  "risk_flags": []
}
```

Heuristics may remain as cheap prefilters.

---

## 8. Make Outreach Personalization Verifiable

Every personalized email should have stored evidence for why it says what it says.

Persist:

```text
personalization_source
personalization_claim
```

Example:

```text
Source:
"Best AI Photo Editing Tools for Ecommerce"

Claim:
"Referenced the publication's recent comparison of AI image editing tools."
```

If evidence is unavailable, use a generic honest opener.

Do not hallucinate article details.

---

## 9. Keep Hard Safety Rules Outside the LLM

The LLM may recommend actions.

Code must enforce:

```text
absolute max placement price
auto-approval threshold
max thread length
unsubscribe suppression
hard decline suppression
blocked domains
blocked topics
max follow-ups
```

Never depend on prompt compliance alone for these.

---

# P1 — DEMO FLOW

The final demo should follow this sequence.

## 0:00–0:30

Explain:

```text
Digital PR teams repeatedly:
find publications,
research them,
find contacts,
write personalized outreach,
read replies,
negotiate prices,
and track outcomes.
```

Then:

```text
Geseo handles that loop autonomously
and only surfaces decisions that need a human.
```

---

## 0:30–1:00

Create campaign with:

```text
Website
Goal
Budget
Constraints
```

Click:

```text
Start
```

No manual ticks afterward.

---

## 1:00–2:00

Show:

```text
Strategy Agent
Discovery Agent
Qualification Agent
Contact Agent
```

Use the real Agent Activity timeline.

Open one qualified prospect.

Show its:

```text
score
reason
evidence
```

Open one rejected prospect.

Show why it was rejected.

---

## 2:00–2:40

Show outreach.

Open one email.

Show:

```text
article reference
personalization basis
publication context
```

Then show emails being sent automatically.

---

## 2:40–3:30

Show incoming replies.

Use at least:

```text
easy agreement
high-price negotiation
hard decline
```

Demonstrate:

```text
hard decline
→ suppression
→ no more outreach
```

---

## 3:30–4:15

Show the budget exception.

This should be the center of the demo.

```text
Initial ask: $350
Current ask: $230
Auto approval: $200

Recommendation:
Counter $200
```

Click:

```text
Counter $200
```

Show the agent resume automatically.

---

## 4:15–4:40

Show final results:

```text
publisher asking total
final spend
negotiated savings
placements
autonomy rate
human interventions
manual actions avoided
```

---

## 4:40–5:00

Show architecture + Agent Runs.

Explicitly demonstrate:

```text
Execution: STRANDS
Fallback: OFF
```

Show specialist agents and tool calls.

---

# FINAL ACCEPTANCE CHECKLIST

Do not call the hackathon build finished until all are true:

- [ ] Hackathon mode cannot silently use TypeScript orchestration fallback
- [ ] Strands service failure causes visible campaign failure
- [ ] `execution_engine = strands`
- [ ] `fallback_used = false`
- [ ] real `/agent-runs` page exists
- [ ] Agent Runs shows real persisted execution
- [ ] budget_exception exists
- [ ] budget exception resumes campaign correctly
- [ ] fake ROI removed
- [ ] spend/savings metrics are correct
- [ ] qualification uses Strands judgment
- [ ] outreach personalization has evidence
- [ ] hard decline suppresses future outreach
- [ ] unsubscribe suppresses future outreach
- [ ] max negotiation turns enforced
- [ ] absolute price ceiling enforced outside LLM
- [ ] campaign data stays isolated
- [ ] Strands-specific evaluations exist
- [ ] E2E test verifies fallback was not used
- [ ] demo completes without manual DB editing
- [ ] demo completes without manual Tick presses
- [ ] public-facing copy does not claim unsupported metrics

---

# STOP CONDITION

Once the above passes:

**STOP ADDING PRODUCT FEATURES.**

Focus only on:

```text
demo reliability
README
architecture diagram
AgentCore / deployment
submission copy
5-minute recording
```

The project already has enough features.

The remaining goal is to make the existing system:

```text
credible
observable
Strands-native
safe
easy to judge
```

That will improve the submission more than adding another feature.
