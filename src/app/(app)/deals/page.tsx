"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { money, ago } from "@/lib/ui/format";

interface Deal { id: string; domain_host: string; publication: string | null; original_ask: number | null; agreed_price: number | null; currency: string; status: string; agreed_at: string | null; terms: { placement_type?: string }; campaign: { id: string; name: string; demo_mode: boolean } }
interface Data { deals: Deal[]; totals: { deals: number; goal: number; budget: number; used: number; saved: number }; in_progress: number }

const STATUS: Record<string, string> = { terms_agreed: "Terms agreed", awaiting_content: "Awaiting content", placement_pending: "Placement pending", live: "Live", closed: "Closed", cancelled: "Cancelled" };

export default function DealsPage() {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetch("/api/deals", { cache: "no-store" }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); setD(await r.json()); }).catch((e) => setError(e.message)); }, []);

  if (error) return <div className="card border-danger-soft bg-danger-soft/40 p-4 text-sm"><b className="text-danger">Could not load.</b> {error}</div>;
  if (!d) return <div className="space-y-3" aria-busy="true"><div className="skeleton h-24" /><div className="skeleton h-40" /></div>;
  const t = d.totals;
  return (
    <div>
      <div className="mb-6">
        <h1 className="serif text-3xl font-semibold tracking-tight">Deals</h1>
        <p className="text-ink-2 mt-2">What you got, what they asked, what you paid.</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <div className="card p-4"><div className="label">Deals</div><div className="mono text-3xl font-semibold mt-1">{t.deals}<span className="text-base text-ink-3 font-normal"> / {t.goal}</span></div></div>
        <div className="card p-4"><div className="label">Committed</div><div className="mono text-3xl font-semibold mt-1">{money(t.used)}</div><div className="text-xs text-ink-3">of {money(t.budget)}</div></div>
        <div className="card p-4"><div className="label">Saved vs asks</div><div className={`mono text-3xl font-semibold mt-1 ${t.saved > 0 ? "text-accent" : ""}`}>{money(t.saved)}</div></div>
        <div className="card p-4"><div className="label">In progress</div><div className="mono text-3xl font-semibold mt-1">{d.in_progress}</div><div className="text-xs text-ink-3">campaigns</div></div>
      </div>
      {d.deals.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="serif text-2xl">No deals yet.</div>
          <p className="text-ink-2 mt-2">{d.in_progress > 0 ? `${d.in_progress} ${d.in_progress === 1 ? "campaign is" : "campaigns are"} still working. Deals appear here the moment terms are agreed.` : "Start a campaign and the agent will negotiate the first one."}</p>
          {d.in_progress === 0 && <Link href="/setup" className="btn mt-5">Start a campaign</Link>}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left label border-b border-rule"><th className="p-3 font-semibold">Publication</th><th className="p-3 font-semibold">Type</th><th className="p-3 font-semibold text-right">They asked</th><th className="p-3 font-semibold text-right">You pay</th><th className="p-3 font-semibold text-right">Saved</th><th className="p-3 font-semibold">Status</th><th className="p-3 font-semibold">Agreed</th></tr></thead>
            <tbody>
              {d.deals.map((x) => { const ask = x.original_ask ?? null, paid = x.agreed_price ?? 0, saved = ask != null ? Math.max(0, ask - paid) : null; return (
                <tr key={x.id} className="border-b border-rule last:border-0">
                  <td className="p-3"><div className="font-medium">{x.publication ?? x.domain_host}</div><Link href={`/campaigns/${x.campaign.id}`} className="text-xs text-ink-3 hover:text-ink">{x.campaign.name}{x.campaign.demo_mode ? " · demo" : ""}</Link></td>
                  <td className="p-3 text-ink-2">{x.terms?.placement_type ?? "inclusion"}</td>
                  <td className="p-3 text-right mono">{ask != null ? money(ask, x.currency) : <span className="text-ink-3">—</span>}</td>
                  <td className="p-3 text-right mono font-semibold">{paid === 0 ? "free" : money(paid, x.currency)}</td>
                  <td className={`p-3 text-right mono ${saved ? "text-accent" : "text-ink-3"}`}>{saved != null ? (saved > 0 ? money(saved, x.currency) : "—") : "—"}</td>
                  <td className="p-3"><span className={`chip ${x.status === "live" || x.status === "closed" ? "chip-accent" : ""}`}>{STATUS[x.status] ?? x.status}</span></td>
                  <td className="p-3 text-ink-3 mono">{ago(x.agreed_at)}</td>
                </tr>); })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
