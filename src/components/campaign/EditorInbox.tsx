"use client";

import { useCallback, useEffect, useState } from "react";
import { Face } from "@/components/ui/Face";
import { focusParam, scrollToFocus } from "@/lib/ui/focus";
import { Expand } from "@/components/ui/motion";

// The simulated inbox of a demo campaign. Every thread the agent has emailed, both directions —
// and a box where YOU write the editor's next reply. Scripted replies keep the hands-off demo
// moving; the moment you type, that editor is yours and the agent has to deal with whatever you
// said. Nothing you write can have been anticipated, which is the point.

export interface ThreadView {
  id: string; host: string; editor: string | null; subject: string; status: string | null; persona: string | null;
  messages: { from: "us" | "them"; body: string; at: string | null }[];
  open: boolean;
  state: "agent_writing" | "waiting_editor" | "editor_replied" | "needs_you" | "you_answered" | "deal" | "declined" | "closed" | "taken_over";
  state_label: string;
  intervention: { type: string; status: string; answer: string | null } | null;
  pending: { id: string; subject: string; body: string } | null;
}

function PendingDraft({ campaignId, t, onDone }: { campaignId: string; t: ThreadView; onDone: () => void }) {
  const [subject, setSubject] = useState(t.pending!.subject);
  const [body, setBody] = useState(t.pending!.body);
  const [busy, setBusy] = useState<"approve" | "discard" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function act(action: "approve" | "discard") {
    if (action === "discard" && !confirm(`Discard the email to ${t.editor ?? "this editor"}? The publication will be closed.`)) return;
    setBusy(action); setErr(null);
    const r = await fetch(`/api/campaigns/${campaignId}/emails`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.pending!.id, action, subject, body }) });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setErr(d.error ?? "Failed."); return; }
    onDone();
  }
  return (
    <div className="rounded-lg border border-attention-soft bg-attention-soft/30 p-3 space-y-2">
      <div className="label text-attention">Waiting for your approval — nothing has been sent</div>
      <input className="field !h-9 !text-sm" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
      <textarea className="field !h-auto py-2 text-sm" rows={7} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Email body" />
      {err && <div className="text-sm text-danger">{err}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={!!busy || body.trim().length < 20} onClick={() => act("approve")}>{busy === "approve" ? "Approving…" : "Approve & send"}</button>
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => act("discard")}>{busy === "discard" ? "…" : "Discard"}</button>
        <span className="text-xs text-ink-3">Approved emails go out from your Gmail on the next scheduler pass inside your sending hours (Settings).</span>
      </div>
    </div>
  );
}

function StateDot({ state }: { state: ThreadView["state"] }) {
  if (state === "agent_writing") return <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-rule border-t-[#76b900] animate-spin shrink-0" aria-label="working" />;
  const color = state === "needs_you" ? "bg-attention" : state === "deal" ? "bg-accent" : state === "editor_replied" ? "bg-model" : state === "you_answered" ? "bg-accent" : state === "waiting_editor" ? "bg-ink-3 live-dot" : "bg-rule";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${color}`} />;
}

const SUGGESTIONS: { label: string; text: string }[] = [
  { label: "Name a high price", text: "Thanks for reaching out. We do sponsored inclusions in that piece at $280 for a permanent placement. Let me know if that works." },
  { label: "Accept cheaply", text: "Sure, we can add you. Our rate for an inclusion is $120. Send over a short blurb and a link." },
  { label: "Ask for a call", text: "Happy to chat about this. Could we jump on a quick 15-minute call this week?" },
  { label: "Ask about traffic", text: "Before I quote anything: what monthly traffic does your site get, and are you expecting a do-follow link?" },
  { label: "Want an NDA", text: "We'd be open to it, but our legal team needs an NDA signed before we discuss terms." },
  { label: "Decline", text: "Thanks, but we don't take paid or sponsored placements in our editorial content." },
  { label: "Out of office", text: "Automatic reply: I am out of the office until next Monday with limited access to email." },
];

const STATUS_LABEL: Record<string, string> = { agreed: "deal", declined: "declined", needs_human: "needs you", negotiating: "negotiating", stalled: "wound down", withdrawn: "closed", handoff: "you took over" };

export function EditorInbox({ campaignId, active, onChanged }: { campaignId: string; active: boolean; onChanged: () => void }) {
  const [demo, setDemo] = useState(true);
  const [threads, setThreads] = useState<ThreadView[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [glowId, setGlowId] = useState<string | null>(null);
  // A pop-up or a card can point at one thread: it opens, scrolls into view and glows.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const hit = (id: string) => { setOpenId(id); setGlowId(id); scrollToFocus(id); if (t) clearTimeout(t); t = setTimeout(() => setGlowId(null), 2600); };
    const f = focusParam(); if (f) hit(f);
    const on = (e: Event) => hit(String((e as CustomEvent).detail));
    window.addEventListener("nseo:focus", on);
    return () => { window.removeEventListener("nseo:focus", on); if (t) clearTimeout(t); };
  }, []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/campaigns/${campaignId}/threads`, { cache: "no-store" });
    if (r.ok) { const d = await r.json(); setThreads(d.threads ?? []); setDemo(d.demo !== false); }
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 10_000); return () => clearInterval(t); }, [load]);

  async function send(threadId: string) {
    if (!text.trim()) return;
    setBusy(true); setResult(null);
    try {
      const r = await fetch(`/api/campaigns/${campaignId}/threads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thread_id: threadId, text }) });
      const d = await r.json();
      if (!r.ok) { setResult({ ok: false, text: d.error ?? "Could not send." }); return; }
      const res = d.result ?? {};
      const what = res.persistedAs === "needs_human" ? `The agent parked this for you (${String(res.interventionType ?? "").replace(/_/g, " ")}) — see Needs you.`
        : res.statusHint === "agreed" ? `Deal — the agent accepted${res.theirPrice != null ? ` $${res.theirPrice}` : ""}.`
        : res.statusHint === "declined" ? "The agent closed the thread politely."
        : res.persistedAs === "skipped" ? "The agent read it as an autoresponder and is still waiting for a human."
        : res.body ? "The agent replied — read it below." : `The agent did: ${res.persistedAs}${res.error ? ` (${res.error})` : ""}`;
      setResult({ ok: true, text: what });
      setText(""); setThreads(d.threads ?? null); onChanged();
    } catch (e: any) { setResult({ ok: false, text: e?.message ?? "Failed." }); } finally { setBusy(false); }
  }

  if (!threads) return <div className="space-y-3" aria-busy="true"><div className="skeleton h-5 w-1/3" /><div className="skeleton h-24" /><div className="skeleton h-24" /></div>;
  if (threads.length === 0) return null;
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <h2 className="label">Conversations <span className="font-normal normal-case text-ink-3">{demo ? "(simulated inbox)" : "(from your Gmail)"}</span></h2>
        <span className="text-xs text-ink-3">{!demo ? "Every email both ways. Replies are read from your inbox over IMAP each scheduler round." : active ? "Each editor's replies are written by the model playing that editor (nothing is sent). Or open a thread and reply as the editor yourself — the agent answers you live." : "The campaign has finished; the threads are read-only."}</span>
      </div>
      <div className="card divide-y divide-rule">
        {threads.map((t) => {
          const isOpen = openId === t.id;
          const last = t.messages[t.messages.length - 1];
          return (
            <div key={t.id} className={`p-4 ${glowId === t.id ? "glow" : ""}`} data-focus={t.id}>
              <button type="button" className="w-full text-left flex items-start gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => { setOpenId(isOpen ? null : t.id); setResult(null); }} aria-expanded={isOpen}>
                <Face kind="editor" seed={`${t.editor ?? "editor"}@${t.host}`} size={40} className="rounded-full mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{t.editor ?? "Editor"}</span>
                    <span className="text-ink-3 text-sm">at {t.host}</span>
                    {t.status && <span className={`chip ${t.status === "agreed" ? "chip-accent" : t.status === "needs_human" ? "chip-attention" : ""}`}>{STATUS_LABEL[t.status] ?? t.status}</span>}
                    {t.persona === "manual" && <span className="chip">you play this editor</span>}
                  </div>
                  <div className={`mt-1.5 flex items-center gap-2 text-sm ${t.state === "needs_you" ? "text-attention" : t.state === "agent_writing" ? "text-ink" : "text-ink-2"}`}><StateDot state={t.state} /><span>{t.state_label}</span></div>
                  {!isOpen && last && <div className="text-sm text-ink-3 mt-1 break-words">{last.from === "us" ? "Agent: " : `${t.editor ?? "Editor"}: `}{last.body.replace(/\s+/g, " ").slice(0, 160)}{last.body.length > 160 ? "…" : ""}</div>}
                </div>
                <span className="text-xs text-ink-3 shrink-0 inline-flex items-center gap-1.5">{`${t.messages.length} message${t.messages.length === 1 ? "" : "s"}`}<span aria-hidden="true" className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span></span>
              </button>
              {isOpen && (
                <div className="mt-3 space-y-3">
                  <div className="text-sm text-ink-3">Subject: {t.subject}</div>
                  {t.pending && <PendingDraft campaignId={campaignId} t={t} onDone={() => { load(); onChanged(); }} />}
                  {t.intervention && <div className={`text-sm rounded-lg p-3 ${t.intervention.status === "open" ? "bg-attention-soft/60 text-attention" : "bg-accent-soft/60 text-ink-2"}`}>{t.intervention.status === "open" ? `Parked for you: ${t.intervention.type.replace(/_/g, " ")}. Answer it on the Needs-you screen and the agent resumes here.` : `You answered (${t.intervention.type.replace(/_/g, " ")}): “${t.intervention.answer ?? ""}” — the agent used it in its next email.`}</div>}
                  {t.messages.map((m, i) => (
                    <div key={i} className={`rounded-lg p-3 text-sm whitespace-pre-wrap ${m.from === "us" ? "bg-paper-2" : "bg-model-soft/60"}`}>
                      <div className="label mb-1">{m.from === "us" ? "The agent wrote" : `${t.editor ?? "The editor"} replied`}</div>
                      {m.body}
                    </div>
                  ))}
                  {demo && active && t.open ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {SUGGESTIONS.map((s) => <button key={s.label} type="button" className="chip hover:bg-paper-2" onClick={() => setText(s.text)}>{s.label}</button>)}
                      </div>
                      <textarea className="field !h-auto min-h-20 py-2" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Reply as ${t.editor ?? "the editor"} — say anything; the agent has to handle it.`} />
                      <div className="flex items-center gap-3 flex-wrap">
                        <button type="button" className="btn" onClick={() => send(t.id)} disabled={busy || !text.trim()}>{busy ? "The agent is reading it…" : "Send as the editor"}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-ink-3">{t.pending ? "" : t.status === "needs_human" ? "Parked on the Needs-you screen: answer it there and the agent resumes this thread." : !t.open ? "This thread is closed." : demo ? "" : "Waiting for the editor. The Inbox agent checks your Gmail every scheduler round."}</div>
                  )}
                  {result && <div className={`text-sm ${result.ok ? "text-accent" : "text-danger"}`}>{result.text}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
