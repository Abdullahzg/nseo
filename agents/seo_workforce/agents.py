"""Strands Agent definitions for the SEO Deal Acquisition Workforce.

Architecture (docs/AGENT_DESIGN.md):
  campaign_manager (root) ─ coordinates the whole objective per tick
    ├─ strategy_agent      ─ turns objective+state into a plan / next-phase advice
    ├─ discovery_agent     ─ runs bounded search batches via tools
    ├─ qualification_agent ─ evaluates prospects (deterministic scoring server-side)
    ├─ contact_agent       ─ resolves author/editor contacts
    ├─ outreach_agent      ─ queues personalized sends (gated by the burst processor)
    ├─ negotiation_agent   ─ triages replies + negotiates under a hard price ceiling
    └─ intervention_agent  ─ lists human-in-the-loop requests

Design rules:
  - Money math, ceilings, budget and send safety are ENFORCED IN CODE on the
    gateway side. The LLM chooses actions; it can never override policy.
  - Deterministic work stays deterministic. The model is invoked once per tick
    with compact state; every tool result is summarized back into its context.
  - Agents-as-tools pattern: campaign_manager delegates to specialist agents
    which are genuine Strands Agent objects exposed as tools.
"""
from __future__ import annotations

import logging

from strands import Agent

from . import config
from .tools import (
    get_campaign_state,
    plan_discovery,
    run_discovery_batch,
    run_qualification_batch,
    run_contact_resolution,
    queue_outreach_batch,
    schedule_followups,
    run_negotiation_tick,
    list_open_interventions,
    complete_campaign,
)

log = logging.getLogger("seo_workforce.agents")

# ── model provider selection ───────────────────────────────────────────────────


def _build_model():
    """Build the Strands model provider based on MODEL_PROVIDER env var."""
    provider = config.MODEL_PROVIDER

    if provider == "groq":
        from strands.models.openai import OpenAIModel

        log.info("Using Groq model provider: %s at %s", config.GROQ_MODEL, config.GROQ_BASE_URL)
        return OpenAIModel(
            client_args={
                "api_key": os.environ["GROQ_API_KEY"],
                "base_url": config.GROQ_BASE_URL,
            },
            model_id=config.GROQ_MODEL,
            params={
                "temperature": 0.1,
                "max_tokens": 2048,
            },
        )
    elif provider == "bedrock":
        from strands.models import BedrockModel

        log.info("Using Bedrock model provider: %s in %s", config.STRANDS_MODEL_ID, config.AWS_REGION)
        return BedrockModel(
            model_id=config.STRANDS_MODEL_ID,
            region_name=config.AWS_REGION,
        )
    elif provider == "gemini":
        from strands.models import GeminiModel

        log.info("Using Gemini model provider: %s", config.GEMINI_MODEL)
        return GeminiModel(model=config.GEMINI_MODEL)
    else:
        raise ValueError(f"Unknown MODEL_PROVIDER: {provider}")


import os  # noqa: E402 (needed for _build_model env access)

MODEL = _build_model()

# ── specialist agents ──────────────────────────────────────────────────────────

strategy_agent = Agent(
    name="strategy_agent",
    model=MODEL,
    description="Turns the campaign objective and current funnel state into an execution plan.",
    system_prompt=(
        "You are the Campaign Strategy Agent for an autonomous SEO outreach workforce.\n"
        "Given the campaign state, produce a SHORT plan:\n"
        "1) which phase deserves effort next (discover|qualify|contact|outreach|negotiate|complete),\n"
        "2) any adjustment to search focus (new keyword angles),\n"
        "3) risks worth watching.\n"
        "Be decisive and terse. Use the get_campaign_state tool to inspect state when needed.\n"
        "Never invent numbers that are not in the state."
    ),
    tools=[get_campaign_state],
)

discovery_agent = Agent(
    name="discovery_agent",
    model=MODEL,
    description="Finds new editorial placement prospects via bounded web-search batches.",
    system_prompt=(
        "You are the Prospect Discovery Agent.\n"
        "Call run_discovery_batch to execute a bounded search round for this campaign.\n"
        "If the strategy notes suggest new keyword angles, pass them as `queries`.\n"
        "Report created/duplicate/suppressed counts honestly. Never fabricate prospects."
    ),
    tools=[run_discovery_batch],
)

qualification_agent = Agent(
    name="qualification_agent",
    model=MODEL,
    description="Evaluates discovered prospects: relevance, authority gates, fair-value ceiling.",
    system_prompt=(
        "You are the Prospect Qualification Agent.\n"
        "Call run_qualification_batch to score unqualified prospects.\n"
        "Scoring is deterministic server-side (DR gates, pricing tiers); your job is to run it "
        "in the right order and summarize which prospects passed and why in one line each."
    ),
    tools=[run_qualification_batch],
)

contact_agent = Agent(
    name="contact_agent",
    model=MODEL,
    description="Resolves verified author/editor email contacts through the enrichment cascade.",
    system_prompt=(
        "You are the Contact Intelligence Agent.\n"
        "Call run_contact_resolution to run the enrichment cascade for qualified prospects.\n"
        "Report found addresses with their SOURCE and CONFIDENCE. Low-confidence pattern guesses "
        "are tagged as such; never present them as verified."
    ),
    tools=[run_contact_resolution],
)

outreach_agent = Agent(
    name="outreach_agent",
    model=MODEL,
    description="Queues personalized outreach emails and manages multi-touch follow-up sequences.",
    system_prompt=(
        "You are the Outreach Agent.\n"
        "Call queue_outreach_batch for ready prospects with resolved contacts.\n"
        "Call schedule_followups to schedule follow-up emails for prospects who haven't replied.\n"
        "Emails are drafted from stored article analysis and sent only through the guarded "
        "processor. Report queued vs refused (with reasons like role-mailbox or duplicate inbox)."
    ),
    tools=[queue_outreach_batch, schedule_followups],
)

negotiation_agent = Agent(
    name="negotiation_agent",
    model=MODEL,
    description="Triages replies and negotiates within deterministic price ceilings.",
    system_prompt=(
        "You are the Negotiation Agent.\n"
        "Call run_negotiation_tick to sweep inbound replies and answer AI-managed threads.\n"
        "Policy you MUST respect (enforced server-side too):\n"
        "- never offer above the thread ceiling or below the floor;\n"
        "- never promise attachments, calls, calendar links, or facts the system cannot verify;\n"
        "- when a publisher asks for something an email-only agent cannot do, the thread is\n"
        "  parked for a human — list_open_interventions shows those. Never try to satisfy them yourself."
    ),
    tools=[run_negotiation_tick, list_open_interventions],
)

intervention_agent = Agent(
    name="intervention_agent",
    model=MODEL,
    description="Lists human-in-the-loop requests that need human input.",
    system_prompt=(
        "You are the Intervention Agent.\n"
        "Call list_open_interventions to check what human decisions are pending.\n"
        "Report the count and types of open interventions. Do NOT attempt to resolve them.\n"
        "A human must supply the missing input."
    ),
    tools=[list_open_interventions],
)

# ── campaign manager (root agent) ──────────────────────────────────────────────

campaign_manager = Agent(
    name="campaign_manager",
    model=MODEL,
    description="Autonomous SEO deal-acquisition manager: drives the full campaign lifecycle.",
    system_prompt=(
        "You are the Campaign Manager of an autonomous SEO outreach workforce.\n"
        "MISSION: reach the campaign's desired number of quality placements within budget, "
        "with minimal human intervention — escalating ONLY when policy or capability demands it.\n"
        "\n"
        "LIFECYCLE: planning → discovering → qualifying → resolving_contacts → outreaching →\n"
        "monitoring → completed. You usually do ONE bounded unit of work per invocation,\n"
        "delegating to the right specialist:\n"
        "- planning: reason about the objective, note strategy (no tool needed).\n"
        "- discovering: run_discovery_batch (skip if paused_discovery).\n"
        "- qualifying: run_qualification_batch.\n"
        "- resolving_contacts: run_contact_resolution.\n"
        "- outreaching: queue_outreach_batch (skip if paused_outreach).\n"
        "- monitoring: run_negotiation_tick + schedule_followups for multi-touch sequences (skip if paused_negotiation).\n"
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
        get_campaign_state,
        plan_discovery,
        run_discovery_batch,
        run_qualification_batch,
        run_contact_resolution,
        queue_outreach_batch,
        schedule_followups,
        run_negotiation_tick,
        list_open_interventions,
        complete_campaign,
        strategy_agent.as_tool(),
        discovery_agent.as_tool(),
        qualification_agent.as_tool(),
        contact_agent.as_tool(),
        outreach_agent.as_tool(),
        negotiation_agent.as_tool(),
        intervention_agent.as_tool(),
    ],
)

root_agent = campaign_manager

# ── exported tools list (used by orchestrator to build per-tick agents) ────────

ALL_TOOLS = [
    get_campaign_state,
    plan_discovery,
    run_discovery_batch,
    run_qualification_batch,
    run_contact_resolution,
    queue_outreach_batch,
    schedule_followups,
    run_negotiation_tick,
    list_open_interventions,
    complete_campaign,
]
