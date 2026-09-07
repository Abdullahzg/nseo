"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

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

export default function AutonomousCampaignsPage() {
  const [campaigns, setCampaigns] = useState<AgenticCampaign[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/campaigns", { cache: "no-store" });
      if (res.ok) {
        const all = await res.json();
        // Agentic campaigns carry a phase (migration 062); legacy ones don't.
        setCampaigns((all as any[]).filter((c) => c.phase));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Autonomous campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">
            An agent workforce researches prospects, resolves contacts, runs outreach and negotiates deals within your budget.
          </p>
        </div>
        <Link href="/campaigns/new"><Button><Plus className="h-4 w-4" /> New campaign</Button></Link>
      </div>

      {loading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {!loading && campaigns.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <Bot className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              No autonomous campaigns yet. Create one with an objective, keywords and a budget — then press Start once.
            </p>
            <Link href="/campaigns/new">
              <Button variant="outline">Create your first campaign</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {campaigns.map((c) => {
          const pct = c.desired_deals ? undefined : undefined; // filled by detail page
          void pct;
          const usedPct = c.budget_total ? Math.min(100, ((c.budget_used ?? 0) / c.budget_total) * 100) : 0;
          return (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/40">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium">{c.name}{c.demo_mode ? " 🧪" : ""}</div>
                    <Badge variant="outline" className={PHASE_COLORS[c.phase] ?? ""}>{c.phase.replace(/_/g, " ")}</Badge>
                  </div>
                  {c.objective && <p className="text-xs text-muted-foreground line-clamp-2">{c.objective}</p>}
                  <div className="text-xs text-muted-foreground">
                    {c.website_url?.replace(/^https?:\/\//, "")}
                    {c.keywords?.length ? ` · ${(c.keywords as string[]).slice(0, 3).join(", ")}` : ""}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                    <span>Budget {(c.budget_used ?? 0).toLocaleString()} / {(c.budget_total ?? 0).toLocaleString()} {c.currency}</span>
                    {c.desired_deals != null && <span>{c.desired_deals} placements</span>}
                  </div>
                  <Progress value={usedPct} className="h-1.5" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
