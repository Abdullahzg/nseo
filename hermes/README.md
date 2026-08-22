# Summit Hermes

An Anthropic tool-use agent whose tools are Summit's own API. It is an operator, not an oracle: it can
do what the product can do, which is why it needs no business logic of its own.

**Verified working** against the live Summit dev server on 2026-07-30 — 13 tools, prompt cache reading
3,641 tokens per turn, multi-turn history, and both `/v1` capability endpoints.

## Isolation from forge — read before editing

forge's Hermes is a live service the ads team depends on. This shares its *pattern* and none of its
*instance*.

| | forge | Summit (this) |
|---|---|---|
| Port | 8003 | **8103** |
| Env namespace | `FORGE_*` | **`SUMMIT_*`** |
| Tools | `forge_tools.py`, publishes Meta ads | `summit_tools.py`, 13 tools, no ad surface |
| Engine | forge FastAPI | Summit Next.js API |

Three rules: separate deployment, separate env namespace, separate credentials. If both ever land on
one host, a shared variable name is how Summit's agent starts spending ad budget.

## Layout

| file | what it is |
|---|---|
| `SOUL.md` | the system prompt. Product knowledge, safety rules, house style. Edit this to change behaviour. |
| `summit_tools.py` | the 13 tools. Thin async HTTP clients onto Summit's routes. |
| `agent_loop.py` | the Anthropic loop. Generic — knows nothing about Summit. |
| `capabilities.py` | `/v1/research` and `/v1/scrape`. Not chat; called by Summit server code. |
| `server.py` | FastAPI wrapper. |

## Endpoints

| endpoint | auth | who calls it |
|---|---|---|
| `GET /health` | none | load balancers. Reports credential *presence*, never values. |
| `POST /chat/stream` | Bearer | a person, via SSE |
| `POST /chat` | Bearer | scripts and crons |
| `POST /chat/stop` · `/chat/reset` | Bearer | interrupt / clear history |
| `GET /v1/health` | Bearer | Summit's settings page |
| `POST /v1/research` | Bearer | the writer, the news sweep |
| `POST /v1/scrape` | Bearer | **enrichment cascade step 5.5** |

`/v1/*` is the contract in `src/lib/hermes/client.ts`. That file swallows errors into `null` so a
Hermes outage degrades Summit instead of breaking it — which is exactly why a shape mismatch there
fails **silently**. Change these two together or not at all.

## Run it

**Never expose this service directly.** It matches forge's production shape: uvicorn binds loopback, and
a reverse proxy with a password gate is the only public door. Files in `deploy/`.

```bash
pip install -r requirements.txt
cp .env.example .env        # fill it in
uvicorn server:app --host 127.0.0.1 --port 8103
```

Then put Caddy in front:

```bash
caddy hash-password
```

Paste the hash into `deploy/Caddyfile.summit-hermes.snippet`, uncomment the `basic_auth` block, append it
to the host's Caddyfile, and `caddy reload`.

For a managed unit, install `deploy/summit-hermes.service` (secrets go in an `EnvironmentFile`, chmod 600
— a unit file is world-readable).

Docker: `docker compose up -d --build`. The compose file publishes the port as `127.0.0.1:8103:8103`, so
only the host's loopback reaches it. Inside the container uvicorn still binds `0.0.0.0`, which is correct
— a container-local loopback would be unreachable even from the host, so the isolation happens at the
publish step. Publishing `8103:8103` instead would put the agent on the internet and bypass the gate.

### Why two layers of auth

The bearer token is real authentication and it is checked. But this agent can spend enrichment credits,
generate paid images, and read the outreach database, and it sits on a public hostname. A single
long-lived header secret is one leaked curl command, one screenshot, or one log file away from being
someone else's. forge made the same call for an agent that spends ad budget.

### The browser is optional, and it is the point

Reading bot-protected pages is Hermes's entire edge over Summit's own `fetch` — and those pages are
disproportionately the high-authority publishers worth a link from. Without a browser, `/v1/scrape`
degrades to plain HTTP and honestly reports `neededBrowser: false`; `GET /v1/health` tells you which
mode you are in.

```bash
pip install playwright && playwright install chromium
```

In Docker, add `RUN playwright install --with-deps chromium` after the pip step.

## Tokens

Two directions, and **one shared secret is the supported setup**:

- Summit → Hermes: Summit sends its `HERMES_TOKEN`.
- Hermes → Summit: we send `SUMMIT_SERVICE_TOKEN`, which Summit validates as `HERMES_TOKEN`.

So set `SUMMIT_SERVICE_TOKEN` to the same value as Summit's `HERMES_TOKEN` and leave
`HERMES_INBOUND_TOKEN` unset — it falls back to the service token. Set both only if you want a
smaller blast radius per direction.

Summit-side, the token must be recognised in **two** places or nothing works:
`src/lib/auth/service.ts` (the routes) and `src/proxy.ts` (the edge). The proxy runs first, so a
token it does not know is redirected to `/login` and the agent receives login HTML with a 200 — no
error, no explanation. `summit_tools.py` detects that specific case and says so.

## Safety, as built

The rule is forge's, applied here: nothing reaches a person or spends money without the gate a human
would face.

- **No send tool exists.** Pitches land `ready`; a person sends. Tested: asked to send 106 queued
  emails with explicit authorisation, it declined and explained why.
- **No publish tool exists.** Drafts stay drafts.
- **Guessed emails stay blocked.** Summit refuses `pattern`/`pattern-catchall` addresses server-side;
  the agent cannot route around it and is told not to try.
- **Not admin by default.** `adoption_report` is per-colleague activity, so the agent gets a 403 with
  a legible message unless `HERMES_ALLOW_ADMIN=1` is set on Summit. Deploying an agent should not
  quietly widen who can read how much each teammate used the tool.

## Two bugs worth not reintroducing

1. **`model_dump()` does not round-trip.** Assistant blocks carry `parsed_output`, which the request
   schema rejects — and only on the *second* turn, when the block is replayed as history. Turn one
   looks perfect. `_replayable()` whitelists fields instead. Keep `signature` on thinking blocks
   byte-exact.
2. **The `done` event must carry the whole turn.** The model often says the important thing *before*
   calling a tool ("I can't send those, here is why") and closes with a one-liner. Reporting only the
   final iteration silently truncated `/chat`'s entire reply. Streaming callers never saw it.

## Do not put anything dynamic in SOUL.md

It is the cached prefix. A timestamp, a row count, a "today is" line — anything that changes between
turns invalidates the cache on every request. It is read once per process: edit the file, restart the
service.
