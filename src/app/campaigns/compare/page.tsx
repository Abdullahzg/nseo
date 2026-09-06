"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CampaignSummary {
  id: string;
  name: string;
  phase: string;
  created_at: string;
  budget_total: number;
  budget_used: number;
  currency: string;
  prospects_by_status: Record<string, number>;
  deals: any[];
  email_stats: { total: number; sent: number; opened: number; bounced: number; openRate: number; bounceRate: number };
  roi: { total_spent: number; deal_revenue: number; saved_amount: number; roi_pct: number };
}

function fmtMoney(v: number | null | undefined, cur = "USD") {
  if (v == null) return "—";
  return `${cur} ${Number(v).toLocaleString()}`;
}

const PHASE_COLORS: Record<string, string> = {
  completed: "text-emerald-400",
  monitoring: "text-blue-400",
  outreaching: "text-violet-400",
  stopped: "text-red-400",
  failed: "text-red-400",
};

export default function ComparePage() {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/campaigns");
        if (!res.ok) return;
        const list: any[] = await res.json();

        // Fetch detailed state for each campaign
        const detailed = await Promise.all(
          list.map(async (c) => {
            try {
              const r = await fetch(`/api/campaigns/${c.id}`, { cache: "no-store" });
              if (!r.ok) return null;
              return await r.json();
            } catch { return null; }
          })
        );
        setCampaigns(detailed.filter(Boolean).map((d) => ({
          id: d.campaign.id,
          name: d.campaign.name,
          phase: d.campaign.phase,
          created_at: d.campaign.created_at,
          budget_total: d.budget.total,
          budget_used: d.budget.used,
          currency: d.budget.currency,
          prospects_by_status: d.prospects_by_status,
          deals: d.deals,
          email_stats: d.email_stats,
          roi: d.roi,
        })));
      } catch { /* */ }
      setLoading(false);
    })();
  }, []);

  // Aggregate totals
  const totals = campaigns.reduce((acc, c) => {
    acc.budget += c.budget_total;
    acc.spent += c.budget_used;
    acc.prospects += Object.values(c.prospects_by_status).reduce((s, v) => s + (v as number), 0);
    acc.deals += c.deals.length;
    acc.emailsSent += c.email_stats?.sent ?? 0;
    acc.emailsOpened += c.email_stats?.opened ?? 0;
    acc.emailsBounced += c.email_stats?.bounced ?? 0;
    acc.revenue += c.roi?.deal_revenue ?? 0;
    acc.saved += c.roi?.saved_amount ?? 0;
    return acc;
  }, { budget: 0, spent: 0, prospects: 0, deals: 0, emailsSent: 0, emailsOpened: 0, emailsBounced: 0, revenue: 0, saved: 0 });

  const avgOpenRate = totals.emailsSent > 0 ? Math.round((totals.emailsOpened / totals.emailsSent) * 100) : 0;
  const avgBounceRate = totals.emailsSent > 0 ? Math.round((totals.emailsBounced / totals.emailsSent) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/campaigns" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <BarChart3 className="h-5 w-5" />
        <h1 className="text-xl font-semibold">Campaign Comparison</h1>
        <Badge variant="secondary">{campaigns.length}</Badge>
      </div>

      {/* Aggregate stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          ["Total campaigns", campaigns.length.toString()],
          ["Total prospects", totals.prospects.toLocaleString()],
          ["Deals closed", totals.deals.toString()],
          ["Emails sent", totals.emailsSent.toLocaleString()],
          ["Open rate", `${avgOpenRate}%`],
          ["Bounce rate", `${avgBounceRate}%`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3 bg-card">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-xl font-semibold mt-0.5">{value}</div>
          </div>
        ))}
      </div>

      {/* Comparison table */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-medium">Side-by-side comparison</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Metric</th>
                {campaigns.map((c) => (
                  <th key={c.id} className="text-right py-2 px-3 font-medium">
                    <Link href={`/campaigns/${c.id}`} className="hover:underline truncate max-w-[120px] block">{c.name}</Link>
                  </th>
                ))}
                <th className="text-right py-2 pl-3 font-medium text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "Phase", render: (c: CampaignSummary) => <span className={PHASE_COLORS[c.phase] ?? ""}>{c.phase}</span> },
                { label: "Prospects", render: (c: CampaignSummary) => Object.values(c.prospects_by_status).reduce((s, v) => s + (v as number), 0).toString() },
                { label: "Deals", render: (c: CampaignSummary) => c.deals.length.toString() },
                { label: "Budget", render: (c: CampaignSummary) => fmtMoney(c.budget_total, c.currency), total: fmtMoney(totals.budget) },
                { label: "Spent", render: (c: CampaignSummary) => fmtMoney(c.budget_used, c.currency), total: fmtMoney(totals.spent) },
                { label: "Emails sent", render: (c: CampaignSummary) => (c.email_stats?.sent ?? 0).toString(), total: totals.emailsSent.toString() },
                { label: "Open rate", render: (c: CampaignSummary) => `${c.email_stats?.openRate ?? 0}%` },
                { label: "Bounce rate", render: (c: CampaignSummary) => `${c.email_stats?.bounceRate ?? 0}%` },
                { label: "Deal value", render: (c: CampaignSummary) => fmtMoney(c.roi?.deal_revenue, c.currency), total: fmtMoney(totals.revenue) },
                { label: "Savings", render: (c: CampaignSummary) => fmtMoney(c.roi?.saved_amount, c.currency), total: fmtMoney(totals.saved) },
                { label: "ROI", render: (c: CampaignSummary) => `${c.roi?.roi_pct ?? 0}%` },
              ].map(({ label, render, total }) => (
                <tr key={label} className="border-b last:border-0">
                  <td className="py-2 pr-4 text-muted-foreground">{label}</td>
                  {campaigns.map((c) => (
                    <td key={c.id} className="py-2 px-3 text-right">{render(c)}</td>
                  ))}
                  <td className="py-2 pl-3 text-right font-medium">{total ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
