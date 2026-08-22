"use client";

// The AI writer: a chat that produces a blog draft.
//
// The shape of this screen follows the workflow it drives, and the approval step is the reason it is
// a chat at all rather than a form. You brief it, it researches, it proposes an outline, and nothing
// gets written until you press Approve. That button is the only path past step 3 — the model has no
// tool that can advance it, which is enforced server-side, not by prompt.
//
// Streaming uses this app's existing SSE envelope and the same manual reader as the discovery
// pipeline on the dashboard, so there is one wire format in the codebase rather than two.
import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Bot, Plus, Loader2, Send, Check, FileText, Wrench, ListTree, AlertTriangle,
  CheckCircle2, Sparkles, ExternalLink, PencilLine, Trash2, ChevronUp, ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { WriterSession, WriterSessionSummary, WriterVoice, BlogDraft, WriterOutline } from "@/lib/db/queries";

interface DisplayMsg {
  role: "user" | "assistant"; kind: string; text?: string;
  name?: string; label?: string; detail?: string; state?: string;
}
interface Violation { gate: string; severity: string; detail: string }

/** Where this piece actually stands. Computed server-side so the UI never has to infer it. */
interface Status {
  phase: string;
  sections_written: number; sections_total: number;
  words: number; target_words: number | null;
  sources_found: number; real_questions_found: number;
  writer_status: string | null;
  usage: Record<string, number>;
}

/**
 * One line in the live activity log. A single replaced "Working…" line was the whole problem the
 * user reported: a five-minute turn looked identical to a hung one. Keeping the finished steps on
 * screen means you can see what it did, in order, and what it is doing right now.
 */
interface Activity { label: string; detail?: string; state: "running" | "done" | "error" }

/** How many times the client will reopen a request to finish machine-driven work. Each server
 *  request already runs up to 6 agent segments, so this is a ceiling on a pathological session, not a
 *  normal path. */
const MAX_AUTO_CONTINUE = 4;

/**
 * The three states a person actually cares about, derived from the phase.
 *
 * "Researching" and "Writing" are the tool's vocabulary; "waiting on you" versus "working" versus
 * "done" is the user's. Showing only the phase left it ambiguous whether the agent wanted something
 * or had quietly stopped.
 */
type Standing = "working" | "waiting" | "done" | "stopped";
function standingFor(phase: string, running: boolean): Standing {
  if (running) return "working";
  if (phase === "done") return "done";
  if (phase === "failed") return "stopped";
  return "waiting";      // gathering, outline_pending, and anything parked mid-flight
}

const STANDING_META: Record<Standing, { label: string; hint: string; cls: string; dot: string }> = {
  working:  { label: "Working",      hint: "No input needed, this can take a few minutes.", cls: "text-highlight-ink border-highlight/40 bg-highlight-soft", dot: "bg-primary" },
  waiting:  { label: "Your turn",    hint: "It is waiting on you.",                          cls: "text-warning border-warning/50 bg-warning/10",   dot: "bg-warning" },
  done:     { label: "Done",         hint: "The draft is written and checked.",              cls: "text-success border-success/40 bg-success/15", dot: "bg-success" },
  stopped:  { label: "Stopped",      hint: "This one needs a human.",                        cls: "text-destructive border-destructive/50 bg-destructive/10",         dot: "bg-destructive" },
};

const PHASE_LABEL: Record<string, string> = {
  gathering: "Gathering the brief",
  researching: "Researching",
  outline_pending: "Outline awaiting your approval",
  approved: "Approved, ready to write",
  writing: "Writing",
  validating: "Checking quality",
  done: "Done",
  failed: "Stopped",
};

export default function WriterPage() {
  const [sessions, setSessions] = useState<WriterSessionSummary[]>([]);
  const [voices, setVoices] = useState<WriterVoice[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [session, setSession] = useState<WriterSession | null>(null);
  const [draft, setDraft] = useState<BlogDraft | null>(null);
  const [messages, setMessages] = useState<DisplayMsg[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  /** Text streaming in for the in-flight assistant turn, rendered before it is persisted. */
  const [live, setLive] = useState("");
  const [activity, setActivity] = useState<Activity[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [qa, setQa] = useState<{ verdict: string; violations: Violation[]; repair_prompt: string | null } | null>(null);
  /** Set when the server reports a segment that changed nothing, so the UI can say so plainly
   *  instead of just going quiet. */
  const [stalled, setStalled] = useState<string | null>(null);
  /** A local copy of the outline while editing. Each section carries `from`: the index it held in the
   *  saved outline (-1 when newly added), which is how the server remaps source/link assignments after
   *  a reorder. `key` is a stable React key so re-rendering does not lose focus mid-typing. */
  const [draftOutline, setDraftOutline] = useState<
    { h1: string; search_intent: string; sections: Array<{ key: string; from: number; level: string; heading: string; target_words?: number }> } | null
  >(null);
  const editingOutline = draftOutline !== null;
  const [busy, setBusy] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/blog/writer").then((r) => r.json()).then((d) => { if (d?.ok) setSessions(d.sessions); }).catch(() => {});
    fetch("/api/blog/voices").then((r) => r.json()).then((d) => { if (d?.ok) setVoices(d.voices); }).catch(() => {});
  }, []);

  const load = useCallback(async (sid: string) => {
    const d = await fetch(`/api/blog/writer/${sid}`).then((r) => r.json()).catch(() => null);
    if (!d?.ok) { toast.error(d?.error ?? "Couldn't load that session."); return; }
    setSession(d.session); setDraft(d.draft); setMessages(d.messages); setStatus(d.status ?? null);
    setQa(d.draft?.writer_qa ? { verdict: d.draft.writer_status, violations: d.draft.writer_qa.violations ?? [], repair_prompt: null } : null);
  }, []);

  useEffect(() => { if (id) load(id); }, [id, load]);
  useEffect(() => {
    const t = setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    return () => clearTimeout(t);
  }, [messages, live, activity]);

  async function newSession(voiceId?: string) {
    setBusy("new");
    try {
      const d = await fetch("/api/blog/writer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_id: voiceId }),
      }).then((r) => r.json());
      if (!d?.ok) { toast.error(d?.error ?? "Couldn't start a session."); return; }
      setSessions((s) => [d.session, ...s]);
      setId(d.session.id);
      setMessages([]);
      // Kick it off immediately so the user lands on a question, not an empty box.
      void send(d.session.id, undefined);
    } finally { setBusy(null); }
  }

  /** Drive one turn and stream it. Same manual reader as the dashboard's pipeline stream. */
  async function send(sid: string, message: string | undefined, depth = 0) {
    setRunning(true); setLive(""); setStalled(null);
    if (depth === 0) setActivity([]);   // a continuation keeps the log it is continuing
    let needsMore = false;
    if (message) setMessages((m) => [...m, { role: "user", kind: "text", text: message }]);
    try {
      const res = await fetch(`/api/blog/writer/${sid}/turn`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const e = JSON.parse(line.slice(5));
            if (e.t === "text") { acc += e.text; setLive(acc); }
            else if (e.t === "tool_start") {
              setActivity((a) => [...a, { label: e.label ?? e.name, state: "running" }]);
            }
            else if (e.t === "tool_result") {
              // Close the newest running line rather than clearing the log. The result carries the
              // richer label (it has the tool's arguments, which tool_start does not).
              setActivity((a) => {
                const next = [...a];
                for (let i = next.length - 1; i >= 0; i--) {
                  if (next[i].state === "running") {
                    next[i] = {
                      label: e.label ?? next[i].label,
                      detail: e.detail,
                      state: e.is_error ? "error" : "done",
                    };
                    break;
                  }
                }
                return next;
              });
            }
            else if (e.t === "progress") {
              setStatus((s) => ({
                ...(s ?? EMPTY_STATUS),
                sections_written: e.sections_written,
                sections_total: e.sections_total,
                words: e.words,
                target_words: e.target_words ?? s?.target_words ?? null,
              }));
            }
            else if (e.t === "phase") setStatus((s) => (s ? { ...s, phase: e.phase } : s));
            // The machine is driving itself through research/writing. Mark the previous step finished
            // so the log reads as continuous progress rather than restarting.
            else if (e.t === "continuing") {
              setActivity((a) => a.map((x) => (x.state === "running" ? { ...x, state: "done" } : x)));
            }
            else if (e.t === "stalled") { setStalled(e.message); toast.warning(e.message); }
            else if (e.t === "done") { if (e.needs_continuation) needsMore = true; }
            else if (e.t === "error") toast.error(e.message);
          } catch { /* a partial line; the next chunk completes it */ }
        }
      }
    } catch (e: any) {
      toast.error(e?.message ?? "The turn failed.");
    } finally {
      setLive("");
      await load(sid);                       // rehydrate from the server's persisted state
      fetch("/api/blog/writer").then((r) => r.json()).then((d) => { if (d?.ok) setSessions(d.sessions); }).catch(() => {});

      // The server ran out of request budget mid-research or mid-writing. Open a fresh request and
      // carry on rather than leaving it parked with no conclusion — bounded so it cannot run away.
      if (needsMore && depth < MAX_AUTO_CONTINUE) {
        void send(sid, undefined, depth + 1);
        return;                              // stay in the running state across the handoff
      }
      setRunning(false);
      // The activity log is cleared, not kept: the rehydrated transcript contains the same steps as
      // persisted tool_use lines, so keeping both would show every step twice.
      setActivity([]);
    }
  }

  async function approve() {
    if (!id) return;
    setBusy("approve");
    try {
      const d = await fetch(`/api/blog/writer/${id}/approve`, { method: "POST" }).then((r) => r.json());
      if (!d?.ok) { toast.error(d?.error ?? "Couldn't approve."); return; }
      toast.success("Outline approved. Writing now.");
      await load(id);
      void send(id, undefined);   // approved phase: the next turn starts section 0
    } finally { setBusy(null); }
  }

  async function finalize() {
    if (!id) return;
    setBusy("finalize");
    try {
      const d = await fetch(`/api/blog/writer/${id}/finalize`, { method: "POST" }).then((r) => r.json());
      if (!d?.ok) { toast.error(d?.error ?? "Check failed."); return; }
      setQa({ verdict: d.verdict, violations: d.violations, repair_prompt: d.repair_prompt });
      await load(id);
      const n = (d.violations ?? []).filter((v: Violation) => v.severity !== "auto_fix").length;
      if (d.verdict === "ok") toast.success("Clean. Nothing to fix.");
      else if (d.verdict === "failed") toast.error("A source could not be verified. This one needs a human.");
      else toast.warning(`${n} thing${n === 1 ? "" : "s"} to look at.`);
    } finally { setBusy(null); }
  }

  async function sendRepair() {
    if (!id || !qa?.repair_prompt) return;
    const p = qa.repair_prompt;
    setQa({ ...qa, repair_prompt: null });
    await send(id, p);
    void finalize();
  }

  const outline = session?.outline as WriterOutline | null;
  // Prefer the live status object: during a turn it is ahead of `session`, which only refreshes when
  // the turn ends. Fall back to the session so a freshly-opened page still shows the right numbers.
  const phase = status?.phase ?? session?.phase ?? "gathering";
  const sectionsDone = status?.sections_written ?? Object.keys(session?.sections ?? {}).length;
  const sectionsTotal = status?.sections_total ?? outline?.sections.length ?? 0;
  const words = status?.words ?? 0;
  const standing = standingFor(phase, running);
  const plannedWords = (editingOutline ? draftOutline!.sections : (outline?.sections ?? []))
    .reduce((n: number, s: any) => n + (Number(s.target_words) || 0), 0);

  function startOutlineEdit() {
    if (!outline) return;
    setDraftOutline({
      h1: outline.h1,
      search_intent: outline.search_intent,
      sections: outline.sections.map((s, i) => ({
        key: `s${i}`, from: i, level: s.level, heading: s.heading, target_words: s.target_words,
      })),
    });
  }

  function patchSection(i: number, patch: Record<string, unknown>) {
    setDraftOutline((d) => {
      if (!d) return d;
      const sections = [...d.sections];
      sections[i] = { ...sections[i], ...patch };
      return { ...d, sections };
    });
  }

  function moveSection(i: number, delta: number) {
    setDraftOutline((d) => {
      if (!d) return d;
      const j = i + delta;
      if (j < 0 || j >= d.sections.length) return d;
      const sections = [...d.sections];
      [sections[i], sections[j]] = [sections[j], sections[i]];
      return { ...d, sections };
    });
  }

  function dropSection(i: number) {
    setDraftOutline((d) => (d ? { ...d, sections: d.sections.filter((_, j) => j !== i) } : d));
  }

  function addSection() {
    setDraftOutline((d) => (d ? {
      ...d,
      // from: -1 marks it as new, so the server knows no existing source or link belongs to it.
      sections: [...d.sections, { key: `new${d.sections.length}${Date.now()}`, from: -1, level: "h2", heading: "" }],
    } : d));
  }

  /** How many sources/links are attached to the section that originally sat at `from`. Shown so it is
   *  obvious what a Remove will take with it. */
  function sourcesFor(from: number): number {
    return from < 0 ? 0 : (outline?.source_plan ?? []).filter((x) => x.section_index === from).length;
  }
  function linksFor(from: number): number {
    return from < 0 ? 0 : (outline?.link_plan ?? []).filter((x) => x.section_index === from).length;
  }

  async function saveOutline() {
    if (!id || !draftOutline) return;
    setBusy("outline");
    try {
      const d = await fetch(`/api/blog/writer/${id}/outline`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outline: {
            h1: draftOutline.h1,
            search_intent: draftOutline.search_intent,
            sections: draftOutline.sections.map((s) => ({
              from: s.from, level: s.level, heading: s.heading, target_words: s.target_words,
            })),
          },
        }),
      }).then((r) => r.json());
      if (!d?.ok) { toast.error(d?.error ?? "Couldn't save the outline."); return; }
      for (const n of (d.notes ?? []) as string[]) toast.warning(n);
      setDraftOutline(null);
      toast.success("Outline saved. Approve when you are happy with it.");
      await load(id);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the outline.");
    } finally { setBusy(null); }
  }

  const targetWords = status?.target_words ?? (session?.brief as any)?.word_count ?? null;

  return (
    <div className="flex gap-6 h-full min-h-0">
      {/* Sessions */}
      <div className="w-80 shrink-0 h-full min-h-0 flex flex-col overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[64px] backdrop-saturate-[1.65] shadow-[var(--glass-shadow)]">
        <div className="p-3 border-b border-border space-y-2">
          <h1 className="text-sm font-light flex items-center gap-2 tracking-tight">
            <Bot className="h-4 w-4 text-highlight-ink" /> AI writer
          </h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Brief it, approve the outline, and it writes the draft.
          </p>
          {voices.length > 1 ? (
            <div className="space-y-1">
              {voices.map((v) => (
                <Button key={v.id} size="sm" variant={v.is_default ? "default" : "outline"}
                  className="w-full gap-1.5 justify-start text-xs"
                  disabled={busy === "new"} onClick={() => newSession(v.id)}>
                  {busy === "new" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  <span className="truncate">{v.name}</span>
                </Button>
              ))}
            </div>
          ) : (
            <Button size="sm" className="w-full gap-1.5" disabled={busy === "new"} onClick={() => newSession()}>
              {busy === "new" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} New post
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground text-center">No sessions yet.</p>
          ) : sessions.map((s) => (
            <button key={s.id} onClick={() => setId(s.id)}
              className={cn("w-full text-left px-3 py-2.5 border-b border-border/60 hover:bg-muted/40",
                id === s.id && "bg-highlight-soft")}>
              <p className="text-sm font-medium truncate">
                {(s.brief as any)?.primary_keyword || "Untitled brief"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{PHASE_LABEL[s.phase] ?? s.phase}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {!id ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Start a new post on the left.
          </div>
        ) : (
          <>
            {/* Status strip. The standing pill comes first and is the biggest thing here on purpose:
                "is this waiting on me, working, or finished" was previously only inferable from the
                phase name, which meant a parked session looked identical to a busy one. */}
            <div className="flex items-center gap-2.5 pb-2.5 border-b border-border flex-wrap">
              <span className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 h-8 text-sm font-medium",
                STANDING_META[standing].cls,
              )}>
                <span className={cn("h-2 w-2 rounded-full", STANDING_META[standing].dot,
                  standing === "working" && "animate-pulse")} />
                {STANDING_META[standing].label}
              </span>
              <span className="text-xs text-muted-foreground">{STANDING_META[standing].hint}</span>
              <Badge variant="outline" className="text-xs text-highlight-ink border-highlight/40">
                {PHASE_LABEL[phase] ?? phase}
              </Badge>
              {sectionsTotal > 0 && (phase === "writing" || phase === "done" || sectionsDone > 0) && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                    <span className="block h-full bg-primary transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.round((sectionsDone / sectionsTotal) * 100))}%` }} />
                  </span>
                  {sectionsDone}/{sectionsTotal} sections
                </span>
              )}
              {words > 0 && (
                <span className="text-xs text-muted-foreground">
                  {words.toLocaleString()}{targetWords ? ` / ${targetWords.toLocaleString()}` : ""} words
                </span>
              )}
              {(status?.sources_found ?? 0) > 0 && (
                <span className="text-xs text-muted-foreground">
                  {status!.sources_found} source{status!.sources_found === 1 ? "" : "s"}
                </span>
              )}
              {(status?.real_questions_found ?? 0) > 0 && (
                <span className="text-xs text-muted-foreground">
                  {status!.real_questions_found} real question{status!.real_questions_found === 1 ? "" : "s"}
                </span>
              )}
              {draft?.writer_status && (
                <Badge variant="outline" className={cn("text-xs",
                  draft.writer_status === "ok" && "text-success border-success/40",
                  draft.writer_status === "flagged" && "text-warning border-warning/30",
                  draft.writer_status === "failed" && "text-destructive border-destructive/30")}>
                  {draft.writer_status === "ok" ? "checks passed" : draft.writer_status}
                </Badge>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                {sectionsTotal > 0 && sectionsDone >= sectionsTotal && (
                  <Button size="xs" variant="outline" className="gap-1 text-xs"
                    onClick={finalize} disabled={busy === "finalize" || running}>
                    {busy === "finalize" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Run checks
                  </Button>
                )}
                {draft && (
                  <a href="/blog" className="text-xs text-highlight-ink hover:underline flex items-center gap-1">
                    <FileText className="h-3 w-3" /> Open draft <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            </div>

            {/* Transcript */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3 min-h-0">
              {messages.map((m, i) => {
                if (m.kind === "tool_use") {
                  return <Step key={i} label={m.label ?? m.name ?? "Working"} detail={m.detail}
                    state={m.state === "error" ? "error" : "done"} />;
                }
                if (!m.text?.trim()) return null;
                // The phase directive is injected into the user turn for the model; it is not
                // something the human typed, so don't render it back at them.
                if (m.role === "user" && m.text.startsWith("<phase>")) {
                  const stripped = m.text.replace(/<phase>[\s\S]*?<\/phase>\n?/, "").trim();
                  if (!stripped) return null;
                  return <Bubble key={i} mine text={stripped} />;
                }
                if (m.role === "user" && m.text.startsWith("<repair_request>")) {
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="text-xs text-muted-foreground px-1">sent the fix list back</div>
                    </div>
                  );
                }
                return <Bubble key={i} mine={m.role === "user"} text={m.text} />;
              })}

              {/* Live activity for the in-flight turn: every step it has taken, in order. */}
              {activity.map((a, i) => <Step key={`a${i}`} label={a.label} detail={a.detail} state={a.state} />)}

              {live && <Bubble mine={false} text={live} />}
              {running && !live && activity.every((a) => a.state !== "running") && (
                <Step label={activity.length ? "Deciding what to do next" : "Reading your brief"} state="running" />
              )}
              <div ref={endRef} />
            </div>

            {/* Outline approval: the gate */}
            {phase === "outline_pending" && outline && (
              <div className="border border-highlight/40 bg-highlight-soft rounded-lg p-4 space-y-3 mb-2 max-h-[55vh] overflow-y-auto">
                <div className="flex items-center gap-2 flex-wrap">
                  <ListTree className="h-4 w-4 text-highlight-ink" />
                  <p className="text-sm font-medium">Outline ready for your approval</p>
                  <span className="text-xs text-muted-foreground">
                    {outline.source_plan.length} sources · {outline.link_plan.length} internal links
                    {targetWords ? ` · ${plannedWords} / ${targetWords} planned words` : ""}
                  </span>
                  {!editingOutline && (
                    <Button size="xs" variant="outline" className="ml-auto gap-1.5" onClick={startOutlineEdit}>
                      <PencilLine className="h-3.5 w-3.5" /> Edit inline
                    </Button>
                  )}
                </div>

                {editingOutline && draftOutline ? (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">H1</label>
                      <Input value={draftOutline.h1}
                        onChange={(e) => setDraftOutline({ ...draftOutline, h1: e.target.value })} />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">
                        Sections — drag order with the arrows. Sources and links follow their section.
                      </label>
                      {draftOutline.sections.map((sec: any, i: number) => (
                        <div key={sec.key} className="flex items-start gap-1.5 rounded-lg border border-border bg-background p-2">
                          <div className="flex flex-col gap-0.5 pt-0.5">
                            <button type="button" aria-label="Move up" disabled={i === 0}
                              onClick={() => moveSection(i, -1)}
                              className="h-5 w-5 rounded hover:bg-muted disabled:opacity-25 flex items-center justify-center">
                              <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" aria-label="Move down" disabled={i === draftOutline.sections.length - 1}
                              onClick={() => moveSection(i, 1)}
                              className="h-5 w-5 rounded hover:bg-muted disabled:opacity-25 flex items-center justify-center">
                              <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <Input value={sec.heading} placeholder="Heading"
                              onChange={(e) => patchSection(i, { heading: e.target.value })} />
                            <div className="flex items-center gap-2 flex-wrap">
                              <select value={sec.level} onChange={(e) => patchSection(i, { level: e.target.value })}
                                className="h-9 rounded-md border border-input bg-background px-2 text-xs">
                                <option value="h2">H2</option>
                                <option value="h3">H3</option>
                              </select>
                              <Input type="number" min={40} max={2000} step={10} value={sec.target_words ?? ""}
                                placeholder="words" className="h-9 w-24"
                                onChange={(e) => patchSection(i, { target_words: Number(e.target.value) || undefined })} />
                              <span className="text-xs text-muted-foreground">
                                {sourcesFor(sec.from)} sources · {linksFor(sec.from)} links
                                {sec.from < 0 ? " · new" : ""}
                              </span>
                              <Button size="xs" variant="ghost" className="ml-auto text-destructive hover:text-destructive gap-1"
                                disabled={draftOutline.sections.length < 2}
                                onClick={() => dropSection(i)}>
                                <Trash2 className="h-3.5 w-3.5" /> Remove
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                      <Button size="xs" variant="outline" className="w-full gap-1.5" onClick={addSection}>
                        <Plus className="h-3.5 w-3.5" /> Add a section
                      </Button>
                    </div>

                    <div className="flex gap-2 pt-1">
                      <Button size="sm" className="gap-1.5" onClick={saveOutline} disabled={busy === "outline"}>
                        {busy === "outline" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Save outline
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDraftOutline(null)}>Cancel</Button>
                      <span className="text-xs text-muted-foreground self-center">
                        Saving does not approve it.
                      </span>
                    </div>
                  </div>
                ) : (
                  <>
                    {outline.search_intent && (
                      <p className="text-xs text-muted-foreground">{outline.search_intent}</p>
                    )}
                    <p className="text-base font-medium leading-snug">{outline.h1}</p>
                    <ol className="text-sm space-y-1">
                      {outline.sections.map((sec, i) => (
                        <li key={i} className={cn("text-muted-foreground flex gap-2", sec.level === "h3" && "pl-5")}>
                          <span className="opacity-40 tabular-nums">{i + 1}.</span>
                          <span>
                            {sec.heading}
                            {sec.target_words ? <span className="opacity-60"> · {sec.target_words}w</span> : null}
                            {sec.is_faq ? <span className="text-highlight-ink/80"> · question</span> : null}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <div className="flex gap-2 pt-1 flex-wrap">
                      <Button size="sm" className="gap-1.5" onClick={approve} disabled={busy === "approve" || running}>
                        {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Approve and write
                      </Button>
                      <span className="text-xs text-muted-foreground self-center">
                        or edit it above, or reply below with changes
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* QA panel */}
            {qa && qa.violations.length > 0 && (
              <div className={cn("border rounded-lg p-3 space-y-2 mb-2",
                qa.verdict === "failed" ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5")}>
                <div className="flex items-center gap-2">
                  {qa.verdict === "failed"
                    ? <AlertTriangle className="h-4 w-4 text-destructive" />
                    : <AlertTriangle className="h-4 w-4 text-warning" />}
                  <p className="text-sm font-medium">
                    {qa.verdict === "failed" ? "This one needs a human" : "Worth a look"}
                  </p>
                </div>
                <ul className="text-xs space-y-1">
                  {qa.violations.filter((v) => v.severity !== "auto_fix").map((v, i) => (
                    <li key={i} className="text-muted-foreground">• {v.detail}</li>
                  ))}
                </ul>
                {qa.repair_prompt && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={sendRepair} disabled={running}>
                    <Wrench className="h-3.5 w-3.5" /> Ask it to fix these
                  </Button>
                )}
              </div>
            )}
            {qa && qa.violations.filter((v) => v.severity !== "auto_fix").length === 0 && (
              <div className="border border-success/40 bg-success/15 rounded-lg p-3 mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <p className="text-sm">All checks passed. Add a thumbnail in the editor, then publish.</p>
              </div>
            )}

            {stalled && (
              <div className="border border-warning/40 bg-warning/5 rounded-lg p-3 mb-2 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <p className="text-sm">{stalled}</p>
              </div>
            )}

            {/* Composer */}
            <div className="flex gap-2 pt-2 border-t border-border">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && input.trim() && !running) {
                    e.preventDefault();
                    const t = input.trim(); setInput(""); void send(id, t);
                  }
                }}
                placeholder={
                  running ? "Working — you can queue a note for the next step…"
                  : phase === "gathering" ? "Primary keyword, topic and angle, blog or landing page, word count…"
                  : phase === "outline_pending" ? "Approve above, or type the changes you want…"
                  : "Reply, or ask for changes…"}
                className="min-h-[44px] max-h-40 flex-1 resize-none text-sm"
                disabled={running}
              />
              <Button size="sm" className="gap-1.5 self-end" disabled={!input.trim() || running}
                onClick={() => { const t = input.trim(); setInput(""); void send(id, t); }}>
                {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground pt-1">⌘/Ctrl + Enter to send</p>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────── bits ─────── */

function Bubble({ mine, text }: { mine: boolean; text: string }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={cn("max-w-[78%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed break-words",
        mine ? "bg-highlight-soft text-white rounded-br-sm" : "bg-muted rounded-bl-sm")}>
        {text}
      </div>
    </div>
  );
}

/**
 * One step the agent took. Labels come from the server (`describeToolCall`) so a live turn and a
 * reloaded transcript read identically, and so "web_search" never leaks into the UI.
 */
function Step({ label, detail, state }: { label: string; detail?: string; state: Activity["state"] }) {
  return (
    <div className="flex justify-start">
      <div className={cn("text-xs flex items-start gap-1.5 px-1 max-w-[78%] leading-relaxed",
        state === "error" ? "text-warning/90" : "text-muted-foreground")}>
        {state === "running" ? <Loader2 className="h-3 w-3 animate-spin shrink-0 mt-0.5" />
          : state === "error" ? <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
          : <Check className="h-3 w-3 shrink-0 mt-0.5 text-success/70" />}
        <span>
          {label}
          {state === "running" && "…"}
          {detail && <span className="opacity-60 break-all"> {detail}</span>}
        </span>
      </div>
    </div>
  );
}

/** Only used to seed a status object from a mid-turn progress event when none was loaded yet. */
const EMPTY_STATUS: Status = {
  phase: "writing", sections_written: 0, sections_total: 0, words: 0, target_words: null,
  sources_found: 0, real_questions_found: 0, writer_status: null, usage: {},
};
