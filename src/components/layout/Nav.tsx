"use client";

import Link from "next/link";
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

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [m, i] = await Promise.all([fetch("/api/me").then((r) => r.json()), fetch("/api/interventions?status=open").then((r) => (r.ok ? r.json() : { open_count: 0 }))]);
        if (!alive) return;
        setMe(m); setOpen(i.open_count ?? 0);
      } catch { /* offline */ }
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [path]);

  return (
    <header className="sticky top-0 z-30 bg-paper/90 backdrop-blur border-b border-rule">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 h-14 flex items-center gap-2 sm:gap-6">
        <Link href="/" className="serif text-lg font-semibold tracking-tight mr-2">Geseo</Link>
        <nav className="flex items-center gap-1 overflow-x-auto -mx-1 px-1">
          {ITEMS.map((it) => {
            const active = it.match ? it.match.test(path) : path === it.href;
            return (
              <Link key={it.href} href={it.href} className={`relative shrink-0 rounded-lg px-3 h-9 inline-flex items-center text-sm font-medium transition-colors ${active ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}>
                {it.label}
                {it.href === "/needs-you" && open > 0 && (
                  <span className={`ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${active ? "bg-paper text-attention" : "bg-attention text-white"}`}>{open}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-xs text-ink-3">
          {me?.kind === "owner" && <Link href="/settings" className={`rounded-lg px-3 h-9 inline-flex items-center text-sm font-medium ${path === "/settings" ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}>Settings</Link>}
          {me?.kind === "guest" && <span className="chip hidden sm:inline-flex">Guest · demo only</span>}
          {me?.kind === "guest" && me.google_configured && <a href="/api/auth/signin" className="text-ink-2 hover:text-ink">Sign in</a>}
        </div>
      </div>
    </header>
  );
}
