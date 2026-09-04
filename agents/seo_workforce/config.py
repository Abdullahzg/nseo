"""Environment configuration for the SEO Workforce agent service."""
from __future__ import annotations

import os
from pathlib import Path

# ── load .env.local from repo root (local dev convenience) ─────────────────────
try:
    from dotenv import load_dotenv

    # Walk up from agents/ to repo root, load .env.local if present
    _repo_root = Path(__file__).resolve().parent.parent.parent
    for _name in (".env.local", ".env"):
        _path = _repo_root / _name
        if _path.is_file():
            load_dotenv(_path, override=False)  # never override explicit env vars
            break
except ImportError:
    pass  # python-dotenv not installed; rely on process env

# ── model provider ─────────────────────────────────────────────────────────────
MODEL_PROVIDER = os.environ.get("MODEL_PROVIDER", "groq")

# Groq (OpenAI-compatible)
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")

# Bedrock (for AWS hackathon deployment)
STRANDS_MODEL_ID = os.environ.get("STRANDS_MODEL_ID", "anthropic.claude-sonnet-4-20250514-v1:0")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# Gemini (legacy/dev fallback)
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

# ── gateway ────────────────────────────────────────────────────────────────────
AGENT_BASE_URL = os.environ.get("AGENT_BASE_URL", os.environ.get("APP_URL", "http://localhost:3000")).rstrip("/")
AGENT_SERVICE_TOKEN=REDACTED "")

# ── session storage ────────────────────────────────────────────────────────────
SESSION_STORAGE_DIR = os.environ.get("SESSION_STORAGE_DIR", ".strands_sessions")

# ── hackathon mode ─────────────────────────────────────────────────────────────
HACKATHON_MODE = os.environ.get("HACKATHON_MODE", "true").lower() in ("true", "1", "yes")

SERVICE_PORT = int(os.environ.get("PORT", os.environ.get("AGENT_SERVICE_PORT", "8104")))


def model_description() -> dict:
    """Non-sensitive model/provider metadata for health endpoint."""
    if MODEL_PROVIDER == "groq":
        model_id = GROQ_MODEL
    elif MODEL_PROVIDER == "bedrock":
        model_id = STRANDS_MODEL_ID
    else:
        model_id = GEMINI_MODEL
    return {
        "framework": "strands-agents",
        "model_provider": MODEL_PROVIDER,
        "model_id": model_id,
        "hackathon_mode": HACKATHON_MODE,
    }
