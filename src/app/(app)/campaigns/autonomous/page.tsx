"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Loader2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface AgenticCampaign {
  id: string;
  name: string;
  phase: string;
  objective: string | null;
  website_url: string | null;
  keywords: string[] | null;
  budget_total: number | null;
  budget_used: number | null;
  currency: string;
  desired_deals: number | null;
  demo_mode: boolean;
}

const PHASE_COLORS: Record<string, string> = {
  planning: "bg-sky-500/15 text-sky-500 border-sky-500/30",
  discovering: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  qualifying: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  resolving_contacts: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  outreaching: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
  monitoring: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  completed: "bg-success/15 text-success border-success/40",
  stopped: "bg-warning/15 text-warning border-warning/30",
};

const PHASE_ORDER = ["draft", "planning", "discovering", "qualifying", "resolving_contacts", "outreaching", "monitoring", "completing", "completed"];

function phaseProgress(phase: string): number {
  if (phase === "completed") return 100;
  if (phase === "stopped" || phase === "failed") return 0;
  const i = PHASE_ORDER.indexOf(phase);
  if (i < 0) return 0;
  return Math.min(100, ((i + 1) / PHASE_ORDER.length) * 100);
}

export default function AutonomousCampaignsPage() {
  const [campaigns, setCampaigns] = useState<AgenticCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadPhase, setLoadPhase] = useState<"init" | "fetching" | "parsing" | "done">("init");

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setLoadPhase("fetching");
    try {
      const res = await fetch("/api/campaigns", { cache: "no-store" });
      setLoadPhase("parsing");
      if (res.ok) {
        const all = await res.json();
        setCampaigns((all as any[]).filter((c) => c.phase));
      }
    } finally {
      setLoadPhase("done");
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Autonomous campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {loading
              ? "Loading campaign data…"
              : campaigns.length === 0
                ? "No campaigns yet. Create one to get started."
                : `${campaigns.length} campaign${campaigns.length !== 1 ? "s" : ""} · Auto-refreshes every 15s`
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!loading && (
            <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={refreshing}>
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
          )}
          <Link href="/campaigns/new"><Button><Plus className="h-4 w-4" /> New campaign</Button></Link>
        </div>
      </div>

      {loading && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              {loadPhase === "init" && "Connecting to server…"}
              {loadPhase === "fetching" && "Fetching campaigns from database…"}
              {loadPhase === "parsing" && "Parsing campaign data…"}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-3 animate-pulse">
                <div className="flex items-start justify-between">
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-1.5 w-full" />
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!loading && campaigns.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <Bot className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              No campaigns yet. Create your first campaign — the AI handles everything automatically.
            </p>
            <Link href="/campaigns/new">
              <Button variant="outline">Create your first campaign</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {campaigns.map((c) => {
          const usedPct = c.budget_total ? Math.min(100, ((c.budget_used ?? 0) / c.budget_total) * 100) : 0;
          return (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/40">
                <CardContent className="p-4 space-y-3 overflow-hidden">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium truncate min-w-0">{c.name}{c.demo_mode ? " 🧪" : ""}</div>
                    <Badge variant="outline" className={cn("shrink-0 text-[10px]", PHASE_COLORS[c.phase] ?? "")}>{c.phase.replace(/_/g, " ")}</Badge>
                  </div>
                  {c.objective && <p className="text-xs text-muted-foreground line-clamp-2">{c.objective}</p>}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                    {c.website_url && <span className="truncate">{c.website_url.replace(/^https?:\/\//, "")}</span>}
                    {c.keywords?.length ? <span className="truncate shrink-0">{(c.keywords as string[]).slice(0, 2).join(", ")}</span> : null}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="truncate">Budget {c.currency} {(c.budget_used ?? 0).toLocaleString()} / {(c.budget_total ?? 0).toLocaleString()}</span>
                    {c.desired_deals != null && <span className="shrink-0">{c.desired_deals} placements</span>}
                  </div>
                  <Progress value={usedPct} className="h-1.5" />
                  <div className="flex items-center gap-4 text-[11px] text-muted-foreground pt-1 border-t border-border/50">
                    <span>Phase {PHASE_ORDER.indexOf(c.phase) + 1}/{PHASE_ORDER.length}</span>
                    <span>{Math.round(phaseProgress(c.phase))}% complete</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
