"use client";

import { useState } from "react";
import type { CampaignPlan } from "@/lib/campaign/plan";
import { PLAN_DEFAULTS } from "@/lib/campaign/plan";

// The plan you can change before launch. Every field here is something the agents read at run
// time (the Scout's angles and pool, the Judge's floor, the Negotiator's money rules and standing
// answers). Nothing is hidden behind the prose.

export function PlanEditor({ plan, onChange, demo, maxPerDeal }: { plan: CampaignPlan; onChange: (p: CampaignPlan) => void; demo: boolean; maxPerDeal: number }) {
  const [newQ, setNewQ] = useState("");
  const p = { ...PLAN_DEFAULTS, ...plan };
  const set = (patch: Partial<CampaignPlan>) => onChange({ ...plan, ...patch });
  const queries = plan.queries ?? [];
  const addQ = () => { const q = newQ.trim(); if (q && !queries.includes(q) && queries.length < 10) set({ queries: [...queries, q] }); setNewQ(""); };
  const Num = ({ k, label, min, max, step = 1, hint }: { k: keyof CampaignPlan; label: string; min: number; max: number; step?: number; hint?: string }) => (
    <label className="block">
      <span className="label">{label}</span>
      <input type="number" className="field mt-1.5 !h-9" min={min} max={max} step={step} value={Number(p[k] ?? "")} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<CampaignPlan>)} />
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
  return (
    <div className="card p-5 space-y-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="label">Edit the plan</div>
        <span className="text-xs text-ink-3">Click anything to change it. The agents read these at run time.</span>
      </div>

      <div>
        <div className="label">Search angles <span className="font-normal normal-case text-ink-3">— what the Scout searches for{demo ? " (the demo runs 3 of them)" : ""}</span></div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {queries.map((q) => <button type="button" key={q} onClick={() => set({ queries: queries.filter((x) => x !== q) })} className="chip hover:bg-danger-soft hover:text-danger" title="Remove">{q} ×</button>)}
          {queries.length < 10 && <input className="field !h-8 !w-64 !text-sm" value={newQ} onChange={(e) => setNewQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addQ(); } }} onBlur={addQ} placeholder="add a search, press Enter" />}
        </div>
        {queries.length === 0 && <div className="text-xs text-ink-3 mt-1">None yet: the Scout will plan its own angles from your keywords.</div>}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Num k="pool_target" label="Publications to look at" min={3} max={60} hint={demo ? "the demo takes what 3 searches return" : "before judging starts"} />
        <Num k="min_dr" label="Authority floor (DR)" min={0} max={90} hint="only applied when DR can be measured" />
        <label className="block"><span className="label">Tone</span>
          <select className="field mt-1.5 !h-9" value={p.tone} onChange={(e) => set({ tone: e.target.value as CampaignPlan["tone"] })}><option value="gentle">gentle</option><option value="balanced">balanced</option><option value="firm">firm</option></select>
          <span className="text-xs text-ink-3">how hard the Negotiator pushes</span>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Num k="auto_accept_below" label="Accept without asking, up to" min={0} max={maxPerDeal} step={10} hint={`a quote at or under this is taken at their number (≤ $${maxPerDeal} ceiling)`} />
        <Num k="human_approval_above" label="Ask me before agreeing above" min={0} max={maxPerDeal} step={10} hint="a Needs-you card instead of a handshake" />
        {!demo && <Num k="followup_after_days" label="Follow up after (days)" min={1} max={30} hint="one polite nudge, then stop" />}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="label">If an editor asks for a call</div>
          <div className="mt-1.5 flex flex-col gap-1.5 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="call" checked={p.if_asked_for_call === "ask_me"} onChange={() => set({ if_asked_for_call: "ask_me" })} /> Park it for me on Needs you</label>
            <label className="flex items-center gap-2"><input type="radio" name="call" checked={p.if_asked_for_call === "email_only"} onChange={() => set({ if_asked_for_call: "email_only" })} /> Say we work by email only, and carry on</label>
          </div>
        </div>
        <div>
          <div className="label">If an editor asks about traffic, links, your audience</div>
          <div className="mt-1.5 flex flex-col gap-1.5 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="facts" checked={p.if_asked_about_traffic === "ask_me"} onChange={() => set({ if_asked_about_traffic: "ask_me" })} /> Park it for me; the agent never invents a number</label>
            <label className="flex items-center gap-2"><input type="radio" name="facts" checked={p.if_asked_about_traffic === "use_facts"} onChange={() => set({ if_asked_about_traffic: "use_facts" })} /> Answer from the facts below</label>
          </div>
        </div>
      </div>

      <label className="block"><span className="label">Facts the agent may state about your business <span className="font-normal normal-case text-ink-3">(optional)</span></span>
        <textarea className="field !h-auto py-2 mt-1.5" rows={2} value={plan.facts ?? ""} onChange={(e) => set({ facts: e.target.value })} placeholder="e.g. About 40,000 visits a month, mostly US and UK. We'd want a do-follow link. We can send before/after examples." />
        <span className="text-xs text-ink-3">Quoted verbatim when relevant; never extended. Leave blank and the agent will ask you instead.</span>
      </label>
    </div>
  );
}
