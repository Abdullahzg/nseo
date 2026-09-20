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
  const rows: { tool: string; where: string; how: string; usage: string; live: boolean }[] = [
    { tool: "Nebius Token Factory", where: "Manager · Judge · Writer · Negotiator", how: "One OpenAI-compatible endpoint, four NVIDIA Nemotron models routed by role. Thinking on for planning, qualification and counters; off for the fast structured calls.", usage: t.nebius.calls ? `${t.nebius.calls} calls · ${t.nebius.tokens_in.toLocaleString()} in / ${t.nebius.tokens_out.toLocaleString()} out · $${t.nebius.cost_usd.toFixed(4)}${models.length ? " — " + models.map(([m, n]) => `${modelShort(m)} ×${n}`).join(", ") : ""}` : "no calls yet", live: true },
    { tool: "Tavily web search", where: "Scout", how: "POST /search with the angles Nano planned; up to 8 results per query, de-duplicated by domain, suppressed domains skipped.", usage: t.tavily.searches ? `${t.tavily.searches} searches · ${t.tavily.results} results${demo ? " (real search, in the demo too)" : ""}` : demo ? (t.fixtures.loaded ? "no search key on this deployment; the demo used its built-in publication list" : "no searches yet") : !t.tavily.used ? (t.seeds.listed ? `off — only the ${t.seeds.listed} publication${t.seeds.listed === 1 ? "" : "s"} you listed` : "no key") : "no searches yet", live: t.tavily.searches > 0 },
    { tool: "Page fetch + Readability", where: "Judge", how: "Fetches each candidate page and extracts the article text so the model judges what was actually written, not a snippet.", usage: t.fixtures.loaded ? `${t.fixtures.loaded} built-in blurbs (no fetch)` : `${t.pages.fetched} pages read`, live: t.pages.fetched > 0 },
    { tool: "Ahrefs domain rating", where: "Judge", how: "Authority for the DR floor. Without a key the score is marked relevance-only and DR is shown as unverified — never invented.", usage: "not configured — authority unverified", live: false },
    { tool: "Editor lookup", where: "Finder", how: "The address you gave at setup, then the page's contact/about pages, then optional providers (Hunter, verification).", usage: `${s.contacts ?? 0} editors found`, live: true },
    { tool: "Gmail SMTP", where: "Writer · Negotiator", how: "Sends from the owner's own Gmail with an app password; every send keeps its Message-ID so replies thread back.", usage: demo ? `${t.gmail.simulated} emails written and NOT sent — the only simulated step in a demo` : `${t.gmail.sent} emails sent`, live: !demo },
    { tool: "Gmail IMAP", where: "Inbox", how: "Every scheduler round logs into the sender mailbox, matches inbound mail to our Message-IDs, strips quoted text, and records the editor's words.", usage: demo ? `${t.gmail.replies} rounds of replies written by the model playing the editors` : `${t.gmail.replies} rounds with new replies`, live: !demo },
    { tool: "Postgres (Supabase)", where: "Ledger · every agent", how: "The feed, the prospects, the threads, and commit_budget() — an atomic budget commit no model can bypass.", usage: `${t.ledger.deals} deals · $${t.ledger.committed} committed`, live: true },
  ];
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <h2 className="label">Tools, and where each one is used</h2>
        <span className="text-xs text-ink-3">Counts come from this campaign's feed.</span>
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
