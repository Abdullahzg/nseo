"use client";

import type { CampaignState } from "./StatusHeader";
import { modelShort } from "@/lib/ui/format";

// Where each external tool is used in THIS campaign, by which agent, and how much: read from the
// same feed the judge can scroll.

export function Tools({ s }: { s: CampaignState }) {
  const t = s.tools;
  if (!t) return null;
  const demo = s.campaign.demo_mode;
  const models = Object.entries(t.nebius.models).sort((a, b) => b[1] - a[1]);
  const ep = (t.tavily as any).endpoints ?? {};
  const tavilyCredits = Object.values(ep).reduce((n: number, e: any) => n + Number(e?.credits ?? 0), 0);
  const rows: { tool: string; where: string; how: string; usage: string; live: boolean }[] = [
    { tool: "Nebius Token Factory", where: "Manager · Judge · Writer · Negotiator", how: "One OpenAI-compatible endpoint, four NVIDIA Nemotron models routed by role. Thinking on for planning, qualification and counters; off for the fast structured calls.", usage: t.nebius.calls ? `${t.nebius.calls} calls · ${t.nebius.tokens_in.toLocaleString()} in / ${t.nebius.tokens_out.toLocaleString()} out · $${t.nebius.cost_usd.toFixed(4)}${models.length ? " — " + models.map(([m, n]) => `${modelShort(m)} ×${n}`).join(", ") : ""}` : "no calls yet", live: true },
    { tool: "Tavily /search", where: "Scout", how: "The angles Nano planned, one call each. Platforms (YouTube, Reddit, stores) are excluded at the API and anything scoring under 0.3 is dropped — so a page that was always going to be rejected never costs a Nemotron judgement.", usage: ep.search ? `${ep.search.calls} searches · ${t.tavily.results} results · ${ep.search.credits} credits` : t.tavily.searches ? `${t.tavily.searches} searches · ${t.tavily.results} results` : demo ? (t.fixtures.loaded ? "no search key on this deployment; this run used its built-in publication list" : "no searches yet") : !t.tavily.used ? (t.seeds.listed ? `off — only the ${t.seeds.listed} publication${t.seeds.listed === 1 ? "" : "s"} you listed` : "no key") : "no searches yet", live: (ep.search?.calls ?? t.tavily.searches) > 0 },
    { tool: "Tavily /map", where: "Finder", how: "Lists a publication's about / contact / team / masthead / author pages, so the agent reads the pages that name a person instead of guessing three URLs.", usage: ep.map ? `${ep.map.calls} sites mapped · ${ep.map.credits} credits` : demo ? "only needed when email is sent, so this run skips it" : "not needed yet", live: (ep.map?.calls ?? 0) > 0 },
    { tool: "Tavily /crawl", where: "Finder", how: `Reads those pages in one call with a plain-English instruction ("find the editorial staff and the pitch address"), and the address is taken by rule from what comes back.`, usage: ep.crawl ? `${ep.crawl.calls} crawls · ${ep.crawl.credits} credits` : demo ? "only needed when email is sent" : "not needed yet", live: (ep.crawl?.calls ?? 0) > 0 },
    { tool: "Tavily /extract", where: "Judge", how: "Reads an article with the campaign's topic as the query, so Tavily returns the passages about it rather than the whole page — fewer tokens to judge, and it works on JavaScript-rendered sites our own fetch cannot read.", usage: ep.extract ? `${ep.extract.calls} calls · ${ep.extract.credits} credits` : "used when a page comes back thin", live: (ep.extract?.calls ?? 0) > 0 },
    { tool: "Page fetch + Readability", where: "Judge", how: "Fetches each candidate page and extracts the article text so the model judges what was actually written, not a snippet.", usage: t.fixtures.loaded ? `${t.fixtures.loaded} built-in blurbs (no fetch)` : `${t.pages.fetched} pages read`, live: t.pages.fetched > 0 },
    { tool: "Ahrefs domain rating", where: "Judge", how: "Would supply domain authority for a DR floor. The free endpoint began returning 403 without a key, so on this deployment no DR is fetched — publications are judged on what the page itself shows, and a number is never invented to fill the gap.", usage: "no key — judged on the page instead", live: false },
    { tool: "Editor lookup", where: "Finder", how: "The address you gave at setup, then the page's contact/about pages, then optional providers (Hunter, verification).", usage: `${s.contacts ?? 0} editors found`, live: true },
    { tool: "Gmail SMTP", where: "Writer · Negotiator", how: "Sends from the owner's own Gmail with an app password; every send keeps its Message-ID so replies thread back.", usage: demo ? `${t.gmail.simulated} emails written and NOT sent — the only simulated step` : `${t.gmail.sent} emails sent`, live: !demo },
    { tool: "Gmail IMAP", where: "Inbox", how: "Every scheduler round logs into the sender mailbox, matches inbound mail to our Message-IDs, strips quoted text, and records the editor's words.", usage: demo ? `${t.gmail.replies} rounds of replies played by the model` : `${t.gmail.replies} rounds with new replies`, live: !demo },
    { tool: "Postgres (Supabase)", where: "Ledger · every agent", how: "The feed, the prospects, the threads, and commit_budget() — an atomic budget commit no model can bypass.", usage: `${t.ledger.deals} deals · $${t.ledger.committed} committed`, live: true },
  ];
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <h2 className="label">Tools, and where each one is used</h2>
        <span className="text-xs text-ink-3">Counts come from this campaign's feed{tavilyCredits ? ` · ${tavilyCredits} Tavily credits` : ""}.</span>
      </div>
      <div className="card divide-y divide-rule">
        {rows.map((r) => (
          <div key={r.tool} className="p-4 grid gap-1 sm:grid-cols-[180px_1fr_auto] sm:gap-4 items-start">
            <div><div className="font-medium">{r.tool}</div><div className="text-xs text-ink-3">used by {r.where}</div></div>
            <div className="text-sm text-ink-2">{r.how}</div>
            <div className={`mono text-xs sm:text-right sm:max-w-56 ${r.live ? "text-ink" : "text-ink-3"}`}>{r.usage}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
