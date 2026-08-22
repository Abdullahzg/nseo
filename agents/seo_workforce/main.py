"""SEO Workforce agent service — FastAPI entrypoint (Cloud Run compatible).

Endpoints:
  GET  /health                          liveness + config summary
  POST /tick        {campaign_id}       one bounded autonomous work unit
  POST /campaigns/{id}/start            flip draft → planning
  POST /campaigns/{id}/stop             emergency/regular stop
  POST /interventions/{id}/resolve      human answer → resume the paused thread
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import config, gateway
from .orchestrator import orchestrator

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = FastAPI(title="SEO Workforce Agent Service", version="1.0.0")


class TickBody(BaseModel):
    campaign_id: str


class ResolveBody(BaseModel):
    assist_input: str


@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "model": config.GEMINI_MODEL,
        "gateway_configured": bool(config.AGENT_SERVICE_TOKEN),
        "durable_sessions": bool(config.sqlalchemy_url()),
    }


@app.post("/tick")
async def tick(body: TickBody) -> dict:
    try:
        result = await orchestrator.tick(body.campaign_id)
        return {
            "ok": True,
            "campaign_id": result.campaign_id,
            "phase_before": result.phase_before,
            "phase_after": result.phase_after,
            "action": result.action_taken,
            "agent_mode": result.agent_mode,
            "details": result.details,
        }
    except gateway.GatewayError as e:
        raise HTTPException(status_code=e.status, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/campaigns/{campaign_id}/start")
async def start_campaign(campaign_id: str) -> dict:
    await gateway.update_campaign(campaign_id, {"phase": "planning", "reason": None, "emergency_stopped": False})
    return {"ok": True, "phase": "planning"}


@app.post("/campaigns/{campaign_id}/stop")
async def stop_campaign(campaign_id: str) -> dict:
    await gateway.update_campaign(campaign_id, {"phase": "stopped", "reason": "stopped_by_user"})
    return {"ok": True, "phase": "stopped"}


@app.post("/campaigns/{campaign_id}/emergency-stop")
async def emergency_stop(campaign_id: str) -> dict:
    await gateway.update_campaign(campaign_id, {"emergency_stopped": True, "phase": "stopped", "reason": "emergency_stop"})
    return {"ok": True, "emergency_stopped": True}


@app.post("/interventions/{intervention_id}/resolve")
async def resolve_intervention(intervention_id: str, body: ResolveBody) -> dict:
    if not body.assist_input.strip():
        raise HTTPException(status_code=400, detail="assist_input required")
    out = await gateway.resolve_intervention(intervention_id, body.assist_input)
    return out
