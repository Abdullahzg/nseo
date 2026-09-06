#!/usr/bin/env python3
"""Background tick runner — ticks a campaign until completed or max rounds."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

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

CAMPAIGN_ID = sys.argv[1] if len(sys.argv) > 1 else "3d3f9e01-a490-435d-ae3f-21640f5678c2"
MAX_ROUNDS = int(sys.argv[2]) if len(sys.argv) > 2 else 30
STRANDS_URL = os.environ.get("AGENT_SERVICE_URL", "http://localhost:8104")


async def main():
    import httpx

    print(f"Background tick runner: campaign={CAMPAIGN_ID} max={MAX_ROUNDS}")
    print(f"Strands service: {STRANDS_URL}")
    print("=" * 60)

    async with httpx.AsyncClient(timeout=300) as c:
        for i in range(1, MAX_ROUNDS + 1):
            try:
                r = await c.post(f"{STRANDS_URL}/tick", json={"campaign_id": CAMPAIGN_ID})
                if r.status_code == 200:
                    d = r.json()
                    phase = f"{d.get('phase_before')}->{d.get('phase_after')}"
                    mode = d.get("agent_mode", "?")
                    ms = d.get("details", {}).get("duration_ms", 0)
                    transition = d.get("details", {}).get("transition")
                    tag = f" >>> {transition}" if transition else ""
                    print(f"[{i:02d}] {phase} | {mode} | {ms}ms{tag}")
                else:
                    print(f"[{i:02d}] HTTP {r.status_code}: {r.text[:100]}")
                    if r.status_code == 503:
                        print("Service unavailable, stopping.")
                        break
            except Exception as e:
                print(f"[{i:02d}] ERROR: {e}")

            await asyncio.sleep(2)

    print("=" * 60)
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
