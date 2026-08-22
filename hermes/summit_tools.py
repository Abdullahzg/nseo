"""Summit tool registry for the Hermes agent loop.

Every tool is a thin async HTTP client onto Summit's OWN API — the same routes the pages call. No
business logic lives here: if a tool needs a decision made, that decision belongs in Summit where the
UI enforces it too. This file is the whole reason Hermes is useful; the loop around it is generic.

ISOLATION FROM FORGE — read this before editing.
This is a SEPARATE deployment from forge's Hermes. forge runs its own agent on the imagine-forge VPS
(port 8003, tools in apps/hermes/forge_tools.py) that publishes Meta ads. Nothing here touches it:
  * every env var is SUMMIT_*, never FORGE_*
  * SUMMIT_API_URL points at Summit, never forge.imagine.art
  * this file is Summit's own; forge_tools.py is not imported, copied or referenced at runtime
If both ever land on one host, a shared variable name is how Summit's agent starts spending ad budget.

AUGMENT, NEVER REPLACE.
Summit's existing paths stay authoritative. Discovery still runs its own harvesters; research still
uses Tavily first. Hermes adds a second source that MERGES into the same tables and is scored by the
same scorer. It earns its cost on pages a plain fetch cannot read — which are disproportionately the
high-authority publishers worth having — not by doing cheap work expensively.

WRITE SAFETY.
forge's rule is that ads always publish PAUSED. The same principle here: nothing this agent does may
reach a person or spend money without the gate a human would face. Pitches land `ready`, never
`scheduled`. Drafts never auto-publish. The email-trust gate still applies server-side. Tools that
would cross that line are marked DRAFT-ONLY and must stay that way.
"""
from __future__ import annotations

import os
from typing import Any, Awaitable, Callable

import httpx

# Summit's API. Server-to-server auth rides Authorization: Bearer <SUMMIT_SERVICE_TOKEN>, which must
# match Summit's HERMES_TOKEN — validated in src/lib/auth/service.ts AND allowed past src/proxy.ts.
# Both matter: the proxy runs first and redirects anything it does not recognise to /login, so a
# mismatch shows up as login HTML with a 200 rather than a 401.
API = os.environ.get("SUMMIT_API_URL", "http://127.0.0.1:3000").rstrip("/")
TOKEN = os.environ.get("SUMMIT_SERVICE_TOKEN", "")

HTTP_TIMEOUT_S = 120.0
# Image generation is a blocking call that really does take minutes; the default timeout abandons
# renders that then still complete, which looks like an outage. forge learned this the hard way.
RENDER_TIMEOUT_S = 420.0

EmitFn = Callable[[dict], None]

# name -> {"def": anthropic tool def, "fn": async handler(args, emit)}
_REGISTRY: dict[str, dict[str, Any]] = {}


def _tool(name: str, description: str, properties: dict | None = None, required: list[str] | None = None):
    """Register a tool. The description is what the model reads to decide whether to call it, so it
    states what the tool DOES and any constraint the model cannot infer."""
    def wrap(fn: Callable[[dict, EmitFn], Awaitable[Any]]):
        _REGISTRY[name] = {
            "def": {
                "name": name,
                "description": description,
                "input_schema": {
                    "type": "object",
                    "properties": properties or {},
                    "required": required or [],
                },
            },
            "fn": fn,
        }
        return fn
    return wrap


def tool_definitions() -> list[dict]:
    """The tools array for the Anthropic call.

    IMPORTANT: this must be identical on every turn. The tools array is part of the cached prefix, so a
    conditionally-included tool silently invalidates the whole prompt cache. If a capability is
    unavailable, keep the tool and return an error from the handler instead of omitting it.
    """
    return [t["def"] for t in _REGISTRY.values()]


async def handle(name: str, args: dict, emit: EmitFn) -> Any:
    entry = _REGISTRY.get(name)
    if not entry:
        return {"error": f"unknown tool {name}"}
    try:
        return await entry["fn"](args, emit)
    except Exception as e:  # a tool failing must not kill the turn
        return {"error": f"{type(e).__name__}: {e}"}


def _client(timeout: float = HTTP_TIMEOUT_S) -> httpx.AsyncClient:
    headers = {"Content-Type": "application/json"}
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    return httpx.AsyncClient(base_url=API, headers=headers, timeout=timeout, follow_redirects=False)


async def _get(c: httpx.AsyncClient, path: str, **params) -> Any:
    r = await c.get(path, params={k: v for k, v in params.items() if v is not None})
    return _unwrap(r, path)


async def _post(c: httpx.AsyncClient, path: str, body: dict | None = None) -> Any:
    r = await c.post(path, json=body or {})
    return _unwrap(r, path)


def _unwrap(r: httpx.Response, path: str) -> Any:
    """Turn a response into data or a legible error.

    The 3xx case is called out explicitly because it is the failure everyone hits first: Summit's proxy
    redirects unrecognised callers to /login, so a bad token looks like a successful redirect rather
    than an auth error. Saying so here saves an hour of confusion.
    """
    if r.status_code in (301, 302, 303, 307, 308):
        return {"error": f"{path} redirected to {r.headers.get('location')} — SUMMIT_SERVICE_TOKEN is "
                         "probably wrong or not allowed past the proxy (see src/proxy.ts)."}
    if r.status_code >= 400:
        return {"error": f"{path} returned {r.status_code}", "body": r.text[:400]}
    try:
        return r.json()
    except Exception:
        return {"error": f"{path} returned non-JSON", "body": r.text[:400]}


# ─── Discovery & research (the augmenting half) ────────────────────────────────

@_tool("discover_backlink_prospects",
       "Find MORE link prospects for an existing backlink campaign. Additive: Summit's own harvesters "
       "already ran, this adds to the same pool and the same scorer. Enrichment chains automatically, "
       "so do not call find_email afterwards.",
       {"campaign_id": {"type": "string", "description": "Backlink campaign id from list_backlink_campaigns."},
        "max_prospects": {"type": "integer", "description": "Ceiling on new prospects. Default 15."}},
       ["campaign_id"])
async def discover_backlink_prospects(args: dict, emit: EmitFn):
    async with _client(300.0) as c:
        return await _post(c, f"/api/backlinks/{args['campaign_id']}/action",
                           {"action": "discover", "maxProspects": args.get("max_prospects", 15)})


@_tool("list_backlink_campaigns",
       "Every backlink campaign with its prospect and live-link counts. Call this first to get a "
       "campaign_id.")
async def list_backlink_campaigns(args: dict, emit: EmitFn):
    async with _client() as c:
        return await _get(c, "/api/backlinks")


@_tool("campaign_funnel",
       "One campaign in detail: every prospect with its score, Domain Rating, email quality "
       "(sourced/verified/guess/none), stage, and what still needs a human.",
       {"campaign_id": {"type": "string"}}, ["campaign_id"])
async def campaign_funnel(args: dict, emit: EmitFn):
    async with _client() as c:
        return await _get(c, f"/api/backlinks/{args['campaign_id']}")


@_tool("find_email",
       "Run Summit's email-finding cascade for a campaign's prospects. Uses the existing 6-step "
       "cascade — do not try to find addresses yourself, and never guess one.",
       {"campaign_id": {"type": "string", "description": "The UNDERLYING campaign id, not the backlink campaign id."},
        "only_new": {"type": "boolean", "description": "Skip anyone already searched. Default true — it saves credits."}},
       ["campaign_id"])
async def find_email(args: dict, emit: EmitFn):
    async with _client(300.0) as c:
        return await _post(c, "/api/enrich/run",
                           {"campaign_id": args["campaign_id"], "mode": "email",
                            "only_new": args.get("only_new", True)})


# ─── Content ──────────────────────────────────────────────────────────────────

@_tool("generate_asset",
       "Generate image assets. ALWAYS pass `surface`: it selects the art-direction preset and changes "
       "the result more than the prompt does. A two-or-three-word subject is enough — the preset "
       "supplies the look. DRAFT-ONLY: images land in the gallery, never on a live page.",
       {"subject": {"type": "string", "description": "Just the subject. Do not describe the style."},
        "surface": {"type": "string", "description": "blog | landing. Required in practice."},
        "role": {"type": "string", "description": "hero | inline | og | thumbnail."},
        "topic": {"type": "string"},
        "count": {"type": "integer", "description": "Variants, 1-4. Each is locked to a different look."}},
       ["subject", "surface"])
async def generate_asset(args: dict, emit: EmitFn):
    async with _client(RENDER_TIMEOUT_S) as c:
        out = await _post(c, "/api/media/generate", {
            "subject": args["subject"], "surface": args.get("surface", "blog"),
            "role": args.get("role", "hero"), "topic": args.get("topic") or args["subject"],
            "count": min(int(args.get("count", 2)), 4),
        })
        # Push the images to the chat the moment they exist rather than only in the tool result.
        for a in (out or {}).get("assets", []) or []:
            emit({"type": "asset", "url": a.get("url"), "role": a.get("role")})
        return out


@_tool("launch_landing_page",
       "Turn a TEMPLATISED landing page into a draft the writer can fill, and link it. Idempotent — "
       "an existing draft comes back rather than forking a second one.",
       {"landing_page_id": {"type": "string"}}, ["landing_page_id"])
async def launch_landing_page(args: dict, emit: EmitFn):
    async with _client() as c:
        return await _post(c, f"/api/landing/{args['landing_page_id']}/launch")


@_tool("list_landing_pages",
       "Every tracked landing page with its stage (brief / vibe_coded / templatised / drafted / published).")
async def list_landing_pages(args: dict, emit: EmitFn):
    async with _client() as c:
        return await _get(c, "/api/landing")


# ─── Outreach ─────────────────────────────────────────────────────────────────

@_tool("queue_status",
       "The send queue and all-time outreach stats: queued, sent, replies, reply rate, wins, win rate.")
async def queue_status(args: dict, emit: EmitFn):
    async with _client() as c:
        return await _get(c, "/api/emails/status")


@_tool("list_threads",
       "Every engaged outreach thread, triaged: needs_reply, human intervention, negotiating, agreed, "
       "hard no, bounced. Use this to find what is stuck.")
async def list_threads(args: dict, emit: EmitFn):
    async with _client() as c:
        return await _get(c, "/api/negotiation/threads")


@_tool("take_over_thread",
       "Stop the AI negotiator managing one thread so a PERSON can answer it. Use when a thread needs "
       "human judgement — never to then answer it yourself.",
       {"author_id": {"type": "string"}}, ["author_id"])
async def take_over_thread(args: dict, emit: EmitFn):
    async with _client() as c:
        return await _post(c, f"/api/inbox/{args['author_id']}/takeover")


# ─── Measurement ──────────────────────────────────────────────────────────────

@_tool("adoption_report",
       "Who uses Summit, how much, and what it produced — wins, losses and opportunities, each with "
       "the source column it came from. Admin-gated.",
       {"days": {"type": "integer", "description": "Window, 7-365. Default 90."}})
async def adoption_report(args: dict, emit: EmitFn):
    async with _client() as c:
        return await _get(c, "/api/admin/adoption", days=args.get("days", 90))


# ─── Pure UI — these never touch the API ──────────────────────────────────────

@_tool("show_options",
       "Put a set of choices in front of the operator as clickable options. Use when a decision is "
       "genuinely theirs — spending money, emailing a real person, publishing.",
       {"question": {"type": "string"}, "options": {"type": "array", "items": {"type": "string"}}},
       ["question", "options"])
async def show_options(args: dict, emit: EmitFn):
    emit({"type": "options", "question": args["question"], "options": args["options"]})
    return {"shown": True}


@_tool("show_table",
       "Render rows as a table in the chat. Row-major, first row is the header.",
       {"title": {"type": "string"}, "rows": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}}},
       ["rows"])
async def show_table(args: dict, emit: EmitFn):
    emit({"type": "table", "title": args.get("title"), "rows": args["rows"]})
    return {"shown": True}
