#!/usr/bin/env python3
"""End-to-end campaign test — creates a campaign, runs ticks, verifies lifecycle.

Usage:
    python scripts/e2e-campaign-test.py

Requires:
    - All services running (start-local.ps1)
    - Real Groq API key in environment or .env.local
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

# Load .env.local
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

BASE_URL = os.environ.get("NEXT_PUBLIC_BASE_URL", "http://localhost:3100")
STRANDS_URL = os.environ.get("AGENT_SERVICE_URL", "http://localhost:8104")
TOKEN = os.environ.get("AGENT_SERVICE_TOKEN", "")
ERRORS = 0
MAX_ROUNDS = 8


def check(label: str, ok: bool, detail: str = ""):
    global ERRORS
    status = "PASS" if ok else "FAIL"
    if not ok:
        ERRORS += 1
    suffix = f" — {detail}" if detail else ""
    print(f"{status} {label}{suffix}")
    return ok


def headers():
    return {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


async def main():
    import httpx

    print("=" * 60)
    print("E2E Campaign Test")
    print("=" * 60)

    # ── 1. Health checks ──────────────────────────────────────────────────────
    print("\n[1] Health checks")

    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{STRANDS_URL}/health")
            health = r.json()
            check("Strands service healthy", health.get("ok") is True,
                  f"framework={health.get('framework')}")
    except Exception as e:
        check("Strands service healthy", False, str(e))
        return

    # ── 2. Create campaign via API ────────────────────────────────────────────
    print("\n[2] Create campaign")
    campaign_id = None
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"{BASE_URL}/api/campaigns", headers=headers(), json={
                "objective": "E2E test — acquire 2 backlinks for AI photo restoration SaaS",
                "website_url": "https://example.com/ai-photo-restoration",
                "keywords": ["AI photo restoration", "photo restoration tools"],
                "desired_deals": 2,
                "budget_total": 500,
                "currency": "USD",
            })
            if r.status_code in (200, 201):
                data = r.json()
                campaign_id = data.get("id") or data.get("campaign_id")
                check("Campaign created", bool(campaign_id), f"id={campaign_id}")
            else:
                check("Campaign created", False, f"status={r.status_code} body={r.text[:200]}")
    except Exception as e:
        check("Campaign created", False, str(e))

    if not campaign_id:
        print("\nCannot proceed without campaign_id.")
        return

    # ── 3. Run ticks and verify lifecycle ─────────────────────────────────────
    print(f"\n[3] Run ticks (campaign={campaign_id})")
    phases_seen = set()
    ticks_run = 0

    async with httpx.AsyncClient(timeout=300) as c:
        for i in range(MAX_ROUNDS):
            try:
                r = await c.post(f"{STRANDS_URL}/tick", headers=headers(),
                                 json={"campaign_id": campaign_id})
                if r.status_code != 200:
                    check(f"Tick {i+1}", False, f"status={r.status_code} {r.text[:200]}")
                    if r.status_code == 503:
                        print("  Strands service unavailable — stopping")
                        break
                    continue

                result = r.json()
                phase_before = result.get("phase_before")
                phase_after = result.get("phase_after")
                action = result.get("action_taken")
                agent_mode = result.get("agent_mode")
                summary = result.get("summary", "")[:100]

                phases_seen.add(phase_after)
                ticks_run += 1

                check(f"Tick {i+1}: {phase_before} → {phase_after}",
                      action in ("agent", "policy", "noop"),
                      f"action={action} mode={agent_mode}")

                if phase_after == "completed":
                    print(f"  Campaign completed after {ticks_run} tick(s)")
                    break

            except Exception as e:
                check(f"Tick {i+1}", False, str(e))
                break

    # ── 4. Verify campaign state ──────────────────────────────────────────────
    print(f"\n[4] Verify final state")
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(f"{BASE_URL}/api/campaigns/{campaign_id}", headers=headers())
            if r.status_code == 200:
                final = r.json()
                final_phase = final.get("phase")
                check("Final phase is terminal",
                      final_phase in ("completed", "monitoring", "outreaching"),
                      f"phase={final_phase}")
                check("Budget tracked",
                      isinstance(final.get("budget_used"), (int, float)),
                      f"budget_used={final.get('budget_used')}")
            else:
                check("Campaign state fetch", False, f"status={r.status_code}")
    except Exception as e:
        check("Campaign state fetch", False, str(e))

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print(f"Ticks run:    {ticks_run}")
    print(f"Phases seen:  {sorted(phases_seen)}")
    if ERRORS == 0:
        print("RESULT: E2E PASS")
    else:
        print(f"RESULT: {ERRORS} FAILED")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
    sys.exit(0 if ERRORS == 0 else 1)
