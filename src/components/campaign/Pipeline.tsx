"use client";

import { useState } from "react";
import { AGENTS, type AgentKey } from "@/lib/campaign/agents";
import type { CampaignState } from "./StatusHeader";
import { money } from "@/lib/ui/format";

// The agents as a pipeline: who is working right now (the pulsing node), what each one has done so
// far in this campaign, what it runs on, and who it hands to. Tap a node for the full card.

function tally(key: AgentKey, s: CampaignState): string {
  const c = (k: string) => s.counts?.[k] ?? 0;
  const t = s.tools;
  const a = s.agents?.[key];
  switch (key) {
    case "manager": return `${s.campaign.tick_count} steps · ${a?.model_calls ?? 0} decisions`;
    case "discovery": return `${s.numbers.found} found${t?.tavily.searches ? ` · ${t.tavily.searches} searches` : t?.seeds.listed ? ` · ${t.seeds.listed} you listed` : ""}`;
    case "qualification": { const passed = s.numbers.found - c("discovered") - c("rejected"); return `${passed} passed · ${c("rejected")} rejected${c("discovered") ? ` · ${c("discovered")} to read` : ""}`; }
    case "contact": return `${s.contacts ?? 0} editors found`;
    case "outreach": return `${s.numbers.contacted} emailed`;
    case "inbox": return `${s.numbers.replied} replied`;
    case "negotiation": return `${c("negotiating")} open · ${c("escalated")} need you`;
    case "deals": return `${s.numbers.deals} deals · ${money(s.budget.used, s.budget.currency)}`;
  }
}

export function Pipeline({ s }: { s: CampaignState }) {
  const [open, setOpen] = useState<AgentKey | null>(null);
  const live = s.activity && Date.now() - new Date(s.activity.at).getTime() < 90_000 ? s.activity.agent : null;
  const spec = open ? AGENTS.find((x) => x.key === open) : null;
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <h2 className="label">The agents</h2>
        <span className="text-xs text-ink-3">Eight agents, one hand-off each. The lit one is working now. Tap any for what it runs on.</span>
      </div>
      <div className="overflow-x-auto -mx-1 px-1 pb-1">
        <ol className="flex items-stretch gap-2 min-w-[880px]">
          {AGENTS.map((a, i) => {
            const active = live === a.key;
            const cost = s.agents?.[a.key]?.cost_usd ?? 0;
            return (
              <li key={a.key} className="flex items-stretch gap-2 flex-1 min-w-0">
                <button type="button" onClick={() => setOpen(open === a.key ? null : a.key)} aria-expanded={open === a.key}
                  className={`card p-3 text-left flex-1 min-w-0 transition-colors hover:border-ink-2 ${active ? "node-active" : ""} ${open === a.key ? "border-ink" : ""}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-block w-2 h-2 shrink-0 rounded-full ${active ? "" : a.ownsMoney ? "bg-accent" : "bg-ink-3"}`} style={active ? { background: "#76b900" } : undefined} />
                    <span className="font-semibold text-sm">{a.name}</span>
                  </div>
                  <div className="text-[11px] text-ink-3 mt-0.5 truncate">{a.engine.split(" · ")[0]}</div>
                  <div className="mono text-[11px] leading-snug mt-2 text-ink-2">{tally(a.key, s)}</div>
                  {cost > 0 && <div className="mono text-[11px] text-ink-3">{cost < 0.0001 ? "<$0.0001" : `$${cost.toFixed(4)}`}</div>}
                </button>
                {i < AGENTS.length - 1 && <span className="self-center text-ink-3 select-none" aria-hidden="true">→</span>}
              </li>
            );
          })}
        </ol>
      </div>
      {spec && (
        <div className="card p-4 mt-3 fade-in grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
          <div><div className="label">{spec.name} — what it does</div><div className="text-sm mt-1">{spec.role}</div></div>
          <div><div className="label">Runs on</div><div className="text-sm mt-1">{spec.engine}</div><div className="text-xs text-ink-3 mt-1">Tools: {spec.tools.join(" · ")}</div></div>
          <div><div className="label">Hands to</div><div className="text-sm mt-1">{spec.handsTo === "you" ? "You (the Deals screen)" : spec.handsTo ? AGENTS.find((x) => x.key === spec.handsTo)?.name : "Every other agent — it picks which one acts each step"}</div>
            {s.agents?.[spec.key] && <div className="text-xs text-ink-3 mt-1 mono">{s.agents[spec.key].events} feed lines · {s.agents[spec.key].model_calls} model calls</div>}
            {spec.ownsMoney && <div className="text-xs text-accent mt-1">Money and safety here are code rules, never a model.</div>}
          </div>
        </div>
      )}
    </section>
  );
}
