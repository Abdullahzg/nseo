"use client";

import { useState } from "react";
import { ago, modelShort } from "@/lib/ui/format";

export interface FeedEvent {
  id: number; agent: string; action: string; human: string; engine: "model" | "policy" | "fixture" | "system"; level: "info" | "warn" | "error";
  model: string | null; tokens_in: number | null; tokens_out: number | null; latency_ms: number | null; reasoning: string | null; cost_usd: number | null;
  detail: Record<string, unknown>; created_at: string;
}

import { AGENT_LABEL } from "@/lib/campaign/agents";

function EngineChip({ e }: { e: FeedEvent }) {
  if (e.engine === "model") return <span className="chip chip-model">{modelShort(e.model) || "Nemotron"}</span>;
  if (e.engine === "policy") return <span className="chip">policy rule</span>;
  if (e.engine === "fixture") return <span className="chip">fixture</span>;
  return null;
}

function Row({ e }: { e: FeedEvent }) {
  const [open, setOpen] = useState(false);
  const expandable = e.engine === "model" || Object.keys(e.detail ?? {}).length > 0;
  const tone = e.level === "error" ? "border-l-danger" : e.level === "warn" ? "border-l-attention" : e.action === "deal_agreed" ? "border-l-accent" : e.engine === "model" ? "border-l-model" : "border-l-rule";
  return (
    <li className={`fade-in border-l-2 ${tone} pl-4 py-3`}>
      <button type="button" onClick={() => expandable && setOpen(!open)} className={`w-full text-left ${expandable ? "cursor-pointer" : "cursor-default"}`} aria-expanded={open}>
        <div className="flex items-start gap-3">
          <p className={`flex-1 leading-snug ${e.level === "error" ? "text-danger" : ""}`}>{e.human}</p>
          <span className="shrink-0 text-xs text-ink-3 mono pt-0.5">{ago(e.created_at)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
          <span>{AGENT_LABEL[e.agent] ?? e.agent}</span>
          <EngineChip e={e} />
          {e.engine === "model" && e.tokens_in != null && <span className="mono">{(e.tokens_in ?? 0) + (e.tokens_out ?? 0)} tok · {((e.latency_ms ?? 0) / 1000).toFixed(1)} s{cost(e.cost_usd)}</span>}
          {expandable && <span className="ml-auto">{open ? "hide" : e.engine === "model" ? "why?" : "details"}</span>}
        </div>
      </button>
      {open && (
        <div className="mt-3 rounded-xl bg-paper-2/70 p-4 text-sm space-y-3">
          {e.engine === "model" && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div><div className="label">Model</div><div className="mono mt-0.5 break-all">{e.model}</div></div>
              <div><div className="label">Tokens in / out</div><div className="mono mt-0.5">{e.tokens_in} / {e.tokens_out}</div></div>
              <div><div className="label">Latency</div><div className="mono mt-0.5">{e.latency_ms} ms</div></div>
              <div><div className="label">Cost</div><div className="mono mt-0.5">{e.cost_usd != null ? `$${e.cost_usd.toFixed(5)}` : "—"}</div></div>
            </div>
          )}
          {e.reasoning ? (
            <div><div className="label mb-1">The model's reasoning</div><pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-2 max-h-72 overflow-auto">{e.reasoning}</pre></div>
          ) : e.engine === "model" ? <div className="text-xs text-ink-3">This call ran with thinking off (fast path); the structured answer is in the details below.</div> : null}
          {typeof e.detail?.body === "string" && <div><div className="label mb-1">Email sent</div><pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-2">{String(e.detail.body)}</pre></div>}
          {Object.keys(e.detail ?? {}).filter((k) => k !== "body").length > 0 && (
            <details><summary className="text-xs text-ink-3 cursor-pointer">raw details</summary><pre className="mono text-[11px] whitespace-pre-wrap mt-1 text-ink-2">{JSON.stringify(Object.fromEntries(Object.entries(e.detail).filter(([k]) => k !== "body")), null, 1)}</pre></details>
          )}
        </div>
      )}
    </li>
  );
}

/** Runs of repetitive data rows (12 "Found …" fixtures, 8 "Found an editor …") collapse into one
 *  line so the model's decisions stay visible. Any row can be opened to see the members. */
const GROUPABLE = new Set(["prospect_found", "contact_resolved"]);
type Item = { kind: "row"; e: FeedEvent } | { kind: "group"; key: string; action: string; agent: string; members: FeedEvent[] };
function groupRuns(events: FeedEvent[]): Item[] {
  const out: Item[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (GROUPABLE.has(e.action) && last && last.kind === "group" && last.action === e.action) { last.members.push(e); continue; }
    if (GROUPABLE.has(e.action) && last && last.kind === "row" && last.e.action === e.action) { out[out.length - 1] = { kind: "group", key: `g${e.id}`, action: e.action, agent: e.agent, members: [last.e, e] }; continue; }
    out.push({ kind: "row", e });
  }
  return out;
}

function GroupRow({ g }: { g: Extract<Item, { kind: "group" }> }) {
  const [open, setOpen] = useState(false);
  const n = g.members.length;
  const line = g.action === "prospect_found" ? `Found ${n} publications` : `Found editors at ${n} publications`;
  const sub = g.members.slice(0, 3).map((m) => m.human.replace(/^Found (an editor |)?/, "").split(" — ")[0].replace(/ at /, " · ")).join(", ");
  return (
    <li className="border-l-2 border-l-rule pl-4 py-3">
      <button type="button" className="w-full text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="flex items-start gap-3"><p className="flex-1 leading-snug">{line} <span className="text-ink-3">— {sub}{n > 3 ? "…" : ""}</span></p><span className="shrink-0 text-xs text-ink-3 mono pt-0.5">{ago(g.members[0].created_at)}</span></div>
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-3"><span>{AGENT_LABEL[g.agent] ?? g.agent}</span><EngineChip e={g.members[0]} /><span className="ml-auto">{open ? "hide" : `show ${n}`}</span></div>
      </button>
      {open && <ul className="mt-2 pl-3 border-l border-rule space-y-1.5 text-sm text-ink-2">{g.members.map((m) => <li key={m.id}>{m.human}</li>)}</ul>}
    </li>
  );
}

const cost = (c: number | null) => (c == null ? "" : c < 0.0001 ? " · <$0.0001" : ` · $${c.toFixed(4)}`);

export function ActivityFeed({ events, loading, onMore, hasMore }: { events: FeedEvent[]; loading: boolean; onMore: () => void; hasMore: boolean }) {
  if (loading && events.length === 0) return <div className="space-y-3" aria-busy="true"><div className="skeleton h-12" /><div className="skeleton h-12" /><div className="skeleton h-12" /></div>;
  if (events.length === 0) return <div className="card p-6 text-sm text-ink-2">Nothing has happened yet. Press <b>Run next step</b> (demo) or wait for the scheduler.</div>;
  const items = groupRuns(events);
  return (
    <div>
      <ul className="divide-y divide-rule">{items.map((it) => (it.kind === "row" ? <Row key={it.e.id} e={it.e} /> : <GroupRow key={it.key} g={it} />))}</ul>
      {hasMore && <button className="btn btn-ghost btn-sm mt-4" onClick={onMore}>Earlier activity</button>}
    </div>
  );
}
