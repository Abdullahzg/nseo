"""FastAPI wrapper around the agent loop.

Endpoints mirror forge's Hermes so the client shape is familiar:
  GET  /health        — liveness + config sanity, no auth (a health check that needs a token is useless
                        to a load balancer). Reports whether each credential is PRESENT, never its value.
  POST /chat/stream   — SSE. The one you want.
  POST /chat          — non-streaming, for cron and scripts.
  POST /chat/stop     — interrupt a running turn between tool rounds.
  POST /chat/reset    — drop a conversation's history.

History is in memory, keyed by conversation id. Deliberate: the durable state that matters already
lives in Summit's Postgres, written by the tools. Losing chat scrollback on restart costs nothing;
adding a second database to store it would be real complexity for no gain.
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import StreamingResponse

import agent_loop
import capabilities
import summit_tools

app = FastAPI(title="Summit Hermes")

# What callers present TO Hermes.
#
# Summit presents its own HERMES_TOKEN when calling out to us (see src/lib/hermes/client.ts) and
# accepts that same value when we call back in — so ONE shared secret is the intended, supported
# setup, and the fallback below makes it work with a single env var. Two values are available for
# anyone who wants a smaller blast radius per direction; they just have to set both.
INBOUND_TOKEN = os.environ.get("HERMES_INBOUND_TOKEN") or os.environ.get("SUMMIT_SERVICE_TOKEN", "")

_history: dict[str, list[dict]] = {}
_stopping: set[str] = set()


def _auth(header: Optional[str]) -> None:
    if not INBOUND_TOKEN:
        # Fail closed. An agent that can send email and spend money must never be open to the
        # internet because someone forgot an env var.
        raise HTTPException(503, "HERMES_INBOUND_TOKEN is not set — refusing to serve unauthenticated.")
    if header != f"Bearer {INBOUND_TOKEN}":
        raise HTTPException(401, "bad token")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "model": agent_loop.MODEL,
        "tools": len(summit_tools.tool_definitions()),
        "summit_api": summit_tools.API,
        # Presence only. Echoing a secret from an unauthenticated endpoint would be the bug.
        "configured": {
            "anthropic_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
            "summit_service_token": bool(summit_tools.TOKEN),
            "inbound_token": bool(INBOUND_TOKEN),
        },
        "conversations": len(_history),
    }


@app.post("/chat/stream")
async def chat_stream(req: Request, authorization: Optional[str] = Header(None)):
    _auth(authorization)
    body = await req.json()
    text = (body.get("message") or "").strip()
    conv = body.get("conversation_id") or "default"
    if not text:
        raise HTTPException(400, "message is required")

    queue: asyncio.Queue[dict | None] = asyncio.Queue()
    _stopping.discard(conv)

    async def work():
        try:
            _history[conv] = await agent_loop.run_turn(
                _history.get(conv, []), text,
                emit=lambda ev: queue.put_nowait(ev),
                should_stop=lambda: conv in _stopping,
            )
        except Exception as e:
            queue.put_nowait({"type": "error", "error": f"{type(e).__name__}: {e}"})
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(work())

    async def events():
        try:
            while True:
                ev = await queue.get()
                if ev is None:
                    break
                yield f"data: {json.dumps(ev, default=str)}\n\n"
        finally:
            # A closed browser tab must not leave the turn running — it would keep calling tools, and
            # those tools have side effects.
            if not task.done():
                _stopping.add(conv)

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/chat")
async def chat(req: Request, authorization: Optional[str] = Header(None)) -> dict[str, Any]:
    _auth(authorization)
    body = await req.json()
    text = (body.get("message") or "").strip()
    conv = body.get("conversation_id") or "default"
    if not text:
        raise HTTPException(400, "message is required")

    events: list[dict] = []
    _history[conv] = await agent_loop.run_turn(
        _history.get(conv, []), text, emit=events.append, should_stop=lambda: conv in _stopping)

    reply = next((e["text"] for e in reversed(events) if e.get("type") == "done"), "")
    return {"ok": True, "reply": reply,
            "tools_used": [e["name"] for e in events if e.get("type") == "tool"],
            "events": events}


@app.post("/chat/stop")
async def chat_stop(req: Request, authorization: Optional[str] = Header(None)) -> dict[str, Any]:
    _auth(authorization)
    conv = (await req.json()).get("conversation_id") or "default"
    _stopping.add(conv)
    return {"ok": True, "stopping": conv}


@app.post("/chat/reset")
async def chat_reset(req: Request, authorization: Optional[str] = Header(None)) -> dict[str, Any]:
    _auth(authorization)
    conv = (await req.json()).get("conversation_id") or "default"
    _history.pop(conv, None)
    return {"ok": True, "reset": conv}


# ─── /v1 — the capability endpoints Summit calls from server code ──────────────
#
# Separate from /chat because these are not conversations: they are single-shot calls made inside
# request paths that must not hang. src/lib/hermes/client.ts is the contract — it was written first,
# and it swallows errors into null so that a Hermes outage degrades Summit instead of breaking it.
# Which is exactly why a shape mismatch here fails SILENTLY. Change these only against that file.


@app.get("/v1/health")
async def v1_health(authorization: Optional[str] = Header(None)) -> dict[str, Any]:
    """Authenticated liveness, for Summit's settings page. /health stays open for load balancers."""
    _auth(authorization)
    return {"ok": True, "model": agent_loop.MODEL, "browser": _browser_available()}


@app.post("/v1/research")
async def v1_research(req: Request, authorization: Optional[str] = Header(None)) -> dict[str, Any]:
    _auth(authorization)
    body = await req.json()
    question = (body.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "question is required")
    return await capabilities.research(question, body.get("window") or None)


@app.post("/v1/scrape")
async def v1_scrape(req: Request, authorization: Optional[str] = Header(None)) -> dict[str, Any]:
    _auth(authorization)
    body = await req.json()
    url = (body.get("url") or "").strip()
    if not url:
        raise HTTPException(400, "url is required")
    return await capabilities.scrape(url, body.get("want") or "text")


def _browser_available() -> bool:
    """Whether a real browser is installed. Surfaced in health because it is the difference between
    Hermes being a genuine capability and being a slightly slower fetch."""
    try:
        import playwright.async_api  # type: ignore  # noqa: F401
        return True
    except ImportError:
        return False
