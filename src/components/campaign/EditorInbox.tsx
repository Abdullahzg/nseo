"use client";

import { useCallback, useEffect, useState } from "react";

// The simulated inbox of a demo campaign. Every thread the agent has emailed, both directions —
// and a box where YOU write the editor's next reply. Scripted replies keep the hands-off demo
// moving; the moment you type, that editor is yours and the agent has to deal with whatever you
// said. Nothing you write can have been anticipated, which is the point.

export interface ThreadView {
  id: string; host: string; editor: string | null; subject: string; status: string | null; persona: string | null;
  messages: { from: "us" | "them"; body: string; at: string | null }[];
  open: boolean;
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
  const [threads, setThreads] = useState<ThreadView[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/campaigns/${campaignId}/threads`, { cache: "no-store" });
    if (r.ok) setThreads((await r.json()).threads ?? []);
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

  if (!threads) return null;
  if (threads.length === 0) return null;
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <h2 className="label">The editors' inbox <span className="font-normal normal-case text-ink-3">(simulated)</span></h2>
        <span className="text-xs text-ink-3">{active ? "Scripted editors reply on their own. Or open a thread and reply as the editor yourself — the agent answers you live." : "The campaign has finished; the threads are read-only."}</span>
      </div>
      <div className="card divide-y divide-rule">
        {threads.map((t) => {
          const isOpen = openId === t.id;
          const last = t.messages[t.messages.length - 1];
          return (
            <div key={t.id} className="p-4">
              <button type="button" className="w-full text-left flex items-start gap-3" onClick={() => { setOpenId(isOpen ? null : t.id); setResult(null); }} aria-expanded={isOpen}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{t.editor ?? "Editor"}</span>
                    <span className="text-ink-3 text-sm">at {t.host}</span>
                    {t.status && <span className={`chip ${t.status === "agreed" ? "chip-accent" : t.status === "needs_human" ? "chip-attention" : ""}`}>{STATUS_LABEL[t.status] ?? t.status}</span>}
                    {t.persona === "manual" && <span className="chip">you play this editor</span>}
                  </div>
                  {!isOpen && last && <div className="text-sm text-ink-2 mt-1 truncate">{last.from === "us" ? "Agent: " : "Editor: "}{last.body.replace(/\s+/g, " ").slice(0, 140)}</div>}
                </div>
                <span className="text-xs text-ink-3 shrink-0">{isOpen ? "close" : `${t.messages.length} message${t.messages.length === 1 ? "" : "s"}`}</span>
              </button>
              {isOpen && (
                <div className="mt-3 space-y-3">
                  <div className="text-sm text-ink-3">Subject: {t.subject}</div>
                  {t.messages.map((m, i) => (
                    <div key={i} className={`rounded-lg p-3 text-sm whitespace-pre-wrap ${m.from === "us" ? "bg-paper-2" : "bg-model-soft/60"}`}>
                      <div className="label mb-1">{m.from === "us" ? "The agent wrote" : `${t.editor ?? "The editor"} replied`}</div>
                      {m.body}
                    </div>
                  ))}
                  {active && t.open ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {SUGGESTIONS.map((s) => <button key={s.label} type="button" className="chip hover:bg-paper-2" onClick={() => setText(s.text)}>{s.label}</button>)}
                      </div>
                      <textarea className="field !h-auto min-h-20 py-2" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Reply as ${t.editor ?? "the editor"} — say anything; the agent has to handle it.`} />
                      <div className="flex items-center gap-3 flex-wrap">
                        <button type="button" className="btn" onClick={() => send(t.id)} disabled={busy || !text.trim()}>{busy ? "The agent is reading it…" : "Send as the editor"}</button>
                        {result && <span className={`text-sm ${result.ok ? "text-accent" : "text-danger"}`}>{result.text}</span>}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-ink-3">{t.status === "needs_human" ? "Parked on the Needs-you screen: answer it there and the agent resumes this thread." : "This thread is closed."}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
