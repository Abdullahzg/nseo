"use client";

import { useState } from "react";
import type { CampaignPlan } from "@/lib/campaign/plan";
import { PLAN_DEFAULTS } from "@/lib/campaign/plan";

// The plan you can change before launch. Every field here is something the agents read at run
// time (the Scout's angles and pool, the Judge's floor, the Negotiator's money rules and standing
// answers). Nothing is hidden behind the prose.

type NumKey = "pool_target" | "min_dr" | "auto_accept_below" | "human_approval_above" | "followup_after_days";

function Num({ k, label, min, max, step = 1, hint, value, onChange }: { k: NumKey; label: string; min: number; max: number; step?: number; hint?: string; value: number | undefined; onChange: (k: NumKey, v: number) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input type="number" className="field mt-1.5 !h-9" min={min} max={max} step={step} value={value ?? ""} onChange={(e) => onChange(k, Number(e.target.value))} />
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function PlanEditor({ plan, onChange, demo, maxPerDeal, hasAuthority }: { plan: CampaignPlan; onChange: (p: CampaignPlan) => void; demo: boolean; maxPerDeal: number; hasAuthority: boolean }) {
  const [newQ, setNewQ] = useState("");
  const p = { ...PLAN_DEFAULTS, ...plan };
  const set = (patch: Partial<CampaignPlan>) => onChange({ ...plan, ...patch });
  const setNum = (k: NumKey, v: number) => set({ [k]: v } as Partial<CampaignPlan>);
  const queries = plan.queries ?? [];
  const addQ = () => { const q = newQ.trim(); if (q && !queries.includes(q) && queries.length < 10) set({ queries: [...queries, q] }); setNewQ(""); };
  return (
    <div className="card p-5 space-y-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="label">Edit the plan</div>
        <span className="text-xs text-ink-3">Click anything to change it. The agents read these at run time.</span>
      </div>

      <div>
        <div className="label">Search angles <span className="font-normal normal-case text-ink-3">— what the Scout searches for{demo ? " (this run does 3 of them)" : ""}</span></div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {queries.map((q) => <button type="button" key={q} onClick={() => set({ queries: queries.filter((x) => x !== q) })} className="chip hover:bg-danger-soft hover:text-danger" title="Remove">{q} ×</button>)}
          {queries.length < 10 && <input className="field !h-8 !w-64 !text-sm" value={newQ} onChange={(e) => setNewQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addQ(); } }} onBlur={addQ} placeholder="add a search, press Enter" />}
        </div>
        {queries.length === 0 && <div className="text-xs text-ink-3 mt-1">None yet: the Scout will plan its own angles from your keywords.</div>}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Num k="pool_target" label="Publications to look at" min={3} max={60} hint={demo ? "this run reads up to 10" : "before judging starts"} value={p.pool_target} onChange={setNum} />
        {hasAuthority
          ? <Num k="min_dr" label="Authority floor (DR)" min={0} max={90} hint="publications under this DR are rejected by rule" value={p.min_dr} onChange={setNum} />
          : <label className="block"><span className="label">Authority</span>
              <div className="field mt-1.5 !h-9 flex items-center text-ink-2">judged from the page</div>
              <span className="block text-xs text-ink-3 mt-1">no DR provider connected</span>
            </label>}
        <label className="block"><span className="label">Tone</span>
          <select className="field mt-1.5 !h-9" value={p.tone} onChange={(e) => set({ tone: e.target.value as CampaignPlan["tone"] })}><option value="gentle">gentle</option><option value="balanced">balanced</option><option value="firm">firm</option></select>
          <span className="text-xs text-ink-3">how hard the Negotiator pushes</span>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Num k="auto_accept_below" label="Accept without asking, up to" min={0} max={maxPerDeal} step={10} hint={`a quote at or under this is taken at their number (≤ $${maxPerDeal} ceiling)`} value={p.auto_accept_below} onChange={setNum} />
        <Num k="human_approval_above" label="Ask me before agreeing above" min={0} max={maxPerDeal} step={10} hint="a Needs-you card instead of a handshake" value={p.human_approval_above} onChange={setNum} />
        {!demo && <Num k="followup_after_days" label="Follow up after (days)" min={1} max={30} hint="one polite nudge, then stop" value={p.followup_after_days} onChange={setNum} />}
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

      {!demo && (
        <div className="grid gap-2 sm:grid-cols-2 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={!!p.approve_emails} onChange={(e) => set({ approve_emails: e.target.checked })} /><span>Show me each first email before it goes out<span className="block text-xs text-ink-3">It waits under Conversations; approve, edit or discard. Replies in a running negotiation still follow the money rules above.</span></span></label>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={p.notify_email !== false} onChange={(e) => set({ notify_email: e.target.checked })} /><span>Email me when something needs me or a deal lands<span className="block text-xs text-ink-3">Sent from your own Gmail to your own Gmail, with a link.</span></span></label>
        </div>
      )}

      <label className="block"><span className="label">Facts the agent may state about your business <span className="font-normal normal-case text-ink-3">(optional)</span></span>
        <textarea className="field !h-auto py-2 mt-1.5" rows={2} value={plan.facts ?? ""} onChange={(e) => set({ facts: e.target.value })} placeholder="e.g. About 40,000 visits a month, mostly US and UK. We'd want a do-follow link. We can send before/after examples." />
        <span className="text-xs text-ink-3">Quoted verbatim when relevant; never extended. Leave blank and the agent will ask you instead.</span>
      </label>
    </div>
  );
}
