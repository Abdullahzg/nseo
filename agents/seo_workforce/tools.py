"""Strands @tool wrappers — the agent-facing surface of the campaign gateway.

Each tool is a thin async function over the Next.js gateway. All authority
(budget, ceilings, send gates, duplicate suppression) is enforced there; these
wrappers add honest, structured results for the model's context.

The campaign_id flows through Strands invocation_state (set by the orchestrator)
so the model never needs to pass it explicitly.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from strands import tool

from . import gateway

log = logging.getLogger("seo_workforce.tools")


def _j(o: Any) -> str:
    return json.dumps(o, default=str)


def _compact_state(state: dict) -> dict:
    camp = state.get("campaign", {})
    return {
        "objective": camp.get("objective"),
        "website": camp.get("website_url"),
        "keywords": camp.get("keywords"),
        "desired_deals": camp.get("desired_deals"),
        "budget_total": camp.get("budget_total"),
        "budget_used": camp.get("budget_used"),
        "currency": camp.get("currency"),
        "phase": camp.get("phase"),
        "paused": {
            "discovery": camp.get("paused_discovery"),
            "outreach": camp.get("paused_outreach"),
            "negotiation": camp.get("paused_negotiation"),
        },
        "emergency_stopped": camp.get("emergency_stopped"),
        "prospects_by_status": state.get("prospects_by_status"),
        "deals": [
            {"domain": d.get("domain_host"), "price": d.get("agreed_price"), "status": d.get("status")}
            for d in (state.get("deals") or [])
        ][:10],
        "open_interventions": len(state.get("open_interventions") or []),
        "is_active": state.get("is_active"),
    }


# ── Strands tools ──────────────────────────────────────────────────────────────


@tool(context=True)
async def get_campaign_state(tool_context: Any = None) -> str:
    """Get full campaign state: objective, budget, funnel counts, deals, open interventions.

    Use this to understand the current state of the campaign before deciding
    which action to take next.
    """
    try:
        campaign_id = tool_context.invocation_state["campaign_id"]
        state = await gateway.get_campaign(campaign_id)
        return _j(_compact_state(state))
    except Exception as e:
        return _j({"error": str(e)})


@tool(context=True)
async def plan_discovery(tool_context: Any = None) -> str:
    """Generate a fresh, diverse discovery query plan from the campaign keywords.

    Call this when the campaign needs new search angles or keyword variations.
    """
    try:
        campaign_id = tool_context.invocation_state["campaign_id"]
        out = await gateway.discover(campaign_id, queries=[])
        return _j({"queries_planned": len(out.get("queries_run", [])), "provider": out.get("planner"), "created": out.get("created")})
    except Exception as e:
        return _j({"error": str(e)})


@tool(context=True)
async def run_discovery_batch(
    queries: list[str] | None = None,
    max_per_query: int = 8,
    tool_context: Any = None,
) -> str:
    """Run ONE bounded web-search batch; new prospects are persisted with provenance.

    Args:
        queries: Optional keyword queries to search for. If None, uses campaign defaults.
        max_per_query: Maximum results per query (default 8).
    """
    try:
        campaign_id = tool_context.invocation_state["campaign_id"]
        out = await gateway.discover(campaign_id, queries=queries, max_per_query=max_per_query)
        return _j({
            "found": out.get("found"),
            "created": out.get("created"),
            "duplicates": out.get("duplicates"),
            "suppressed": out.get("suppressed"),
            "per_query_first5": (out.get("per_query") or [])[:5],
        })
    except Exception as e:
        return _j({"error": str(e)})


@tool(context=True)
async def run_qualification_batch(limit: int = 8, tool_context: Any = None) -> str:
    """Evaluate up to `limit` unqualified prospects (deterministic scoring + semantic analysis).

    Scoring is deterministic server-side (DR gates, pricing tiers); this tool
    runs it in the right order and summarizes which prospects passed.

    Args:
        limit: Number of prospects to evaluate (1-20, default 8).
    """
    try:
        campaign_id = tool_context.invocation_state["campaign_id"]
        out = await gateway.qualify(campaign_id, limit=max(1, min(20, int(limit))))
        results = out.get("results", [])
        qualified = [r for r in results if r.get("qualified")]
        return _j({
            "evaluated": len(results),
            "qualified": len(qualified),
            "rejected": len(results) - len(qualified),
            "top_scores": sorted(
                [{"host_score": r.get("opportunity_score"), "prospect_id": r.get("prospect_id")} for r in results],
                key=lambda x: x["host_score"] or 0,
                reverse=True,
            )[:5],
        })
    except Exception as e:
        return _j({"error": str(e)})


@tool(context=True)
async def run_contact_resolution(limit: int = 5, tool_context: Any = None) -> str:
    """Resolve verified contacts for qualified prospects via the enrichment cascade.

    Reports found addresses with SOURCE and CONFIDENCE. Low-confidence pattern
    guesses are tagged as such; never presented as verified.

    Args:
        limit: Number of prospects to resolve contacts for (1-10, default 5).
    """
    try:
        campaign_id = tool_context.invocation_state["campaign_id"]
        out = await gateway.resolve_contacts(campaign_id, limit=max(1, min(10, int(limit))))
        results = out.get("results", [])
        found = [r for r in results if r.get("ok")]
        return _j({
            "attempted": len(results),
            "found": len(found),
            "sources": [r.get("source") for r in found],
            "low_confidence": [r.get("prospect_id") for r in found if (r.get("confidence") or 0) < 70],
        })
    except Exception as e:
        return _j({"error": str(e)})


@tool(context=True)
async def queue_outreach_batch(limit: int = 5, tool_context: Any = None) -> str:
    """Queue personalized outreach emails through the guarded send pipeline.

    Emails are drafted from stored article analysis and sent only through the
    guarded processor. Reports queued vs refused (with reasons).

    Args:
        limit: Number of prospects to queue outreach for (1-10, default 5).
    """
    try:
        campaign_id = tool_context.invocation_state["campaign_id"]
        out = await gateway.send_outreach(campaign_id, limit=max(1, min(10, int(limit))))
        results = out.get("results", [])
        ok = [r for r in results if r.get("ok")]
        refused = [{"prospect_id": r.get("prospect_id"), "reason": r.get("reason")} for r in results if not r.get("ok")]
        simulated = any(r.get("simulated") for r in ok)
        return _j({"queued": len(ok), "refused": refused[:5], "simulated_mode": simulated})
    except Exception as e:
        return _j({"error": str(e)})


@tool(context=True)
async def schedule_followups(limit: int = 10, tool_context: Any = None) -> str:
    """Schedule follow-up emails for prospects who haven't replied yet (multi-touch sequences).

    Checks prospects in 'outreached' status and schedules the next touch in their
    sequence (initial + 2 follow-ups spaced 2 and 4 days apart).

    Args:
        limit: Number of prospects to check for follow-up scheduling (1-20, default 10).
    """
    try:
        campaign_id = tool_context.invocation_state["campaign_id"]
        out = await gateway.schedule_followups(campaign_id, limit=max(1, min(20, int(limit))))
        return _j({
            "scheduled": out.get("scheduled", 0),
            "skipped_replied": out.get("skipped_replied", 0),
            "skipped_complete": out.get("skipped_complete", 0),
            "errors": (out.get("errors") or [])[:5],
        })
    except Exception as e:
        return _j({"error": str(e)})


@tool(context=True)
async def run_negotiation_tick(tool_context: Any = None) -> str:
    """Sweep inbound replies and answer AI-managed threads within policy (one bounded pass).

    Policy enforced server-side:
    - never offer above the thread ceiling or below the floor
    - never promise attachments, calls, calendar links, or unverifiable facts
    - when a publisher asks for something an email-only agent cannot do,
      the thread is parked for a human
    """
    try:
        campaign_id = tool_context.invocation_state["campaign_id"]
        out = await gateway.negotiate_tick(campaign_id)
        return _j({
            "replies_detected": out.get("detected"),
            "negotiation_replies_sent_or_drafted": out.get("negotiated"),
            "threads_needing_human": out.get("needs_human"),
            "errors": (out.get("errors") or [])[:5],
        })
    except Exception as e:
        return _j({"error": str(e)})


@tool(context=True)
async def list_open_interventions(tool_context: Any = None) -> str:
    """Human-in-the-loop requests awaiting an answer.

    The agent must NOT resolve these itself — a human must supply the missing input.
    Use this to check what interventions are pending.
    """
    try:
        campaign_id = tool_context.invocation_state["campaign_id"]
        items = await gateway.list_interventions(campaign_id, "open")
        return _j({
            "count": len(items),
            "interventions": [
                {"id": i.get("id"), "type": i.get("type"), "ask": i.get("ask"), "thread": i.get("anchor_email_id")}
                for i in items[:10]
            ],
        })
    except Exception as e:
        return _j({"error": str(e)})


@tool(context=True)
async def complete_campaign(reason: str = "goal_reached", tool_context: Any = None) -> str:
    """Mark the campaign completed with a stated reason.

    Only call this when no work remains or the goal is met.

    Args:
        reason: Why the campaign is being completed.
    """
    try:
        campaign_id = tool_context.invocation_state["campaign_id"]
        await gateway.update_campaign(campaign_id, {"phase": "completed", "reason": reason})
        return _j({"completed": True, "reason": reason})
    except Exception as e:
        return _j({"error": str(e)})


# ── all tools list (used by agents) ───────────────────────────────────────────

ALL_TOOLS = [
    get_campaign_state,
    plan_discovery,
    run_discovery_batch,
    run_qualification_batch,
    run_contact_resolution,
    queue_outreach_batch,
    run_negotiation_tick,
    list_open_interventions,
    complete_campaign,
]
