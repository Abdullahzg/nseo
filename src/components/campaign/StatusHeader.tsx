"use client";

import Link from "next/link";
import { money, int } from "@/lib/ui/format";
import { AGENT_LABEL } from "@/lib/campaign/agents";
import { CountUp, motion, AnimatePresence } from "@/components/ui/motion";

export interface CampaignState {
  campaign: { id: string; name: string; phase: string; paused: boolean; paused_reason: string | null; paused_kind: string | null; demo_mode: boolean; desired_deals: number; keywords: string[]; tick_count: number; completion_reason: string | null };
  is_active: boolean;
  sentence: string;
  numbers: { found: number; contacted: number; replied: number; deals: number };
  budget: { total: number; used: number; currency: string };
  open_interventions: number;
  awaiting_approval?: number;
  activity?: { agent: string; doing: string; target?: string | null; n?: number; of?: number; model?: string | null; at: string; done?: boolean; fresh?: boolean } | null;
  agents?: Record<string, { events: number; model_calls: number; cost_usd: number }>;
  tools?: ToolUsage;
  counts?: Record<string, number>;
  contacts?: number;
}

export interface ToolUsage {
  nebius: { calls: number; cost_usd: number; tokens_in: number; tokens_out: number; models: Record<string, number> };
  tavily: { searches: number; results: number; used: boolean };
  seeds: { listed: number };
  fixtures: { loaded: number };
  pages: { fetched: number };
  gmail: { sent: number; simulated: number; replies: number };
  ledger: { deals: number; committed: number };
}

/** "Judge is reading designdigest.creative.example (3 of 12)" — or what the campaign is waiting for. */
export function activityLine(s: CampaignState, stepping: boolean): string {
  const a = s.activity;
  const fresh = !!a?.fresh;
  const who = a ? (AGENT_LABEL[a.agent] ?? a.agent) : "";
  const count = a && a.n && a.of ? ` (${a.n} of ${a.of})` : "";
  if (a && fresh && !a.done) return `${who} is ${a.doing}${a.target ? ` ${a.target}` : ""}${count}${a.model ? ` · ${a.model}` : ""}`;
  const last = a ? `${who} just finished ${a.doing}${a.target ? ` ${a.target}` : ""}${count}. ` : "";
  if (stepping) return `${last}Starting the next step…`;
  const c = s.campaign;
  if (c.phase === "completed") return `${last}Finished.`;
  if (c.phase === "stopped") return `${last}Stopped.`;
  if (c.paused) return `${last}Paused.`;
  if (c.phase === "monitoring") return `${last}${c.demo_mode ? "Waiting for editors to reply; they answer on the next step." : "Waiting for editors to reply. The inbox is checked every 5 minutes."}`;
  return `${last}${c.demo_mode ? "Next step in a few seconds." : "Next step when the scheduler runs (every 5 minutes)."}`;
}

export function StatusHeader({ s, busy, onControl, onStep, stepping, autoStep, setAutoStep, onDelete }: {
  s: CampaignState; busy: string | null; onControl: (a: "pause" | "resume" | "stop") => void; onStep: () => void; stepping: boolean; autoStep: boolean; setAutoStep: (v: boolean) => void; onDelete?: () => void;
}) {
  const c = s.campaign;
  const pct = s.budget.total > 0 ? Math.min(100, (s.budget.used / s.budget.total) * 100) : 0;
  const terminal = c.phase === "completed" || c.phase === "stopped" || c.phase === "failed";
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span className="font-medium text-ink-2">{c.name}</span>
        <span>·</span>
        <span>{c.keywords.join(" · ")}</span>
        {c.demo_mode && <span className="chip">Running live · real models and search, no email sent</span>}
        {s.is_active && !c.paused && <span className="inline-flex items-center gap-1.5"><span className="live-dot" />live</span>}
      </div>

      <div className="flex items-start gap-4" data-tour="status">
        <div className={`orb mt-1 ${terminal ? "orb-done" : c.paused || !s.is_active ? "orb-idle" : ""}`} aria-hidden="true" />
        <div className="min-w-0">
          <h1 className="serif text-2xl sm:text-[34px] leading-tight font-medium max-w-3xl">{s.sentence}</h1>
          <div className="mt-2 text-sm text-ink-2 min-h-5" aria-live="polite">
            {!terminal && s.is_active && !c.paused && <span className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle" style={{ background: "#76b900" }} />}
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={activityLine(s, stepping)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }} className="inline-block">{activityLine(s, stepping)}</motion.span>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {c.paused && c.paused_kind && c.paused_kind !== "user" && (
        <div className={`card p-4 text-sm ${c.paused_kind === "nebius" ? "border-danger-soft bg-danger-soft/40" : "border-attention-soft bg-attention-soft/40"}`}>
          <div className="font-semibold">{c.paused_kind === "nebius" ? "Nebius Token Factory is unreachable" : c.paused_kind === "budget" ? "Daily model budget reached" : "Step limit reached"}</div>
          <div className="text-ink-2 mt-0.5">{c.paused_reason}</div>
          <div className="text-ink-3 mt-1 text-xs">{c.paused_kind === "nebius" ? "Check NEBIUS_API_KEY and the model list at /api/health?deep=1, then resume." : c.paused_kind === "budget" ? "It resumes automatically tomorrow, or raise NEBIUS_DAILY_TOKEN_BUDGET." : "A run without email stops after 60 steps. Start a new one from Setup."}</div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([["found", "Found"], ["contacted", "Contacted"], ["replied", "Replied"], ["deals", "Deals"]] as const).map(([k, label]) => (
          <div key={k} className="card p-4">
            <div className="label">{label}</div>
            <div className={`mono text-3xl font-semibold mt-1 ${k === "deals" && s.numbers.deals > 0 ? "text-accent" : ""}`}><CountUp value={s.numbers[k]} format={(n) => int(Math.round(n))} />{k === "deals" ? <span className="text-base text-ink-3 font-normal"> / {c.desired_deals}</span> : null}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-baseline justify-between text-sm">
          <span className="label">Budget</span>
          <span className="mono"><span className="font-semibold"><CountUp value={s.budget.used} format={(n) => money(Math.round(n), s.budget.currency)} /></span> <span className="text-ink-3">of {money(s.budget.total, s.budget.currency)} committed</span></span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-paper-2 overflow-hidden"><div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} /></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {s.open_interventions > 0 && <Link href="/needs-you" className="btn btn-attention">{s.open_interventions} {s.open_interventions === 1 ? "thing needs" : "things need"} you →</Link>}
        {(s.awaiting_approval ?? 0) > 0 && <Link href={`/campaigns/${c.id}?tab=conversations`} className="btn btn-attention">{s.awaiting_approval} email{s.awaiting_approval === 1 ? "" : "s"} to approve →</Link>}
        {!terminal && c.demo_mode && (
          <>
            <button className="btn" onClick={onStep} disabled={stepping || c.paused}>{stepping ? "Working…" : "Run next step"}</button>
            <label className="inline-flex items-center gap-2 text-sm text-ink-2 select-none"><input type="checkbox" checked={autoStep} onChange={(e) => setAutoStep(e.target.checked)} disabled={c.paused} /> auto-run while this tab is open</label>
          </>
        )}
        {!terminal && !c.demo_mode && <span className="text-sm text-ink-3">Stepped by the scheduler every 5 minutes. Close the tab; the Needs-you badge will tell you when it wants you.</span>}
        <span className="flex-1" />
        {!terminal && (c.paused ? <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => onControl("resume")}>Resume</button> : <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => onControl("pause")}>Pause</button>)}
        {!terminal && <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => onControl("stop")}>Stop</button>}
        {terminal && <Link href={`/campaigns/${c.id}?tab=story`} className="btn btn-sm" onClick={(e) => { e.preventDefault(); window.history.replaceState(null, "", `?tab=story`); window.dispatchEvent(new CustomEvent("nseo:tab", { detail: "story" })); }}>Read the story</Link>}
        {terminal && <Link href="/deals" className="btn btn-ghost btn-sm">See deals →</Link>}
        {terminal && <Link href={`/setup?from=${c.id}`} className="btn btn-ghost btn-sm">Run again</Link>}
        {terminal && onDelete && <button className="btn btn-ghost btn-sm text-danger" disabled={!!busy} onClick={onDelete}>Delete</button>}
      </div>
    </section>
  );
}
