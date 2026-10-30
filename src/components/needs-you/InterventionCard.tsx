"use client";

import { useState } from "react";
import { Face } from "@/components/ui/Face";
import Link from "next/link";
import { ago, INTERVENTION_LABEL } from "@/lib/ui/format";
import { useFocus } from "@/lib/ui/focus";

export interface Intervention {
  id: string; campaign_id: string; anchor_email_id?: string | null; type: string; editor_quote: string | null; agent_plan: string | null; agent_needs: string | null; assistable: boolean; status: string; created_at: string;
  draft?: string | null;
  thread?: { from: "us" | "them"; body: string; at: string | null }[];
  campaign: { id: string; name: string; demo_mode: boolean };
  prospect?: { contact_name: string | null; domain_host: string } | null;
}

export function InterventionCard({ iv, onDone }: { iv: Intervention; onDone: (id: string) => void }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState<"answer" | "dismiss" | "take_over" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const thread = iv.thread ?? [];
  const hidden = showAll ? 0 : Math.max(0, thread.length - 2);
  const shown = thread.slice(hidden);
  const editorName = iv.prospect?.contact_name ?? "The editor";
  const { glow } = useFocus(iv.anchor_email_id ?? null);

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
    <article className={`card p-5 fade-in ${glow ? "glow" : ""}`} data-focus={iv.anchor_email_id ?? undefined}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <span className="chip chip-attention">{INTERVENTION_LABEL[iv.type] ?? iv.type}</span>
        <Link href={`/campaigns/${iv.campaign_id}`} className="hover:text-ink">{iv.campaign.name}</Link>
        {iv.campaign.demo_mode && <span>· no email sent</span>}
        <span className="ml-auto mono">{ago(iv.created_at)}</span>
      </div>
      {iv.editor_quote && (
        <blockquote className="mt-4 flex items-start gap-3"><Face kind="editor" seed={`${iv.prospect?.contact_name ?? "editor"}@${iv.prospect?.domain_host ?? ""}`} size={44} className="rounded-full mt-1" /><div className="border-l-2 border-rule pl-4 serif text-[17px] leading-relaxed flex-1 min-w-0">“{iv.editor_quote}”<div className="text-xs text-ink-3 mt-1 font-sans">— {iv.prospect?.contact_name ?? "the editor"}{iv.prospect?.domain_host ? `, ${iv.prospect.domain_host}` : ""}</div></div></blockquote>
      )}
      {thread.length > 0 && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div className="label">The conversation so far <span className="font-normal normal-case text-ink-3">· {thread.length} message{thread.length === 1 ? "" : "s"}</span></div>
            <Link href={`/campaigns/${iv.campaign_id}?tab=conversations${iv.anchor_email_id ? `&focus=${iv.anchor_email_id}` : ""}`} className="text-xs text-model underline">Open in Conversations →</Link>
          </div>
          {hidden > 0 && <button type="button" className="mt-2 text-xs text-ink-2 underline" onClick={() => setShowAll(true)}>Show {hidden} earlier message{hidden === 1 ? "" : "s"}</button>}
          <div className="mt-2 space-y-2">
            {shown.map((m, i) => (
              <div key={hidden + i} className={`rounded-lg p-3 text-sm whitespace-pre-wrap break-words ${m.from === "us" ? "bg-paper-2" : "bg-model-soft/60"}`}>
                <div className="label mb-1">{m.from === "us" ? "The agent wrote" : `${editorName} replied`}</div>
                {m.body}
              </div>
            ))}
          </div>
        </div>
      )}
      {iv.draft && (
        <div className="mt-4 rounded-lg border border-attention-soft bg-attention-soft/30 p-3 text-sm">
          <div className="label mb-1 text-attention">What the agent wanted to send — held back</div>
          <div className="whitespace-pre-wrap break-words">{iv.draft}</div>
          <div className="text-xs text-ink-3 mt-2">Code stopped it: an email-only agent must not promise a file, a call or a link. Your line below replaces the promise; the agent rewrites the reply around it.</div>
        </div>
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
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => send("take_over")} title="The agent stops writing to this editor. You continue from your own inbox.">{busy === "take_over" ? "…" : "I'll handle it myself"}</button>
            {!confirmDismiss ? (
              <button className="btn btn-ghost" disabled={!!busy} onClick={() => setConfirmDismiss(true)}>Dismiss</button>
            ) : (
              <span className="inline-flex items-center gap-2 text-sm"><span className="text-ink-2">Close this thread? The editor won't hear back.</span><button className="btn btn-sm" disabled={!!busy} onClick={() => send("dismiss")}>{busy === "dismiss" ? "…" : "Yes, close it"}</button><button className="btn btn-ghost btn-sm" onClick={() => setConfirmDismiss(false)}>Keep</button></span>
            )}
          </div>
          <div className="mt-2 text-xs text-ink-3"><b className="font-medium text-ink-2">Answer &amp; resume</b>: the agent writes the next email with your line as context, and keeps going. <b className="font-medium text-ink-2">I'll handle it myself</b>: the agent stops writing to this editor; you continue from your inbox. <b className="font-medium text-ink-2">Dismiss</b>: close the thread; the editor won't hear back.</div>
        </div>
      )}
    </article>
  );
}
