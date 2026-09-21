# Devpost submission — text description and video script

## Project description (for the Devpost form)

**What it is.** Nseo is an autonomous outreach agent for getting a product featured in editorial
publications. You give it your website, one line about what you sell, three keywords, a target
number of placements and a budget. It searches for publications, judges which are worth pursuing,
finds a human editor at each, writes them, reads their replies, negotiates a price under your
per-placement ceiling, and records the deal. It comes back to you only when it hits something an
email-only agent must not decide alone — a call, a contract, a price above your limit, a factual
question about your business — and parks that one thread on a **Needs you** card. You answer in a
line; the same thread resumes.

**Why.** Editorial placements are the highest-value SEO work and the most manual: dozens of
searches, hundreds of pages, finding the right person, writing, waiting, negotiating, tracking. It
is also asynchronous — replies come back over days — so the wrong product is a dashboard you watch.
The right product is one you can close, that pulls you back three times a week with a specific
question.

**How it works.** Every decision is a NVIDIA Nemotron 3 call on Nebius Token Factory, routed by
role: **Nemotron 3 Super** (thinking on) chooses the next action each step as a tool call;
**Nemotron 3 Nano** (thinking off, `json_schema`) does the high-volume judgments — relevance and
editorial quality of each publication, outreach wording, reply classification — in ~70 tokens each;
**Nemotron 3 Ultra** writes counter-offers when an editor names a price. Code owns the money and the
safety rules: ceilings, an atomic budget commit in Postgres, the escalation cues, phase transitions,
completion. The activity feed shows, for every line, which model decided it, its tokens, latency and
reasoning. A whole demo campaign costs about three cents.

**Demo vs real.** The demo (default, no account) is the real pipeline — real Tavily search, real
pages, real judging by Super, real editor lookup, real outreach written by Nano — with one difference:
no email leaves the machine. The editors' replies are written by Nano role-playing an editor with a
stance, so the negotiation never sees a script; and **you can be the editor**: open any thread in the
campaign's Conversations tab, type whatever an editor might say, and watch the agent classify it,
counter it, or park it for a human. Real mode is multi-user and
bring-your-own-keys: sign in with Google, save your Nebius, Gmail and Tavily credentials, and it sends
actual email from your Gmail, runs from a 5-minute scheduler, and reads replies over IMAP. Guests can
only ever run demos; that is enforced by a database `CHECK` and a trigger, not a permissions check.

**Built with.** Next.js 16 on Vercel Hobby · Supabase Postgres · GitHub Actions scheduler · Nebius
Token Factory (`nvidia/nemotron-3-super-120b-a12b`, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`,
`nvidia/Nemotron-3-Ultra-550b-a55b`, `nvidia/Nemotron-3_5-Lightning`) · Tavily.

---

## Video script — 3:00, audio covers Token Factory + Nemotron throughout

| Time | Screen | Voice |
|---|---|---|
| 0:00–0:15 | Setup page, cursor idle | "This is Nseo. It gets your product featured in publications without you doing the outreach. Every decision it makes is a NVIDIA Nemotron 3 model running on Nebius Token Factory, and I'll show you each one as it happens." |
| 0:15–0:30 | Setup with the plan already written; hover the Nano chip | "Six fields. Before anything starts, Nemotron 3 Nano — thinking off, structured output, about three hundred tokens — has already written the plan in plain English. That's the cheap fast path we use for every high-volume judgment." |
| 0:30–0:50 | Press **Launch demo**; Campaign screen; first lines appear | "Demo mode: the publications and editors are fixtures, but every decision on them is real. Top of the page is one sentence that is always true — it's computed by code, never by a model." |
| 0:50–1:10 | Expand a **manager** line | "Each step, Nemotron 3 Super picks exactly one action as a tool call. Here's its reasoning, the tokens, the latency. Code decides what's *available*; the model decides which to do. On idle steps we don't call a model at all." |
| 1:10–1:30 | Scroll to qualification lines; expand a rejection | "Super judges each publication with thinking on — relevance, editorial quality, and whether this publisher could ever feature us. Rejected: garden beds versus photo restoration. Rejected: DR thirty-one, below your floor — that's a code rule. Authority we can't verify is shown as unverified, never invented." |
| 1:30–2:05 | **The editors' inbox**: open a thread, type an unscripted reply ("$300, or $220 if you send two before/after examples"), press Send | "Now the part you'd be right to doubt: the replies. Scripted editors keep the demo moving — but I can be the editor. I'll type something no script anticipated. Nano classifies it; a code rule sees the request for files and parks it rather than letting a model promise to send them. Try a price instead and Nemotron 3 Ultra writes the counter, clamped to your ceiling." |
| 2:05–2:30 | Needs-you badge; the "Wants a file" and "Wants a call" cards; answer one; resume | "That's where it lands. Their words, what the agent wants to do, what it needs from me. I answer in a line — and the same thread resumes, drafted by Super with my answer as context." |
| 2:30–2:45 | Deals screen | "Three deals, two negotiated down from two-eighty to one-eighty. The whole campaign — twelve publications judged, every reply answered — about three cents on Token Factory." |
| 2:45–3:00 | Real Gmail inbox on screen: the agent's email, a reply, the agent's counter arriving; then the README | "Real mode is the same code with real email: this is my Gmail, the agent's outreach, my reply, its counter. Ten replies of every kind are in the ledger. Code and ledger are in the repo. Thanks." |

---

## Showing it to a judge without "it's hardcoded"

The doubt is legitimate: a demo with scripted editor replies looks like a script. Four things answer it,
in the order a judge can verify them in under five minutes:

1. **Nothing in the demo is canned.** The publications come from a live Tavily search (the Tools
   tab shows the queries and counts), the verdicts are Super reading the real pages (the Publications
   tab shows every check and reason, with the link), and the editors' replies are written by Nano
   playing an editor with a stance — the feed line says so, with the model and tokens. **Be the
   editor:** open a thread in Conversations and type a reply no one anticipated; the agent's answer is
   a live call with its reasoning attached.
2. **Every line is labelled with who decided it.** *Nemotron 3 Super / Nano / Ultra* chips are model
   calls with cost and reasoning attached; *policy rule* is code; *fixture* is a data load. There is no
   fourth kind. A judge can count the fixture lines (publications, editors, scripted replies) and see
   that none of them is a decision.
3. **Real mode, in a real inbox.** The video's last fifteen seconds are Gmail: the agent's outreach, a
   reply, the agent's counter arriving. `docs/LEDGER.md` Run E lists ten real editor replies of every
   kind — high anchor, quick accept, call request, traffic question, decline, autoresponder, above-max
   ask, NDA, in-bounds price, "what's your budget" — each with what the agent did and the Message-IDs.
4. **Run it yourself.** `README.md` → clone, one key, `npm run dev`. Or sign in with Google on the
   deployment, save your own Nebius key, and run a real campaign against a publication you list.
