"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowRight, Command } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Campaigns", href: "/campaigns/autonomous", group: "Pages" },
  { label: "New Campaign", href: "/campaigns/new", group: "Pages" },
  { label: "Inbox", href: "/inbox", group: "Pages" },
  { label: "Decisions", href: "/sending", group: "Pages" },
  { label: "Agent Runs", href: "/agent-runs", group: "Pages" },
  { label: "Settings", href: "/settings", group: "Pages" },
  { label: "Dashboard", href: "/dashboard", group: "Pages" },
  { label: "Email Finder", href: "/email-finder", group: "Tools" },
  { label: "Site Audit", href: "/site-audit", group: "Tools" },
  { label: "Link Audit", href: "/link-audit", group: "Tools" },
  { label: "Indexing", href: "/indexing", group: "Tools" },
  { label: "Negotiation", href: "/negotiation", group: "Tools" },
  { label: "Handbook", href: "/handbook", group: "Docs" },
];

export function SearchDialog() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();

  const filtered = NAV_ITEMS.filter(
    (item) => !q || item.label.toLowerCase().includes(q.toLowerCase()) || item.group.toLowerCase().includes(q.toLowerCase())
  );

  const handleKey = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setOpen((o) => !o);
    }
    if (e.key === "Escape") setOpen(false);
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Navigate to…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter" && filtered.length > 0) {
                router.push(filtered[0].href);
                setOpen(false);
              }
            }}
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            esc
          </kbd>
        </div>
        <div className="max-h-[300px] overflow-y-auto p-1">
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No results found.</p>
          )}
          {filtered.map((item) => (
            <button
              key={item.href}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
              onClick={() => { router.push(item.href); setOpen(false); }}
            >
              <span className="flex-1 text-left">{item.label}</span>
              <span className="text-xs text-muted-foreground">{item.group}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ))}
        </div>
        <div className="border-t border-border px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Command className="h-3 w-3" />K to toggle</span>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
