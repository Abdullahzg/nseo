"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// A campaign keeps running while you are on another screen. This pill, bottom-right, says so and
// takes you back — so the Campaign tab is never a dead end and the browser's Back button is never
// the only way home.

interface Row { id: string; name: string; phase: string; paused: boolean; demo_mode: boolean; budget_used: number; budget_total: number }
const ACTIVE = new Set(["planning", "discovering", "qualifying", "resolving_contacts", "outreaching", "monitoring"]);

export function RunningPill() {
  const path = usePathname();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/campaigns", { cache: "no-store" }); if (r.ok && alive) setRows(await r.json()); } catch { /* offline */ } };
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [path]);
  const running = rows.filter((c) => ACTIVE.has(c.phase) && !c.paused);
  const onIt = running.length && path === `/campaigns/${running[0].id}`;
  if (!running.length || onIt) return null;
  const c = running[0];
  return (
    <Link href={`/campaigns/${c.id}`} className="fixed bottom-4 right-4 z-40 card shadow-lg px-3.5 py-2.5 flex items-center gap-3 hover:border-ink-2 transition-colors max-w-[calc(100vw-2rem)]">
      <span className="orb !w-7 !h-7" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-medium truncate">{c.name}{running.length > 1 ? ` +${running.length - 1} more` : ""}</span>
        <span className="block text-xs text-ink-3 truncate">running · {c.phase.replace("_", " ")}{c.demo_mode ? " · demo" : ""} — back to it →</span>
      </span>
    </Link>
  );
}
