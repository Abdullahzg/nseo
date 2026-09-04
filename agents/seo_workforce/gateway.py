"""HTTP client for the Next.js agent tool gateway (/api/agent/*).

Every mutating action is enforced server-side by the gateway: send limits, trust
gates, budget atomicity, negotiation ceilings. This client is a thin, typed pass-through.
"""
from __future__ import annotations

import httpx

from . import config


class GatewayError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(f"gateway {status}: {message}")
        self.status = status


def _headers() -> dict[str, str]:
    h: dict[str, str] = {"Content-Type": "application/json"}
    if config.AGENT_SERVICE_TOKEN:
        h["Authorization"] = f"Bearer {config.AGENT_SERVICE_TOKEN}"
    return h


async def _request(method: str, path: str, json_body: dict | None = None, timeout: float = 120.0) -> dict:
    url = f"{config.AGENT_BASE_URL}{path}"
    async with httpx.AsyncClient(timeout=timeout) as client:
        res = await client.request(method, url, headers=_headers(), json=json_body)
        if res.status_code >= 400:
            try:
                detail = res.json().get("error", res.text[:200])
            except Exception:
                detail = res.text[:200]
            raise GatewayError(res.status_code, str(detail))
        if res.status_code == 204 or not res.content:
            return {}
        return res.json()


# ── campaign state ────────────────────────────────────────────────────────────

async def get_campaign(campaign_id: str) -> dict:
    return await _request("GET", f"/api/agent/campaigns/{campaign_id}")


async def update_campaign(campaign_id: str, patch: dict) -> dict:
    return await _request("PATCH", f"/api/agent/campaigns/{campaign_id}", patch)


# ── tools ─────────────────────────────────────────────────────────────────────

async def discover(campaign_id: str, queries: list[str] | None = None, max_per_query: int = 8) -> dict:
    body: dict = {"campaign_id": campaign_id, "max_per_query": max_per_query}
    if queries:
        body["queries"] = queries
    return await _request("POST", "/api/agent/tools/discover", body)


async def qualify(campaign_id: str, limit: int = 8) -> dict:
    return await _request("POST", "/api/agent/tools/qualify", {"campaign_id": campaign_id, "limit": limit})


async def qualify_prospect(prospect_id: str) -> dict:
    return await _request("POST", "/api/agent/tools/qualify", {"prospect_id": prospect_id})


async def resolve_contacts(campaign_id: str, limit: int = 5) -> dict:
    return await _request("POST", "/api/agent/tools/contact", {"campaign_id": campaign_id, "limit": limit})


async def send_outreach(campaign_id: str, limit: int = 5) -> dict:
    return await _request("POST", "/api/agent/tools/outreach", {"campaign_id": campaign_id, "limit": limit})


async def negotiate_tick(campaign_id: str) -> dict:
    return await _request("POST", "/api/agent/tools/negotiate", {"campaign_id": campaign_id}, timeout=300.0)


async def negotiate_single(anchor_email_id: str, assist_input: str | None = None) -> dict:
    body: dict = {"anchor_email_id": anchor_email_id}
    if assist_input:
        body["assist_input"] = assist_input
    return await _request("POST", "/api/agent/tools/negotiate", body, timeout=300.0)


async def list_interventions(campaign_id: str, status: str = "open") -> list[dict]:
    out = await _request("GET", f"/api/agent/interventions?campaign_id={campaign_id}&status={status}")
    return out.get("interventions", [])


async def resolve_intervention(intervention_id: str, assist_input: str) -> dict:
    return await _request(
        "POST",
        "/api/agent/interventions",
        {"id": intervention_id, "assist_input": assist_input},
        timeout=300.0,
    )


async def emit_events(campaign_id: str | None, events: list[dict]) -> dict:
    for ev in events:
        ev.setdefault("campaign_id", campaign_id)
    return await _request("POST", "/api/agent/events", {"events": events})


# ── legacy send processor (all real SMTP delivery + trust gates live there) ──

async def run_send_processor() -> dict:
    """Triggers /api/emails/process with the ops secret — the proven burst-send +
    reply-detection + follow-up pipeline. Safe to call repeatedly (Redis-locked)."""
    url = f"{config.AGENT_BASE_URL}/api/emails/process"
    async with httpx.AsyncClient(timeout=320.0) as client:
        res = await client.post(url, headers=_headers())
        if res.status_code >= 400:
            raise GatewayError(res.status_code, res.text[:200])
        return res.json()
