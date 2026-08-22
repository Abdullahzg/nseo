"""The /v1 capability endpoints: research and scrape.

These are NOT chat. Summit calls them directly from server code — `src/lib/hermes/client.ts` — as
augmenting steps inside paths that already work:

  /v1/scrape    ← enrichment cascade step 5.5, after every cheap attempt has failed and BEFORE the
                  pattern guess. The single highest-value call in the integration: it is the one point
                  where bounces get manufactured, and a real address found here replaces a guess that
                  would have been blocked anyway.
  /v1/research  ← the writer and the news sweep, for questions a plain fetch cannot answer.

Both return the exact shape `client.ts` declares. That file was written first, so it is the contract;
if these drift from it the failure is silent, because the client swallows errors and returns null by
design so a Hermes outage can never break Summit.
"""
from __future__ import annotations

import asyncio
import os
import re
from typing import Any, Optional

import httpx

MODEL = os.environ.get("HERMES_MODEL", "claude-opus-4-8")
RESEARCH_MAX_TOKENS = int(os.environ.get("HERMES_RESEARCH_MAX_TOKENS", "4096"))
MAX_WEB_SEARCHES = int(os.environ.get("HERMES_MAX_WEB_SEARCHES", "6"))

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

# Deliberately not a full RFC 5322 matcher: this runs over arbitrary page HTML, where a permissive
# pattern happily matches tracking pixels and asset filenames. Tight beats complete here.
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")

# Addresses that are technically valid and useless — or worse, a false positive that gets emailed.
EMAIL_DENY = re.compile(
    r"(?:^|@)(?:example|test|localhost|sentry|wixpress|squarespace|shopify|sentry\.io)|"
    r"\.(?:png|jpe?g|gif|webp|svg|css|js|woff2?)$|"
    r"^(?:noreply|no-reply|donotreply)@", re.I)


def _pick_email(html: str) -> Optional[str]:
    """Best email on the page, or None.

    mailto: links win over body text: a mailto is someone deliberately publishing an address, while a
    match in the body is as likely to be an example, a customer's address in a testimonial, or a
    third-party script's. Role addresses are kept but ranked last — Summit decides what to do with a
    role mailbox, not this function.
    """
    ordered: list[str] = []
    ordered += re.findall(r'mailto:([^"\'?>\s]+)', html, re.I)
    ordered += EMAIL_RE.findall(html)

    role = ("info@", "contact@", "hello@", "press@", "editor@", "support@", "admin@", "team@")
    best: Optional[str] = None
    for raw in ordered:
        e = raw.strip().strip(".,;:").lower()
        if not EMAIL_RE.fullmatch(e) or EMAIL_DENY.search(e):
            continue
        if not e.startswith(role):
            return e          # a personal address is what we actually want — take it immediately
        best = best or e       # otherwise remember the first role address and keep looking
    return best


def _pick_byline(html: str) -> Optional[str]:
    for pat in (
        r'<meta[^>]+name=["\']author["\'][^>]+content=["\']([^"\']{2,80})["\']',
        r'<meta[^>]+property=["\']article:author["\'][^>]+content=["\']([^"\']{2,80})["\']',
        r'rel=["\']author["\'][^>]*>([^<]{2,80})<',
        r'class=["\'][^"\']*(?:author|byline)[^"\']*["\'][^>]*>\s*(?:by\s+)?([^<]{2,80})<',
    ):
        m = re.search(pat, html, re.I)
        if m:
            name = re.sub(r"\s+", " ", m.group(1)).strip(" ,|-")
            # A URL in the author slot means the selector matched a link wrapper, not a name.
            if name and "http" not in name.lower():
                return name
    return None


def _pick_contact(html: str, base: str) -> Optional[str]:
    m = re.search(r'href=["\']([^"\']*(?:contact|write-for-us|contribute|submit|advertise)[^"\']*)["\']',
                  html, re.I)
    if not m:
        return None
    href = m.group(1)
    if href.startswith("http"):
        return href
    from urllib.parse import urljoin
    return urljoin(base, href)


def _visible_text(html: str) -> str:
    """Rendered-ish text. Script and style go first — otherwise the 'text' of a modern page is mostly
    minified JavaScript, which is both useless and expensive to put in a prompt."""
    s = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html)
    s = re.sub(r"(?is)<br[^>]*>|</p>|</div>|</li>|</h[1-6]>", "\n", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    import html as _h
    s = _h.unescape(s)
    s = re.sub(r"[ \t]+", " ", s)
    return re.sub(r"\n\s*\n\s*\n+", "\n\n", s).strip()


async def _browser_fetch(url: str, timeout_s: float) -> Optional[tuple[str, int]]:
    """Fetch through a real browser, or None when one is not installed.

    Optional on purpose. Playwright plus a Chromium download is a heavy dependency, and everything
    else here works without it — so a deploy that skips it degrades to plain HTTP and says so via
    `neededBrowser` rather than failing. But note what is lost: reading bot-protected pages IS Hermes's
    edge over Summit's own fetch. Without a browser this endpoint is only a convenience.
    """
    try:
        from playwright.async_api import async_playwright  # type: ignore
    except ImportError:
        return None
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=["--disable-blink-features=AutomationControlled"])
            try:
                page = await (await browser.new_context(user_agent=UA)).new_page()
                resp = await page.goto(url, timeout=timeout_s * 1000, wait_until="domcontentloaded")
                return await page.content(), (resp.status if resp else 0)
            finally:
                await browser.close()
    except Exception:
        return None


async def scrape(url: str, want: str, timeout_s: float = 45.0) -> dict[str, Any]:
    """Read one page and pull one thing off it. Matches HermesScrapeResult in client.ts exactly.

    Plain HTTP first, browser only on failure. Doing it the other way round would spend a browser
    session on every prospect, which is precisely the cost mistake the augment rule exists to avoid.
    """
    if not re.match(r"^https?://", url or ""):
        return {"ok": False, "value": None, "error": "url must be http(s)"}

    html, status, needed_browser = "", 0, False
    try:
        async with httpx.AsyncClient(timeout=min(timeout_s, 20.0), follow_redirects=True,
                                     headers={"User-Agent": UA}) as c:
            r = await c.get(url)
            status, html = r.status_code, r.text
    except Exception as e:
        status, html = 0, ""
        err = str(e)
    else:
        err = ""

    # 403/429 is the signature of bot protection, and a suspiciously short body usually means a
    # JS-rendered shell. Both are the cases a browser exists for.
    if status in (0, 403, 401, 429, 503) or len(html) < 800:
        got = await _browser_fetch(url, timeout_s)
        if got:
            html, status = got
            needed_browser = True

    if not html:
        return {"ok": False, "value": None, "status": status,
                "error": err or f"could not read the page (status {status})",
                "neededBrowser": needed_browser}

    if want == "email":
        value = _pick_email(html)
    elif want == "byline":
        value = _pick_byline(html)
    elif want == "contact":
        value = _pick_contact(html, url)
    elif want == "text":
        return {"ok": True, "value": None, "text": _visible_text(html)[:40000],
                "status": status, "neededBrowser": needed_browser}
    else:
        return {"ok": False, "value": None, "error": f"unknown want '{want}'"}

    return {"ok": value is not None, "value": value, "status": status,
            "neededBrowser": needed_browser,
            **({} if value else {"error": f"no {want} found on the page"})}


RESEARCH_SYSTEM = (
    "You are a research assistant for an SEO team at imagine.art, an AI image and video generation "
    "product. Answer the question from web sources you actually searched.\n\n"
    "Rules:\n"
    "- Cite nothing you did not read. If the searches do not answer it, say so plainly.\n"
    "- Facts, numbers and dates only from sources. Never estimate a figure and present it as found.\n"
    "- Be brief and factual. No preamble, no emoji.\n"
    "- If sources disagree, say they disagree and give both."
)


async def research(question: str, window: Optional[str] = None,
                   timeout_s: float = 120.0) -> dict[str, Any]:
    """Answer a question from the live web. Matches HermesResearchResult in client.ts.

    Uses Anthropic's server-side web_search tool rather than our own search keys: it runs inside the
    model's own loop, and it returns citations as structured data, which is what makes `sources`
    trustworthy instead of a list scraped out of prose. Summit's writer treats `sources` as a closed
    set for its no-invented-citations check, so a source list assembled from the answer text would
    defeat that check entirely.
    """
    from anthropic import AsyncAnthropic

    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return {"answer": "", "sources": [], "error": "ANTHROPIC_API_KEY is not set"}

    prompt = question if not window else f"{question}\n\nRestrict to: {window}."
    client = AsyncAnthropic(api_key=key, timeout=timeout_s)

    resp = await client.messages.create(
        model=MODEL, max_tokens=RESEARCH_MAX_TOKENS,
        system=[{"type": "text", "text": RESEARCH_SYSTEM, "cache_control": {"type": "ephemeral"}}],
        tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": MAX_WEB_SEARCHES}],
        messages=[{"role": "user", "content": prompt}],
    )

    # Text blocks arrive interleaved with the searches, and the ones BEFORE the last search are the
    # model narrating its process — "I'll search for…", "Let me verify a couple of specifics". Only the
    # text after the final search result is the actual answer. Concatenating all of them puts that
    # narration into the writer's source context, where it reads as content and wastes the budget the
    # real facts need.
    texts: list[tuple[int, str, Any]] = []
    sources: list[str] = []
    last_search_at = -1

    for i, block in enumerate(resp.content):
        bt = getattr(block, "type", "")
        if bt == "text":
            texts.append((i, block.text, block))
        elif bt in ("web_search_tool_result", "server_tool_use"):
            last_search_at = i
            for item in (getattr(block, "content", None) or []):
                u = getattr(item, "url", None)
                if u and u not in sources:
                    sources.append(u)

    answer_parts = [t for i, t, _ in texts if i > last_search_at]
    # A question answered without searching at all has no post-search text; fall back to everything
    # rather than returning an empty answer.
    if not any(p.strip() for p in answer_parts):
        answer_parts = [t for _, t, _ in texts]

    # Citations are the authoritative provenance — the URLs the model actually read, as opposed to any
    # URL it happened to type into the prose. Collected from the kept blocks only.
    for i, _, block in texts:
        if i <= last_search_at:
            continue
        for c in (getattr(block, "citations", None) or []):
            u = getattr(c, "url", None)
            if u and u not in sources:
                sources.append(u)

    return {"answer": "\n\n".join(p for p in answer_parts if p.strip()).strip(),
            "sources": sources, "model": resp.model}
