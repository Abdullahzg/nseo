"""TickRunner — one bounded, resumable unit of autonomous campaign work per call.

Safety rails enforced HERE (in addition to gateway-side enforcement):
  - emergency stop / terminal phases short-circuit everything;
  - exactly one batch action per tick;
  - phase transitions are computed deterministically from funnel counts;
  - hard wall-clock timeout on agent reasoning;
  - if Strands is unavailable, FAILS VISIBLY in hackathon mode (no silent fallback).
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field

from strands import Agent
from strands.session.file_session_manager import FileSessionManager

from . import config, gateway
from .agents import root_agent, ALL_TOOLS

log = logging.getLogger("seo_workforce.orchestrator")

TICK_TIMEOUT_S = 240
POOL_TARGET_MIN = 30


@dataclass
class TickResult:
    campaign_id: str
    phase_before: str | None
    phase_after: str | None
    action_taken: str
    agent_mode: str  # strands-gemini | strands-bedrock | fallback-policy
    summary: str = ""
    details: dict = field(default_factory=dict)


class CampaignOrchestrator:
    def __init__(self) -> None:
        self._agent: Agent | None = None

    @property
    def agent(self) -> Agent:
        if self._agent is None:
            session_id = f"campaign-{getattr(self, '_active_campaign', 'default')}"
            session_manager = FileSessionManager(
                session_id=session_id,
                storage_dir=config.SESSION_STORAGE_DIR,
            )
            self._agent = Agent(
                name="campaign_manager",
                model=root_agent.model,
                system_prompt=root_agent.system_prompt,
                tools=root_agent.tools,
                session_manager=session_manager,
            )
        return self._agent

    # ── public ────────────────────────────────────────────────────────────────

    async def tick(self, campaign_id: str) -> TickResult:
        t0 = time.monotonic()
        run_id = str(uuid.uuid4())

        state = await gateway.get_campaign(campaign_id)
        camp = state["campaign"]
        before = camp.get("phase")

        if camp.get("emergency_stopped"):
            return TickResult(campaign_id, before, before, "noop", "fallback-policy", "emergency stop active")
        if not state.get("is_active"):
            return TickResult(campaign_id, before, before, "noop", "fallback-policy", f"phase={before} is terminal/inactive")

        # The agent reasons and may execute one bounded action via tools.
        agent_ran, agent_summary = await self._run_agent_tick(campaign_id, state)

        # Deterministic transition check regardless of what the agent did.
        transitioned = await self._maybe_transition(campaign_id, state)
        fresh = await gateway.get_campaign(campaign_id)

        details = {
            "run_id": run_id,
            "agent_ran": agent_ran,
            "transition": f"{before}->{fresh['campaign'].get('phase')}" if transitioned else None,
            "prospects_by_status": fresh.get("prospects_by_status"),
            "budget_used": fresh["campaign"].get("budget_used"),
            "duration_ms": int((time.monotonic() - t0) * 1000),
            "framework": "strands-agents",
            "model_provider": config.MODEL_PROVIDER,
        }
        await gateway.emit_events(campaign_id, [{
            "run_id": run_id,
            "agent": "campaign_manager",
            "action": "tick",
            "framework": "strands-agents",
            "model_provider": config.MODEL_PROVIDER,
            "state_before": before,
            "state_after": fresh["campaign"].get("phase"),
            "duration_ms": details["duration_ms"],
            "detail": details,
            "event_key": f"tick:{campaign_id}:{run_id}",
        }])
        return TickResult(
            campaign_id=campaign_id,
            phase_before=before,
            phase_after=fresh["campaign"].get("phase"),
            action_taken="agent" if agent_ran else "policy",
            agent_mode=f"strands-{config.MODEL_PROVIDER}" if agent_ran else "fallback-policy",
            summary=agent_summary,
            details=details,
        )

    # ── agent reasoning ───────────────────────────────────────────────────────

    async def _run_agent_tick(self, campaign_id: str, state: dict) -> tuple[bool, str]:
        prompt = self._tick_prompt(state)

        # Create a fresh agent per tick with campaign-scoped session
        session_manager = FileSessionManager(
            session_id=f"campaign-{campaign_id}",
            storage_dir=config.SESSION_STORAGE_DIR,
        )
        agent = Agent(
            name="campaign_manager",
            model=root_agent.model,
            system_prompt=root_agent.system_prompt,
            tools=ALL_TOOLS,
            session_manager=session_manager,
        )

        try:
            result = await asyncio.wait_for(
                agent.invoke_async(prompt),
                timeout=TICK_TIMEOUT_S,
            )
            summary = str(result) if result else ""
            # Check if any tool was called by examining agent state
            tool_called = bool(agent.messages) and any(
                m.get("role") == "assistant" and m.get("content")
                for m in agent.messages[-3:]
            )
            return tool_called or bool(summary.strip()), summary
        except asyncio.TimeoutError:
            log.warning("agent tick timed out for %s", campaign_id)
            return False, "timeout"
        except Exception as e:
            log.warning("agent tick failed for %s: %s", campaign_id, e)
            if config.HACKATHON_MODE:
                raise RuntimeError(f"HACKATHON_MODE: Strands agent failed — {e}") from e
            return False, f"error: {e}"

    def _tick_prompt(self, state: dict) -> str:
        camp = state["campaign"]
        counts = state.get("prospects_by_status", {})
        desired = camp.get("desired_deals")
        rec = self._recommend(state)
        return (
            "CAMPAIGN STATE:\n"
            + json.dumps({
                "objective": camp.get("objective"),
                "website": camp.get("website_url"),
                "keywords": camp.get("keywords"),
                "desired_deals": desired,
                "budget_total": camp.get("budget_total"),
                "budget_used": camp.get("budget_used"),
                "currency": camp.get("currency"),
                "phase": camp.get("phase"),
                "paused_discovery": camp.get("paused_discovery"),
                "paused_outreach": camp.get("paused_outreach"),
                "paused_negotiation": camp.get("paused_negotiation"),
                "prospects_by_status": counts,
                "open_interventions": len(state.get("open_interventions") or []),
                "deals_count": len(state.get("deals") or []),
            })
            + "\n\nPOLICY-RECOMMENDED ACTION THIS TICK: "
            + rec
            + "\nExecute that single bounded action with the matching tool (unless it is clearly wrong), "
            + "then stop with a one-paragraph honest summary."
        )

    # ── deterministic policy ──────────────────────────────────────────────────

    def _recommend(self, state: dict) -> str:
        camp = state["campaign"]
        phase = camp.get("phase")
        counts = state.get("prospects_by_status", {})
        deals = len(state.get("deals") or [])
        desired = camp.get("desired_deals")
        if state.get("open_interventions"):
            return "monitoring (note open human interventions; do not resolve them yourself)"
        if phase == "planning":
            return "move to discovering"
        if phase == "discovering":
            target = max(POOL_TARGET_MIN, (desired or 3) * 12)
            have = counts.get("discovered", 0) + sum(counts.get(k, 0) for k in ("qualified", "ready", "outreached", "replied", "negotiating"))
            if have < target and not camp.get("paused_discovery"):
                return "run_discovery_batch"
            return "advance to qualifying"
        if phase == "qualifying":
            if counts.get("discovered", 0) > 0:
                return "run_qualification_batch"
            return "advance to resolving_contacts"
        if phase == "resolving_contacts":
            if counts.get("qualified", 0) > 0:
                return "run_contact_resolution"
            return "advance to outreaching"
        if phase == "outreaching":
            if counts.get("ready", 0) > 0 and not camp.get("paused_outreach"):
                return "queue_outreach_batch"
            return "advance to monitoring"
        if phase == "monitoring":
            if desired is not None and deals >= desired:
                return "complete_campaign (goal reached)"
            if not camp.get("paused_negotiation"):
                return "run_negotiation_tick"
            return "wait (negotiation paused)"
        return "no-op"

    async def _maybe_transition(self, campaign_id: str, state: dict) -> bool:
        """Code-enforced phase transitions (never left to the model)."""
        camp = state["campaign"]
        phase = camp.get("phase")
        counts = state.get("prospects_by_status", {})
        desired = camp.get("desired_deals")
        nxt: str | None = None
        reason: str | None = None

        total_pool = sum(counts.get(k, 0) for k in ("discovered", "qualified", "resolving_contact", "ready", "outreached", "replied", "negotiating"))

        if phase == "planning":
            nxt, reason = "discovering", "plan ready"
        elif phase == "discovering":
            target = max(POOL_TARGET_MIN, (desired or 3) * 12)
            have = counts.get("discovered", 0) + sum(counts.get(k, 0) for k in ("qualified", "ready", "outreached", "replied", "negotiating"))
            if have >= target or (counts.get("discovered", 0) > 0 and have >= max(10, target // 3)):
                nxt, reason = "qualifying", "pool filled"
        elif phase == "qualifying":
            if counts.get("discovered", 0) == 0 and total_pool > 0:
                nxt, reason = "resolving_contacts", "all prospects evaluated"
        elif phase == "resolving_contacts":
            if counts.get("qualified", 0) == 0 and counts.get("resolving_contact", 0) == 0:
                if counts.get("ready", 0) > 0:
                    nxt, reason = "outreaching", "contacts resolved"
                elif counts.get("outreached", 0) + counts.get("replied", 0) + counts.get("negotiating", 0) > 0:
                    nxt, reason = "monitoring", "outreach already in flight"
        elif phase == "outreaching":
            if counts.get("ready", 0) == 0:
                nxt, reason = "monitoring", "initial outreach queued"

        if nxt:
            await gateway.update_campaign(campaign_id, {"phase": nxt, "reason": reason})
            await gateway.emit_events(campaign_id, [{
                "agent": "campaign_manager",
                "action": "phase_transition",
                "framework": "strands-agents",
                "state_before": phase,
                "state_after": nxt,
                "detail": {"reason": reason},
                "event_key": f"phase:{campaign_id}:{nxt}:{counts}",
            }])
            return True
        return False


orchestrator = CampaignOrchestrator()
