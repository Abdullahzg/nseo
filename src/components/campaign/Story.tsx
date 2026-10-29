"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Story as StoryT, StoryFacts } from "@/lib/campaign/story";
import type { FeedEvent } from "./ActivityFeed";
import { AGENTS, AGENT_LABEL } from "@/lib/campaign/agents";
import { Face } from "@/components/ui/Face";
import { motion, AnimatePresence, Rise, CountUp } from "@/components/ui/motion";
import { money, modelShort } from "@/lib/ui/format";

// The story of a campaign — chapters written by Super from the real ledger — and a replay of it:
// a scrubber over every recorded moment, the agents lighting up in turn, the numbers growing.
// Shareable read-only, with addresses stripped.

export function StoryView({ story, facts, readOnly = false }: { story: StoryT | null; facts: StoryFacts; readOnly?: boolean }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <article>
        {story ? (
          <>
            <Rise><h2 className="serif text-3xl font-semibold tracking-tight text-balance">{story.title}</h2></Rise>
            <div className="mt-6 space-y-7">
              {story.chapters.map((c, i) => (
                <Rise key={i} delay={0.08 * (i + 1)}>
                  <section><h3 className="label mb-1.5">{c.heading}</h3><p className="serif text-[17px] leading-relaxed">{c.body}</p></section>
                </Rise>
              ))}
              <Rise delay={0.08 * (story.chapters.length + 1)}>
                <aside className="card p-5 border-l-4 border-l-accent"><div className="label mb-1.5 text-accent">{story.highlight.heading}</div><p className="serif text-[17px] leading-relaxed">{story.highlight.body}</p></aside>
              </Rise>
              <Rise delay={0.08 * (story.chapters.length + 2)}><p className="serif text-[17px] leading-relaxed text-ink-2">{story.closing}</p></Rise>
            </div>
            <div className="mt-6 text-xs text-ink-3">Written by {modelShort(story.model)} from the campaign's own records · {story.tokens.toLocaleString()} tokens · the numbers on the right are computed by code, not by the model.</div>
          </>
        ) : (
          <div className="card p-6 text-sm text-ink-2">The story is written once the campaign has done something. Come back after a few steps{readOnly ? "" : ", or run it live"}.</div>
        )}
      </article>
      <aside className="space-y-3 lg:sticky lg:top-20 self-start">
        <div className="card p-4">
          <div className="label mb-2">The numbers</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-ink-3">Looked at</dt><dd className="mono">{facts.searches.found}</dd>
            <dt className="text-ink-3">Passed / rejected</dt><dd className="mono">{facts.judged.passed} / {facts.judged.rejected}</dd>
            <dt className="text-ink-3">Editors found</dt><dd className="mono">{facts.editors.found}</dd>
            <dt className="text-ink-3">Emailed</dt><dd className="mono">{facts.emailed}</dd>
            <dt className="text-ink-3">Replied</dt><dd className="mono">{facts.replies.length}</dd>
            <dt className="text-ink-3">Needed you</dt><dd className="mono">{facts.cards.length}</dd>
            <dt className="text-ink-3">Deals</dt><dd className="mono text-accent font-semibold">{facts.deals.length} / {facts.goal}</dd>
            <dt className="text-ink-3">Committed</dt><dd className="mono">{money(facts.committed)} of {money(facts.budget)}</dd>
            <dt className="text-ink-3">Saved vs asks</dt><dd className="mono text-accent">{money(facts.deals.reduce((s, d) => s + Math.max(0, (d.asked ?? 0) - d.agreed), 0))}</dd>
            <dt className="text-ink-3">Model calls</dt><dd className="mono">{facts.model_calls}</dd>
            <dt className="text-ink-3">Cost</dt><dd className="mono">${facts.cost_usd.toFixed(3)}</dd>
            <dt className="text-ink-3">Steps · time</dt><dd className="mono">{facts.steps} · {facts.minutes} min</dd>
          </dl>
          {facts.demo && <div className="text-xs text-ink-3 mt-3">No email was sent; the editors' replies were played by the model.</div>}
        </div>
        {facts.deals.length > 0 && (
          <div className="card p-4"><div className="label mb-2">Deals</div><ul className="text-sm space-y-1">{facts.deals.map((d) => <li key={d.host} className="flex justify-between gap-2"><span className="truncate">{d.host}</span><span className="mono">{d.asked != null && d.asked > d.agreed ? <><span className="text-ink-3 line-through mr-1">${d.asked}</span></> : null}${d.agreed}</span></li>)}</ul></div>
        )}
      </aside>
    </div>
  );
}

// ── Replay ───────────────────────────────────────────────────────────────────────────────────────

interface Snap { i: number; agent: string; human: string; at: string; found: number; judged: number; passed: number; emailed: number; replied: number; deals: number; committed: number; phase: string }

function snapshots(events: FeedEvent[]): Snap[] {
  const asc = [...events].sort((a, b) => a.id - b.id);
  let found = 0, judged = 0, passed = 0, emailed = 0, replied = 0, deals = 0, committed = 0, phase = "planning";
  return asc.map((e, i) => {
    if (e.action === "prospect_found") found++;
    if (e.action === "prospect_qualified") { judged++; passed++; }
    if (e.action === "prospect_rejected") judged++;
    if (e.action === "outreach_sent_simulated" || e.action === "outreach_sent") emailed++;
    if (e.action === "demo_reply_written" || e.action === "reply_written_by_you") replied++;
    if (e.action === "replies_received" && !String(e.human).includes("simulated")) replied += Number((e.detail as any)?.accounts ? 0 : 0);
    if (e.action === "deal_agreed") { deals++; const m = String(e.human).match(/at \$(\d+)/); if (m) committed += Number(m[1]); }
    if (e.action === "phase_changed") phase = String((e.detail as any)?.to ?? phase);
    return { i, agent: e.agent, human: e.human, at: e.created_at, found, judged, passed, emailed, replied, deals, committed, phase };
  });
}

export function Replay({ events }: { events: FeedEvent[] }) {
  const snaps = useMemo(() => snapshots(events.filter((e) => e.action !== "policy_noop")), [events]);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setPos(snaps.length ? snaps.length - 1 : 0); }, [snaps.length]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setPos((p) => { if (p >= snaps.length - 1) { setPlaying(false); return p; } return p + 1; }), 700);
    return () => clearInterval(t);
  }, [playing, snaps.length]);
  const play = useCallback(() => { if (pos >= snaps.length - 1) setPos(0); setPlaying(true); }, [pos, snaps.length]);
  if (snaps.length < 2) return null;
  const s = snaps[Math.min(pos, snaps.length - 1)];
  const started = new Date(snaps[0].at).getTime();
  const elapsed = Math.max(0, Math.round((new Date(s.at).getTime() - started) / 1000));
  const agentKey = s.agent === "strategy" ? "discovery" : s.agent;
  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
        <h3 className="label">Replay <span className="font-normal normal-case text-ink-3">— every recorded moment, in order</span></h3>
        <div className="flex items-center gap-2"><button type="button" className="btn btn-sm" onClick={() => (playing ? setPlaying(false) : play())}>{playing ? "Pause" : pos >= snaps.length - 1 ? "Play from the start" : "Play"}</button><span className="mono text-xs text-ink-3">{s.i + 1} / {snaps.length} · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span></div>
      </div>
      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <div className="flex md:flex-col gap-2 flex-wrap">
          {AGENTS.map((a) => (
            <motion.div key={a.key} animate={{ scale: agentKey === a.key ? 1.08 : 1, opacity: agentKey === a.key ? 1 : 0.45 }} transition={{ duration: 0.25 }} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${agentKey === a.key ? "bg-paper-2 ring-2 ring-[#76b900]" : ""}`}>
              <Face kind="agent" seed={a.key} size={28} className="rounded-md" /><span className="text-sm font-medium hidden md:inline">{a.name}</span>
            </motion.div>
          ))}
        </div>
        <div className="min-w-0">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
            {([["found", s.found], ["judged", s.judged], ["emailed", s.emailed], ["replied", s.replied], ["deals", s.deals], ["committed", s.committed]] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-paper-2 px-2.5 py-2"><div className="label !text-[10px]">{k}</div><div className="mono text-xl font-semibold">{k === "committed" ? <CountUp value={v} format={(n) => `$${Math.round(n)}`} /> : <CountUp value={v} />}</div></div>
            ))}
          </div>
          <div className="min-h-16 rounded-lg border border-rule bg-paper p-3">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={s.i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                <div className="text-[11px] text-ink-3 mb-1">{AGENT_LABEL[s.agent] ?? s.agent} · {s.phase.replace("_", " ")}</div>
                <div className="text-sm leading-snug">{s.human}</div>
              </motion.div>
            </AnimatePresence>
          </div>
          <input type="range" min={0} max={snaps.length - 1} value={Math.min(pos, snaps.length - 1)} onChange={(e) => { setPlaying(false); setPos(Number(e.target.value)); }} className="w-full mt-3 accent-[#76b900]" aria-label="Replay position" />
          <div className="flex justify-between text-[11px] text-ink-3 mono"><span>start</span><span>{snaps.length} moments</span></div>
        </div>
      </div>
    </section>
  );
}
