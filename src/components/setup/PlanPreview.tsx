"use client";

import { modelShort } from "@/lib/ui/format";

export function PlanPreview({ plan, previewing, demo }: { plan: { text: string; model: string; tokens: number; latency_ms: number } | null; previewing: boolean; demo: boolean }) {
  return (
    <div className="card p-5">
      <div className="label mb-3">The plan, in plain English</div>
      {previewing && (
        <div className="space-y-2" aria-busy="true">
          <div className="skeleton h-4 w-full" /><div className="skeleton h-4 w-11/12" /><div className="skeleton h-4 w-4/5" /><div className="skeleton h-4 w-2/3" />
          <div className="text-xs text-ink-3 pt-1">Nemotron 3 Nano is writing it…</div>
        </div>
      )}
      {!previewing && plan && (
        <div className="fade-in">
          <p className="serif text-[17px] leading-relaxed">{plan.text}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="chip chip-model">{modelShort(plan.model)}</span>
            <span className="chip mono">{plan.tokens} tokens</span>
            <span className="chip mono">{(plan.latency_ms / 1000).toFixed(1)} s</span>
          </div>
          <p className="text-xs text-ink-3 mt-3">{demo ? "This runs for real: real search, real pages, real judging by Nemotron. The only simulated step is sending the email; the editors' replies are played by the model. Change anything in the plan below before you launch." : "Nothing is sent until you press Launch. Change anything in the plan below first; you can pause or stop any time."}</p>
        </div>
      )}
      {!previewing && !plan && (
        <p className="text-sm text-ink-2">Fill in the six fields and press <b>See the plan</b>. The agent will tell you, before anything starts, exactly what it intends to do, and it will ask you before anything unusual.</p>
      )}
    </div>
  );
}
