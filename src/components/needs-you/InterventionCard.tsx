"use client";

import { useState } from "react";
import Link from "next/link";
import { ago, INTERVENTION_LABEL } from "@/lib/ui/format";

export interface Intervention {
  id: string; campaign_id: string; type: string; editor_quote: string | null; agent_plan: string | null; agent_needs: string | null; assistable: boolean; status: string; created_at: string;
  campaign: { id: string; name: string; demo_mode: boolean };
}

export function InterventionCard({ iv, onDone }: { iv: Intervention; onDone: (id: string) => void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState<"answer" | "dismiss" | "take_over" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function send(kind: "answer" | "dismiss" | "take_over") {
    setBusy(kind); setError(null);
    try {
      const body = kind === "answer" ? { id: iv.id, answer } : kind === "dismiss" ? { id: iv.id, dismiss: true } : { id: iv.id, take_over: true };
      const r = await fetch("/api/interventions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not send.");
      if (kind === "answer") {
        const res = d.result;
        setResult(res?.draft?.body ? `Sent to the editor:\n\n${res.draft.body}` : res?.persistedAs === "needs_human" ? "The agent still needs you on this one — a new card will appear." : "Resumed.");
        setTimeout(() => onDone(iv.id), 2500);
      } else onDone(iv.id);
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  return (
    <article className="card p-5 fade-in">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span className="chip chip-attention">{INTERVENTION_LABEL[iv.type] ?? iv.type}</span>
        <Link href={`/campaigns/${iv.campaign_id}`} className="hover:text-ink">{iv.campaign.name}</Link>
        {iv.campaign.demo_mode && <span>· demo</span>}
        <span className="ml-auto mono">{ago(iv.created_at)}</span>
      </div>
      {iv.editor_quote && (
        <blockquote className="mt-4 border-l-2 border-rule pl-4 serif text-[17px] leading-relaxed">“{iv.editor_quote}”<div className="text-xs text-ink-3 mt-1 font-sans">— the editor</div></blockquote>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
        <div><div className="label mb-1">What the agent wants to do</div><p>{iv.agent_plan}</p></div>
        <div><div className="label mb-1">What it needs from you</div><p>{iv.agent_needs}</p></div>
      </div>
      {result ? (
        <div className="mt-4 rounded-xl bg-accent-soft/60 p-4 text-sm whitespace-pre-wrap">{result}</div>
      ) : (
        <div className="mt-4">
          <textarea className="field" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={iv.type === "budget_exception" ? "e.g. Approve 280" : iv.type === "sync_contact" || iv.type === "scheduling" ? "e.g. Thursday 3–5pm CET works, or tell them email is easier for us" : "Your answer, in a line or two"} />
          {error && <div className="text-sm text-danger mt-2">{error}</div>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn" disabled={!!busy || answer.trim().length < 2} onClick={() => send("answer")}>{busy === "answer" ? "Resuming…" : "Answer & resume"}</button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => send("take_over")} title="The agent leaves this thread to you">{busy === "take_over" ? "…" : "Take over thread"}</button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => send("dismiss")}>{busy === "dismiss" ? "…" : "Dismiss"}</button>
          </div>
        </div>
      )}
    </article>
  );
}
