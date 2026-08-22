"""ADK FunctionTools — the agent-facing surface of the campaign gateway.

Each tool is a thin async function over the Next.js gateway. All authority
(budget, ceilings, send gates, duplicate suppression) is enforced there; these
wrappers add honest, structured results for the model's context.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from . import gateway

log = logging.getLogger("seo_workforce.tools")

# The campaign under management is injected by the orchestrator per tick.
_ACTIVE_CAMPAIGN: str | None = None


def set_active_campaign(campaign_id: str | None) -> None:
    global _ACTIVE_CAMPAIGN
    _ACTIVE_CAMPAIGN = campaign_id


def _campaign_id(explicit: str | None) -> str:
    cid = explicit or _ACTIVE_CAMPAIGN
    if not cid:
        raise RuntimeError("no active campaign for this tick")
    return cid


def _j(o: Any) -> str:
    return json.dumps(o, default=str)


async def get_campaign_state(campaign_id: str = "") -> dict:
    """Full campaign state: objective, budget, funnel counts, deals, open interventions."""
    try:
        state = await gateway.get_campaign(_campaign_id(campaign_id or None))
        return _compact_state(state)
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


async def plan_discovery(campaign_id: str = "") -> dict:
    """Generate a fresh, diverse discovery query plan from the campaign keywords."""
    try:
        out = await gateway.discover(_campaign_id(campaign_id or None), queries=[])
        return {"queries_planned": len(out.get("queries_run", [])), "provider": out.get("planner"), "created": out.get("created")}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


async def run_discovery_batch(queries: list[str] | None = None, max_per_query: int = 8, campaign_id: str = "") -> dict:
    """Run ONE bounded web-search batch; new prospects are persisted with provenance."""
    try:
        out = await gateway.discover(_campaign_id(campaign_id or None), queries=queries, max_per_query=max_per_query)
        return {
            "found": out.get("found"),
            "created": out.get("created"),
            "duplicates": out.get("duplicates"),
            "suppressed": out.get("suppressed"),
            "per_query_first5": (out.get("per_query") or [])[:5],
        }
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


async def run_qualification_batch(limit: int = 8, campaign_id: str = "") -> dict:
    """Evaluate up to `limit` unqualified prospects (deterministic scoring + Gemini semantics)."""
    try:
        out = await gateway.qualify(_campaign_id(campaign_id or None), limit=max(1, min(20, int(limit))))
        results = out.get("results", [])
        qualified = [r for r in results if r.get("qualified")]
        return {
            "evaluated": len(results),
            "qualified": len(qualified),
            "rejected": len(results) - len(qualified),
            "top_scores": sorted(
                [{"host_score": r.get("opportunity_score"), "prospect_id": r.get("prospect_id")} for r in results],
                key=lambda x: x["host_score"] or 0,
                reverse=True,
            )[:5],
        }
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


async def run_contact_resolution(limit: int = 5, campaign_id: str = "") -> dict:
    """Resolve verified contacts for qualified prospects via the enrichment cascade."""
    try:
        out = await gateway.resolve_contacts(_campaign_id(campaign_id or None), limit=max(1, min(10, int(limit))))
        results = out.get("results", [])
        found = [r for r in results if r.get("ok")]
        return {
            "attempted": len(results),
            "found": len(found),
            "sources": [r.get("source") for r in found],
            "low_confidence": [r.get("prospect_id") for r in found if (r.get("confidence") or 0) < 70],
        }
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


async def queue_outreach_batch(limit: int = 5, campaign_id: str = "") -> dict:
    """Queue personalized outreach for ready prospects (delivery gated by burst processor)."""
    try:
        out = await gateway.send_outreach(_campaign_id(campaign_id or None), limit=max(1, min(10, int(limit))))
        results = out.get("results", [])
        ok = [r for r in results if r.get("ok")]
        refused = [{"prospect_id": r.get("prospect_id"), "reason": r.get("reason")} for r in results if not r.get("ok")]
        simulated = any(r.get("simulated") for r in ok)
        return {"queued": len(ok), "refused": refused[:5], "simulated_mode": simulated}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


async def run_negotiation_tick(campaign_id: str = "") -> dict:
    """Sweep inbound replies and answer AI-managed threads within policy (one bounded pass)."""
    try:
        out = await gateway.negotiate_tick(_campaign_id(campaign_id or None))
        return {
            "replies_detected": out.get("detected"),
            "negotiation_replies_sent_or_drafted": out.get("negotiated"),
            "threads_needing_human": out.get("needs_human"),
            "errors": (out.get("errors") or [])[:5],
        }
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


async def list_open_interventions(campaign_id: str = "") -> dict:
    """Human-in-the-loop requests awaiting an answer (the agent must NOT resolve them itself)."""
    try:
        items = await gateway.list_interventions(_campaign_id(campaign_id or None), "open")
        return {
            "count": len(items),
            "interventions": [
                {"id": i.get("id"), "type": i.get("type"), "ask": i.get("ask"), "thread": i.get("anchor_email_id")}
                for i in items[:10]
            ],
        }
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


async def complete_campaign(reason: str = "goal_reached", campaign_id: str = "") -> dict:
    """Mark the campaign completed with a stated reason (only when no work remains)."""
    try:
        await gateway.update_campaign(_campaign_id(campaign_id or None), {"phase": "completed", "reason": reason})
        return {"completed": True, "reason": reason}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


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
