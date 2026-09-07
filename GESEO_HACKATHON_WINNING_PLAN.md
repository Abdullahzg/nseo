# GESEO — Hackathon Winning Upgrade Plan

## Purpose

This document is an implementation handoff for improving **Geseo** for the AWS / Devpost **Agents for Humans Hackathon**.

Do not treat this as a brainstorming document. Treat it as the prioritized build specification for the submission.

The goal is not to add more random features. The goal is to make the existing product score as highly as possible against the actual judging criteria:

1. Technical Implementation
2. Design
3. Potential Impact
4. Creativity & Originality
5. Presentation

The hackathon explicitly rewards deep, non-trivial use of the **Strands Agents SDK**. A live demo and/or deployment with **Amazon Bedrock AgentCore** strengthens Technical Implementation. The product should operate autonomously in the background and surface only when a real human decision is necessary.

---

# 1. Executive Diagnosis

Geseo already has a stronger product shell than many hackathon projects:

- end-to-end campaign lifecycle
- prospect discovery
- qualification
- contact resolution
- outreach
- inbox/reply processing
- negotiation
- human-in-the-loop interventions
- metrics
- multi-touch follow-ups
- demo personas
- persistent campaign state

However, **the current architecture undersells the agent itself**.

The most important current weakness is this:

> Geseo looks like a sophisticated TypeScript workflow application with a Strands layer attached to it, instead of a Strands-native autonomous agent product.

That must be reversed before submission.

The judging question is not "how many features exist?"

It is:

> "How thoroughly and skillfully does the project use Strands Agents?"

The final architecture and demo must make the answer obvious.

---

# 2. P0 — Critical Problems That Must Be Fixed

These are submission-blocking or score-killing issues.

## P0.1 — Demo Must Actually Run Through Strands

Current documentation contains contradictory behavior:

- Strands is described as the primary agent layer.
- TypeScript fallback can run the campaign.
- `/tick` routing appears to bypass Strands in demo mode.
- demo negotiation can use scripted/heuristic logic instead of Strands.
- business logic is described as living primarily in TypeScript.

This is dangerous for the hackathon.

### Required change

Create a single explicit **hackathon execution mode**:

```text
HACKATHON_MODE=true
DEMO_DATA=true
REQUIRE_STRANDS=true
ALLOW_ORCHESTRATOR_FALLBACK=false
```

When these flags are active:

- all orchestration MUST go through Strands
- all important judgment calls MUST go through Strands agents
- deterministic demo fixtures may replace external services
- deterministic tools may perform side effects
- the agent must still decide what to do with the fixture data
- if Strands is unavailable, the run must visibly fail
- never silently fall back to TypeScript orchestration

A demo can mock the external world.

It must NOT mock the core agent intelligence.

### Add an execution assertion

Every campaign run should store:

```json
{
  "execution_engine": "strands",
  "model_provider": "bedrock",
  "agent_run_id": "...",
  "fallback_used": false
}
```

The UI should show:

```text
Execution: Strands Agents
Fallback: OFF
```

during the demo.

---

## P0.2 — Make Strands the Actual Orchestrator

Do not leave the campaign as a large TypeScript state-machine where Strands merely calls HTTP wrappers.

Use Strands for the orchestration itself.

### Recommended pattern

Use a **Strands Graph** for the campaign lifecycle because the macro flow is structured but contains dynamic decisions.

Suggested graph:

```text
Campaign Manager
      |
      v
Strategy Agent
      |
      v
Discovery Agent
      |
      v
Research + Qualification Agent
      |
      v
Contact Agent
      |
      v
Outreach Agent
      |
      v
Reply Monitor
      |
      v
Negotiation Agent
      |
      +--------> Human Decision Gate
      |                 |
      |                 v
      |            resume campaign
      |
      +--------> Agreement / Decline / Follow-up
                        |
                        v
                    Completion
```

Not every box needs to be a separate LLM call.

Keep deterministic operations as tools.

Agents should own **judgment**.

Tools should own **actions and facts**.

### Agent responsibilities

#### Campaign Manager

Responsible for:

- understanding campaign goal
- delegating work
- deciding whether enough prospects exist
- deciding when the campaign should stop
- deciding whether another discovery pass is worth doing
- routing exceptions
- summarizing campaign state

#### Strategy Agent

Inputs:

- product URL
- product description
- campaign goal
- target market
- budget
- constraints

Outputs structured JSON:

```json
{
  "ideal_publication_profiles": [],
  "search_queries": [],
  "angles": [],
  "disallowed_targets": [],
  "success_criteria": {}
}
```

#### Discovery Agent

Uses tools such as:

- Tavily search
- publication lookup
- article search
- optional social/profile lookup

The agent decides:

- which queries to run
- whether results are redundant
- whether another search is needed
- which sites deserve research

#### Qualification Agent

This must not be only keyword counting.

For each prospect, evaluate:

- topical relevance
- editorial fit
- publication legitimacy
- audience fit
- article relevance
- likely partnership fit
- risk / spam signals
- reason for selection

Return structured output:

```json
{
  "score": 0.0,
  "decision": "qualify|reject|research_more",
  "reason": "...",
  "evidence": [],
  "risk_flags": []
}
```

Keyword heuristics may remain as cheap prefilters.

They must not be the main intelligence shown to judges.

#### Contact Agent

Decides:

- best person to contact
- editorial vs partnerships vs generic inbox
- whether confidence is sufficient
- whether human review is needed

Tools perform email lookup and validation.

#### Outreach Agent

Generates a personalized pitch using:

- actual article context
- campaign angle
- publication profile
- prior contact history
- campaign constraints

It should explain a short structured rationale for personalization without exposing hidden chain-of-thought.

Example:

```json
{
  "subject": "...",
  "body": "...",
  "personalization_basis": [
    "Referenced article X",
    "Matched publication focus Y",
    "Used campaign angle Z"
  ]
}
```

#### Negotiation Agent

This is one of Geseo's strongest differentiators.

Make it a first-class Strands agent.

It should:

- classify reply intent
- extract price and terms
- evaluate against campaign policy
- choose accept / counter / decline / escalate
- maintain negotiation history
- enforce hard caps
- stop after configured limits
- request human intervention only when required

---

## P0.3 — Fix the Negotiation Economics

The current `min_price` concept appears backwards.

Geseo is negotiating as the **buyer** of a publisher placement.

A publisher says:

```text
"Our rate is $350."
```

Geseo then tries to negotiate lower.

Therefore the critical hard constraint is not a minimum acceptable price.

It is a **maximum placement budget / ceiling**.

### Replace

```text
min_price
```

with:

```text
max_placement_price
target_placement_price
campaign_budget
```

Optional:

```text
auto_accept_below
human_approval_above
absolute_max_price
```

### Example

```json
{
  "target_placement_price": 175,
  "auto_accept_below": 200,
  "human_approval_above": 200,
  "absolute_max_price": 300
}
```

Rules:

```text
price <= auto_accept_below
    -> agent may accept autonomously

auto_accept_below < price <= absolute_max_price
    -> human approval required

price > absolute_max_price
    -> agent may counter but MUST NOT accept
```

Hard constraints must be enforced in deterministic code as well as communicated to the agent.

Never rely only on the LLM to respect financial limits.

---

## P0.4 — Fix ROI / Metrics Semantics

The current documentation treats negotiated publisher price as `deal_revenue`.

That is incorrect.

If the user is paying a publisher, the agreed amount is campaign spend.

### Remove misleading metric

```text
deal_revenue
```

unless Geseo genuinely earns that amount.

### Replace with

```text
placement_spend
publisher_initial_ask
negotiated_price
negotiated_savings
savings_pct
cost_per_agreement
reply_rate
qualified_to_reply_rate
agreement_rate
hours_saved_estimate
human_interventions
autonomous_resolution_rate
```

### Strong hackathon metric

Add:

```text
Autonomy Rate =
actions completed without human intervention /
total agent decisions
```

Add:

```text
Human Attention Saved =
estimated manual actions avoided
```

Add:

```text
Negotiation Savings =
sum(initial publisher asks - agreed prices)
```

These metrics directly support the "Agents for Humans" theme.

Do not invent monetary ROI unless the user provides a value model.

---

## P0.5 — Fix the Draft Phase Bug

Current documented flow requires manual database intervention:

```sql
UPDATE campaigns SET phase = 'planning' ...
```

This cannot exist in the submitted demo.

### Required behavior

```text
Create Campaign
    ->
Start Campaign
    ->
draft -> planning
    ->
agent executes
```

The user should never touch the database.

Add an end-to-end test that creates a campaign from a clean database and completes the full lifecycle without manual patches.

---

## P0.6 — Enforce Maximum Negotiation Turns

Current documentation explicitly says `max_thread_length` can be ignored.

Fix this.

Before any negotiation response:

```text
if agent_messages >= max_thread_length:
    status = "needs_human" OR "stalled"
    stop automatic replies
```

Write tests for:

- exactly at limit
- one below limit
- one above limit
- resumed human-approved thread

---

## P0.7 — Fix Cross-Campaign Persona / Thread Contamination

Current documentation says thread lookup can join by `author_id` without properly scoping by `campaign_id`.

That is a major state isolation bug.

Every query related to:

- prospect
- thread
- reply
- persona
- email
- intervention
- negotiation setting

must be scoped to:

```text
campaign_id
```

where applicable.

Add regression tests with two simultaneous campaigns using the same publication/domain.

---

## P0.8 — Stop Negotiating After Explicit Decline

If a prospect replies:

```text
We don't accept placements.
No thanks.
Please remove me.
Not interested.
```

the agent must immediately stop.

Add a global suppression / do-not-contact mechanism.

Required fields:

```text
suppressed_at
suppression_reason
```

No follow-up may be sent after a decline or opt-out.

---

# 3. P0 — Reposition the Product

Do NOT pitch the project as:

> "AI that automatically buys backlinks to manipulate Google rankings."

That framing creates a trust problem and weakens Potential Impact.

Google explicitly treats buying/selling links for ranking purposes and automated link creation as link spam. Paid links can be legitimate when appropriately qualified, e.g. `rel="sponsored"` or `rel="nofollow"`.

### Better product framing

Use:

> **Geseo is an autonomous digital PR and publisher outreach agent that discovers relevant publications, researches fit, personalizes outreach, manages replies, negotiates partnership terms within a budget, and only interrupts the human when a real judgment call is required.**

Backlinks can be a downstream benefit.

The core value proposition is:

- publisher outreach
- digital PR
- partnership discovery
- sponsored placements
- editorial collaboration
- relationship management

### Add a compliance/policy layer

Campaign policy should support:

```text
allow_paid_placements
require_sponsored_attribute
require_nofollow_for_paid
never_request_dofollow_payment
respect_opt_out
max_followups
blocked_domains
blocked_topics
```

This makes the product look mature instead of spam-oriented.

---

# 4. P0 — New Project / Eligibility Risk

The hackathon rules require the submitted project to be newly created during the submission period.

The current product contains many signs of a larger pre-existing SEO platform:

- legacy pages
- redirected pages
- AI Writer
- content clusters
- landing page builder
- site audit
- growth agents
- media
- admin tooling
- other unrelated SEO features

This can create avoidable eligibility questions.

### Required action

For the public hackathon repository:

1. isolate the Geseo agent work clearly
2. remove unrelated legacy product code where practical
3. disclose any pre-existing scaffolding/components that were reused
4. clearly state what was built during the hackathon
5. do not falsely claim old code was created during the contest

Best option:

```text
repo/
  app/
  agents/
  tools/
  evaluation/
  demo/
  docs/
```

Keep the submission focused on the hackathon project.

If retaining a larger pre-existing codebase, add a section:

```markdown
## Hackathon Build Scope

The following components were created during the Agents for Humans submission period:
- ...
- ...
- ...

Pre-existing scaffolding used:
- ...
```

Truthfulness is more important than making the repository look larger.

---

# 5. P1 — Redesign the User Flow

The current campaign creation form asks too many low-level questions.

A strong agent product should reduce configuration burden.

## Desired judge-facing flow

### Screen 1 — Create Campaign

Primary fields:

```text
Website / product URL
Goal
Target audience or keywords
Total budget
```

Optional:

```text
Anything the agent must never do?
```

Button:

```text
Build Campaign
```

The Strategy Agent should infer:

- product name
- product description
- likely audience
- publication categories
- search angles
- keywords
- initial outreach strategy

Show these as a generated campaign plan.

User can approve/edit.

Then:

```text
Start Agent
```

### Advanced settings

Hide these behind "Advanced":

- model/provider
- tone
- negotiation aggressiveness
- follow-up count
- pricing thresholds
- rate limits
- domain rules

Do not force the judge to configure 12 fields.

---

# 6. P1 — Remove "Tick" From the Main Product Experience

"Tick" is useful for debugging.

It is bad judge-facing UX.

The hackathon theme is an agent that runs in the background.

### Replace judge-facing controls with

```text
Start
Pause
Resume
Stop
```

The internal engine may still execute ticks.

The user should not need to trigger them.

### Debug mode

Keep:

```text
Run next step
```

inside an Agent Debug / Developer panel only.

---

# 7. P1 — Add an Agent Activity / Trust View

This can become one of the strongest parts of the demo.

Create a live activity timeline:

```text
14:32:04  Strategy Agent created 6 search angles
14:32:07  Discovery Agent searched "AI photo editing editorial tools"
14:32:11  Discovery Agent found 14 candidate publications
14:32:15  Qualification Agent accepted Pixelcraft Journal — score 0.91
14:32:19  Qualification Agent rejected FakeSEOList — low editorial quality
14:32:27  Contact Agent selected Sarah Mitchell — Editor
14:32:32  Outreach Agent sent personalized pitch
14:33:08  Reply Monitor detected publisher reply
14:33:10  Negotiation Agent extracted asking price: $350
14:33:12  Negotiation Agent countered at $180
14:33:40  Publisher countered at $230
14:33:42  Human approval requested — above $200 auto-approval threshold
```

Do not expose hidden chain-of-thought.

Store concise structured decision summaries.

### Add columns / event fields

```text
agent_name
action
tool_name
status
decision_summary
duration_ms
tokens_used
timestamp
campaign_id
run_id
```

Use Strands hooks / tracing where possible.

---

# 8. P1 — Add Strands Observability

Use Strands lifecycle hooks and OpenTelemetry.

Capture:

- agent invocation
- model calls
- tool calls
- tool failures
- retries
- agent handoffs
- graph node transitions
- durations
- tokens
- final status

Expose a sanitized subset in the UI.

This both improves the product and makes Strands usage visible to judges.

---

# 9. P1 — Deploy the Agent on Amazon Bedrock AgentCore

This is explicitly called out by the hackathon as strengthening the Technical Implementation score.

Do this if at all feasible.

Target architecture:

```text
Next.js UI
    |
    v
API
    |
    v
Amazon Bedrock AgentCore Runtime
    |
    v
Strands Graph / Agents
    |
    +--> Discovery tools
    +--> Publisher research tools
    +--> Contact tools
    +--> Email tools
    +--> Negotiation tools
    |
    v
Persistent DB / state
```

Prefer Bedrock for the final submission path even if Groq remains available for local development.

### Provider modes

```text
LOCAL_DEV_MODEL_PROVIDER=groq
HACKATHON_MODEL_PROVIDER=bedrock
```

The public demo and recorded video should use the hackathon path.

If AgentCore deployment becomes too unstable, prioritize:

1. working Strands execution
2. public live demo
3. Bedrock
4. AgentCore

Do not break the demo just to add AWS logos.

---

# 10. P1 — Simplify Navigation

Current sidebar is too broad for the hackathon story.

Hide unrelated modules from the hackathon build:

- Blog
- AI Writer
- Clusters
- Landing Pages
- Assets
- Voices
- Site Audit
- legacy backlink pages
- unnecessary admin pages

### Judge-facing navigation

Use something like:

```text
Overview
Campaigns
Decisions
Inbox
Agent Runs
Settings
```

This is more coherent and better aligned with the judging rubric.

---

# 11. P1 — Upgrade Qualification From Heuristic to Agentic Judgment

Current rule:

```text
keyword match count >= 2
```

is not good enough as the main qualifier.

Use it only as a cheap filter.

### Agent evaluation criteria

Score 0–1:

```text
topic_relevance
audience_fit
editorial_quality
placement_fit
contactability
trust_score
```

Generate:

```json
{
  "overall_score": 0.86,
  "decision": "qualify",
  "why": "Publication regularly covers AI creative tools and recently published a comparison article directly adjacent to the campaign topic.",
  "evidence": [
    {
      "title": "...",
      "url": "..."
    }
  ]
}
```

This gives judges something visibly intelligent to inspect.

---

# 12. P1 — Make Personalization Real

Do not generate generic lines like:

```text
I enjoyed your article...
```

without evidence.

The Outreach Agent should use a real snippet / topic / angle from the publication research.

Require the draft to include:

```text
personalization_source_id
personalization_claim
```

Then verify the claim is supported by stored research.

If no support exists:

```text
use generic but honest outreach
```

Never hallucinate article details.

---

# 13. P1 — Human-in-the-Loop Should Represent Real Decisions

Current call/meeting escalation is fine but not sufficiently compelling.

Use human intervention for decisions that demonstrate why the product is trustworthy.

## Strong intervention types

### `budget_exception`

Publisher asks above autonomous approval threshold.

Card:

```text
Publisher: Pixelcraft Journal
Initial ask: $350
Current ask: $230
Your auto-approval limit: $200
Agent recommendation: Counter at $200
Reason: publication fit = 0.91; current price = 15% above approval threshold
```

Actions:

```text
Approve $230
Counter $200
Decline
Take over
```

### `policy_exception`

Example:

```text
Publisher requires an unqualified paid dofollow link.
```

Agent recommendation:

```text
Decline or request sponsored/nofollow attribution.
```

### `relationship_exception`

Prospect requests:

```text
call
custom package
cross-promotion
exclusive arrangement
legal terms
invoice / PO
```

### `low_confidence`

Agent cannot confidently determine:

```text
contact identity
publication legitimacy
reply intent
```

This is much stronger than escalating arbitrarily.

---

# 14. P1 — Build a Real Evaluation Harness

Winning agent projects increasingly show evidence, not only UI.

Create:

```text
evaluation/
  reply_cases.json
  qualification_cases.json
  negotiation_cases.json
  run_eval.py
  README.md
```

## Reply classification benchmark

At least 50 synthetic-but-realistic messages across:

```text
positive
decline
negotiation
meeting
OOO
price question
invoice/payment
unsubscribe
ambiguous
spam
```

Measure:

```text
classification_accuracy
critical_misclassification_rate
```

## Negotiation safety benchmark

At least 30 scenarios.

Verify:

- never accepts above absolute max
- never continues after opt-out
- never exceeds thread limit
- escalates ambiguous financial terms
- accepts valid low-price offers when allowed
- preserves currency correctly

Target:

```text
100% deterministic hard-constraint compliance
```

Do not fake the score.

Run the benchmark and publish the actual result.

## Campaign isolation test

Run two campaigns simultaneously with overlapping domains.

Verify zero cross-contamination.

## End-to-end test

One command should run:

```text
create campaign
-> strategy
-> discovery
-> qualification
-> contacts
-> outreach
-> simulated replies
-> negotiation
-> human gate
-> completion
```

Fail if any manual DB change is needed.

---

# 15. P1 — Demo Data Strategy

Deterministic fixtures are acceptable for demo reliability.

But distinguish between:

```text
mock world
```

and:

```text
mock agent
```

### Good

Fixtures provide:

- publications
- articles
- contact records
- incoming replies

Then real Strands agents decide:

- relevance
- who to contact
- what to write
- reply intent
- negotiation move
- whether to escalate

### Bad

Fixtures predefine:

- classification
- reply action
- negotiation decision
- final result

The latter makes the agent appear fake.

---

# 16. P1 — Demo Personas Should Test Intelligence

Keep personas, but change them from scripted success stories to agent challenges.

Suggested set:

## Persona A — Easy agreement

```text
"Sounds relevant. Our sponsored inclusion is $125."
```

Expected:

```text
accept autonomously if within policy
```

## Persona B — High anchor

```text
"We normally charge $450."
```

Expected:

```text
negotiate within budget
```

## Persona C — Boundary case

```text
"We can do $225, but only if the link is dofollow and not labeled sponsored."
```

Expected:

```text
policy escalation / compliant counter
```

## Persona D — Meeting

```text
"Can we talk Tuesday?"
```

Expected:

```text
human decision or calendar workflow
```

## Persona E — Decline

```text
"Not interested. Remove us from future outreach."
```

Expected:

```text
suppress permanently
```

## Persona F — Ambiguous

```text
"Maybe. What exactly are you proposing?"
```

Expected:

```text
clarify without negotiating prematurely
```

## Persona G — Invoice

```text
"$180 works. Send billing details and PO."
```

Expected:

```text
payment-details handoff
```

This gives the demo breadth.

---

# 17. P1 — Security / Public Repo Cleanup

Before making the repository public:

Remove all:

```text
SMTP passwords
API keys
Google app passwords
database passwords
tokens
private URLs
real private inbox data
```

Add:

```text
.env.example
```

Replace personal demo addresses in docs and fixtures with neutral placeholders where possible.

Example:

```text
demo.publisher@example.test
demo.sender@example.test
```

Run secret scanning before publishing.

---

# 18. P1 — Required Submission Assets

Ensure the repository contains:

```text
LICENSE
README.md
ARCHITECTURE.md
architecture.png
DEMO.md
EVALUATION.md
.env.example
```

License must be MIT or Apache-compatible with hackathon requirements.

README should make setup easy.

A judge should understand the project within 60 seconds.

---

# 19. P1 — README Structure

Use this structure:

```markdown
# Geseo

One-line product statement.

## The Problem

## What Geseo Does

## Why an Agent Is Necessary

Explain why a traditional workflow is insufficient:
- research is open-ended
- relevance requires judgment
- email personalization is contextual
- replies are unstructured
- negotiation is dynamic
- escalation requires policy reasoning

## Demo

## Architecture

## How Strands Is Used

List every Strands agent and orchestration pattern.

## Human-in-the-Loop

## Safety / Guardrails

## Evaluation Results

## AWS Architecture

## Run Locally

## Hackathon Build Scope

## License
```

The section `How Strands Is Used` is mandatory strategically.

Do not make judges hunt for it.

---

# 20. P1 — Architecture Diagram Requirements

The architecture diagram must visibly show:

```text
User
 |
 v
Geseo Web App
 |
 v
Amazon Bedrock AgentCore Runtime
 |
 v
Strands Campaign Graph
 |
 +--> Strategy Agent
 +--> Discovery Agent
 +--> Qualification Agent
 +--> Contact Agent
 +--> Outreach Agent
 +--> Negotiation Agent
 |
 v
Tools
 |
 +--> Search
 +--> Contact Resolution
 +--> Email
 +--> Database
 |
 v
Human Decision Gate
```

Also show:

```text
Strands Hooks / OpenTelemetry
```

feeding:

```text
Agent Run Timeline / Observability
```

A judge should understand the agent architecture without reading code.

---

# 21. P2 — Product Features Worth Adding Only After P0/P1

Do not build these until core scoring weaknesses are fixed.

## P2.1 — Adaptive Campaign Strategy

After a batch of outreach:

```text
Agent notices:
- security publications reply more often
- generic AI blogs reject
- direct partnership subject performs better
```

Campaign Manager updates future targeting.

Show an event:

```text
Strategy updated:
Prioritize product-comparison publications.
Reason: 3.1x reply rate in current campaign.
```

This is highly agentic.

---

## P2.2 — Publisher Memory

Store publication preferences:

```text
typical price
preferred contact
previous response
topics accepted
last contacted date
do-not-contact
sponsorship policy
```

Use this to avoid repeated cold research.

---

## P2.3 — Campaign Goal Stop Condition

Let user specify:

```text
Goal: 5 accepted placements
Budget: $1,000
```

Agent decides when to stop.

Example:

```text
Goal reached: 5 placements
Spend: $910
Remaining prospects canceled
Campaign completed
```

This makes the system outcome-driven rather than phase-driven.

---

## P2.4 — Recovery / Retry

Use Strands hooks for:

- model retries
- tool retries
- transient API errors
- structured output validation

Show recovered failures in Agent Runs.

---

# 22. Judge-Facing Demo Flow — Exact Recommended Sequence

The entire demo must fit within 5 minutes.

## 0:00–0:25 — Problem

Show the repetitive workflow visually:

```text
Find publications
Read articles
Decide fit
Find contacts
Write emails
Follow up
Read replies
Negotiate pricing
Track outcomes
Escalate exceptions
```

Pitch:

> Digital PR teams repeat this workflow hundreds of times. Geseo is an autonomous campaign operator that handles the repetitive research, outreach and negotiation loop, and only asks for help when a real business decision appears.

Do not lead with generic "AI-powered SEO."

---

## 0:25–0:50 — Create Campaign

Enter only:

```text
URL
Goal
Target audience
Budget
```

Click:

```text
Build Campaign
```

Show Strategy Agent produce:

- target publication types
- discovery queries
- messaging angles
- guardrails

Click:

```text
Start Agent
```

This should be the last manual action for a while.

---

## 0:50–1:50 — Autonomous Research

Show live Agent Timeline.

Speed up long waits.

Visually show:

```text
Discovery Agent -> publications
Qualification Agent -> score + evidence
Contact Agent -> contact selection
```

Open one qualified prospect and show why it was selected.

Open one rejected prospect and show why it was rejected.

---

## 1:50–2:30 — Outreach

Show:

```text
Outreach Agent generating a genuinely personalized email
```

The UI should display:

```text
Personalized from:
- article X
- topic Y
- campaign angle Z
```

Send.

Show a second/third outreach happening automatically.

---

## 2:30–3:25 — Replies + Negotiation

Inject or receive demo replies.

Show at least:

```text
easy agreement
high-price negotiation
decline
```

The negotiation should visibly use:

```text
publisher ask
current offer
budget threshold
number of rounds
```

One thread should close automatically.

One should be suppressed after decline.

---

## 3:25–4:05 — The Human Moment

This is the key emotional moment of the demo.

Publisher asks:

```text
$230
```

Campaign auto-approval ceiling:

```text
$200
```

Agent generates a decision card:

```text
Recommendation: Counter at $200
Publication fit: 0.91
Initial ask: $350
Current ask: $230
Why you're seeing this: price exceeds autonomous approval limit
```

Click:

```text
Counter $200
```

Agent resumes.

This directly demonstrates the hackathon thesis:

> AI handles routine work; humans handle judgment.

---

## 4:05–4:35 — Results

Show:

```text
Prospects researched
Qualified
Outreach sent
Replies
Agreements
Publisher initial asks
Final negotiated spend
Negotiation savings
Autonomy rate
Human interventions
Estimated manual actions avoided
```

Do not show fake `deal_revenue`.

---

## 4:35–5:00 — Architecture / Closing

Show architecture diagram.

Explicitly say:

```text
- Strands Agents Graph orchestrates the campaign
- specialist Strands agents make contextual decisions
- deterministic tools execute actions
- AgentCore hosts the agent runtime
- hard financial and policy guardrails are enforced outside the LLM
- humans are only surfaced for exceptions
```

End on outcome:

> One campaign goal, one start click, dozens of decisions handled automatically, one human interruption.

---

# 23. Presentation Rules

## Do

- show the product working
- show Strands visibly
- show one real human decision
- show agent reasoning summaries
- show a measurable result
- show architecture
- keep the story about removing human busywork

## Do not

- spend 90 seconds explaining libraries
- browse every page
- show legacy SEO features
- manually click Tick repeatedly
- show database SQL
- show terminal setup
- show broken fallback behavior
- claim the agent is autonomous while manually advancing it
- pitch paid dofollow ranking manipulation
- call placement spend "revenue"

---

# 24. Bonus Points — Do Not Ignore This

The official rules allow up to **0.6 bonus points** for qualifying builder.aws posts, with up to three pieces at 0.2 each.

This is large relative to a 5-point base judging scale.

Publish three useful build posts if possible.

Suggested topics:

1. **Agents for Humans: Building a Strands Multi-Agent Publisher Outreach Graph**
2. **Agents for Humans: Designing Safe Autonomous Negotiation With Human Approval Gates**
3. **Agents for Humans: Observability and Evaluation for a Background Strands Agent**

Each post should be substantive and honest.

Use screenshots, architecture, implementation choices, failures and fixes.

Do not publish three shallow duplicates.

---

# 25. Recommended Build Order

Do not work randomly.

## Phase A — Submission safety

- [ ] clean public repo
- [ ] confirm hackathon build scope / disclosure
- [ ] add MIT or Apache license
- [ ] remove secrets / personal credentials
- [ ] replace personal demo data

## Phase B — Core correctness

- [ ] draft -> planning transition
- [ ] max negotiation turns
- [ ] cross-campaign isolation
- [ ] decline / unsubscribe suppression
- [ ] replace `min_price`
- [ ] correct metrics / ROI semantics
- [ ] ensure all hard budget limits are deterministic

## Phase C — Strands-native architecture

- [ ] create Campaign Graph
- [ ] implement specialist Strands agents
- [ ] structured outputs
- [ ] move judgment out of TS heuristics
- [ ] leave actions/validation as deterministic tools
- [ ] disable fallback in hackathon mode
- [ ] record execution metadata

## Phase D — Agent visibility

- [ ] Strands hooks
- [ ] traces
- [ ] Agent Run Timeline
- [ ] decision summaries
- [ ] graph/node status

## Phase E — Judge-facing UX

- [ ] simplify create campaign
- [ ] generated strategy preview
- [ ] remove Tick from primary UI
- [ ] simplify sidebar
- [ ] build decision cards
- [ ] fix metrics dashboard

## Phase F — Evaluation

- [ ] 50+ reply classification cases
- [ ] 30+ negotiation cases
- [ ] hard guardrail tests
- [ ] cross-campaign isolation test
- [ ] clean-database E2E
- [ ] record actual benchmark results

## Phase G — AWS

- [ ] Bedrock model path
- [ ] AgentCore Runtime deployment
- [ ] public live demo
- [ ] verify deployment for full judging period

## Phase H — Submission

- [ ] README
- [ ] architecture diagram
- [ ] 5-minute demo video
- [ ] Devpost description
- [ ] live demo instructions
- [ ] public repo
- [ ] AWS Builder ID
- [ ] builder.aws bonus posts

---

# 26. Acceptance Tests Before Recording

The project is not ready to record until ALL of these pass.

## Functional

- [ ] clean campaign starts from `draft`
- [ ] no DB editing required
- [ ] campaign runs without manual ticks
- [ ] Strands executes every important judgment step
- [ ] no TS orchestration fallback occurs
- [ ] discovery produces candidates
- [ ] qualification uses contextual agent judgment
- [ ] outreach contains evidence-backed personalization
- [ ] incoming replies are classified correctly
- [ ] decline stops all future outreach
- [ ] unsubscribe adds suppression
- [ ] negotiation respects hard price ceilings
- [ ] negotiation respects max thread length
- [ ] human exception pauses the thread
- [ ] human action resumes the thread
- [ ] campaign completion condition works
- [ ] two campaigns cannot contaminate one another

## Hackathon proof

- [ ] UI visibly identifies Strands execution
- [ ] Agent Runs page shows real tool calls
- [ ] architecture diagram shows Strands orchestration
- [ ] README explains exact Strands usage
- [ ] public build can be tested without secret credentials
- [ ] live demo remains available
- [ ] repository license visible

## Presentation

- [ ] recorded run finishes successfully
- [ ] no loading dead time
- [ ] no broken pages
- [ ] no legacy pages shown
- [ ] human decision moment is obvious
- [ ] metrics are semantically correct
- [ ] video is below 5 minutes

---

# 27. Suggested Final Product Statement

Use something close to:

> **Geseo is an autonomous digital PR and publisher outreach agent. Give it a product, campaign goal, budget, and guardrails. It researches relevant publications, identifies the right contacts, writes evidence-backed outreach, follows up, interprets replies, and negotiates partnership terms using Strands Agents. Routine decisions happen automatically; budget, policy, or relationship exceptions are packaged into a single human decision card.**

This is substantially stronger than:

> "AI backlink automation."

---

# 28. The One Feature Judges Should Remember

The project needs one memorable interaction.

Make it this:

```text
Hundreds of background agent decisions
              |
              v
     ONE human decision card
              |
              v
       agent resumes itself
```

The judge should leave remembering:

> "That was the outreach agent that researches publications and negotiates on its own, but brings me in when a price or policy boundary is crossed."

Everything in the build should reinforce that memory.

---

# 29. What NOT to Spend Time On

Until every P0/P1 item is complete, do not spend meaningful time on:

- new blog-writing features
- site audit
- extra SEO dashboards
- fancy admin controls
- content generation
- large template libraries
- unrelated analytics
- new integrations that do not appear in the demo
- superficial multi-agent counts
- adding agents whose only purpose is to say there are more agents

Six real agents are better than twenty thin wrappers.

---

# 30. Final Engineering Principle

The architecture should follow this rule:

```text
LLM / Strands agent:
    judgment
    planning
    classification
    prioritization
    negotiation strategy
    escalation decision

Deterministic tool / code:
    API calls
    database operations
    sending email
    hard financial limits
    opt-out enforcement
    retries
    idempotency
    state isolation
    validation
```

This makes the project both genuinely agentic and safe enough to trust.

---

# 31. Agent Instructions for Implementing This Plan

Work through the document in priority order.

For every change:

1. inspect existing implementation before modifying it
2. preserve working functionality unless it conflicts with this plan
3. add tests for each bug fix
4. do not silently introduce mocks into the intelligence layer
5. use demo fixtures only for external-world inputs
6. keep Strands as the execution path in hackathon mode
7. keep hard constraints deterministic
8. continuously run the complete end-to-end demo
9. update `GSEO_DOCUMENTATION.md` after behavior changes
10. maintain a `HACKATHON_READINESS.md` checklist with pass/fail evidence

Do not consider a feature complete because the UI exists.

A feature is complete only if its underlying execution is real, testable, and visible in the agent trace.

