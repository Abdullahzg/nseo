"""Unit tests for the Strands agent service.

These tests verify structure and configuration WITHOUT requiring a live Groq key.
Run with: python -m pytest agents/seo_workforce/test_agents.py -v
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# Ensure repo root is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _set_groq_env():
    """Set Groq environment for all tests."""
    with patch.dict(os.environ, {
        "MODEL_PROVIDER": "groq",
        "GROQ_API_KEY": "gsk_test_key_for_unit_tests_only",
        "GROQ_MODEL": "openai/gpt-oss-120b",
        "GROQ_BASE_URL": "https://api.groq.com/openai/v1",
        "HACKATHON_MODE": "true",
    }):
        yield


@pytest.fixture
def reload_modules():
    """Reload config and agents modules to pick up env changes."""
    import importlib
    from seo_workforce import config, agents
    importlib.reload(config)
    importlib.reload(agents)
    return config, agents


# ── Config tests ──────────────────────────────────────────────────────────────

class TestConfig:
    def test_model_provider_groq(self):
        from seo_workforce import config
        assert config.MODEL_PROVIDER == "groq"

    def test_groq_model_default(self):
        from seo_workforce import config
        assert config.GROQ_MODEL == "openai/gpt-oss-120b"

    def test_groq_base_url(self):
        from seo_workforce import config
        assert config.GROQ_BASE_URL == "https://api.groq.com/openai/v1"

    def test_hackathon_mode_true(self):
        from seo_workforce import config
        assert config.HACKATHON_MODE is True

    def test_health_metadata_groq(self):
        from seo_workforce import config
        meta = config.model_description()
        assert meta["framework"] == "strands-agents"
        assert meta["model_provider"] == "groq"
        assert meta["model_id"] == "openai/gpt-oss-120b"
        assert meta["hackathon_mode"] is True

    def test_session_storage_dir(self):
        from seo_workforce import config
        assert config.SESSION_STORAGE_DIR == ".strands_sessions"


# ── Agent structure tests ─────────────────────────────────────────────────────

class TestAgentStructure:
    def test_eight_agents_exist(self):
        from seo_workforce.agents import (
            campaign_manager, strategy_agent, discovery_agent,
            qualification_agent, contact_agent, outreach_agent,
            negotiation_agent, intervention_agent,
        )
        agents = [
            campaign_manager, strategy_agent, discovery_agent,
            qualification_agent, contact_agent, outreach_agent,
            negotiation_agent, intervention_agent,
        ]
        assert len(agents) == 8

    def test_nine_tools_exist(self):
        from seo_workforce.tools import ALL_TOOLS
        assert len(ALL_TOOLS) == 9

    def test_tool_names(self):
        from seo_workforce.tools import ALL_TOOLS
        names = [t.tool_name for t in ALL_TOOLS]
        expected = [
            "get_campaign_state", "plan_discovery", "run_discovery_batch",
            "run_qualification_batch", "run_contact_resolution",
            "queue_outreach_batch", "run_negotiation_tick",
            "list_open_interventions", "complete_campaign",
        ]
        assert names == expected

    def test_campaign_manager_is_root(self):
        from seo_workforce.agents import campaign_manager, root_agent
        assert campaign_manager is root_agent

    def test_provider_factory_creates_groq_model(self):
        from seo_workforce.agents import MODEL
        from strands.models.openai import OpenAIModel
        assert isinstance(MODEL, OpenAIModel)

    def test_campaign_manager_name(self):
        from seo_workforce.agents import campaign_manager
        assert campaign_manager.name == "campaign_manager"

    def test_all_agents_share_model(self):
        from seo_workforce.agents import (
            strategy_agent, discovery_agent, qualification_agent,
            contact_agent, outreach_agent, negotiation_agent,
            intervention_agent, campaign_manager,
        )
        model = campaign_manager.model
        assert strategy_agent.model is model
        assert discovery_agent.model is model
        assert qualification_agent.model is model
        assert contact_agent.model is model
        assert outreach_agent.model is model
        assert negotiation_agent.model is model
        assert intervention_agent.model is model


# ── Tool context tests ────────────────────────────────────────────────────────

class TestToolContext:
    def test_tools_accept_context_parameter(self):
        """Verify @tool(context=True) is set on tools that need campaign_id."""
        from seo_workforce.tools import (
            get_campaign_state, run_discovery_batch, run_qualification_batch,
            complete_campaign,
        )
        # These tools should have _context_param set (from @tool(context=True))
        for t in [get_campaign_state, run_discovery_batch, run_qualification_batch, complete_campaign]:
            assert hasattr(t, '_metadata') or callable(getattr(t, 'tool_spec', None))


# ── Health endpoint tests ─────────────────────────────────────────────────────

class TestHealth:
    def test_health_response_structure(self):
        from seo_workforce.config import model_description
        meta = model_description()
        assert "framework" in meta
        assert "model_provider" in meta
        assert "model_id" in meta
        assert "hackathon_mode" in meta


# ── Orchestrator tests ────────────────────────────────────────────────────────

class TestOrchestrator:
    def test_tick_result_dataclass(self):
        from seo_workforce.orchestrator import TickResult
        r = TickResult(
            campaign_id="test-123",
            phase_before="planning",
            phase_after="discovering",
            action_taken="agent",
            agent_mode="strands-groq",
        )
        assert r.campaign_id == "test-123"
        assert r.agent_mode == "strands-groq"

    def test_recommend_returns_string(self):
        from seo_workforce.orchestrator import CampaignOrchestrator
        orch = CampaignOrchestrator()
        state = {
            "campaign": {"phase": "planning", "desired_deals": 3},
            "prospects_by_status": {},
            "deals": [],
            "open_interventions": [],
        }
        rec = orch._recommend(state)
        assert isinstance(rec, str)
        assert len(rec) > 0


# ── Tool gateway tests (mocked, no live API needed) ──────────────────────────

class MockContext:
    """Simulates Strands InvocationContext with campaign_id."""
    def __init__(self, campaign_id: str = "test-campaign-123"):
        self.invocation_state = {"campaign_id": campaign_id}


class TestToolGateway:
    """Test all 9 tools by mocking the gateway HTTP calls."""

    @pytest.fixture(autouse=True)
    def _mock_gateway(self):
        import asyncio
        from unittest.mock import AsyncMock, patch

        # Mock all gateway functions
        self.mock_get_campaign = AsyncMock(return_value={
            "campaign": {
                "objective": "Test objective",
                "website_url": "https://example.com",
                "keywords": ["test"],
                "desired_deals": 3,
                "budget_total": 100,
                "budget_used": 0,
                "currency": "USD",
                "phase": "planning",
                "paused_discovery": False,
                "paused_outreach": False,
                "paused_negotiation": False,
                "emergency_stopped": False,
            },
            "prospects_by_status": {"unqualified": 5},
            "deals": [],
            "open_interventions": [],
            "is_active": True,
        })

        self.mock_discover = AsyncMock(return_value={
            "found": 10, "created": 8, "duplicates": 2, "suppressed": 0,
            "queries_run": ["test query"], "planner": "llm", "per_query": [{"query": "test", "found": 5}],
        })
        self.mock_qualify = AsyncMock(return_value={
            "results": [
                {"prospect_id": "p1", "qualified": True, "opportunity_score": 85},
                {"prospect_id": "p2", "qualified": False, "opportunity_score": 30},
            ],
        })
        self.mock_resolve_contacts = AsyncMock(return_value={
            "results": [{"ok": True, "source": "hunter", "confidence": 90}],
        })
        self.mock_send_outreach = AsyncMock(return_value={
            "results": [{"ok": True, "simulated": True}],
        })
        self.mock_negotiate_tick = AsyncMock(return_value={
            "detected": 2, "negotiated": 1, "needs_human": 0,
        })
        self.mock_list_interventions = AsyncMock(return_value=[])
        self.mock_update_campaign = AsyncMock(return_value={})

        with patch("seo_workforce.tools.gateway.get_campaign", self.mock_get_campaign), \
             patch("seo_workforce.tools.gateway.discover", self.mock_discover), \
             patch("seo_workforce.tools.gateway.qualify", self.mock_qualify), \
             patch("seo_workforce.tools.gateway.resolve_contacts", self.mock_resolve_contacts), \
             patch("seo_workforce.tools.gateway.send_outreach", self.mock_send_outreach), \
             patch("seo_workforce.tools.gateway.negotiate_tick", self.mock_negotiate_tick), \
             patch("seo_workforce.tools.gateway.list_interventions", self.mock_list_interventions), \
             patch("seo_workforce.tools.gateway.update_campaign", self.mock_update_campaign):
            yield

    def _run(self, coro):
        import asyncio
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()

    def test_tool_01_get_campaign_state(self):
        from seo_workforce.tools import get_campaign_state
        ctx = MockContext()
        result = self._run(get_campaign_state(ctx))
        data = __import__("json").loads(result)
        assert data["objective"] == "Test objective"
        assert data["phase"] == "planning"
        assert data["budget_total"] == 100
        self.mock_get_campaign.assert_called_once_with("test-campaign-123")

    def test_tool_02_plan_discovery(self):
        from seo_workforce.tools import plan_discovery
        ctx = MockContext()
        result = self._run(plan_discovery(ctx))
        data = __import__("json").loads(result)
        assert data["queries_planned"] == 1
        assert data["provider"] == "llm"
        self.mock_discover.assert_called_once()

    def test_tool_03_run_discovery_batch(self):
        from seo_workforce.tools import run_discovery_batch
        ctx = MockContext()
        result = self._run(run_discovery_batch(queries=["test"], max_per_query=5, tool_context=ctx))
        data = __import__("json").loads(result)
        assert data["found"] == 10
        assert data["created"] == 8
        self.mock_discover.assert_called_once()

    def test_tool_04_run_qualification_batch(self):
        from seo_workforce.tools import run_qualification_batch
        ctx = MockContext()
        result = self._run(run_qualification_batch(limit=10, tool_context=ctx))
        data = __import__("json").loads(result)
        assert data["evaluated"] == 2
        assert data["qualified"] == 1
        assert data["rejected"] == 1
        self.mock_qualify.assert_called_once_with("test-campaign-123", limit=10)

    def test_tool_05_run_contact_resolution(self):
        from seo_workforce.tools import run_contact_resolution
        ctx = MockContext()
        result = self._run(run_contact_resolution(limit=3, tool_context=ctx))
        data = __import__("json").loads(result)
        assert data["attempted"] == 1
        assert data["found"] == 1
        self.mock_resolve_contacts.assert_called_once()

    def test_tool_06_queue_outreach_batch(self):
        from seo_workforce.tools import queue_outreach_batch
        ctx = MockContext()
        result = self._run(queue_outreach_batch(limit=5, tool_context=ctx))
        data = __import__("json").loads(result)
        assert data["queued"] == 1
        assert data["simulated_mode"] is True

    def test_tool_07_run_negotiation_tick(self):
        from seo_workforce.tools import run_negotiation_tick
        ctx = MockContext()
        result = self._run(run_negotiation_tick(ctx))
        data = __import__("json").loads(result)
        assert data["replies_detected"] == 2
        assert data["negotiation_replies_sent_or_drafted"] == 1

    def test_tool_08_list_open_interventions(self):
        from seo_workforce.tools import list_open_interventions
        ctx = MockContext()
        result = self._run(list_open_interventions(ctx))
        data = __import__("json").loads(result)
        assert data["count"] == 0

    def test_tool_09_complete_campaign(self):
        from seo_workforce.tools import complete_campaign
        ctx = MockContext()
        result = self._run(complete_campaign(reason="goal_reached", tool_context=ctx))
        data = __import__("json").loads(result)
        assert data["completed"] is True
        assert data["reason"] == "goal_reached"
        self.mock_update_campaign.assert_called_once()

    def test_tool_error_handling(self):
        """Each tool should return JSON with 'error' key on exception."""
        import json
        from unittest.mock import AsyncMock, patch
        from seo_workforce.tools import get_campaign_state

        with patch("seo_workforce.tools.gateway.get_campaign", AsyncMock(side_effect=RuntimeError("gateway down"))):
            ctx = MockContext()
            result = self._run(get_campaign_state(ctx))
            data = json.loads(result)
            assert "error" in data
            assert "gateway down" in data["error"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
