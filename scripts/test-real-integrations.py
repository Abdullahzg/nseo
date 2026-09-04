#!/usr/bin/env python3
"""Test all real-mode integrations: Tavily, Blitz, SMTP, IMAP."""
from __future__ import annotations

import asyncio
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

ERRORS = 0


def check(label: str, ok: bool, detail: str = ""):
    global ERRORS
    status = "PASS" if ok else "FAIL"
    if not ok:
        ERRORS += 1
    suffix = f" -- {detail}" if detail else ""
    print(f"  {status} {label}{suffix}")
    return ok


async def test_tavily():
    print("\n[1] TAVILY SEARCH")
    key = os.environ.get("TAVILY_API_KEY", "")
    check("TAVILY_API_KEY configured", bool(key and len(key) > 10), f"len={len(key)}")

    if not key:
        return

    import httpx
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post("https://api.tavily.com/search", json={
                "api_key": key,
                "query": "AI photo restoration tools blog",
                "max_results": 5,
                "search_depth": "basic",
            })
            data = r.json()
            results = data.get("results", [])
            check("Tavily returns results", len(results) > 0, f"count={len(results)}")
            for i, result in enumerate(results[:3]):
                print(f"    {i+1}. {result['title'][:60]}")
                print(f"       {result['url'][:80]}")
    except Exception as e:
        check("Tavily search", False, str(e))


async def test_blitz():
    print("\n[2] BLITZ EMAIL EXTRACTION")
    key = os.environ.get("BLITZ_API_KEY", "")
    check("BLITZ_API_KEY configured", bool(key and len(key) > 10), f"len={len(key)}")

    if not key:
        return

    import httpx
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            # Test with a known LinkedIn URL
            r = await c.get(
                "https://api.blitz-api.ai/v2/account/key-info",
                headers={"x-api-key": key},
            )
            check("Blitz API reachable", r.status_code in (200, 404, 422),
                  f"status={r.status_code}")
            if r.status_code == 200:
                data = r.json()
                print(f"    Result: {str(data)[:200]}")
    except Exception as e:
        check("Blitz API", False, str(e))


def test_smtp():
    print("\n[3] SMTP EMAIL SENDING")
    host = os.environ.get("SMTP_HOST", "")
    user = os.environ.get("SMTP_USER", "")
    pw = os.environ.get("SMTP_PASS", "")
    check("SMTP_HOST configured", bool(host), f"value={host}")
    check("SMTP_USER configured", bool(user), f"value={user}")
    check("SMTP_PASS configured", bool(pw), f"len={len(pw)}")

    if not all([host, user, pw]):
        return

    import smtplib
    from email.mime.text import MIMEText
    try:
        server = smtplib.SMTP_SSL(host, int(os.environ.get("SMTP_PORT", 465)), timeout=10)
        server.login(user, pw)
        check("SMTP login successful", True)

        # Send a test email to ourselves
        msg = MIMEText("This is a test email from SEO Workforce. Ignore this message.")
        msg["Subject"] = "SEO Workforce SMTP Test"
        msg["From"] = os.environ.get("SMTP_FROM_EMAIL", user)
        msg["To"] = user
        server.send_message(msg)
        check("Test email sent", True, f"to={user}")
        server.quit()
    except Exception as e:
        check("SMTP connection/login", False, str(e))


def test_imap():
    print("\n[4] IMAP EMAIL READING")
    host = os.environ.get("IMAP_HOST", "")
    user = os.environ.get("IMAP_USER", "")
    pw = os.environ.get("IMAP_PASS", "")
    check("IMAP_HOST configured", bool(host), f"value={host}")
    check("IMAP_USER configured", bool(user), f"value={user}")
    check("IMAP_PASS configured", bool(pw), f"len={len(pw)}")

    if not all([host, user, pw]):
        return

    import imaplib
    try:
        mail = imaplib.IMAP4_SSL(host, int(os.environ.get("IMAP_PORT", 993)))
        mail.login(user, pw)
        check("IMAP login successful", True)

        mail.select("INBOX")
        status, messages = mail.search(None, "ALL")
        count = len(messages[0].split()) if messages[0] else 0
        check("IMAP INBOX readable", True, f"messages={count}")
        mail.logout()
    except Exception as e:
        check("IMAP connection/login", False, str(e))


async def main():
    print("=" * 50)
    print("Real-Mode Integration Test")
    print("=" * 50)

    await test_tavily()
    await test_blitz()
    test_smtp()
    test_imap()

    print("\n" + "=" * 50)
    if ERRORS == 0:
        print("RESULT: ALL PASS")
    else:
        print(f"RESULT: {ERRORS} FAILED")
    print("=" * 50)
    return ERRORS == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    sys.exit(0 if ok else 1)
