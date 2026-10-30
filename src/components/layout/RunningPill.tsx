"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Campaigns keep running while you are on another screen. This panel, bottom-right, lists every
// one that is live (and anything that needs you), so you can open the one you want. Collapsed it is
// one line; expanded it is the list. The Campaign tab and the campaigns list are the other ways in.

interface Row { id: string; name: string; phase: string; paused: boolean; demo_mode: boolean; budget_used: number; budget_total: number; desired_deals: number; keywords: string[] }
const ACTIVE = new Set(["planning", "discovering", "qualifying", "resolving_contacts", "outreaching", "monitoring"]);
const PHASE: Record<string, string> = { planning: "planning", discovering: "searching", qualifying: "judging pages", resolving_contacts: "finding editors", outreaching: "writing emails", monitoring: "waiting for replies" };

export function RunningPill() {
  const path = usePathname();
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/campaigns", { cache: "no-store" }); if (r.ok && alive) setRows(await r.json()); } catch { /* offline */ } };
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [path]);
  const running = rows.filter((c) => ACTIVE.has(c.phase));
  const here = running.find((c) => path === `/campaigns/${c.id}`);
  const others = running.filter((c) => c.id !== here?.id);
  if (running.length === 0 || (here && others.length === 0)) return null;
  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-[calc(100vw-2rem)] w-80">
      {open && (
        <div className="card shadow-lg mb-2 overflow-hidden fade-in">
          <div className="px-3.5 py-2 text-[11px] label border-b border-rule flex items-center justify-between">Running now <Link href="/campaigns" className="normal-case tracking-normal font-normal text-ink-2 hover:text-ink">all campaigns →</Link></div>
          <ul className="divide-y divide-rule max-h-80 overflow-auto">
            {running.map((c) => (
              <li key={c.id}>
                <Link href={`/campaigns/${c.id}`} className={`block px-3.5 py-2.5 hover:bg-paper-2 ${c.id === here?.id ? "bg-paper-2/60" : ""}`} onClick={() => setOpen(false)}>
                  <div className="flex items-center gap-2">
                    <span className={`orb !w-4 !h-4 !border-[3px] shrink-0 ${c.paused ? "orb-idle" : ""}`} aria-hidden="true" />
                    <span className="text-sm font-medium truncate">{c.name}</span>
                    {c.id === here?.id && <span className="ml-auto text-[11px] text-ink-3">this one</span>}
                  </div>
                  <div className="text-xs text-ink-3 mt-0.5 truncate">{c.paused ? "paused" : PHASE[c.phase] ?? c.phase}{c.demo_mode ? " · no email sent" : ""} · ${c.budget_used} of ${c.budget_total} · goal {c.desired_deals}</div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="card shadow-lg px-3.5 py-2.5 flex items-center gap-3 w-full text-left hover:border-ink-2 transition-colors">
        <span className={`orb !w-7 !h-7 shrink-0 ${running.every((c) => c.paused) ? "orb-idle" : ""}`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium truncate">{running.length === 1 ? running[0].name : `${running.length} campaigns running`}</span>
          <span className="block text-xs text-ink-3 truncate">{running.length === 1 ? `${PHASE[running[0].phase] ?? running[0].phase}${running[0].demo_mode ? " · no email sent" : ""}` : running.map((c) => c.name).join(" · ")}</span>
        </span>
        <span aria-hidden="true" className={`text-ink-3 text-xs transition-transform ${open ? "rotate-90" : "-rotate-90"}`}>▸</span>
      </button>
    </div>
  );
}
