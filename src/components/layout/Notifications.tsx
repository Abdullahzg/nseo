"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "@/components/ui/motion";
import { pointAt } from "@/lib/ui/focus";

// Bottom-right pop-ups for the moments that matter while you are anywhere in the app: a deal, a
// card that needs you, an editor's reply, a finished campaign, a failed send. They stack above the
// running-campaigns panel, link to the right screen, and go away on their own.

interface N { id: number; campaign_id: string; campaign_name: string; action: string; human: string; level: string; href: string; created_at: string }
const TITLE: Record<string, string> = { deal_agreed: "Deal", intervention_created: "Needs you", demo_reply_written: "Reply", replies_received: "Replies", campaign_completed: "Finished", send_failed: "Send failed", tick_error: "Step failed", thread_withdrawn: "Closed", counter_sent: "Counter sent", outreach_sent: "Email sent" };
const OPEN: Record<string, string> = { deal_agreed: "Open the deal", intervention_created: "Answer it", demo_reply_written: "Open the conversation", replies_received: "Open the conversations", campaign_completed: "Read the story", counter_sent: "Open the conversation", thread_withdrawn: "Open the conversation", outreach_sent: "Open the conversation", send_failed: "See what happened", tick_error: "See what happened" };
const TTL_MS = 14_000;

export function Notifications() {
  const [items, setItems] = useState<N[]>([]);
  const lastId = useRef<number>(0);
  const booted = useRef(false);

  useEffect(() => {
    let alive = true;
    try { lastId.current = Number(localStorage.getItem("nseo.notif.last") ?? 0) || 0; } catch { /* no storage */ }
    const poll = async () => {
      try {
        const r = await fetch(`/api/notifications?after_id=${lastId.current}`, { cache: "no-store" });
        if (!r.ok || !alive) return;
        const d = await r.json();
        const fresh: N[] = d.events ?? [];
        if (!booted.current) { booted.current = true; if (lastId.current === 0) { lastId.current = d.newest_id ?? 0; try { localStorage.setItem("nseo.notif.last", String(lastId.current)); } catch { /* ignore */ } return; } }
        if (fresh.length) {
          lastId.current = Math.max(lastId.current, fresh[0].id);
          try { localStorage.setItem("nseo.notif.last", String(lastId.current)); } catch { /* ignore */ }
          setItems((prev) => [...fresh.slice(0, 4).reverse(), ...prev].slice(0, 4));
          for (const f of fresh.slice(0, 4)) setTimeout(() => { if (alive) setItems((prev) => prev.filter((x) => x.id !== f.id)); }, TTL_MS);
        }
      } catch { /* offline */ }
    };
    poll();
    const t = setInterval(() => { if (document.visibilityState === "visible") poll(); }, 6000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="fixed bottom-24 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] space-y-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((n) => (
          <motion.div key={n.id} layout initial={{ opacity: 0, x: 40, scale: 0.98 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }} transition={{ duration: 0.35 }}>
            <Link href={n.href} onClick={(e) => { setItems((prev) => prev.filter((x) => x.id !== n.id)); if (pointAt(n.href)) e.preventDefault(); }} className={`card shadow-lg block px-3.5 py-2.5 hover:border-ink-2 hover:-translate-y-px transition-all border-l-4 ${n.action === "deal_agreed" ? "border-l-accent" : n.action === "intervention_created" ? "border-l-attention" : n.level === "error" || n.action === "send_failed" ? "border-l-danger" : "border-l-model"}`}>
              <div className="flex items-center justify-between gap-2 text-[11px]"><span className="label">{TITLE[n.action] ?? n.action.replace(/_/g, " ")}</span><span className="text-ink-3 truncate">{n.campaign_name}</span></div>
              <div className="text-sm mt-0.5 leading-snug">{n.human.length > 150 ? n.human.slice(0, 150) + "…" : n.human}</div>
              <div className="text-[11px] text-model mt-1">{OPEN[n.action] ?? "Open"} →</div>
            </Link>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
