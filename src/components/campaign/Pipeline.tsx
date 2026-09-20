"use client";

import { useEffect, useState } from "react";
import { AGENTS, type AgentKey } from "@/lib/campaign/agents";
import type { CampaignState } from "./StatusHeader";
import { Row, type FeedEvent } from "./ActivityFeed";
import { money } from "@/lib/ui/format";

// The agents as a pipeline: who is working right now (the pulsing card), who worked last (solid
// green, so the place is never lost between steps), what each has done so far, what it runs on, and
// whom it hands to. Open a card and it lists everything that agent did — each article, editor,
// email, reply, counter — as the same expandable lines as the feed.

function tally(key: AgentKey, s: CampaignState): [string, string] {
  const c = (k: string) => s.counts?.[k] ?? 0;
  const t = s.tools;
  const a = s.agents?.[key];
  switch (key) {
    case "manager": return [`${s.campaign.tick_count} steps`, `${a?.model_calls ?? 0} decisions`];
    case "discovery": return [`${s.numbers.found} found`, t?.tavily.searches ? `${t.tavily.searches} searches` : t?.seeds.listed ? `${t.seeds.listed} you listed` : s.campaign.demo_mode ? "the demo's list" : ""];
    case "qualification": { const passed = s.numbers.found - c("discovered") - c("rejected"); return [`${passed} passed · ${c("rejected")} rejected`, c("discovered") ? `${c("discovered")} still to read` : ""]; }
    case "contact": return [`${s.contacts ?? 0} editors found`, ""];
    case "outreach": return [`${s.numbers.contacted} emailed`, ""];
    case "inbox": return [`${s.numbers.replied} replied`, ""];
    case "negotiation": return [`${c("negotiating")} negotiating`, c("escalated") ? `${c("escalated")} need you` : ""];
    case "deals": return [`${s.numbers.deals} deals`, `${money(s.budget.used, s.budget.currency)} committed`];
  }
}

export function Pipeline({ s }: { s: CampaignState }) {
  const [open, setOpen] = useState<AgentKey | null>(null);
  const [work, setWork] = useState<FeedEvent[] | null>(null);
  const a = s.activity;
  const live = a && !a.done && Date.now() - new Date(a.at).getTime() < 90_000 ? a.agent : null;
  const last = a && !live ? a.agent : null;
  const spec = open ? AGENTS.find((x) => x.key === open) : null;

  useEffect(() => {
    if (!open) { setWork(null); return; }
    let alive = true;
    fetch(`/api/campaigns/${s.campaign.id}/feed?agent=${open}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (alive) setWork(d.events ?? []); }).catch(() => { if (alive) setWork([]); });
    return () => { alive = false; };
  }, [open, s.campaign.id, s.campaign.tick_count, s.activity?.at]);

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <h2 className="label">The agents</h2>
        <span className="text-xs text-ink-3">Eight agents in order, one hand-off each. Green = working (pulsing) or worked last. Click a card for everything it did.</span>
      </div>
      <ol className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {AGENTS.map((ag, i) => {
          const active = live === ag.key;
          const wasLast = last === ag.key;
          const isOpen = open === ag.key;
          const cost = s.agents?.[ag.key]?.cost_usd ?? 0;
          const [l1, l2] = tally(ag.key, s);
          const next = ag.handsTo === "you" ? "you" : ag.handsTo ? AGENTS.find((x) => x.key === ag.handsTo)?.name : null;
          return (
            <li key={ag.key}>
              <button type="button" onClick={() => setOpen(isOpen ? null : ag.key)} aria-expanded={isOpen}
                className={`card p-4 text-left w-full h-full flex flex-col cursor-pointer transition-colors hover:border-ink-2 hover:bg-paper-2/40 outline-none focus-visible:ring-2 focus-visible:ring-accent ${active ? "node-active" : wasLast ? "node-last" : ""} ${isOpen ? "border-ink" : ""}`}>
                <div className="flex items-center gap-2">
                  <span className="mono text-[11px] text-ink-3">{i + 1}</span>
                  <span className={`inline-block w-2 h-2 shrink-0 rounded-full ${active || wasLast ? "" : ag.ownsMoney ? "bg-accent" : "bg-ink-3"}`} style={active || wasLast ? { background: "#76b900" } : undefined} />
                  <span className="font-semibold">{ag.name}</span>
                  {active && <span className="ml-auto text-[11px] font-medium" style={{ color: "#4e7a00" }}>working</span>}
                  {!active && wasLast && <span className="ml-auto text-[11px] font-medium text-ink-3">worked last</span>}
                </div>
                <div className="text-xs text-ink-3 mt-1">{ag.engineShort}</div>
                <div className="mono text-xs mt-3 text-ink-2">{l1}</div>
                {l2 && <div className="mono text-xs text-ink-2">{l2}</div>}
                <div className="mt-auto pt-3 flex items-center justify-between gap-2 text-[11px] text-ink-3">
                  <span>{next ? `hands to ${next}` : "picks who acts"}</span>
                  <span className="inline-flex items-center gap-1.5">{cost > 0 && <span className="mono">{cost < 0.0001 ? "<$0.0001" : `$${cost.toFixed(4)}`}</span>}<span aria-hidden="true" className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span></span>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
      {spec && (
        <div className="card p-4 mt-3 fade-in grid gap-4 md:grid-cols-3">
          <div><div className="label">{spec.name} — what it does</div><div className="text-sm mt-1">{spec.role}</div></div>
          <div><div className="label">Runs on</div><div className="text-sm mt-1">{spec.engine}</div><div className="text-xs text-ink-3 mt-1">Tools: {spec.tools.join(" · ")}</div></div>
          <div><div className="label">Hands to</div><div className="text-sm mt-1">{spec.handsTo === "you" ? "You — the Deals screen" : spec.handsTo ? AGENTS.find((x) => x.key === spec.handsTo)?.name : "Whichever agent it picks: each step it chooses one action from what code says is available"}</div>
            {s.agents?.[spec.key] && <div className="text-xs text-ink-3 mt-1 mono">{s.agents[spec.key].events} feed lines · {s.agents[spec.key].model_calls} model calls</div>}
            {spec.ownsMoney && <div className="text-xs text-accent mt-1">Money and safety here are code rules, never a model.</div>}
          </div>
          <div className="md:col-span-3 border-t border-rule pt-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
              <div className="label">Everything {spec.name} did in this campaign{work ? ` (${work.length})` : ""}</div>
              <span className="text-xs text-ink-3">Newest first. Click a line for the model, its reasoning, the email.</span>
            </div>
            {work == null ? <div className="space-y-2 py-2" aria-busy="true"><div className="skeleton h-5 w-2/3" /><div className="skeleton h-5 w-1/2" /><div className="skeleton h-5 w-3/5" /></div>
              : work.length === 0 ? <div className="text-sm text-ink-3 py-2">Nothing yet — {spec.name} has not been handed anything in this campaign.</div>
              : <ul className="divide-y divide-rule">{work.map((e) => <Row key={e.id} e={e} />)}</ul>}
          </div>
        </div>
      )}
    </section>
  );
}
