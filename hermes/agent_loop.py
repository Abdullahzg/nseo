"""The Anthropic tool-use loop.

Generic on purpose: it knows nothing about Summit. All product knowledge lives in SOUL.md (the system
prompt) and summit_tools.py (the tools). This file only runs the conversation.

Copied from forge's pattern, not its code. The four things worth preserving from that pattern:

1. The system prompt is built ONCE per process and cached with `cache_control`. It is several thousand
   tokens of soul + operating rules, re-sent on every turn — reading it from cache instead of
   reprocessing it is most of the cost of running an agent like this.
2. Tool results go back as a SINGLE user message containing every tool_result block. Anthropic's API
   requires that shape when the model makes parallel tool calls; sending them as separate messages is
   a 400.
3. Parallel tool calls run concurrently. The model routinely asks for four reads at once and doing
   them in sequence is four round trips of latency for no reason.
4. A tool that raises must come back as an error string, not an exception. The model recovers from a
   legible error; a dead turn just loses the work.
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any, Callable

from anthropic import AsyncAnthropic

import summit_tools

MODEL = os.environ.get("HERMES_MODEL", "claude-opus-4-8")
MAX_TOKENS = int(os.environ.get("HERMES_MAX_TOKENS", "8192"))
# Ceiling on tool round-trips in one turn. A wedged agent burns budget silently; this makes it stop
# and say so instead.
MAX_ITERATIONS = int(os.environ.get("HERMES_MAX_ITERATIONS", "40"))

_client: AsyncAnthropic | None = None
_system: list[dict] | None = None


def client() -> AsyncAnthropic:
    global _client
    if _client is None:
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")
        _client = AsyncAnthropic(api_key=key)
    return _client


def system_prompt() -> list[dict]:
    """SOUL.md as a cached system block.

    Built once per process and never re-read. Deliberate: re-reading the file per turn would let an
    edit change the cached prefix mid-conversation and silently drop the cache hit rate to zero. Edit
    SOUL.md, restart the service — that is the contract.

    Nothing dynamic may go in here. A timestamp, a row count, a "today is" line — anything that
    changes between turns — invalidates the cache on every single request. That is the most expensive
    mistake available in this file.
    """
    global _system
    if _system is None:
        soul = (Path(__file__).parent / "SOUL.md").read_text(encoding="utf-8")
        _system = [{"type": "text", "text": soul, "cache_control": {"type": "ephemeral"}}]
    return _system


async def run_turn(
    history: list[dict],
    user_text: str,
    emit: Callable[[dict], None],
    should_stop: Callable[[], bool] | None = None,
) -> list[dict]:
    """Run one user turn to completion. Returns the updated history.

    `emit` pushes events to the caller as they happen — text deltas, tool starts, tool results, and
    whatever the UI tools emit. `should_stop` lets the operator interrupt between iterations.
    """
    messages = list(history) + [{"role": "user", "content": user_text}]
    tools = summit_tools.tool_definitions()
    # Text accumulates across EVERY iteration of the turn, not just the last one. The model
    # routinely says the important thing before it calls a tool — "I can't send those, here is
    # why" — and then closes with a one-line summary after. Reporting only the final iteration
    # silently dropped the reasoning, which the non-streaming /chat endpoint returns as its whole
    # reply. Streaming callers never saw the bug because they get every delta as it arrives.
    turn_text: list[str] = []

    for _ in range(MAX_ITERATIONS):
        if should_stop and should_stop():
            emit({"type": "stopped"})
            break

        tool_uses: list[Any] = []

        async with client().messages.stream(
            model=MODEL, max_tokens=MAX_TOKENS, system=system_prompt(),
            tools=tools, messages=messages,
        ) as stream:
            async for event in stream:
                if event.type == "content_block_delta" and getattr(event.delta, "type", "") == "text_delta":
                    emit({"type": "text", "text": event.delta.text})
            final = await stream.get_final_message()

        for block in final.content:
            if block.type == "text":
                turn_text.append(block.text)
            elif block.type == "tool_use":
                tool_uses.append(block)

        # Cache accounting, so a broken prefix is visible rather than merely expensive.
        u = final.usage
        emit({"type": "usage",
              "input": u.input_tokens, "output": u.output_tokens,
              "cache_read": getattr(u, "cache_read_input_tokens", 0) or 0,
              "cache_write": getattr(u, "cache_creation_input_tokens", 0) or 0})

        # Append the assistant turn. The raw blocks matter: tool_use ids have to survive to be paired
        # with their results, and re-serialising from display text loses them.
        messages.append({"role": "assistant", "content": [_replayable(b) for b in final.content]})

        if not tool_uses:
            emit({"type": "done", "text": "\n\n".join(t for t in turn_text if t.strip())})
            break

        for t in tool_uses:
            emit({"type": "tool", "name": t.name, "input": t.input})

        # Parallel fan-out. The model asks for several reads at once; serialising them adds latency
        # and nothing else. return_exceptions so one failure cannot cancel its siblings.
        results = await asyncio.gather(
            *[summit_tools.handle(t.name, t.input or {}, emit) for t in tool_uses],
            return_exceptions=True,
        )

        blocks = []
        for t, r in zip(tool_uses, results):
            if isinstance(r, BaseException):
                r = {"error": f"{type(r).__name__}: {r}"}
            emit({"type": "tool_result", "name": t.name, "result": r})
            blocks.append({
                "type": "tool_result", "tool_use_id": t.id,
                "content": _as_text(r),
                # Flagged as an error so the model treats it as a failure to work around rather than
                # as data. Without this it happily reports {"error": …} to the operator as a finding.
                **({"is_error": True} if isinstance(r, dict) and "error" in r else {}),
            })

        # ONE user message holding every tool_result. Splitting them is a 400 from the API.
        messages.append({"role": "user", "content": blocks})
    else:
        emit({"type": "error",
              "error": f"Stopped after {MAX_ITERATIONS} tool rounds without finishing. "
                       "The task is probably too large for one turn — narrow it."})

    return messages


def _replayable(block: Any) -> dict:
    """One assistant content block, reduced to the fields the API will accept back.

    A plain `model_dump()` does NOT round-trip. The SDK's response models carry read-only extras that
    the request schema rejects — `parsed_output` on a text block is the one that bites, and it fails
    with `Extra inputs are not permitted` only on the SECOND turn, once the block is being replayed as
    history. Turn one looks perfect.

    So this whitelists rather than excludes: a field the SDK adds next version is dropped by default
    instead of breaking every conversation on upgrade.

    `signature` on a thinking block is load-bearing and must be passed through byte-for-byte — it is
    how the API verifies the reasoning was not tampered with, and a thinking block without it is
    rejected.
    """
    d = block.model_dump()
    t = d.get("type")
    if t == "text":
        out = {"type": "text", "text": d.get("text", "")}
        if d.get("citations"):
            out["citations"] = d["citations"]
        return out
    if t == "tool_use":
        return {"type": "tool_use", "id": d["id"], "name": d["name"], "input": d.get("input") or {}}
    if t == "thinking":
        return {"type": "thinking", "thinking": d.get("thinking", ""), "signature": d.get("signature", "")}
    if t == "redacted_thinking":
        return {"type": "redacted_thinking", "data": d.get("data", "")}
    return d  # unknown block type: pass it through rather than silently dropping the turn's content


def _as_text(result: Any) -> str:
    import json
    if isinstance(result, str):
        return result
    try:
        s = json.dumps(result, default=str)
    except Exception:
        s = str(result)
    # Big JSON payloads (a 200-prospect funnel) blow the context and cost more than they inform.
    # Truncating with a visible marker beats a silent context overflow.
    return s if len(s) <= 24000 else s[:24000] + f"\n… truncated, {len(s)} chars total"
