"use client";

// Topic clusters: pick a topic, review a plan built from real Search Console demand, approve once,
// and N articles get written unattended.
//
// The keyword list on this screen is the point. It is not a text box you guess into: it is queries
// where we ALREADY earn impressions but rank badly, ordered by how much traffic the gap is worth.
// Approving is the only human gate in the whole run, so the plan screen shows the evidence behind
// every choice, what the planner deliberately excluded, and an estimated cost.
import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  Layers, Loader2, Search, Check, Play, AlertTriangle, CheckCircle2, FileText, RefreshCw, PencilLine, Trash2, Plus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { WriterCluster, WriterVoice } from "@/lib/db/queries";

interface Opportunity { keyword: string; impressions: number; clicks: number; position: number; opportunity: number }
interface ProgressArticle {
  session_id: string; draft_id: string | null; keyword: string; title: string; slug: string;
  phase: string; sections: string; words: number; writer_status: string | null;
}
interface Progress {
  id: string; status: string; total: number; done: number; failed: number;
  pillar_keyword: string; articles: ProgressArticle[];
}
interface Estimate { articles: number; est_output_tokens: number; est_usd: number }

/**
 * The pipeline, in the order it happens.
 *
 * This renders as the empty state of this page rather than living in a doc, because "I don't understand
 * how clusters work" is a question people have while looking at this screen — and a doc they have to go
 * find is a doc they do not read. Kept as data so the numbering can never drift from the copy.
 */
const CLUSTER_STEPS = [
  {
    t: "It finds real opportunities",
    d: "Search a topic and it pulls 90 days of Google Search Console, keeping only striking distance: queries where you already get 50+ impressions but rank between position 5 and 30. Real demand you are visible for and losing. No search-volume guessing — those numbers are measured.",
  },
  {
    t: "It proposes a plan",
    d: "One model call picks a pillar and N supporting posts from those queries, with titles, angles, headings and word counts. Every keyword is checked back against the real data: an invented one is dropped, and if the pillar is not real the whole plan is rejected.",
  },
  {
    t: "You approve once — and can edit first",
    d: "Edit plan lets you change titles, angles, headings and word counts, drop a post or add one. The target query is a dropdown over the real Search Console rows, so the impressions and position shown always belong to the query actually chosen. One approval authorises every article.",
  },
  {
    t: "Slugs and the link map are fixed before writing",
    d: "On approval every slug is minted and collision-checked, all the draft rows are created empty, and the link graph is computed server-side: the pillar links down to all of them, each supporting post links up to the pillar plus two siblings. That is why interlinking works — the model gets a fixed list of real URLs and cannot invent one.",
  },
  {
    t: "It writes them one at a time, resumably",
    d: "The pillar goes first so the others link to a page that already exists. Two levels of resume — which article, and which section inside it — so an interrupted run picks up where it stopped instead of starting over.",
  },
  {
    t: "Each article is checked, then stops",
    d: "The same quality gates as the chat writer, plus up to two automatic repair rounds since nobody is there to press the fix button. Author, category and thumbnail get filled in. Then it stops: nothing is ever published automatically.",
  },
];

const RUNNING = new Set(["approved", "running"]);

export default function ClustersPage() {
  const [clusters, setClusters] = useState<WriterCluster[]>([]);
  const [voices, setVoices] = useState<WriterVoice[]>([]);
  const [seed, setSeed] = useState("");
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [oppNotes, setOppNotes] = useState<string[]>([]);
  const [loadingOpps, setLoadingOpps] = useState(false);
  const [size, setSize] = useState(4);
  const [voiceId, setVoiceId] = useState<string>("");
  const [planning, setPlanning] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [cluster, setCluster] = useState<WriterCluster | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** A local copy of the plan while editing, so nothing is written until Save. */
  const [draftItems, setDraftItems] = useState<any[] | null>(null);
  const editing = draftItems !== null;

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadClusters = useCallback(async () => {
    const d = await fetch("/api/blog/writer/cluster").then((r) => r.json()).catch(() => null);
    if (d?.ok) setClusters(d.clusters);
  }, []);

  useEffect(() => {
    loadClusters();
    fetch("/api/blog/voices").then((r) => r.json()).then((d) => {
      if (d?.ok) { setVoices(d.voices); setVoiceId(d.voices.find((v: WriterVoice) => v.is_default)?.id ?? ""); }
    }).catch(() => {});
  }, [loadClusters]);

  const loadOne = useCallback(async (id: string) => {
    const d = await fetch(`/api/blog/writer/cluster/${id}`).then((r) => r.json()).catch(() => null);
    if (!d?.ok) return;
    setCluster(d.cluster); setProgress(d.progress); setEstimate(d.estimate);
  }, []);

  // Poll only while something is actually running, so an idle tab isn't hitting the API forever.
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (!selected) return;
    void loadOne(selected);
    pollRef.current = setInterval(() => {
      void loadOne(selected);
      void loadClusters();
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selected, loadOne, loadClusters]);

  useEffect(() => {
    if (cluster && !RUNNING.has(cluster.status) && pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null;
    }
  }, [cluster]);

  async function findOpportunities() {
    setLoadingOpps(true);
    try {
      const d = await fetch(`/api/blog/writer/cluster?seed=${encodeURIComponent(seed)}`).then((r) => r.json());
      if (!d?.ok) { toast.error(d?.error ?? "Couldn't load keyword data."); return; }
      setOpps(d.opportunities); setOppNotes(d.notes ?? []);
      if (!d.opportunities.length) toast.warning(d.notes?.[0] ?? "No striking-distance queries for that topic.");
    } finally { setLoadingOpps(false); }
  }

  async function plan() {
    if (!seed.trim()) { toast.error("Enter a topic first."); return; }
    setPlanning(true);
    try {
      const d = await fetch("/api/blog/writer/cluster", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed_keyword: seed.trim(), size, voice_id: voiceId || undefined }),
      }).then((r) => r.json());
      if (!d?.ok) { toast.error(d?.error ?? "Planning failed."); return; }
      await loadClusters();
      setSelected(d.cluster.id);
      toast.success("Plan ready. Review it before approving.");
    } finally { setPlanning(false); }
  }

  async function act(action: "approve" | "resume") {
    if (!selected) return;
    setBusy(action);
    try {
      const d = await fetch(`/api/blog/writer/cluster/${selected}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }).then((r) => r.json());
      if (!d?.ok) { toast.error(d?.error ?? "Failed."); return; }
      toast.success(action === "approve" ? "Approved. Writing has started." : "Resuming.");
      await loadOne(selected);
    } finally { setBusy(null); }
  }

  const plan_ = cluster?.plan;
  const items = plan_ ? [plan_.pillar, ...plan_.supporting] : [];

  const evidence: Array<{ keyword: string; impressions: number; position: number }> =
    (plan_?.evidence as any[]) ?? [];

  function startEdit() { setDraftItems(items.map((it: any) => ({ ...it, headings: [...(it.headings ?? [])] }))); }
  function cancelEdit() { setDraftItems(null); }

  function editItem(i: number, patch: Record<string, unknown>) {
    setDraftItems((d) => {
      if (!d) return d;
      const next = [...d];
      next[i] = { ...next[i], ...patch };
      // Changing the query re-attaches its real metrics immediately, so the card never shows one
      // keyword's numbers against another's. The server re-derives them too; this keeps the UI honest
      // in the meantime rather than showing a stale figure until save.
      if (typeof patch.keyword === "string") {
        const row = evidence.find((o) => o.keyword === patch.keyword);
        if (row) { next[i].impressions = row.impressions; next[i].position = row.position; }
      }
      return next;
    });
  }

  function dropItem(i: number) {
    setDraftItems((d) => (d ? d.filter((_, j) => j !== i) : d));
  }

  function addItem() {
    // Seed from the first evidence row not already used, so the new card is valid on arrival.
    const used = new Set((draftItems ?? []).map((x) => x.keyword));
    const row = evidence.find((o) => !used.has(o.keyword));
    if (!row) { toast.error("Every query from the evidence is already used."); return; }
    setDraftItems((d) => [...(d ?? []), {
      keyword: row.keyword,
      title: `${row.keyword}: what to know`,
      angle: "",
      headings: ["Introduction", "The main point", "What to do next"],
      word_count: 1400,
      impressions: row.impressions,
      position: row.position,
    }]);
  }

  async function savePlan() {
    if (!cluster || !draftItems?.length) return;
    setBusy("save");
    try {
      const [pillar, ...supporting] = draftItems;
      const d = await fetch(`/api/blog/writer/cluster/${cluster.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_plan", plan: { pillar, supporting } }),
      }).then((r) => r.json());
      if (!d?.ok) { toast.error(d?.error ?? "Couldn't save the plan."); return; }
      setDraftItems(null);
      for (const n of (d.notes ?? []) as string[]) toast.warning(n);
      toast.success("Plan saved.");
      await loadOne(cluster.id);
      void loadClusters();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save the plan.");
    } finally { setBusy(null); }
  }

  return (
    <div className="flex gap-6 h-full min-h-0">
      {/* Left: new cluster + list */}
      <div className="w-80 shrink-0 h-full min-h-0 flex flex-col overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[64px] backdrop-saturate-[1.65] shadow-[var(--glass-shadow)]">
        <div className="p-3 border-b border-border space-y-2">
          <h1 className="text-sm font-light flex items-center gap-2 tracking-tight">
            <Layers className="h-4 w-4 text-highlight-ink" /> Topic clusters
          </h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            One pillar plus supporting posts, planned from queries we already get impressions for
            but rank badly on.
          </p>
          <div className="flex gap-1.5">
            <Input value={seed} onChange={(e) => setSeed(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void findOpportunities(); }}
              placeholder="Topic, e.g. ai video" className="h-8 text-xs" />
            <Button size="sm" variant="outline" className="shrink-0 px-2"
              onClick={findOpportunities} disabled={loadingOpps}>
              {loadingOpps ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {opps.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                {opps.length} striking-distance queries. Real impressions, current position.
              </p>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                {opps.map((o) => (
                  <div key={o.keyword} className="px-2 py-1.5">
                    <p className="text-xs truncate">{o.keyword}</p>
                    <p className="text-xs text-muted-foreground">
                      {o.impressions.toLocaleString()} impressions · position {o.position.toFixed(1)}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-muted-foreground">Posts</label>
                <Input type="number" min={2} max={12} value={size}
                  onChange={(e) => setSize(Math.max(2, Math.min(12, Number(e.target.value) || 4)))}
                  className="h-7 w-14 text-xs" />
                {voices.length > 1 && (
                  <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}
                    className="h-7 flex-1 min-w-0 rounded-md border border-border bg-background px-1.5 text-xs">
                    {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                )}
              </div>
              <Button size="sm" className="w-full gap-1.5" onClick={plan} disabled={planning}>
                {planning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
                Plan a cluster
              </Button>
            </div>
          )}
          {oppNotes.length > 0 && opps.length === 0 && (
            <p className="text-xs text-warning">{oppNotes[0]}</p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {clusters.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground text-center">No clusters yet.</p>
          ) : clusters.map((cl) => (
            <button key={cl.id} onClick={() => setSelected(cl.id)}
              className={cn("w-full text-left px-3 py-2.5 border-b border-border/60 hover:bg-muted/40",
                selected === cl.id && "bg-highlight-soft")}>
              <p className="text-sm font-medium truncate">{cl.pillar_keyword}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {cl.status} · {cl.done}/{cl.total} written{cl.failed ? ` · ${cl.failed} failed` : ""}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Right: plan review + progress */}
      <div className="flex-1 overflow-y-auto pr-1">
        {!cluster ? (
          <div className="max-w-3xl mx-auto py-6 space-y-5">
            <div className="space-y-1.5">
              <h2 className="text-lg font-semibold">What a cluster is</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                One broad <span className="text-foreground">pillar</span> article plus several narrower{" "}
                <span className="text-foreground">supporting</span> articles, all targeting different
                queries and all linking to each other. Google reads that linking as &ldquo;this site
                covers this topic properly&rdquo;, which is worth more than the same posts published
                unconnected.
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">How it runs here</h3>
              {CLUSTER_STEPS.map((step, i) => (
                <div key={step.t} className="flex gap-3">
                  <span className="shrink-0 h-7 w-7 rounded-full border border-highlight/40 bg-highlight-soft text-highlight-ink text-xs font-semibold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{step.t}</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{step.d}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border p-3 space-y-1.5">
              <p className="text-sm font-medium">The one real limitation</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Clusters are planned from Search Console, so they can only find queries you{" "}
                <span className="text-foreground">already get impressions for</span>. A topic with zero
                impressions is invisible to this. Ahrefs would cover that gap but your plan has no API
                access, and the Semrush connector currently has no API units — so for now, scope a
                cluster with the topic search and treat the striking-distance list as the candidate pool.
              </p>
            </div>

            <p className="text-sm text-muted-foreground">
              Search a topic on the left to see what you already have demand for.
            </p>
          </div>
        ) : (
          <div className="max-w-5xl space-y-4 pb-10">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold truncate">{cluster.title || cluster.pillar_keyword}</h2>
                <p className="text-xs text-muted-foreground">
                  {cluster.status}
                  {progress ? ` · ${progress.done}/${progress.total} written` : ""}
                  {cluster.failed ? ` · ${cluster.failed} failed` : ""}
                </p>
              </div>
              {cluster.status === "plan_pending" && !editing && (
                <>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={startEdit} disabled={busy !== null}>
                    <PencilLine className="h-4 w-4" /> Edit plan
                  </Button>
                  <Button size="sm" className="gap-1.5" onClick={() => act("approve")} disabled={busy !== null}>
                    {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Approve and write all
                  </Button>
                </>
              )}
              {cluster.status === "partial" && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => act("resume")} disabled={busy !== null}>
                  {busy === "resume" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  Resume
                </Button>
              )}
              {RUNNING.has(cluster.status) && (
                <Badge variant="outline" className="text-xs text-highlight-ink border-highlight/40 gap-1">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> writing
                </Badge>
              )}
            </div>

            {cluster.status === "plan_pending" && estimate && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs space-y-1">
                <p className="font-medium flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" /> One click writes {estimate.articles} articles
                </p>
                <p className="text-muted-foreground">
                  Roughly {estimate.est_output_tokens.toLocaleString()} output tokens, about ${estimate.est_usd}.
                  Each article researches its own keyword, so approving is the last chance to change the plan.
                  Drafts are never published automatically.
                </p>
              </div>
            )}

            {/* The plan. Editable while it is still pending, because a plan you can only accept or
                discard is not something you can review — the only recourse was to re-plan and hope.
                Keywords are a dropdown over the real Search Console evidence, never free text: every
                item's impressions and position come from that row, and a typed keyword would be an
                unevidenced guess wearing another query's numbers. */}
            {items.length > 0 && (
              <div className="space-y-3">
                {editing && (
                  <div className="flex items-center gap-2 flex-wrap rounded-lg border border-highlight/40 bg-highlight-soft px-3 py-2.5">
                    <PencilLine className="h-4 w-4 text-highlight-ink" />
                    <p className="text-sm">Editing the plan. Nothing is written until you approve.</p>
                    <div className="ml-auto flex items-center gap-1.5">
                      <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={busy !== null}>Cancel</Button>
                      <Button size="sm" className="gap-1.5" onClick={savePlan} disabled={busy !== null}>
                        {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Save plan
                      </Button>
                    </div>
                  </div>
                )}

                {(editing ? draftItems : items).map((it, i) => {
                  const live = progress?.articles.find((a) => a.keyword === it.keyword);
                  const isPillar = i === 0;
                  return (
                    <div key={i} className={cn(
                      "rounded-lg border p-4 space-y-3",
                      isPillar ? "border-highlight/40 bg-primary/[0.04]" : "border-border",
                    )}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={cn("text-xs shrink-0",
                          isPillar && "text-highlight-ink border-highlight/40")}>
                          {isPillar ? "Pillar" : `Support ${i}`}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {it.impressions?.toLocaleString()} impressions · position {it.position?.toFixed(1)}
                        </span>
                        {it.slug && <span className="text-xs text-muted-foreground font-mono">/{it.slug}</span>}

                        {live && (
                          <span className="ml-auto flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">{live.phase} · {live.sections} · {live.words}w</span>
                            {live.writer_status && (
                              <Badge variant="outline" className={cn("text-xs",
                                live.writer_status === "ok" && "text-success border-success/40",
                                live.writer_status === "flagged" && "text-warning border-warning/30",
                                live.writer_status === "failed" && "text-destructive border-destructive/30")}>
                                {live.writer_status}
                              </Badge>
                            )}
                          </span>
                        )}
                        {editing && !isPillar && draftItems.length > 2 && (
                          <Button size="xs" variant="ghost" className="ml-auto text-destructive hover:text-destructive gap-1"
                            onClick={() => dropItem(i)}>
                            <Trash2 className="h-3.5 w-3.5" /> Drop
                          </Button>
                        )}
                      </div>

                      {editing ? (
                        <div className="space-y-2.5">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Target query</label>
                            <select value={it.keyword} onChange={(e) => editItem(i, { keyword: e.target.value })}
                              className="w-full h-10 rounded-lg border border-input bg-background px-2.5 text-sm">
                              {evidence.map((o) => (
                                <option key={o.keyword} value={o.keyword}>
                                  {o.keyword} — {o.impressions.toLocaleString()} impressions, position {o.position.toFixed(1)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">
                              Title <span className={cn(it.title.length < 35 && "text-warning")}>({it.title.length}/35 min)</span>
                            </label>
                            <Input value={it.title} onChange={(e) => editItem(i, { title: e.target.value })} />
                          </div>
                          <div className="grid grid-cols-[1fr_140px] gap-2">
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Angle</label>
                              <Textarea value={it.angle} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => editItem(i, { angle: e.target.value })}
                                className="min-h-[64px] text-sm" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Target words</label>
                              <Input type="number" min={300} max={6000} step={100} value={it.word_count}
                                onChange={(e) => editItem(i, { word_count: Number(e.target.value) })} />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Headings (one per line)</label>
                            <Textarea value={it.headings.join("\n")}
                              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => editItem(i, { headings: e.target.value.split("\n") })}
                              className="min-h-[120px] text-sm font-mono" />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-base font-medium leading-snug">{it.title}</p>
                          <p className="text-sm text-muted-foreground font-mono">{it.keyword} · target {it.word_count}w</p>
                          <p className="text-sm text-muted-foreground leading-relaxed">{it.angle}</p>
                          {it.headings?.length > 0 && (
                            <ul className="text-sm text-muted-foreground space-y-1 pt-1">
                              {it.headings.map((h: string, j: number) => (
                                <li key={j} className="flex gap-2"><span className="opacity-40">{j + 1}.</span>{h}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {editing && draftItems.length < 12 && (
                  <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={addItem}>
                    <Plus className="h-4 w-4" /> Add a supporting post
                  </Button>
                )}
              </div>
            )}

            {/* What the planner excluded, and why. The most useful part for a reviewer. */}
            {plan_?.notes && plan_.notes.length > 0 && (
              <div className="rounded-lg border border-border p-3 space-y-1">
                <p className="text-xs font-medium">Planner notes</p>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {plan_.notes.map((n: string, i: number) => <li key={i}>• {n}</li>)}
                </ul>
              </div>
            )}

            {cluster.status === "done" && (
              <div className="rounded-lg border border-success/40 bg-success/15 p-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <p className="text-sm">
                  All {cluster.total} drafts written. Add thumbnails in the editor, then publish.
                </p>
                <a href="/blog" className="ml-auto text-xs text-highlight-ink hover:underline flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Open drafts
                </a>
              </div>
            )}
            {cluster.status === "partial" && (
              <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-warning" />
                <p className="text-sm">
                  Stopped partway with {cluster.done} of {cluster.total} written. Resume picks up where it left off.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
