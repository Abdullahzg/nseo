"use client";

import { useState, useMemo } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Prospect {
  id: string;
  domain_host: string;
  prospect_url: string | null;
  title: string | null;
  status: string;
  opportunity_score: number | null;
  domain_authority: number | null;
  contact_email: string | null;
  author_id: string | null;
  provenance: string | null;
  created_at: string;
}

type SortKey = "domain_host" | "status" | "opportunity_score" | "domain_authority" | "created_at";
type SortDir = "asc" | "desc";

const STATUS_COLORS: Record<string, string> = {
  discovered: "bg-sky-500/15 text-sky-500 border-sky-500/30",
  qualified: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  rejected: "bg-red-500/15 text-red-400 border-red-500/30",
  ready: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  outreached: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
  replied: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  negotiating: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  won: "bg-success/15 text-success border-success/40",
  lost: "bg-red-500/15 text-red-400 border-red-500/30",
  bounced: "bg-red-500/15 text-red-400 border-red-500/30",
};

const PAGE_SIZE = 15;

export function ProspectTable({ prospects }: { prospects: Prospect[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const sorted = useMemo(() => {
    const filtered = statusFilter === "all" ? prospects : prospects.filter((p) => p.status === statusFilter);
    return [...filtered].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (av == null) av = sortDir === "asc" ? Infinity : -Infinity;
      if (bv == null) bv = sortDir === "asc" ? Infinity : -Infinity;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [prospects, sortKey, sortDir, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageData = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "opportunity_score" || key === "domain_authority" ? "desc" : "asc"); }
    setPage(0);
  }

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const statuses = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of prospects) map.set(p.status, (map.get(p.status) ?? 0) + 1);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [prospects]);

  if (prospects.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No prospects yet — agents are discovering targets.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => { setStatusFilter("all"); setPage(0); }} className={`text-xs px-2 py-1 rounded-md font-medium ${statusFilter === "all" ? "bg-highlight-soft text-highlight-ink" : "text-muted-foreground hover:bg-muted/40"}`}>
          All <span className="opacity-70">{prospects.length}</span>
        </button>
        {statuses.map(([s, n]) => (
          <button key={s} onClick={() => { setStatusFilter(s); setPage(0); }} className={`text-xs px-2 py-1 rounded-md font-medium ${statusFilter === s ? "bg-highlight-soft text-highlight-ink" : "text-muted-foreground hover:bg-muted/40"}`}>
            {s.replace(/_/g, " ")} <span className="opacity-70">{n}</span>
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {[
                ["domain_host", "Domain"],
                ["status", "Status"],
                ["opportunity_score", "Score"],
                ["domain_authority", "DA"],
                ["created_at", "Found"],
              ].map(([k, label]) => (
                <th key={k} className="px-3 py-2 text-left font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => toggleSort(k as SortKey)}>
                  <span className="inline-flex items-center gap-1">{label} <SortIcon k={k as SortKey} /></span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.map((p) => (
              <tr key={p.id} className="border-b border-border/50 hover:bg-muted/20">
                <td className="px-3 py-2">
                  <div className="font-medium truncate max-w-[200px]">{p.domain_host}</div>
                  {p.title && <div className="text-muted-foreground truncate max-w-[200px]">{p.title}</div>}
                </td>
                <td className="px-3 py-2"><Badge variant="outline" className={STATUS_COLORS[p.status] ?? ""}>{p.status.replace(/_/g, " ")}</Badge></td>
                <td className="px-3 py-2 tabular-nums">{p.opportunity_score != null ? Math.round(p.opportunity_score) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{p.domain_authority ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{new Date(p.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{sorted.length} prospects{statusFilter !== "all" ? ` (filtered to ${statusFilter})` : ""}</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
          <span className="tabular-nums">{page + 1}/{totalPages}</span>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    </div>
  );
}
