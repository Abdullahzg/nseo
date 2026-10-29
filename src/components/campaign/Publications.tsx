"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProspectRow } from "@/app/api/campaigns/[id]/prospects/route";
import { downloadCsv } from "@/lib/ui/csv";

// Every publication the campaign looked at, what it decided, and why — one row each, expandable.
// This is the list behind the numbers: found / rejected / qualified / emailed / replied / deal.

const STAGE_ORDER = ["deal", "negotiating", "needs_you", "replied", "emailed", "ready", "qualified", "found", "closed", "rejected"];
const STAGE_CHIP: Record<string, string> = { deal: "chip-accent", needs_you: "chip-attention", rejected: "", closed: "" };

export function Publications({ campaignId, refreshKey }: { campaignId: string; refreshKey: number }) {
  const [rows, setRows] = useState<ProspectRow[] | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/campaigns/${campaignId}/prospects`, { cache: "no-store" });
    if (r.ok) setRows((await r.json()).prospects ?? []);
  }, [campaignId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (!rows) return <div className="skeleton h-40" />;
  if (rows.length === 0) return <div className="card p-6 text-sm text-ink-2">Nothing found yet. The Scout runs on the first step.</div>;
  const stages = STAGE_ORDER.filter((st) => rows.some((r) => r.stage === st));
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => (filter === "all" || r.stage === filter) && (!needle || [r.host, r.title, r.why, r.editor?.name, r.editor?.email, r.email?.subject].some((v) => (v ?? "").toLowerCase().includes(needle)))).sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  const exportCsv = () => downloadCsv("nseo-publications.csv", rows.map((r) => ({ publication: r.host, url: r.url ?? "", title: r.title ?? "", stage: r.stage_label, relevance: r.relevance ?? "", dr: r.dr ?? "", score: r.score ?? "", page_type: r.page_type ?? "", verdict: r.why ?? "", editor: r.editor?.name ?? "", editor_email: r.editor?.email ?? "", editor_source: r.editor?.source ?? "", email_subject: r.email?.subject ?? "", email_status: r.email?.status ?? "", reply: r.email?.reply ?? "", thread: r.email?.negotiation_status ?? "", deal_agreed: r.deal?.agreed ?? "", deal_asked: r.deal?.asked ?? "" })));
  const n = (st: string) => rows.filter((r) => r.stage === st).length;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <h2 className="label">Every publication it looked at <span className="font-normal normal-case text-ink-3">({rows.length})</span></h2>
        <span className="text-xs text-ink-3">Tap a row for the verdict, the editor, the email and the reply.</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <button type="button" className={`chip ${filter === "all" ? "bg-ink text-paper border-ink" : "hover:bg-paper-2"}`} onClick={() => setFilter("all")}>all {rows.length}</button>
        {stages.map((st) => <button key={st} type="button" className={`chip ${filter === st ? "bg-ink text-paper border-ink" : "hover:bg-paper-2"}`} onClick={() => setFilter(st)}>{st.replace("_", " ")} {n(st)}</button>)}
        <input className="field !h-8 !w-56 !text-sm ml-auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder="find a publication, editor, word…" aria-label="Filter publications" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv}>Download CSV</button>
      </div>
      {shown.length === 0 && <div className="card p-6 text-sm text-ink-2">Nothing matches.</div>}
      <div className="card divide-y divide-rule">
        {shown.map((r) => {
          const isOpen = openId === r.id;
          return (
            <div key={r.id} className="p-3 sm:p-4">
              <button type="button" className="w-full text-left grid gap-x-3 gap-y-1 grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_auto] items-start rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => setOpenId(isOpen ? null : r.id)} aria-expanded={isOpen}>
                <div className="min-w-0">
                  <div className="font-medium break-words">{r.host}{r.synthetic && <span className="chip ml-2 !text-[10px] align-middle">stand-in site</span>}</div>
                  <div className="text-xs text-ink-3 break-words">{r.title ?? r.url ?? ""}</div>
                </div>
                <div className="min-w-0 text-sm text-ink-2 hidden sm:block">{r.why ?? (r.stage === "found" ? "Not read yet" : "")}</div>
                <div className="flex items-center gap-2 justify-end">
                  {r.deal && <span className="mono text-sm text-accent font-semibold">${r.deal.agreed}</span>}
                  {r.score != null && r.stage !== "rejected" && <span className="mono text-xs text-ink-3" title={r.score_basis === "relevance_only" ? "scored on topical fit, read from the page" : "topical fit + domain authority"}>{r.score}</span>}
                  <span className={`chip ${STAGE_CHIP[r.stage] ?? ""}`}>{r.stage.replace("_", " ")}</span>
                  <span aria-hidden="true" className={`text-ink-3 text-xs inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
                </div>
              </button>
              {isOpen && (
                <div className="mt-3 grid gap-4 sm:grid-cols-2 fade-in text-sm">
                  <div className="space-y-2">
                    <div><div className="label">The page</div>
                      {r.synthetic ? <span className="break-all">{r.url} <span className="text-xs text-ink-3">(a demo publication; this address does not exist)</span></span> : r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="text-model underline break-all">{r.url}</a> : <span className="text-ink-3">no URL</span>}
                      <div className="text-xs text-ink-3 mt-0.5">Found via {r.source === "seed" ? "your list" : r.source === "demo-fixture" ? "the built-in publication list" : r.source.replace("websearch:", "web search: ")}{r.page_type ? ` · read as ${r.page_type.replace(/_/g, " ")}` : ""}</div>
                    </div>
                    <div><div className="label">The verdict — {r.stage_label}</div>
                      {r.checks.length ? (
                        <ul className="mt-1 space-y-0.5">
                          {r.checks.map((c) => <li key={c.label} className="flex items-center gap-2"><span className={`inline-block w-2 h-2 rounded-full ${c.state === "pass" ? "bg-accent" : c.state === "fail" ? "bg-danger" : "bg-ink-3"}`} />{c.label} <span className="text-ink-3 text-xs">{c.state}</span></li>)}
                        </ul>
                      ) : <div className="text-ink-3">Not evaluated yet.</div>}
                      {r.why && <div className="mt-1.5 text-ink-2">{r.why}</div>}
                      <div className="text-xs text-ink-3 mt-1 mono">{r.relevance != null ? `relevance ${r.relevance}/100` : ""}{r.dr != null ? ` · DR ${r.dr} (${r.dr_source})` : ""}{r.ceiling != null ? ` · ceiling $${r.ceiling}` : ""}</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div><div className="label">The editor</div>
                      {r.editor ? <div>{r.editor.name ?? "Editor"} <span className="mono text-xs text-ink-3">{r.editor.email}</span><div className="text-xs text-ink-3">{r.editor.source === "demo-simulated" ? "stand-in editor — no real mailbox" : r.editor.source === "provided" ? "address you gave at setup" : `found via ${r.editor.source}`}</div></div>
                        : <div className="text-ink-3">{r.stage === "rejected" ? "Not looked for — the page was rejected." : r.contact_attempts > 0 ? `No verifiable address yet (${r.contact_attempts} of 3 attempts).` : "Not looked for yet."}</div>}
                    </div>
                    <div><div className="label">The conversation</div>
                      {r.email ? (
                        <div>
                          <div>“{r.email.subject}” <span className="text-xs text-ink-3">· {r.email.status}{r.email.sent_at ? "" : " (queued)"}</span></div>
                          {r.email.reply ? <div className="mt-1 text-ink-2">Reply: “{r.email.reply.replace(/\s+/g, " ").slice(0, 160)}{r.email.reply.length > 160 ? "…" : ""}”</div> : <div className="text-ink-3 text-xs mt-1">No reply yet.</div>}
                          {r.email.negotiation_status && <div className="text-xs text-ink-3 mt-1">Thread: {r.email.negotiation_status.replace("_", " ")}{r.email.intervention_type ? ` (${r.email.intervention_type.replace(/_/g, " ")})` : ""}</div>}
                          {r.deal && <div className="mt-1 text-accent font-medium">Deal at ${r.deal.agreed}{r.deal.asked != null && r.deal.asked > r.deal.agreed ? ` — they asked $${r.deal.asked}, saved $${r.deal.asked - r.deal.agreed}` : ""}</div>}
                        </div>
                      ) : <div className="text-ink-3">{r.editor ? "Email not written yet." : "—"}</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="text-xs text-ink-3 mt-2">* score is relevance only: authority (DR) could not be verified, so it was never invented.</div>
    </section>
  );
}
