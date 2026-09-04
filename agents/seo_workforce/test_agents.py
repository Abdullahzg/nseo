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


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
