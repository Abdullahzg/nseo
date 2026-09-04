"""Environment configuration for the SEO Workforce agent service."""
from __future__ import annotations

import os

# ── model provider ─────────────────────────────────────────────────────────────
# Primary: Amazon Bedrock. Optional dev: Gemini (via Strands provider).
MODEL_PROVIDER = os.environ.get("MODEL_PROVIDER", "bedrock")
STRANDS_MODEL_ID = os.environ.get("STRANDS_MODEL_ID", "anthropic.claude-sonnet-4-20250514-v1:0")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# Gemini fallback for local dev (when MODEL_PROVIDER=gemini)
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

# ── gateway ────────────────────────────────────────────────────────────────────
AGENT_BASE_URL = os.environ.get("AGENT_BASE_URL", os.environ.get("APP_URL", "http://localhost:3000")).rstrip("/")
AGENT_SERVICE_TOKEN=REDACTED "")

# ── session storage ────────────────────────────────────────────────────────────
SESSION_STORAGE_DIR = os.environ.get("SESSION_STORAGE_DIR", ".strands_sessions")

# ── hackathon mode ─────────────────────────────────────────────────────────────
# When true, /tick FAILS VISIBLY if Strands service is unavailable.
# No silent TypeScript fallback.
HACKATHON_MODE = os.environ.get("HACKATHON_MODE", "true").lower() in ("true", "1", "yes")

SERVICE_PORT = int(os.environ.get("PORT", os.environ.get("AGENT_SERVICE_PORT", "8104")))


def model_description() -> dict:
    """Non-sensitive model/provider metadata for health endpoint."""
    return {
        "framework": "strands-agents",
        "model_provider": MODEL_PROVIDER,
        "model_id": STRANDS_MODEL_ID if MODEL_PROVIDER == "bedrock" else GEMINI_MODEL,
        "hackathon_mode": HACKATHON_MODE,
    }
