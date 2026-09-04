# Migrate GenAI Scout to Strands Agents for the Agents for Humans Hackathon

We now have a clear architectural direction.

The target hackathon is NOT the Google All Things Agentic Hackathon.

The target is:

**AWS / Devpost — Agents for Humans Hackathon**

The submission MUST use **Strands Agents SDK** as a core part of the working application.

The existing application architecture, database, campaign domain logic, UI, negotiation safeguards, gateway endpoints, and integrations should be preserved wherever possible.

Your task is to migrate the AGENT ORCHESTRATION LAYER from Google ADK to Strands Agents SDK and produce a working end-to-end demo where Strands is unquestionably executing the campaign.

Do not rewrite the application unnecessarily.

---

# PRIMARY OBJECTIVE

Replace:

```text
Google ADK
    +
TypeScript fallback orchestrator
```

as the hackathon agent execution path with:

```text
Strands Agents SDK
```

The resulting runtime should be approximately:

```text
Next.js UI
    |
    v
Campaign /tick API
    |
    v
Strands Campaign Manager
    |
    +--> Strategy Agent
    +--> Discovery Agent
    +--> Qualification Agent
    +--> Contact Resolution Agent
    +--> Outreach Agent
    +--> Negotiation Agent
    +--> Intervention Agent
             |
             v
       Strands custom tools
             |
             v
Existing Next.js /api/agent/tools/* gateway
             |
             v
Existing TypeScript business logic + database
```

Do NOT migrate business logic from TypeScript to Python simply to make the architecture look different.

The existing HTTP tool boundary is useful and should remain.

---

# PHASE 1 — PRESERVE AND SNAPSHOT

Before modifying architecture:

1. Inspect current git status.
2. Commit or preserve uncommitted diagnostic files appropriately.
3. Record the current working demo result.
4. Run existing tests.
5. Record baseline results.

The existing 24 regression tests must continue passing.

Do not remove the Google ADK implementation immediately.

Keep it until the Strands version is proven working.

---

# PHASE 2 — ADD STRANDS DEPENDENCIES

Update the Python agent service dependencies.

Required core dependency:

```text
strands-agents
```

Likely useful:

```text
strands-agents-tools
bedrock-agentcore
boto3
```

Remove `google-adk` only AFTER the Strands implementation is fully working and no production code references it.

Do not perform dependency upgrades unrelated to this migration.

---

# PHASE 3 — MODEL PROVIDER

The default hackathon model provider should become **Amazon Bedrock**.

Use Strands' Bedrock model provider.

Configuration should support something conceptually like:

```text
AGENT_MODEL_PROVIDER=bedrock
STRANDS_MODEL_ID=<model>
AWS_REGION=<region>
```

Do NOT hardcode credentials.

AWS credentials must come from the normal AWS credential chain / environment.

Gemini MAY remain as an optional Strands model provider for local development.

Do NOT directly call Gemini outside Strands for the main agent reasoning path.

Desired model selection behavior:

```text
bedrock -> default hackathon path
gemini  -> optional development alternative
```

The application should clearly log which Strands model provider and model ID are being used.

---

# PHASE 4 — CONVERT EXISTING GATEWAY FUNCTIONS INTO STRANDS TOOLS

The current Python gateway already calls the Next.js agent endpoints.

Preserve that boundary.

Convert the existing nine agent operations into genuine Strands tools using `@tool`.

Expected tools:

```text
get_campaign_state
plan_discovery
run_discovery_batch
run_qualification_batch
run_contact_resolution
queue_outreach_batch
run_negotiation_tick
list_open_interventions
complete_campaign
```

Prefer:

```python
from strands import tool
```

Do not make the model invent or repeatedly pass the campaign UUID.

Use Strands invocation state / ToolContext.

Conceptually:

```python
@tool(context=True)
def run_qualification_batch(tool_context: ToolContext):
    campaign_id = tool_context.invocation_state["campaign_id"]
    ...
```

The campaign ID should enter through the `/tick` invocation and flow through Strands invocation state.

This avoids exposing infrastructure identifiers to the model unnecessarily.

---

# PHASE 5 — SPECIALIST STRANDS AGENTS

Recreate the existing agent responsibilities using genuine Strands `Agent` objects.

Create at least:

```text
strategy_agent
discovery_agent
qualification_agent
contact_agent
outreach_agent
negotiation_agent
intervention_agent
campaign_manager
```

Each specialist must have:

- a narrow system prompt
- only the tools required for its responsibility
- a useful name
- a useful description

Example responsibility mapping:

```text
strategy_agent
    -> plan_discovery

discovery_agent
    -> run_discovery_batch

qualification_agent
    -> run_qualification_batch

contact_agent
    -> run_contact_resolution

outreach_agent
    -> queue_outreach_batch

negotiation_agent
    -> run_negotiation_tick

intervention_agent
    -> list_open_interventions
```

The `campaign_manager` should have:

```text
get_campaign_state
complete_campaign
specialist agents exposed as tools
```

Use Strands' **Agents as Tools** pattern so the Campaign Manager genuinely delegates reasoning/action to specialist agents.

Do NOT merely rename ordinary Python functions "agents".

Judges inspecting the repository should clearly see multiple Strands Agent objects.

---

# PHASE 6 — CAMPAIGN MANAGER RULES

Preserve the existing bounded-tick behavior.

The Campaign Manager should:

1. Read current campaign state.
2. Determine the current lifecycle phase.
3. Delegate to exactly ONE relevant specialist during a normal tick.
4. Re-read or evaluate resulting state if necessary.
5. Return a structured tick result.

Lifecycle remains:

```text
planning
    ↓
discovering
    ↓
qualifying
    ↓
resolving_contacts
    ↓
outreaching
    ↓
monitoring
    ↓
completed
```

Do not allow the LLM to arbitrarily mutate campaign phases.

Phase transitions remain deterministically validated by backend/domain logic.

The LLM chooses the appropriate action.

The backend remains authoritative for policy and state.

This separation is important.

---

# PHASE 7 — STRANDS SESSION MANAGEMENT

Add genuine Strands session handling.

Development:

```text
FileSessionManager
```

Production/AWS:

prefer:

```text
S3SessionManager
```

unless AgentCore Memory is implemented later.

Use a campaign-scoped session identifier such as:

```text
campaign-{campaign_id}
```

The relational campaign database remains the canonical business-state store.

Strands session state is for:

- agent conversation history
- orchestration context
- resumability
- agent state

Do not duplicate the entire campaign database inside the session.

---

# PHASE 8 — HUMAN IN THE LOOP

Preserve the existing `interventions` table and current 13 intervention categories.

Integrate Strands' interrupt/resume capability where it adds value.

Examples:

```text
publisher requests phone call
publisher requests unsupported asset
publisher asks unknown factual question
financial terms exceed ceiling
payment/invoice details requested
```

The deterministic backend should still decide when a policy requires escalation.

Where practical:

```text
backend determines intervention condition
    ->
Strands tool raises interrupt
    ->
UI shows intervention
    ->
human provides response
    ->
agent resumes
```

Do not weaken any current safety/price policies merely to use Strands.

---

# PHASE 9 — OBSERVABILITY

Use Strands hooks to record useful agent execution information into the existing `agent_events` timeline.

Capture at minimum:

```text
run_id
campaign_id
agent name
tool name
start time
duration
success/failure
state before
state after
error if applicable
```

Do not log:

- API keys
- credentials
- email passwords
- secrets

Add enough information to the UI that during the demo we can visibly show:

```text
Campaign Manager
    delegated to Qualification Agent
        called run_qualification_batch
```

We want judges to SEE the multi-agent workforce executing.

---

# PHASE 10 — FIX DEMO DR DATA PROPERLY

Do NOT bypass the DR qualification policy in demo mode.

Do NOT globally set the campaign minimum DR to zero.

Instead update demo fixtures so each synthetic publisher has a realistic deterministic DR value.

Use a range where some publishers intentionally FAIL and some PASS.

For example, approximately:

```text
22
34
47
55
68
72
31
29
44
61
76
38
```

These exact numbers are not mandatory if the fixtures already imply more appropriate values.

Important behavior:

For:

```text
min_dr = 30
```

the demo should visibly show:

```text
low DR prospect -> rejected
high DR prospect -> qualified
```

This proves the qualification agent is doing useful work.

The values must be deterministic between runs.

---

# PHASE 11 — REMOVE GEMINI QUOTA AS A BLOCKER

The working hackathon demo must NOT depend on the currently exhausted Gemini API key.

Primary path:

```text
Strands -> Amazon Bedrock
```

Gemini can remain optional.

If Bedrock is unavailable locally, it is acceptable to use a Strands-supported alternate model temporarily, but the hackathon architecture should be Bedrock-first.

The agent must never silently degrade from:

```text
Strands reasoning
```

to:

```text
heuristic-only TypeScript orchestration
```

during the recorded hackathon demo.

---

# PHASE 12 — CHANGE FALLBACK BEHAVIOR

The current TypeScript fallback is useful for resilience, but it creates a serious hackathon judging problem because the system can appear to work while Strands is not running.

Add:

```text
HACKATHON_MODE=true
```

or equivalent.

When enabled:

If the Strands service is unavailable:

```text
FAIL VISIBLY
```

Do NOT silently run the TypeScript fallback.

Normal production/development mode may retain the old fallback if there is a legitimate reason.

But hackathon mode must prove that the Strands service is executing.

The UI/log should expose:

```text
Agent framework: Strands Agents SDK
Provider: Amazon Bedrock
Agent: campaign_manager
```

---

# PHASE 13 — HEALTH ENDPOINT

Update the Python agent `/health` response.

It should provide non-sensitive metadata such as:

```json
{
  "ok": true,
  "framework": "strands-agents",
  "model_provider": "bedrock",
  "model_id": "...",
  "agents": [
    "campaign_manager",
    "strategy_agent",
    "discovery_agent",
    "qualification_agent",
    "contact_agent",
    "outreach_agent",
    "negotiation_agent",
    "intervention_agent"
  ]
}
```

Do not include credentials.

---

# PHASE 14 — END-TO-END STRANDS TEST

Create a dedicated test such as:

```text
scripts/strands-demo-test.mjs
```

or an equivalent Python integration test.

It must prove:

```text
campaign created
↓
campaign started
↓
request reaches Strands service
↓
campaign_manager invoked
↓
specialist agent invoked
↓
Strands tool invoked
↓
Next.js gateway called
↓
campaign progresses
↓
qualified/rejected prospects exist
↓
outreach occurs
↓
negotiation occurs
↓
deal closes
↓
campaign completes
```

The test should verify that at least one `agent_event` contains explicit evidence of Strands execution.

It is NOT sufficient for the final test to pass through `fallbackOrchestrator.ts`.

---

# PHASE 15 — TESTING REQUIREMENTS

At minimum rerun:

```bash
npx vitest run
```

```bash
npx tsc --noEmit
```

Existing edge-case tests.

Existing demo arc.

New Strands agent tests.

New complete Strands integration test.

Python import/startup tests.

Run the full demo multiple times.

Record exact results.

---

# PHASE 16 — AGENTCORE PREPARATION

After local Strands execution works reliably, prepare the Python service for optional Amazon Bedrock AgentCore deployment.

Use:

```python
from bedrock_agentcore.runtime import BedrockAgentCoreApp
```

Provide an AgentCore-compatible entrypoint around the Strands campaign manager.

Conceptually:

```python
app = BedrockAgentCoreApp()

@app.entrypoint
def invoke(payload, context):
    ...
```

Do NOT deploy yet if AWS credentials/project configuration are unavailable.

But make the agent code structurally compatible.

Document exact deployment commands.

The expected deployment tooling is the current AWS AgentCore CLI.

Prepare documentation for:

```bash
npm install -g @aws/agentcore
```

followed by the appropriate AgentCore configuration/deployment flow.

Do not invent successful deployment results.

Only mark AgentCore as deployed once verified.

---

# PHASE 17 — DOCUMENTATION / HACKATHON COMPLIANCE

Update documentation so it describes the correct hackathon.

Remove incorrect references claiming the project is for:

```text
Google All Things Agentic Hackathon
```

The target is:

```text
AWS Agents for Humans Hackathon
```

Recommended track:

```text
Professional Agents
```

Explain why:

The agent automates repetitive, judgment-heavy SEO outreach and negotiation work normally performed by SEO/content professionals.

Update architecture diagrams to explicitly show:

```text
Strands Agents SDK
Amazon Bedrock
specialist agents
custom tools
human intervention
database
external integrations
AgentCore Runtime if deployed
```

---

# PHASE 18 — LICENSE

The repository must contain either an MIT or Apache open-source license for the hackathon.

Prefer MIT unless there is a project-specific reason Apache is more appropriate.

Do not license code that the project does not have rights to sublicense.

Flag any ownership/licensing uncertainty before changing licensing.

---

# PHASE 19 — PRE-EXISTING WORK DISCLOSURE

DO NOT remove `docs/PREEXISTING_WORK.md`.

Improve it.

The rules permit disclosed pre-existing components but the submitted project itself must be new during the hackathon window.

Clearly separate:

```text
PRE-EXISTING COMPONENTS
```

from:

```text
BUILT DURING AGENTS FOR HUMANS
```

Use git history where possible.

Be precise and transparent.

Do not exaggerate how much was newly built.

Do not rewrite git history to hide pre-existing work.

---

# PHASE 20 — README PROOF

The README should contain a section:

```text
## How Strands Agents Is Used
```

Explain:

- campaign_manager is a Strands Agent
- specialist agents are Strands Agents
- agents-as-tools delegation
- custom @tool wrappers
- invocation state
- session management
- interrupts/HITL
- hooks/observability
- Bedrock model provider
- AgentCore deployment if completed

Also provide a quick-start that actually launches the Strands service.

---

# DEFINITION OF DONE

Do NOT report this migration as complete until ALL of these are true:

1. `strands-agents` is installed.

2. `campaign_manager` is a genuine Strands Agent.

3. Specialist agents are genuine Strands Agents.

4. Existing campaign gateway functions are exposed as genuine Strands tools.

5. `/tick` actually invokes Strands.

6. A complete campaign can progress using the Strands path.

7. Hackathon mode cannot silently fall back to the TypeScript orchestrator.

8. Demo prospects have realistic DR values.

9. At least one prospect is rejected by the DR gate and another passes.

10. Negotiation can still close a deal.

11. Existing price/budget safety rules remain intact.

12. Existing tests continue passing.

13. New Strands tests pass.

14. The agent event timeline proves Strands agent/tool execution.

15. README documents Strands usage.

16. Architecture diagram contains Strands.

17. Google hackathon references are corrected.

18. Pre-existing work is clearly disclosed.

19. No secrets are committed.

20. The public-repo license requirement is addressed.

---

# AFTER LOCAL SUCCESS

Only after all local acceptance criteria pass:

Prepare and attempt AgentCore deployment.

If AWS credentials/access are available, deploy the Strands service to Amazon Bedrock AgentCore Runtime and test a real invocation.

If deployment succeeds:

Record:

- Runtime ARN safely where appropriate
- deployment region
- tested invocation
- observability confirmation

Do not commit credentials.

If AgentCore deployment fails:

Preserve the fully working local Strands implementation and document the exact deployment blocker rather than breaking the local system.

---

# FINAL REPORT

After implementation create:

`STRANDS_MIGRATION_REPORT.md`

Include:

```text
Previous architecture
New architecture
Files changed
Strands features used
Agent topology
Tools implemented
Model/provider
Session strategy
HITL strategy
Observability
DR demo fix
Test results
AgentCore status
Remaining blockers
Hackathon readiness
```

Also give me a concise final response containing:

1. whether a full Strands campaign now completes
2. whether TypeScript fallback was used
3. number of Strands agents
4. number of Strands tools
5. model/provider used
6. test results
7. AgentCore deployment status
8. remaining blockers

Do not start adding unrelated features.