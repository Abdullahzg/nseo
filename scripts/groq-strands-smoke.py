#!/usr/bin/env python3
"""Groq + Strands smoke test — verifies model invocation and tool calling.

Usage:
    python scripts/groq-strands-smoke.py

Requires GROQ_API_KEY in environment or .env.local.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Load .env.local from repo root
try:
    from dotenv import load_dotenv
    repo_root = Path(__file__).resolve().parent.parent
    for name in (".env.local", ".env"):
        p = repo_root / name
        if p.is_file():
            load_dotenv(p, override=False)
            break
except ImportError:
    pass

ERRORS = 0


def check(label: str, ok: bool, detail: str = ""):
    global ERRORS
    status = "PASS" if ok else "FAIL"
    if not ok:
        ERRORS += 1
    suffix = f" — {detail}" if detail else ""
    print(f"{status} {label}{suffix}")
    return ok


def main():
    # ── 1. Configuration check ────────────────────────────────────────────────
    print("=" * 50)
    print("Groq + Strands Smoke Test")
    print("=" * 50)

    api_key = os.environ.get("GROQ_API_KEY", "")
    check("GROQ_API_KEY configured", bool(api_key and len(api_key) > 10),
          f"length={len(api_key)}" if api_key else "missing")

    provider = os.environ.get("MODEL_PROVIDER", "bedrock")
    check("MODEL_PROVIDER=groq", provider == "groq", f"got: {provider}")

    # ── 2. Import check ───────────────────────────────────────────────────────
    try:
        from strands.models.openai import OpenAIModel
        check("Strands OpenAIModel import", True)
    except ImportError as e:
        check("Strands OpenAIModel import", False, str(e))
        return

    try:
        from strands import Agent, tool
        check("Strands Agent + tool import", True)
    except ImportError as e:
        check("Strands Agent + tool import", False, str(e))
        return

    # ── 3. Model creation ─────────────────────────────────────────────────────
    base_url = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
    model_id = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")

    try:
        model = OpenAIModel(
            client_args={"api_key": api_key, "base_url": base_url},
            model_id=model_id,
            params={"temperature": 0.1, "max_tokens": 256},
        )
        check("Groq OpenAIModel created", True, f"model={model_id}")
    except Exception as e:
        check("Groq OpenAIModel created", False, str(e))
        return

    # ── 4. Simple model invocation ────────────────────────────────────────────
    import asyncio

    async def test_invoke():
        agent = Agent(
            name="smoke_test",
            model=model,
            system_prompt="You are a helpful assistant. Answer briefly.",
        )
        result = await agent.invoke_async("What is 2+2? Reply with just the number.")
        return str(result)

    try:
        response = asyncio.run(test_invoke())
        check("Model invocation", bool(response and len(response.strip()) > 0),
              f"response={response[:100]}")
    except Exception as e:
        check("Model invocation", False, str(e))
        return

    # ── 5. Tool calling ──────────────────────────────────────────────────────
    @tool
    def add_numbers(a: int, b: int) -> int:
        """Add two numbers together.

        Args:
            a: First number
            b: Second number
        """
        return a + b

    async def test_tool():
        agent = Agent(
            name="smoke_tool_test",
            model=model,
            system_prompt="You have a tool called add_numbers. Use it to calculate.",
            tools=[add_numbers],
        )
        result = await agent.invoke_async("What is 17 + 25? Use the add_numbers tool.")
        return str(result)

    try:
        tool_response = asyncio.run(test_tool())
        has_result = "42" in tool_response
        check("Tool calling", has_result, f"response={tool_response[:150]}")
    except Exception as e:
        check("Tool calling", False, str(e))

    # ── Summary ───────────────────────────────────────────────────────────────
    print("=" * 50)
    if ERRORS == 0:
        print("RESULT: ALL PASS")
    else:
        print(f"RESULT: {ERRORS} FAIL(S)")
    print("=" * 50)
    return ERRORS == 0


if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
