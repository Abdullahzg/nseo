"""ADK agent definitions for the SEO Deal Acquisition Workforce.

Architecture (docs/AGENT_DESIGN.md):
  campaign_manager (root, Gemini) ─ coordinates the whole objective per tick
    ├─ strategy_agent      ─ turns objective+state into a plan / next-phase advice
    ├─ discovery_agent     ─ runs bounded search batches via tools
    ├─ qualification_agent ─ evaluates prospects (deterministic scoring server-side)
    ├─ contact_intel_agent ─ resolves author/editor contacts
    ├─ outreach_agent      ─ queues personalized sends (gated by the burst processor)
    ├─ negotiation_agent   ─ triages replies + negotiates under a hard price ceiling
    └─ deal_agent          ─ records structured deals + completion checks

Design rules:
  - Money math, ceilings, budget and send safety are ENFORCED IN CODE on the
    gateway side. The LLM chooses actions; it can never override policy.
  - Deterministic work stays deterministic. Gemini is invoked once per tick with
    compact state; every tool result is summarized back into its context.
"""
from __future__ import annotations

from google.adk.agents import LlmAgent
from google.adk.tools import FunctionTool

from . import config
from .tools import (
    get_campaign_state,
    plan_discovery,
    run_discovery_batch,
    run_qualification_batch,
    run_contact_resolution,
    queue_outreach_batch,
    run_negotiation_tick,
    list_open_interventions,
    complete_campaign,
)

MODEL = config.GEMINI_MODEL

# ── specialized sub-agents ────────────────────────────────────────────────────

strategy_agent = LlmAgent(
    name="strategy_agent",
    model=MODEL,
    description="Turns the campaign objective and current funnel state into an execution plan.",
    instruction=(
        "You are the Campaign Strategy Agent for an autonomous SEO outreach workforce.\n"
        "Given the campaign state JSON, produce a SHORT plan:\n"
        "1) which phase deserves effort next (discover|qualify|contact|outreach|negotiate|complete),\n"
        "2) any adjustment to search focus (new keyword angles),\n"
        "3) risks worth watching.\n"
        "Be decisive and terse. Use the get_campaign_state tool to inspect state when needed.\n"
        "Never invent numbers that are not in the state."
    ),
    tools=[FunctionTool(get_campaign_state)],
)

discovery_agent = LlmAgent(
    name="discovery_agent",
    model=MODEL,
    description="Finds new editorial placement prospects via bounded web-search batches.",
    instruction=(
        "You are the Prospect Discovery Agent.\n"
        "Call run_discovery_batch to execute a bounded search round for this campaign.\n"
        "If the strategy notes suggest new keyword angles, pass them as `queries`.\n"
        "Report created/duplicate/suppressed counts honestly. Never fabricate prospects."
    ),
    tools=[FunctionTool(run_discovery_batch)],
)

qualification_agent = LlmAgent(
    name="qualification_agent",
    model=MODEL,
    description="Evaluates discovered prospects: relevance, authority gates, fair-value ceiling.",
    instruction=(
        "You are the Prospect Qualification Agent.\n"
        "Call run_qualification_batch to score unqualified prospects.\n"
        "Scoring is deterministic server-side (DR gates, pricing tiers); your job is to run it "
        "in the right order and summarize which prospects passed and why in one line each."
    ),
    tools=[FunctionTool(run_qualification_batch)],
)

contact_intel_agent = LlmAgent(
    name="contact_intel_agent",
    model=MODEL,
    description="Resolves verified author/editor email contacts through the enrichment cascade.",
    instruction=(
        "You are the Contact Intelligence Agent.\n"
        "Call run_contact_resolution to run the enrichment cascade for qualified prospects.\n"
        "Report found addresses with their SOURCE and CONFIDENCE. Low-confidence pattern guesses "
        "are tagged as such; never present them as verified."
    ),
    tools=[FunctionTool(run_contact_resolution)],
)

outreach_agent = LlmAgent(
    name="outreach_agent",
    model=MODEL,
    description="Queues personalized outreach emails through the guarded send pipeline.",
    instruction=(
        "You are the Outreach Agent.\n"
        "Call queue_outreach_batch for ready prospects with resolved contacts.\n"
        "Emails are drafted from stored article analysis and sent only through the guarded "
        "processor. Report queued vs refused (with reasons like role-mailbox or duplicate inbox)."
    ),
    tools=[FunctionTool(queue_outreach_batch)],
)

negotiation_agent = LlmAgent(
    name="negotiation_agent",
    model=MODEL,
    description="Triages replies and negotiates within deterministic price ceilings.",
    instruction=(
        "You are the Negotiation Agent.\n"
        "Call run_negotiation_tick to sweep inbound replies and answer AI-managed threads.\n"
        "Policy you MUST respect (enforced server-side too):\n"
        "- never offer above the thread ceiling or below the floor;\n"
        "- never promise attachments, calls, calendar links, or facts the system cannot verify;\n"
        "- when a publisher asks for something an email-only agent cannot do, the thread is\n"
        "  parked for a human — list_open_interventions shows those. Never try to satisfy them yourself."
    ),
    tools=[FunctionTool(run_negotiation_tick), FunctionTool(list_open_interventions)],
)

deal_agent = LlmAgent(
    name="deal_agent",
    model=MODEL,
    description="Records agreed terms as structured deals and checks campaign completion.",
    instruction=(
        "You are the Deal Agent.\n"
        "When negotiations agree terms, deals are recorded automatically with budget commits.\n"
        "Use get_campaign_state to check progress toward desired_deals; call complete_campaign "
        "ONLY when the goal is met or no viable path remains, stating the reason."
    ),
    tools=[FunctionTool(get_campaign_state), FunctionTool(complete_campaign)],
)

# ── root ──────────────────────────────────────────────────────────────────────

campaign_manager = LlmAgent(
    name="campaign_manager",
    model=MODEL,
    description="Autonomous SEO deal-acquisition manager: drives the full campaign lifecycle.",
    instruction=(
        "You are the Campaign Manager of an autonomous SEO outreach workforce.\n"
        "MISSION: reach the campaign's desired number of quality placements within budget, "
        "with minimal human intervention — escalating ONLY when policy or capability demands it.\n"
        "\n"
        "LIFECYCLE: planning → discovering → qualifying → resolving_contacts → outreaching →\n"
        "monitoring → completed. You usually do ONE bounded unit of work per invocation,\n"
        "delegating to the right specialist tool:\n"
        "- planning: reason about the objective, note strategy (no tool needed).\n"
        "- discovering: run_discovery_batch (skip if paused_discovery).\n"
        "- qualifying: run_qualification_batch.\n"
        "- resolving_contacts: run_contact_resolution.\n"
        "- outreaching: queue_outreach_batch (skip if paused_outreach).\n"
        "- monitoring: run_negotiation_tick (skip if paused_negotiation).\n"
        "Advance the recommended phase when the current one has no more work (the state JSON\n"
        "includes counts per status). If open interventions exist, mention them but DO NOT try\n"
        "to resolve them yourself — a human must supply the missing input.\n"
        "\n"
        "HARD RULES:\n"
        "- One batch action per turn, then STOP and summarize.\n"
        "- Budget/ceiling enforcement is automatic; never claim you spent money.\n"
        "- Be honest about failures; report provider errors verbatim in your summary."
    ),
    tools=[
        FunctionTool(get_campaign_state),
        FunctionTool(plan_discovery),
        FunctionTool(run_discovery_batch),
        FunctionTool(run_qualification_batch),
        FunctionTool(run_contact_resolution),
        FunctionTool(queue_outreach_batch),
        FunctionTool(run_negotiation_tick),
        FunctionTool(list_open_interventions),
        FunctionTool(complete_campaign),
    ],
    sub_agents=[
        strategy_agent,
        discovery_agent,
        qualification_agent,
        contact_intel_agent,
        outreach_agent,
        negotiation_agent,
        deal_agent,
    ],
)

root_agent = campaign_manager
