"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CampaignState } from "./StatusHeader";
import type { FeedEvent } from "./ActivityFeed";
import { Face } from "@/components/ui/Face";
import { motion, AnimatePresence } from "@/components/ui/motion";
import { money } from "@/lib/ui/format";

// Milestone moments: the first reply, the first deal, the goal. Shown once each, only when the
// change is watched happening (never on opening a campaign that already has them), with the story
// so far in one line. Dismisses itself after a few seconds or on click.

type Key = "first_reply" | "first_deal" | "goal";
interface Moment { key: Key; agent: string; title: string; actions: string[]; fallback: string; soFar: string }

const HOLD_MS = 7000;

export function Moments({ state, events }: { state: CampaignState; events: FeedEvent[] }) {
  const prev = useRef<CampaignState | null>(null);
  const [queue, setQueue] = useState<Moment[]>([]);
  const shown = useRef<Set<Key>>(new Set());

  useEffect(() => {
    const p = prev.current; prev.current = state;
    if (!p) return; // first load: nothing is "new"
    const id = state.campaign.id;
    const seen = (k: Key) => { try { return !!localStorage.getItem(`nseo.moment.${id}.${k}`); } catch { return false; } };
    const mark = (k: Key) => { try { localStorage.setItem(`nseo.moment.${id}.${k}`, "1"); } catch { /* ignore */ } };
    const soFar = `${state.numbers.found} looked at · ${state.numbers.contacted} emailed · ${state.numbers.replied} replied · ${state.numbers.deals} of ${state.campaign.desired_deals} deals · ${money(state.budget.used)} committed`;
    const add: Moment[] = [];
    if (p.numbers.replied === 0 && state.numbers.replied > 0 && !shown.current.has("first_reply") && !seen("first_reply"))
      add.push({ key: "first_reply", agent: "inbox", title: "The first reply is in", actions: ["demo_reply_written", "reply_written_by_you", "replies_received"], fallback: "An editor wrote back. The Negotiator reads it next.", soFar });
    if (p.numbers.deals === 0 && state.numbers.deals > 0 && !shown.current.has("first_deal") && !seen("first_deal"))
      add.push({ key: "first_deal", agent: "deals", title: "First deal agreed", actions: ["deal_agreed"], fallback: "The Ledger recorded it and committed the money.", soFar });
    if (p.campaign.phase !== "completed" && state.campaign.phase === "completed" && state.campaign.completion_reason === "goal_reached" && !shown.current.has("goal") && !seen("goal"))
      add.push({ key: "goal", agent: "manager", title: "Goal reached", actions: [], fallback: state.sentence, soFar });
    if (add.length) { add.forEach((m) => { shown.current.add(m.key); mark(m.key); }); setQueue((q) => [...q, ...add]); }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = queue[0] ?? null;
  // The feed can arrive a poll later than the numbers: read the line at render time, newest first.
  const line = current ? (events.find((e) => current.actions.includes(e.action))?.human ?? current.fallback) : "";
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), HOLD_MS);
    return () => clearTimeout(t);
  }, [current]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {current && (
        <motion.div key={current.key} initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={{ type: "spring", stiffness: 300, damping: 26 }}
          className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 w-[min(560px,calc(100vw-32px))]" role="status" aria-live="polite">
          <button type="button" onClick={() => setQueue((q) => q.slice(1))} className="relative overflow-hidden w-full text-left card p-4 sm:p-5 shadow-xl border-[#76b900]/60 flex items-start gap-4 hover:bg-paper-2">
            <motion.div animate={{ rotate: [0, -6, 6, -3, 0] }} transition={{ duration: 0.9, delay: 0.3 }}><Face kind="agent" seed={current.agent} size={56} className="rounded-xl shrink-0" /></motion.div>
            <div className="min-w-0 flex-1">
              <div className="label text-[#4f7d00] mb-0.5">Moment</div>
              <div className="serif text-xl sm:text-2xl font-semibold leading-tight">{current.title}</div>
              <div className="text-sm text-ink-2 mt-1 leading-snug line-clamp-2">{line}</div>
              <div className="mono text-[11px] text-ink-3 mt-2">So far: {current.soFar}</div>
            </div>
            <motion.span className="absolute left-0 bottom-0 h-0.5 bg-[#76b900] rounded-b-xl" initial={{ width: "100%" }} animate={{ width: 0 }} transition={{ duration: HOLD_MS / 1000, ease: "linear" }} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
