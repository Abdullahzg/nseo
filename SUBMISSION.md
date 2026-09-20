# Devpost submission — text description and video script

## Project description (for the Devpost form)

**What it is.** Geseo is an autonomous outreach agent for getting a product featured in editorial
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
reasoning. A whole demo campaign costs about half a cent.

**Demo vs real.** The demo (default, no account) runs the full arc in about three minutes on fixture
publications and scripted editor replies — but every decision on that data is a real model call.
Real mode sends actual email from the owner's Gmail, runs from a 5-minute scheduler, and reads
replies over IMAP. Guests can only ever run demos; that is enforced by a database `CHECK` and a
trigger, not a permissions check. Tavily is called at runtime for real-mode discovery.

**Built with.** Next.js 16 on Vercel Hobby · Supabase Postgres · GitHub Actions scheduler · Nebius
Token Factory (`nvidia/nemotron-3-super-120b-a12b`, `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`,
`nvidia/Nemotron-3-Ultra-550b-a55b`, `nvidia/Nemotron-3_5-Lightning`) · Tavily.

---

## Video script — 3:00, audio covers Token Factory + Nemotron throughout

| Time | Screen | Voice |
|---|---|---|
| 0:00–0:15 | Setup page, cursor idle | "This is Geseo. It gets your product featured in publications without you doing the outreach. Every decision it makes is a NVIDIA Nemotron 3 model running on Nebius Token Factory, and I'll show you each one as it happens." |
| 0:15–0:35 | Press **See the plan**; plan appears with the Nano chip | "Six fields. Before anything starts, Nemotron 3 Nano — thinking off, structured output, about three hundred tokens — writes the plan in plain English. That's the cheap fast path we use for every high-volume judgment." |
| 0:35–0:55 | Press **Launch demo**; Campaign screen; first lines appear | "Demo mode: the publications and editors are fixtures, but every decision on them is real. Top of the page is one sentence that is always true — it's computed by code, never by a model." |
| 0:55–1:20 | Expand a **manager** line | "Each step, Nemotron 3 Super picks exactly one action as a tool call. Here's its reasoning, the tokens, the latency. Code decides what's *available*; the model decides which to do. On idle steps we don't call a model at all — that's how a public demo runs on hackathon credits." |
| 1:20–1:45 | Scroll to qualification lines; expand a rejection | "Nano evaluates each publication — relevance, editorial quality, spam risk — as JSON we validate. Rejected: relevance ten out of a hundred, garden beds versus photo restoration. And this one: DR thirty-one, below your floor. That's a code rule. Authority we can't verify is shown as unverified, never invented." |
| 1:45–2:15 | Replies arrive; a **counter_sent** line with the Ultra chip; expand it | "Editors reply. Nano classifies each one. When an editor names two hundred and eighty dollars, Nemotron 3 Ultra writes the counter — two-twenty — and code clamps every number to your ceiling. Here's Ultra's reasoning." |
| 2:15–2:40 | Needs-you badge; open the screen; the call-request card; type an answer; resume | "An editor asks for a call. An email agent can't take a call, so it parks the thread here with the editor's words, what it wants to do, and what it needs from me. I answer in a line — and the same thread resumes, drafted by Super with my answer as context." |
| 2:40–2:55 | Deals screen | "Two deals, what they asked, what we paid. The whole campaign — twelve publications, eight emails, eight negotiations — cost about half a cent on Token Factory." |
| 2:55–3:00 | README on screen | "Code and ledger are in the repo. Thanks." |
