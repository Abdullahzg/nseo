"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { money, ago } from "@/lib/ui/format";
import { downloadCsv } from "@/lib/ui/csv";

interface Deal { id: string; domain_host: string; publication: string | null; original_ask: number | null; agreed_price: number | null; currency: string; status: string; agreed_at: string | null; terms: { placement_type?: string; blurb?: string; anchor_text?: string; live_url?: string; paid_at?: string }; campaign: { id: string; name: string; demo_mode: boolean } }
interface Data { deals: Deal[]; totals: { deals: number; goal: number; budget: number; used: number; saved: number }; in_progress: number }

const STATUS: Record<string, string> = { terms_agreed: "Terms agreed", awaiting_content: "Blurb sent", placement_pending: "Placement pending", live: "Live", closed: "Paid", cancelled: "Cancelled" };
const NEXT_LABEL: Record<string, string> = { terms_agreed: "I sent the blurb", awaiting_content: "Placement is pending", placement_pending: "It's live", live: "I paid" };

function DealRow({ x, onChange }: { x: Deal; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState(x.terms?.live_url ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const ask = x.original_ask ?? null, paid = x.agreed_price ?? 0, saved = ask != null ? Math.max(0, ask - paid) : null;
  async function advance() {
    setBusy("advance"); setMsg(null);
    const r = await fetch(`/api/deals/${x.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "advance", live_url: liveUrl }) });
    const d = await r.json().catch(() => ({})); setBusy(null);
    if (!r.ok) { setMsg(d.error ?? "Failed."); return; }
    onChange();
  }
  async function blurb() {
    setBusy("blurb"); setMsg(null);
    const r = await fetch(`/api/deals/${x.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "blurb" }) });
    const d = await r.json().catch(() => ({})); setBusy(null);
    if (!r.ok) { setMsg(d.error ?? "Failed."); return; }
    onChange();
  }
  return (
    <>
      <tr className="border-b border-rule last:border-0 cursor-pointer hover:bg-paper-2/40" onClick={() => setOpen(!open)}>
        <td className="p-3"><div className="font-medium">{x.publication ?? x.domain_host}</div><Link href={`/campaigns/${x.campaign.id}?tab=conversations`} className="text-xs text-ink-3 hover:text-ink" onClick={(e) => e.stopPropagation()}>{x.campaign.name}{x.campaign.demo_mode ? " · demo" : ""}</Link></td>
        <td className="p-3 text-ink-2">{x.terms?.placement_type ?? "inclusion"}</td>
        <td className="p-3 text-right mono">{ask != null ? money(ask, x.currency) : <span className="text-ink-3">—</span>}</td>
        <td className="p-3 text-right mono font-semibold">{paid === 0 ? "free" : money(paid, x.currency)}</td>
        <td className={`p-3 text-right mono ${saved ? "text-accent" : "text-ink-3"}`}>{saved != null ? (saved > 0 ? money(saved, x.currency) : "—") : "—"}</td>
        <td className="p-3"><span className={`chip ${x.status === "live" || x.status === "closed" ? "chip-accent" : ""}`}>{STATUS[x.status] ?? x.status}</span></td>
        <td className="p-3 text-ink-3 mono whitespace-nowrap">{ago(x.agreed_at)} <span aria-hidden="true" className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span></td>
      </tr>
      {open && (
        <tr className="border-b border-rule last:border-0 bg-paper-2/30"><td colSpan={7} className="p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="label">The blurb you owe them</div>
              {x.terms?.blurb ? (
                <div className="mt-1.5 text-sm"><p className="whitespace-pre-wrap">{x.terms.blurb}</p><div className="text-xs text-ink-3 mt-1">Anchor text: <b className="text-ink-2">{x.terms.anchor_text}</b> → {x.campaign.name}</div>
                  <div className="mt-2 flex gap-2"><button type="button" className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(`${x.terms.blurb}\n\nAnchor text: ${x.terms.anchor_text}`).then(() => setMsg("Copied."))}>Copy</button><button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={blurb}>{busy === "blurb" ? "Writing…" : "Rewrite"}</button></div></div>
              ) : <div className="mt-1.5 text-sm text-ink-2">Nothing drafted yet. <button type="button" className="btn btn-sm ml-1" disabled={!!busy} onClick={blurb}>{busy === "blurb" ? "Nano is writing…" : "Draft it for me"}</button></div>}
            </div>
            <div>
              <div className="label">Where it stands</div>
              <div className="mt-1.5 text-sm text-ink-2">{STATUS[x.status] ?? x.status}{x.terms?.live_url && <> · <a href={x.terms.live_url} target="_blank" rel="noreferrer" className="text-model underline break-all">{x.terms.live_url}</a></>}{x.terms?.paid_at && <> · paid {ago(x.terms.paid_at)}</>}</div>
              {x.status === "placement_pending" && <input className="field !h-9 !text-sm mt-2" value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} placeholder="URL of the live placement (optional)" />}
              {NEXT_LABEL[x.status] && <div className="mt-2"><button type="button" className="btn btn-sm" disabled={!!busy} onClick={advance}>{busy === "advance" ? "…" : NEXT_LABEL[x.status]}</button></div>}
              {msg && <div className="text-xs mt-2 text-ink-2">{msg}</div>}
            </div>
          </div>
        </td></tr>
      )}
    </>
  );
}

export default function DealsPage() {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => fetch("/api/deals", { cache: "no-store" }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error); setD(await r.json()); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="card border-danger-soft bg-danger-soft/40 p-4 text-sm"><b className="text-danger">Could not load.</b> {error}</div>;
  if (!d) return <div className="space-y-3" aria-busy="true"><div className="skeleton h-24" /><div className="skeleton h-40" /></div>;
  const t = d.totals;
  return (
    <div>
      <div className="mb-6">
        <h1 className="serif text-3xl font-semibold tracking-tight">Deals</h1>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <p className="text-ink-2 mt-2">What you got, what they asked, what you paid. Click a deal to draft the blurb you owe them and to move it along — blurb sent, live, paid.</p>
          {d.deals.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadCsv("nseo-deals.csv", d.deals.map((x) => ({ publication: x.publication ?? x.domain_host, campaign: x.campaign.name, demo: x.campaign.demo_mode ? "yes" : "no", they_asked: x.original_ask ?? "", you_pay: x.agreed_price ?? "", currency: x.currency, status: STATUS[x.status] ?? x.status, live_url: x.terms?.live_url ?? "", agreed_at: x.agreed_at ?? "", blurb: x.terms?.blurb ?? "" })))}>Download CSV</button>}
        </div>
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
              {d.deals.map((x) => <DealRow key={x.id} x={x} onChange={load} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
