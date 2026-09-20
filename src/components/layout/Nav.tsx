"use client";

import Link from "next/link";
import { Wordmark } from "./Logo";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface Me { kind: "owner" | "guest" | "none"; email?: string; google_configured?: boolean }

const ITEMS = [
  { href: "/setup", label: "Setup" },
  { href: "/campaigns", label: "Campaign", match: /^\/campaigns/ },
  { href: "/needs-you", label: "Needs you" },
  { href: "/deals", label: "Deals" },
];

export function Nav() {
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState<number>(0);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [m, i, cs] = await Promise.all([fetch("/api/me").then((r) => r.json()), fetch("/api/interventions?status=open").then((r) => (r.ok ? r.json() : { open_count: 0 })), fetch("/api/campaigns").then((r) => (r.ok ? r.json() : []))]);
        if (!alive) return;
        setMe(m); setOpen(i.open_count ?? 0);
        // The Campaign tab opens the campaign that is running (or the newest one), never a dead end.
        const list = Array.isArray(cs) ? cs : [];
        const live = list.find((c: any) => ["planning", "discovering", "qualifying", "resolving_contacts", "outreaching", "monitoring"].includes(c.phase) && !c.paused) ?? list[0];
        setRunningId(live?.id ?? null);
      } catch { /* offline */ }
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [path]);

  return (
    <header className="sticky top-0 z-30 bg-paper/90 backdrop-blur border-b border-rule">
      <div className="mx-auto max-w-5xl px-3 sm:px-6 h-14 flex items-center gap-1 sm:gap-6">
        <Link href="/" className="mr-1 sm:mr-2 hidden sm:block" aria-label="Nseo home"><Wordmark className="text-lg" /></Link>
        <nav className="flex flex-1 items-center gap-0.5 sm:gap-1">
          {ITEMS.map((it) => {
            const active = it.match ? it.match.test(path) : path === it.href;
            const href = it.href === "/campaigns" && runningId ? `/campaigns/${runningId}` : it.href;
            return (
              <Link key={it.href} href={href} className={`relative flex-1 sm:flex-none justify-center rounded-lg px-2 sm:px-3 h-9 inline-flex items-center text-[13px] sm:text-sm font-medium whitespace-nowrap transition-colors ${active ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}>
                {it.label}
                {it.href === "/needs-you" && open > 0 && (
                  <span className={`ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${active ? "bg-paper text-attention" : "bg-attention text-white"}`}>{open}</span>
                )}
              </Link>
            );
          })}
          {me?.kind === "owner" && <Link href="/settings" className={`flex-1 sm:flex-none justify-center rounded-lg px-2 sm:px-3 h-9 inline-flex items-center text-[13px] sm:text-sm font-medium whitespace-nowrap sm:ml-auto ${path === "/settings" ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}>Settings</Link>}
        </nav>
        <div className="hidden sm:flex items-center gap-2 text-xs text-ink-3">
          {me?.kind === "guest" && <span className="chip">Guest · demo only</span>}
          {me?.kind === "guest" && me.google_configured && <a href="/api/auth/signin" className="text-ink-2 hover:text-ink">Sign in</a>}
        </div>
      </div>
    </header>
  );
}
