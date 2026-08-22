"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Bot, Play, Loader2, Link2, Sparkles, ExternalLink, Ticket, Send, CheckCircle2, HelpCircle,
  TrendingUp, RefreshCw, Globe, FileCheck2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PathCombobox } from "@/components/ui/path-combobox";
import { cn } from "@/lib/utils";
import type { InternalLinkReport, GeoReport, PageQualityReport } from "@/lib/seo-agents/types";
import { useKnownPages } from "@/lib/hooks/useKnownPages";

function Tip({ text }: { text: string }) {
  return (
    <span title={text} className="inline-flex cursor-help align-middle text-muted-foreground/70 hover:text-muted-foreground">
      <HelpCircle className="h-3.5 w-3.5" />
    </span>
  );
}

type Dispatch = { status: "idle" | "loading" | "done" | "error"; ref?: string; error?: string };

export default function SeoAgentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-light flex items-center gap-2 tracking-tight">
          <Bot className="h-6 w-6 text-highlight-ink" /> Growth Agents
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Helpers that grow rankings: find pages that should link to an important page, check whether
          AI tools recommend you vs competitors, spot money pages that are almost ranking, and get
          refresh briefs for pages losing traffic. All are suggestions only — you choose what to action.
        </p>
      </div>

      <Tabs defaultValue="links">
        <TabsList>
          <TabsTrigger value="links"><Link2 className="h-4 w-4 mr-1.5" /> Internal Links</TabsTrigger>
          <TabsTrigger value="geo"><Sparkles className="h-4 w-4 mr-1.5" /> AI Citations</TabsTrigger>
          <TabsTrigger value="rank"><TrendingUp className="h-4 w-4 mr-1.5" /> Rankings</TabsTrigger>
          <TabsTrigger value="quality"><FileCheck2 className="h-4 w-4 mr-1.5" /> Page Quality</TabsTrigger>
          <TabsTrigger value="refresh"><RefreshCw className="h-4 w-4 mr-1.5" /> Content Refresh</TabsTrigger>
          <TabsTrigger value="backlinks"><Globe className="h-4 w-4 mr-1.5" /> Backlinks</TabsTrigger>
        </TabsList>
        <TabsContent value="links" className="mt-4"><InternalLinks /></TabsContent>
        <TabsContent value="geo" className="mt-4"><Geo /></TabsContent>
        <TabsContent value="rank" className="mt-4"><RankWatcher /></TabsContent>
        <TabsContent value="quality" className="mt-4"><PageQuality /></TabsContent>
        <TabsContent value="refresh" className="mt-4"><ContentRefresh /></TabsContent>
        <TabsContent value="backlinks" className="mt-4"><Backlinks /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ─────────────────────────── Internal Links ─────────────────────────── */
interface LinkOpp {
  id: string;
  source_path: string; target_path: string; source_url: string;
  source_title?: string; target_title?: string;
  anchor: string; placement: string; sentence?: string; draft_sentence?: string;
  score?: number; shared_terms?: string[]; status: string; ticket_url?: string;
  first_seen_at: string; last_seen_at: string;
}

// Highlight the verbatim anchor inside its sentence so "where to place the link" is obvious.
function SentenceWithAnchor({ sentence, anchor }: { sentence: string; anchor: string }) {
  const i = sentence.toLowerCase().indexOf(anchor.toLowerCase());
  if (i < 0) return <span className="text-muted-foreground">{sentence}</span>;
  return (
    <span className="text-muted-foreground">
      {sentence.slice(0, i)}
      <mark className="bg-highlight-soft text-highlight-ink rounded px-0.5 font-medium">{sentence.slice(i, i + anchor.length)}</mark>
      {sentence.slice(i + anchor.length)}
    </span>
  );
}

function InternalLinks() {
  const [mode, setMode] = useState<"site" | "page">("site");
  // Whole-site sweep + persisted backlog
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [opps, setOpps] = useState<LinkOpp[]>([]);
  const [statusFilter, setStatusFilter] = useState<"open" | "actioned" | "dismissed">("open");
  const [swept, setSwept] = useState(false);
  const [disp, setDisp] = useState<Record<string, Dispatch>>({});
  // Single-page (ad-hoc, report-only)
  const [target, setTarget] = useState("/ai-image-generator");
  const [limit, setLimit] = useState(30);
  const [pageReport, setPageReport] = useState<InternalLinkReport | null>(null);
  const [pageDisp, setPageDisp] = useState<Record<number, Dispatch>>({});
  const knownPages = useKnownPages();

  async function loadBacklog(status = statusFilter) {
    setLoading(true);
    try {
      const d = await fetch(`/api/seo-agents/internal-links?backlog=1&status=${status}`).then((r) => r.json());
      if (d?.ok) setOpps(d.opportunities);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function runSweep() {
    setRunning(true);
    try {
      const d = await fetch("/api/seo-agents/internal-links", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sweep: true, persist: true, limit: 80 }),
      }).then((r) => r.json());
      if (d?.ok) {
        setSwept(true);
        toast.success(`Swept ${d.report.crawled} pages · ${d.report.opportunities.length} opportunities (${d.persisted?.created ?? 0} new).`);
        setStatusFilter("open");
        await loadBacklog("open");
      } else toast.error(d?.error ?? "Sweep failed.");
    } catch (e: any) { toast.error(e?.message ?? "Sweep failed."); }
    finally { setRunning(false); }
  }

  async function mark(id: string, status: "actioned" | "dismissed", ticketUrl?: string) {
    await fetch("/api/seo-agents/internal-links", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status, ticketUrl }),
    }).catch(() => {});
    setOpps((prev) => prev.filter((o) => o.id !== id)); // drop from the current (open) view
  }

  async function createTaskFor(o: LinkOpp) {
    setDisp((p) => ({ ...p, [o.id]: { status: "loading" } }));
    const how = o.placement === "linkify"
      ? `Linkify the existing phrase "${o.anchor}" in this sentence:\n> ${o.sentence}`
      : `Add a sentence that links to the target, e.g.:\n> ${o.draft_sentence || o.sentence || ""}`;
    const preview = {
      kind: "ticket" as const,
      reason: "internal_link",
      title: `[SEO] Internal link: ${o.source_path} → ${o.target_path}`,
      rootCause: "CRAWL_BUDGET" as const,
      owner: "content" as const,
      priority: "p2" as const,
      fix: `On ${o.source_path}, link to ${o.target_path} using anchor "${o.anchor}".`,
      body: `**Add an internal link**\n\nFrom: ${o.source_url}\nTo: https://${"imagine.art"}${o.target_path}\nAnchor: "${o.anchor}"\nPlacement: ${o.placement}\n\n${how}\n\n_Suggested by the Internal Linking sweep._`,
      urls: [o.source_url],
      templates: [],
    };
    try {
      const d = await fetch("/api/indexing/ticket", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preview }),
      }).then((r) => r.json());
      if (d?.ok) {
        setDisp((p) => ({ ...p, [o.id]: { status: "done", ref: d.issue?.url } }));
        toast.success(`Ticket ${d.issue.identifier} created — marked actioned.`);
        await mark(o.id, "actioned", d.issue?.url);
      } else { setDisp((p) => ({ ...p, [o.id]: { status: "error", error: d?.error } })); toast.error(d?.error ?? "Failed."); }
    } catch (e: any) { setDisp((p) => ({ ...p, [o.id]: { status: "error", error: e?.message } })); toast.error(e?.message ?? "Failed."); }
  }

  // Single-page ad-hoc scan (unchanged behavior, now shows grounded placement).
  async function runPage() {
    setRunning(true); setPageReport(null); setPageDisp({});
    try {
      const d = await fetch("/api/seo-agents/internal-links", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target, limit }),
      }).then((r) => r.json());
      if (d?.ok) { setPageReport(d.report); toast.success(`Found ${d.report.suggestions.length} opportunities.`); }
      else toast.error(d?.error ?? "Failed.");
    } catch (e: any) { toast.error(e?.message ?? "Failed."); }
    finally { setRunning(false); }
  }

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center gap-1 rounded-lg border border-border p-1 w-fit text-sm">
        <button onClick={() => setMode("site")} className={cn("px-3 py-1.5 rounded-md", mode === "site" ? "bg-highlight-soft text-highlight-ink font-medium" : "text-muted-foreground hover:bg-muted")}>Whole site</button>
        <button onClick={() => setMode("page")} className={cn("px-3 py-1.5 rounded-md", mode === "page" ? "bg-highlight-soft text-highlight-ink font-medium" : "text-muted-foreground hover:bg-muted")}>One page</button>
      </div>

      {mode === "site" ? (
        <>
          <div className="rounded-lg border border-border p-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[280px]">
              <div className="font-medium text-sm">Whole-site link backlog</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                One sweep scans every money page at once and finds pages that should link to them —
                each with the exact sentence to edit. Runs automatically every night; new items get a Slack ping.
              </p>
            </div>
            <Button onClick={runSweep} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? "Sweeping…" : "Run sweep now"}
            </Button>
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1 text-sm">
            {(["open", "actioned", "dismissed"] as const).map((s) => (
              <button key={s} onClick={() => { setStatusFilter(s); loadBacklog(s); }}
                className={cn("px-3 py-1 rounded-md capitalize", statusFilter === s ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50")}>{s}</button>
            ))}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => loadBacklog()} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
            </Button>
          </div>

          {!swept && opps.length === 0 && !loading && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No backlog loaded yet. Click <b>Run sweep now</b> for a fresh scan, or <button onClick={() => loadBacklog()} className="text-highlight-ink hover:underline">load saved opportunities</button>.
            </div>
          )}

          {opps.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">{opps.length} {statusFilter} opportunit{opps.length === 1 ? "y" : "ies"}</div>
              {opps.map((o) => {
                const st = disp[o.id] ?? { status: "idle" as const };
                return (
                  <div key={o.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a href={o.source_url} target="_blank" rel="noreferrer" className="font-mono text-xs hover:underline flex items-center gap-1">{o.source_path} <ExternalLink className="h-3 w-3" /></a>
                      <span className="text-muted-foreground text-xs">→</span>
                      <span className="font-mono text-xs text-highlight-ink">{o.target_path}</span>
                      <Badge variant="outline" className={cn("text-xs", o.placement === "linkify" ? "text-success border-success/40" : "text-warning border-warning/40")}>
                        {o.placement === "linkify" ? "linkify existing text" : "add a sentence"}
                      </Badge>
                      <span className="text-xs text-muted-foreground ml-auto">relevance {Math.round((o.score ?? 0) * 100)}%</span>
                    </div>
                    {/* Grounded placement */}
                    <div className="mt-2 rounded-md bg-muted/40 border border-border/60 p-2 text-[13px] leading-relaxed">
                      {o.placement === "linkify"
                        ? <SentenceWithAnchor sentence={o.sentence ?? ""} anchor={o.anchor} />
                        : <span className="italic text-muted-foreground">{o.draft_sentence || `Add a sentence mentioning “${o.anchor}” that links to ${o.target_path}.`}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      anchor <span className="font-medium text-highlight-ink">“{o.anchor}”</span> → {o.target_path}
                    </div>
                    {statusFilter === "open" && (
                      <div className="mt-2 flex items-center gap-2">
                        {st.status === "done" ? (
                          <a href={st.ref} target="_blank" rel="noreferrer" className="text-sm text-success flex items-center gap-1 hover:underline"><CheckCircle2 className="h-4 w-4" /> Ticket created <ExternalLink className="h-3 w-3" /></a>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" disabled={st.status === "loading"} onClick={() => createTaskFor(o)}>
                              {st.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ticket className="h-3.5 w-3.5" />} Create task
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => mark(o.id, "actioned")}>Mark done</Button>
                            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => mark(o.id, "dismissed")}>Dismiss</Button>
                          </>
                        )}
                        {st.status === "error" && <span className="text-xs text-destructive">{st.error}</span>}
                      </div>
                    )}
                    {o.ticket_url && statusFilter !== "open" && (
                      <a href={o.ticket_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex text-xs text-highlight-ink hover:underline items-center gap-1">open ticket <ExternalLink className="h-3 w-3" /></a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="rounded-lg border border-border p-4 flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="target" className="flex items-center gap-1">Page that needs links <Tip text="The page you want to boost — other pages will be suggested to link TO it." /></Label>
              <PathCombobox id="target" value={target} onChange={setTarget} options={knownPages} className="w-64" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lim" className="flex items-center gap-1">Pages to search <Tip text="How many existing pages to scan for link opportunities." /></Label>
              <Input id="lim" type="number" min={5} max={60} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-24" />
            </div>
            <Button onClick={runPage} disabled={running} className="ml-auto">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? "Searching…" : "Find link opportunities"}
            </Button>
          </div>

          {pageReport && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                Looked at <b>{pageReport.crawled}</b> pages for <span className="font-mono text-xs">{pageReport.targetPath}</span>
                {pageReport.targetTitle && <> ("{pageReport.targetTitle}")</>}. <b>{pageReport.alreadyLinking}</b> already link to it;
                found <b className="text-highlight-ink">{pageReport.suggestions.length}</b> more that should.
              </div>
              {pageReport.notes.map((n, i) => <div key={i} className="text-xs text-muted-foreground">{n}</div>)}
              {pageReport.suggestions.map((s, i) => {
                const st = pageDisp[i] ?? { status: "idle" as const };
                return (
                  <div key={i} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="font-mono text-xs hover:underline flex items-center gap-1">{s.sourcePath} <ExternalLink className="h-3 w-3" /></a>
                      <Badge variant="outline" className={cn("text-xs", s.placement === "linkify" ? "text-success border-success/40" : "text-warning border-warning/40")}>
                        {s.placement === "linkify" ? "linkify existing text" : "add a sentence"}
                      </Badge>
                      <span className="text-xs text-muted-foreground ml-auto">relevance {Math.round(s.score * 100)}%</span>
                    </div>
                    {s.sourceTitle && <div className="text-xs text-muted-foreground mt-0.5 truncate">{s.sourceTitle}</div>}
                    <div className="mt-2 rounded-md bg-muted/40 border border-border/60 p-2 text-[13px] leading-relaxed">
                      {s.placement === "linkify"
                        ? <SentenceWithAnchor sentence={s.sentence} anchor={s.anchor} />
                        : <span className="italic text-muted-foreground">{s.draftSentence || `Add a sentence mentioning “${s.anchor}”.`}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">anchor <span className="font-medium text-highlight-ink">“{s.anchor}”</span></div>
                    <div className="mt-2">
                      {st.status === "done" ? (
                        <a href={st.ref} target="_blank" rel="noreferrer" className="text-sm text-success flex items-center gap-1 hover:underline"><CheckCircle2 className="h-4 w-4" /> Task created — open <ExternalLink className="h-3 w-3" /></a>
                      ) : (
                        <Button size="sm" variant="outline" disabled={st.status === "loading"} onClick={async () => {
                          setPageDisp((p) => ({ ...p, [i]: { status: "loading" } }));
                          const how = s.placement === "linkify" ? `Linkify "${s.anchor}" in:\n> ${s.sentence}` : `Add a sentence, e.g.:\n> ${s.draftSentence || ""}`;
                          const preview = { kind: "ticket" as const, reason: "internal_link", title: `[SEO] Add internal link → ${pageReport.targetPath}`, rootCause: "CRAWL_BUDGET" as const, owner: "content" as const, priority: "p2" as const, fix: `Add a link from ${s.sourcePath} to ${pageReport.targetPath} using anchor "${s.anchor}".`, body: `**Add an internal link**\n\nFrom: ${s.sourceUrl}\nTo: ${pageReport.target}\nAnchor: "${s.anchor}"\nPlacement: ${s.placement}\n\n${how}\n\n_Suggested by the Internal Linking agent._`, urls: [s.sourceUrl], templates: [] };
                          try {
                            const d = await fetch("/api/indexing/ticket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preview }) }).then((r) => r.json());
                            if (d?.ok) { setPageDisp((p) => ({ ...p, [i]: { status: "done", ref: d.issue?.url } })); toast.success(`Ticket ${d.issue.identifier} created.`); }
                            else { setPageDisp((p) => ({ ...p, [i]: { status: "error", error: d?.error } })); toast.error(d?.error ?? "Failed."); }
                          } catch (e: any) { setPageDisp((p) => ({ ...p, [i]: { status: "error", error: e?.message } })); toast.error(e?.message ?? "Failed."); }
                        }}>
                          {st.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ticket className="h-3.5 w-3.5" />} Create task
                        </Button>
                      )}
                      {st.status === "error" && <span className="text-xs text-destructive ml-2">{st.error}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────── GEO / AI Citations ─────────────────────────── */
function Geo() {
  const [competitors, setCompetitors] = useState("Midjourney, Leonardo, Canva, Runway, Kling, Adobe Firefly, DALL-E");
  const [prompts, setPrompts] = useState("What is the best AI image generator?\nBest free AI image generator online\nBest AI video generator\nHow can I swap faces in a video with AI?");
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<GeoReport | null>(null);
  const [slack, setSlack] = useState<Dispatch>({ status: "idle" });

  async function run() {
    setRunning(true); setReport(null); setSlack({ status: "idle" });
    try {
      const d = await fetch("/api/seo-agents/geo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          competitors: competitors.split(",").map((c) => c.trim()).filter(Boolean),
          prompts: prompts.split("\n").map((p) => p.trim()).filter(Boolean),
        }),
      }).then((r) => r.json());
      if (d?.ok) { setReport(d.report); const n = d.report.enginesUsed.length; toast.success(`${d.report.answered} answers from ${n} engine${n === 1 ? "" : "s"}.`); }
      else toast.error(d?.error ?? "Failed.");
    } catch (e: any) { toast.error(e?.message ?? "Failed."); }
    finally { setRunning(false); }
  }

  async function shareGaps() {
    if (!report) return;
    setSlack({ status: "loading" });
    const lines = [
      `:mag: *AI citation check — ${report.brand}*`,
      `Appears in *${Math.round(report.brandShareOfVoice * 100)}%* of AI answers (${report.answered} answers across ${report.enginesUsed.length || "no"} engine${report.enginesUsed.length === 1 ? "" : "s"}: ${report.enginesUsed.join(", ") || "none"}).`,
      report.sourceGaps.length ? `\n*Source gaps* (sites the AI cites for competitors, not us):` : `\nNo source gaps found.`,
      ...report.sourceGaps.slice(0, 12).map((g) => `• ${g.domain} (${g.count})`),
    ];
    try {
      const d = await fetch("/api/indexing/slack", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: lines.join("\n") }),
      }).then((r) => r.json());
      if (d?.ok) { setSlack({ status: "done" }); toast.success("Shared to Slack."); }
      else { setSlack({ status: "error", error: d?.error }); toast.error(d?.error ?? "Failed."); }
    } catch (e: any) { setSlack({ status: "error", error: e?.message }); toast.error(e?.message ?? "Failed."); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="comp">Competitors to track</Label>
          <Input id="comp" value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="comma-separated" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pr" className="flex items-center gap-1">Questions to ask the AI <Tip text="Buyer-intent questions your customers would ask. One per line." /></Label>
          <Textarea id="pr" value={prompts} onChange={(e) => setPrompts(e.target.value)} rows={4} />
        </div>
        <Button onClick={run} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Asking AI engines…" : "Check AI answers"}
        </Button>
      </div>

      {report && (
        <div className="space-y-4">
          {report.notes.map((n, i) => <div key={i} className="text-xs text-warning">{n}</div>)}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border p-3">
              <div className="text-2xl font-semibold text-highlight-ink">{Math.round(report.brandShareOfVoice * 100)}%</div>
              <div className="text-xs text-muted-foreground mt-0.5">{report.brand} appears in AI answers</div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-2xl font-semibold">{report.enginesUsed.length}<span className="text-base text-muted-foreground">/{report.engines.length}</span></div>
              <div className="text-xs text-muted-foreground mt-0.5">engines checked</div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-2xl font-semibold">{report.citedDomainLeaderboard.length}</div>
              <div className="text-xs text-muted-foreground mt-0.5">sources cited</div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className={cn("text-2xl font-semibold", report.sourceGaps.length ? "text-warning" : "")}>{report.sourceGaps.length}</div>
              <div className="text-xs text-muted-foreground mt-0.5">source gaps</div>
            </div>
          </div>

          {/* Per-engine availability + share of voice — honest record of what actually ran. */}
          <div className="rounded-lg border border-border p-3">
            <div className="text-sm font-medium mb-2">Engines checked <Tip text="Each AI engine lights up when its API key is set. Engines without a key are shown but not counted." /></div>
            <div className="space-y-1.5">
              {report.engines.map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-sm">
                  <span className="w-40 flex items-center gap-1.5 min-w-0">
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", e.available ? "bg-primary" : "bg-muted-foreground/40")} />
                    <span className="truncate">{e.label}</span>
                  </span>
                  {e.available ? (
                    <>
                      <div className="flex-1 h-2 rounded bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.round(e.brandShareOfVoice * 100)}%` }} /></div>
                      <span className="text-xs text-muted-foreground w-28 text-right">{Math.round(e.brandShareOfVoice * 100)}% · {e.answered} ans</span>
                      {e.recentHitRate && (
                        <span className="text-xs text-muted-foreground/70 w-24 text-right shrink-0" title="How often this engine has actually returned an answer over recent checks — a single run can be a false negative (esp. Google AI Overview, which is genuinely intermittent).">
                          answered {e.recentHitRate.answered}/{e.recentHitRate.checked} recently
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="flex-1 text-xs text-muted-foreground italic">not checked — {e.reason}</span>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground/70 mt-2">
              "Answered X/Y recently" tracks the last up-to-10 checks per prompt — an engine (especially Google AI Overview)
              can genuinely show nothing for one run and something the next; a single 0% isn't necessarily broken.
            </p>
          </div>

          {Object.keys(report.competitorShareOfVoice).length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <div className="text-sm font-medium mb-2">Who the AI recommends</div>
              <div className="space-y-1.5">
                {[[report.brand, report.brandShareOfVoice] as const, ...Object.entries(report.competitorShareOfVoice).sort((a, b) => b[1] - a[1])].map(([name, sov]) => (
                  <div key={name} className="flex items-center gap-2 text-sm">
                    <span className={cn("w-40 truncate", name === report.brand && "font-semibold text-highlight-ink")}>{name}</span>
                    <div className="flex-1 h-2 rounded bg-muted overflow-hidden"><div className={cn("h-full", name === report.brand ? "bg-primary" : "bg-muted-foreground/40")} style={{ width: `${Math.round((sov as number) * 100)}%` }} /></div>
                    <span className="text-xs text-muted-foreground w-10 text-right">{Math.round((sov as number) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.sourceGaps.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-sm font-medium">Source gaps — get mentioned on these <Tip text="Sites the AI cites when recommending competitors, but never when mentioning you. Getting covered here is how you enter AI answers." /></div>
                {slack.status === "done" ? <span className="text-xs text-success flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Shared</span> : (
                  <Button size="sm" variant="outline" disabled={slack.status === "loading"} onClick={shareGaps}>
                    {slack.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Share to Slack
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {report.sourceGaps.map((g) => <Badge key={g.domain} variant="outline" className="text-xs">{g.domain} ({g.count})</Badge>)}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border">
            <div className="p-3 border-b border-border text-sm font-medium">Per-question results</div>
            <div className="divide-y divide-border">
              {report.results.map((r, i) => (
                <div key={i} className="p-3 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-highlight-ink border-highlight/40 text-xs">{report.engines.find((e) => e.id === r.engine)?.label ?? r.engine}{r.surface ? ` · ${r.surface}` : ""}</Badge>
                    <span className="font-medium">{r.prompt}</span>
                    {r.error ? <Badge variant="outline" className="text-destructive border-destructive/30 text-xs">no answer</Badge>
                      : r.brandMentioned ? <Badge variant="outline" className="text-success border-success/40 text-xs">we appear</Badge>
                        : <Badge variant="outline" className="text-muted-foreground text-xs">not mentioned</Badge>}
                    {r.recentHitRate && r.recentHitRate.checked > 1 && (
                      <span className="text-xs text-muted-foreground/70" title="How often this exact prompt+engine has answered over recent checks.">
                        ({r.recentHitRate.answered}/{r.recentHitRate.checked} recently)
                      </span>
                    )}
                  </div>
                  {r.error && r.recentHitRate && r.recentHitRate.answered > 0 && (
                    <div className="text-xs text-warning/80 mt-1">
                      Not this time — but has answered {r.recentHitRate.answered} of the last {r.recentHitRate.checked} checks, so this is likely intermittent rather than broken.
                    </div>
                  )}
                  {!r.error && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {r.competitorsMentioned.length > 0 && <>Competitors named: {r.competitorsMentioned.join(", ")}. </>}
                      {r.citedDomains.length > 0 && <>Cited: {r.citedDomains.slice(0, 6).join(", ")}.</>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Page Quality (Programmatic) ─────────────────────────── */
const PQ_VERDICT = {
  publish: { label: "Publish", cls: "text-success border-success/40" },
  noindex: { label: "Noindex", cls: "text-warning border-warning/40" },
  hold: { label: "Hold", cls: "text-destructive border-destructive/40" },
} as const;

function PageQuality() {
  const [template, setTemplate] = useState("");
  const [urlsText, setUrlsText] = useState("");
  const [limit, setLimit] = useState(30);
  const [llm, setLlm] = useState(true);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<PageQualityReport | null>(null);

  async function run() {
    setRunning(true); setReport(null);
    const urls = urlsText.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    try {
      const d = await fetch("/api/seo-agents/page-quality", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: template.trim() || undefined, urls: urls.length ? urls : undefined, limit, llm }),
      }).then((r) => r.json());
      if (d?.ok) { setReport(d.report); toast.success(`Scored ${d.report.crawled} page${d.report.crawled === 1 ? "" : "s"}.`); }
      else toast.error(d?.error ?? "Failed.");
    } catch (e: any) { toast.error(e?.message ?? "Failed."); }
    finally { setRunning(false); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Score a batch of auto-generated / template pages before they ship — catches thin, near-duplicate,
          incomplete, or placeholder/low-quality pages and gives each a <b className="text-foreground">publish / noindex / hold</b> verdict.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pq-tpl" className="flex items-center gap-1">Template or path prefix <Tip text={'e.g. "apps/[slug]", "features/[slug]", or "/tools". Pulls matching pages from the sitemap. Leave blank to sample the whole site.'} /></Label>
            <Input id="pq-tpl" value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="apps/[slug]" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pq-limit">Max pages</Label>
            <Input id="pq-limit" type="number" min={1} max={80} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(80, Number(e.target.value) || 1)))} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pq-urls" className="flex items-center gap-1">Or specific URLs <Tip text="Paste exact URLs (one per line) to check instead of discovering from the sitemap." /></Label>
          <Textarea id="pq-urls" value={urlsText} onChange={(e) => setUrlsText(e.target.value)} rows={3} placeholder={"https://www.imagine.art/apps/…\nhttps://www.imagine.art/features/…"} className="font-mono text-xs" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer w-fit">
          <input type="checkbox" checked={llm} onChange={(e) => setLlm(e.target.checked)} className="accent-teal-500" />
          Read text quality with AI <Tip text="Uses the LLM to flag placeholder, untranslated/mixed-language, or auto-generated filler text that word-count alone misses." />
        </label>
        <Button onClick={run} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Scoring pages…" : "Score pages"}
        </Button>
      </div>

      {report && (
        <div className="space-y-4">
          {report.notes.map((n, i) => <div key={i} className="text-xs text-warning">{n}</div>)}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border p-3"><div className="text-2xl font-semibold">{report.crawled}</div><div className="text-xs text-muted-foreground mt-0.5">pages scored</div></div>
            <div className="rounded-lg border border-border p-3"><div className={cn("text-2xl font-semibold", report.counts.hold ? "text-destructive" : "")}>{report.counts.hold}</div><div className="text-xs text-muted-foreground mt-0.5">hold (don&apos;t publish)</div></div>
            <div className="rounded-lg border border-border p-3"><div className={cn("text-2xl font-semibold", report.counts.noindex ? "text-warning" : "")}>{report.counts.noindex}</div><div className="text-xs text-muted-foreground mt-0.5">noindex</div></div>
            <div className="rounded-lg border border-border p-3"><div className="text-2xl font-semibold">{Math.round(report.avgUniqueness * 100)}%</div><div className="text-xs text-muted-foreground mt-0.5">avg uniqueness</div></div>
          </div>

          <div className="rounded-lg border border-border divide-y divide-border">
            {report.results.map((r) => {
              const V = PQ_VERDICT[r.verdict];
              return (
                <div key={r.url} className="p-3 space-y-1.5">
                  <div className="flex items-start gap-2 flex-wrap">
                    <Badge variant="outline" className={cn("text-xs", V.cls)}>{V.label}</Badge>
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-sm hover:text-highlight-ink hover:underline break-all flex-1 min-w-0 inline-flex items-center gap-1">{r.path}<ExternalLink className="h-3 w-3 opacity-50 shrink-0" /></a>
                    <span className="text-xs text-muted-foreground shrink-0">{r.words}w · {Math.round(r.uniqueness * 100)}% unique{r.llmQuality ? ` · text: ${r.llmQuality}` : ""}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{r.reason}</div>
                  {r.flags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.flags.map((f) => <Badge key={f} variant="outline" className="text-xs text-muted-foreground">{f}</Badge>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Rankings (Rank Watcher) ─────────────────────────── */
interface SerpCompetitor { position: number; domain: string; title: string; link: string }
interface RankPage {
  url: string; path: string; bestPosition: number; totalImpressions: number; opportunity: number;
  queries: { query: string; position: number; impressions: number; ctr: number }[]; gaps: string[];
  competitors: SerpCompetitor[]; competitorQuery?: string; inboundLinkOpportunities: number;
}
interface RankReport { configured: boolean; pages: RankPage[]; notes: string[] }

const ADULT_RE = /\b(nsfw|porn|sex|xxx|nude|naked|undress|clothes?\s*remov|dress\s*remov|hentai|erotic|adult)\b/i;

function RankWatcher() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<RankReport | null>(null);
  const [disp, setDisp] = useState<Record<number, Dispatch>>({});
  // A3 — filter / sort / top-N controls over the (often 100+) result list.
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"opportunity" | "position" | "impressions">("opportunity");
  const [showAll, setShowAll] = useState(false);
  const [hideAdult, setHideAdult] = useState(false);

  async function run() {
    setRunning(true); setReport(null); setDisp({});
    try {
      const d = await fetch("/api/seo-agents/rank-watcher", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json());
      if (d?.ok) { setReport(d.report); toast.success(d.report.configured ? `Found ${d.report.pages.length} pages in striking distance.` : "Connect GSC to use this."); }
      else toast.error(d?.error ?? "Failed.");
    } catch (e: any) { toast.error(e?.message ?? "Failed."); }
    finally { setRunning(false); }
  }

  async function createTask(i: number) {
    if (!report) return;
    const p = report.pages[i];
    setDisp((s) => ({ ...s, [i]: { status: "loading" } }));
    const preview = {
      kind: "ticket" as const, reason: "rank_push", title: `[SEO] Push ${p.path} into top 3`,
      rootCause: "CRAWL_BUDGET" as const, owner: "seo" as const, priority: "p1" as const,
      fix: p.gaps.join(" ") || "Push this page from striking distance (pos 4–10) into the top 3.",
      body: `**Striking-distance money page: ${p.url}**\n\nBest position: ${p.bestPosition}, ${p.totalImpressions} impressions/28d.\n\n**Queries close to top 3:**\n${p.queries.slice(0, 10).map((qq) => `- "${qq.query}" — pos ${qq.position}, ${qq.impressions} impressions`).join("\n")}\n\n**Recommended fixes:**\n${p.gaps.map((g) => `- ${g}`).join("\n") || "- (on-page looks fine; needs links/authority)"}${p.competitors.length ? `\n\n**Outranking us for "${p.competitorQuery}":**\n${p.competitors.map((c) => `- #${c.position} ${c.domain} — ${c.title}`).join("\n")}` : ""}`,
      urls: [p.url], templates: [],
    };
    try {
      const d = await fetch("/api/indexing/ticket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preview }) }).then((r) => r.json());
      if (d?.ok) { setDisp((s) => ({ ...s, [i]: { status: "done", ref: d.issue?.url } })); toast.success(`Ticket ${d.issue.identifier} created.`); }
      else { setDisp((s) => ({ ...s, [i]: { status: "error", error: d?.error } })); toast.error(d?.error ?? "Failed."); }
    } catch (e: any) { setDisp((s) => ({ ...s, [i]: { status: "error", error: e?.message } })); toast.error(e?.message ?? "Failed."); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground max-w-xl">Finds your money pages ranking in positions 4–10 — the ones a small push turns into top-3 traffic — and lists exactly what to fix.</p>
        <Button onClick={run} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Checking rankings…" : "Find striking-distance pages"}
        </Button>
      </div>
      {report && !report.configured && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">{report.notes[0]}</div>
      )}
      {report?.configured && report.notes.map((n, i) => <div key={i} className="text-xs text-muted-foreground">{n}</div>)}

      {report?.configured && report.pages.length > 0 && (() => {
        const ranked = report.pages
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => !q || p.path.toLowerCase().includes(q.toLowerCase()) || p.queries.some((qq) => qq.query.toLowerCase().includes(q.toLowerCase())))
          .filter(({ p }) => !hideAdult || !(ADULT_RE.test(p.path) || p.queries.some((qq) => ADULT_RE.test(qq.query))))
          .sort((a, b) =>
            sort === "position" ? a.p.bestPosition - b.p.bestPosition
            : sort === "impressions" ? b.p.totalImpressions - a.p.totalImpressions
            : b.p.opportunity - a.p.opportunity);
        const shown = showAll ? ranked : ranked.slice(0, 20);
        return (
          <>
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by page or query…" className="h-8 w-56" />
              <select value={sort} onChange={(e) => setSort(e.target.value as any)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                <option value="opportunity">Sort: opportunity</option>
                <option value="position">Sort: best position</option>
                <option value="impressions">Sort: impressions</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={hideAdult} onChange={(e) => setHideAdult(e.target.checked)} /> Hide adult-term pages</label>
              <span className="text-xs text-muted-foreground ml-auto">{shown.length} of {ranked.length}</span>
            </div>
            {shown.map(({ p, i }) => {
              const st = disp[i] ?? { status: "idle" as const };
              return (
                <div key={i} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={p.url} target="_blank" rel="noreferrer" className="font-mono text-xs hover:underline flex items-center gap-1">{p.path} <ExternalLink className="h-3 w-3" /></a>
                    <Badge variant="outline" className="text-xs">best pos {p.bestPosition}</Badge>
                    <span className="text-xs text-muted-foreground ml-auto">{p.totalImpressions.toLocaleString()} impressions/28d · opportunity {p.opportunity.toLocaleString()}</span>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {p.queries.slice(0, 6).map((qq) => <span key={qq.query} className="inline-block mr-3">“{qq.query}” <span className="text-foreground/70">pos {qq.position}</span></span>)}
                  </div>
                  {p.gaps.length > 0 && <ul className="mt-2 text-xs list-disc pl-4 space-y-0.5">{p.gaps.map((g, gi) => <li key={gi}>{g}</li>)}</ul>}
                  {p.competitors.length > 0 && (
                    <div className="mt-2 text-xs">
                      <span className="text-muted-foreground">Outranking us for “{p.competitorQuery}”:</span>
                      <div className="mt-1 space-y-0.5">
                        {p.competitors.map((c) => (
                          <a key={c.link} href={c.link} target="_blank" rel="noreferrer" className="block hover:underline">
                            <span className="text-destructive">#{c.position}</span> <span className="font-medium">{c.domain}</span> <span className="text-muted-foreground">— {c.title}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-2">
                    {st.status === "done" ? (
                      <a href={st.ref} target="_blank" rel="noreferrer" className="text-sm text-success flex items-center gap-1 hover:underline"><CheckCircle2 className="h-4 w-4" /> Ticket created — open <ExternalLink className="h-3 w-3" /></a>
                    ) : (
                      <Button size="sm" variant="outline" disabled={st.status === "loading"} onClick={() => createTask(i)}>
                        {st.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ticket className="h-3.5 w-3.5" />} Create ticket
                      </Button>
                    )}
                    {st.status === "error" && <span className="text-xs text-destructive ml-2">{st.error}</span>}
                  </div>
                </div>
              );
            })}
            {!showAll && ranked.length > 20 && (
              <button onClick={() => setShowAll(true)} className="w-full py-2 text-sm text-highlight-ink hover:bg-muted/30 rounded-md border border-border">Show all {ranked.length} pages</button>
            )}
          </>
        );
      })()}
    </div>
  );
}

/* ─────────────────────────── Content Refresh ─────────────────────────── */
interface Brief {
  url: string; path: string; title: string; wordCount: number; hasSchema: boolean;
  recentClicks?: number; priorClicks?: number; dropPct?: number; brief: string; note?: string;
}
interface RefreshReport { mode: "manual" | "auto"; gscConfigured: boolean; briefs: Brief[]; notes: string[] }

function ContentRefresh() {
  const [url, setUrl] = useState("");
  const [running, setRunning] = useState<"" | "manual" | "auto">("");
  const [report, setReport] = useState<RefreshReport | null>(null);
  const [disp, setDisp] = useState<Record<number, Dispatch>>({});

  async function run(manual: boolean) {
    setRunning(manual ? "manual" : "auto"); setReport(null); setDisp({});
    try {
      const d = await fetch("/api/seo-agents/content-refresh", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manual ? { url } : {}),
      }).then((r) => r.json());
      if (d?.ok) { setReport(d.report); toast.success(`Generated ${d.report.briefs.length} brief(s).`); }
      else toast.error(d?.error ?? "Failed.");
    } catch (e: any) { toast.error(e?.message ?? "Failed."); }
    finally { setRunning(""); }
  }

  async function createTask(i: number) {
    if (!report) return;
    const b = report.briefs[i];
    setDisp((s) => ({ ...s, [i]: { status: "loading" } }));
    const preview = {
      kind: "ticket" as const, reason: "content_refresh", title: `[SEO] Refresh ${b.path}`,
      rootCause: "THIN_DUPLICATE" as const, owner: "content" as const, priority: "p2" as const,
      fix: "Refresh this page per the brief.",
      body: `**Content refresh: ${b.url}**\n${b.dropPct !== undefined ? `Clicks down ${Math.round(b.dropPct * 100)}% (${b.priorClicks}→${b.recentClicks}).\n` : ""}\n${b.brief || "(on-page signals only)"}`,
      urls: [b.url], templates: [],
    };
    try {
      const d = await fetch("/api/indexing/ticket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preview }) }).then((r) => r.json());
      if (d?.ok) { setDisp((s) => ({ ...s, [i]: { status: "done", ref: d.issue?.url } })); toast.success(`Ticket ${d.issue.identifier} created.`); }
      else { setDisp((s) => ({ ...s, [i]: { status: "error", error: d?.error } })); toast.error(d?.error ?? "Failed."); }
    } catch (e: any) { setDisp((s) => ({ ...s, [i]: { status: "error", error: e?.message } })); toast.error(e?.message ?? "Failed."); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5 flex-1 min-w-[260px]">
            <Label htmlFor="rurl" className="flex items-center gap-1">Brief a specific page <Tip text="Paste any imagine.art URL to get a refresh brief now — works without Google Search Console." /></Label>
            <Input id="rurl" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/features/lucy-edit" />
          </div>
          <Button onClick={() => run(true)} disabled={!url || running !== ""}>
            {running === "manual" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Generate brief
          </Button>
          <Button variant="outline" onClick={() => run(false)} disabled={running !== ""}>
            {running === "auto" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Find declining pages
          </Button>
        </div>
      </div>
      {report && report.notes.map((n, i) => <div key={i} className="text-xs text-warning">{n}</div>)}
      {report?.briefs.map((b, i) => {
        const st = disp[i] ?? { status: "idle" as const };
        return (
          <div key={i} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <a href={b.url} target="_blank" rel="noreferrer" className="font-mono text-xs hover:underline flex items-center gap-1">{b.path} <ExternalLink className="h-3 w-3" /></a>
              {b.dropPct !== undefined && <Badge variant="outline" className="text-destructive border-destructive/30 text-xs">↓ {Math.round(b.dropPct * 100)}% clicks</Badge>}
              <span className="text-xs text-muted-foreground ml-auto">{b.wordCount} words · schema {b.hasSchema ? "yes" : "no"}</span>
            </div>
            {b.title && <div className="text-xs text-muted-foreground mt-0.5 truncate">{b.title}</div>}
            {b.note && <div className="text-xs text-warning mt-1">{b.note}</div>}
            {b.brief && <pre className="mt-2 whitespace-pre-wrap text-xs bg-muted/40 rounded p-3">{b.brief}</pre>}
            <div className="mt-2">
              {st.status === "done" ? (
                <a href={st.ref} target="_blank" rel="noreferrer" className="text-sm text-success flex items-center gap-1 hover:underline"><CheckCircle2 className="h-4 w-4" /> Ticket created — open <ExternalLink className="h-3 w-3" /></a>
              ) : (
                <Button size="sm" variant="outline" disabled={st.status === "loading"} onClick={() => createTask(i)}>
                  {st.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ticket className="h-3.5 w-3.5" />} Create task
                </Button>
              )}
              {st.status === "error" && <span className="text-xs text-destructive ml-2">{st.error}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── Backlinks (Targeting #4 + Scoring #5) ─────────────────────────── */
interface Prospect {
  url: string; domain: string; title: string; relevance: number; freshnessYear: number | null;
  freshness: "fresh" | "stale" | "unknown"; outboundQuality: number; spamRisk: "low" | "medium" | "high";
  domainAuthority: number | null; replyLikelihood: "high" | "medium" | "low"; isListicle: boolean;
  angle: string; composite: number; note?: string;
}
interface BacklinkReport {
  target: string; targetPath: string; topicLabel: string; queries: string[];
  candidatesFound: number; prospects: Prospect[]; notes: string[];
}
const spamCls: Record<string, string> = { low: "text-success", medium: "text-warning", high: "text-destructive" };
const replyCls: Record<string, string> = { high: "text-success", medium: "text-warning", low: "text-muted-foreground" };

function Backlinks() {
  const [target, setTarget] = useState("/ai-image-generator");
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<BacklinkReport | null>(null);
  const [disp, setDisp] = useState<Record<number, Dispatch>>({});
  const [slack, setSlack] = useState<Dispatch>({ status: "idle" });
  const knownPages = useKnownPages();

  async function run() {
    setRunning(true); setReport(null); setDisp({}); setSlack({ status: "idle" });
    try {
      const d = await fetch("/api/seo-agents/backlinks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }) }).then((r) => r.json());
      if (d?.ok && d.report) { setReport(d.report); toast.success(`Found ${d.report.prospects.length} scored prospects.`); }
      else toast.error(d?.error ?? "Failed.");
    } catch (e: any) { toast.error(e?.message ?? "Failed."); }
    finally { setRunning(false); }
  }

  async function createTask(i: number) {
    if (!report) return;
    const p = report.prospects[i];
    setDisp((s) => ({ ...s, [i]: { status: "loading" } }));
    const preview = {
      kind: "ticket" as const, reason: "backlink_outreach", title: `[SEO] Outreach: ${p.domain} → ${report.targetPath}`,
      rootCause: "CRAWL_BUDGET" as const, owner: "seo" as const, priority: "p2" as const,
      fix: p.angle,
      body: `**Backlink prospect for ${report.target}**\n\nPage: ${p.url}\nDomain: ${p.domain} (score ${p.composite}/100)\nRelevance ${Math.round(p.relevance * 100)}% (est) · spam risk ${p.spamRisk} (est) · reply likelihood ${p.replyLikelihood} (est)${p.domainAuthority != null ? ` · Ahrefs DR ${p.domainAuthority}/100` : ""}\n\n**Angle:** ${p.angle}`,
      urls: [p.url], templates: [],
    };
    try {
      const d = await fetch("/api/indexing/ticket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preview }) }).then((r) => r.json());
      if (d?.ok) { setDisp((s) => ({ ...s, [i]: { status: "done", ref: d.issue?.url } })); toast.success(`Ticket ${d.issue.identifier} created.`); }
      else { setDisp((s) => ({ ...s, [i]: { status: "error", error: d?.error } })); toast.error(d?.error ?? "Failed."); }
    } catch (e: any) { setDisp((s) => ({ ...s, [i]: { status: "error", error: e?.message } })); toast.error(e?.message ?? "Failed."); }
  }

  async function shareList() {
    if (!report) return;
    setSlack({ status: "loading" });
    const lines = [
      `:link: *Backlink prospects for ${report.targetPath}* (${report.topicLabel})`,
      ...report.prospects.slice(0, 12).map((p, i) => `${i + 1}. ${p.domain} — ${p.composite}/100, reply ${p.replyLikelihood} — ${p.angle}`),
    ];
    try {
      const d = await fetch("/api/indexing/slack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: lines.join("\n") }) }).then((r) => r.json());
      if (d?.ok) { setSlack({ status: "done" }); toast.success("Shared to Slack."); }
      else { setSlack({ status: "error", error: d?.error }); toast.error(d?.error ?? "Failed."); }
    } catch (e: any) { setSlack({ status: "error", error: e?.message }); toast.error(e?.message ?? "Failed."); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4 flex flex-wrap items-end gap-4">
        <div className="space-y-1.5 flex-1 min-w-[260px]">
          <Label htmlFor="btarget" className="flex items-center gap-1">Page that needs backlinks <Tip text="Finds articles that could link to THIS page specifically (not your homepage), then scores each prospect." /></Label>
          <PathCombobox id="btarget" value={target} onChange={setTarget} options={knownPages} />
        </div>
        <Button onClick={run} disabled={running}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Finding prospects…" : "Find backlink prospects"}
        </Button>
      </div>

      {report && (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm flex items-center justify-between gap-2 flex-wrap">
            <span>Topic: <b>{report.topicLabel}</b> · {report.candidatesFound} candidates · <b className="text-highlight-ink">{report.prospects.length}</b> scored prospects</span>
            {report.prospects.length > 0 && (slack.status === "done"
              ? <span className="text-xs text-success flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Shared</span>
              : <Button size="sm" variant="outline" disabled={slack.status === "loading"} onClick={shareList}>{slack.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Share list to Slack</Button>)}
          </div>
          {report.notes.map((n, i) => <div key={i} className="text-xs text-muted-foreground">{n}</div>)}
          {report.prospects.map((p, i) => {
            const st = disp[i] ?? { status: "idle" as const };
            return (
              <div key={i} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn("text-lg font-semibold w-12", (p.composite ?? 0) >= 60 ? "text-success" : p.composite >= 35 ? "text-warning" : "text-muted-foreground")}>{p.composite}</span>
                  <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline flex items-center gap-1 font-medium">{p.domain} <ExternalLink className="h-3 w-3" /></a>
                  <Badge variant="outline" className="text-xs uppercase text-muted-foreground">est.</Badge>
                  <Tip text="Composite is a 0–100 estimate blending on-page signals — a prioritization guide, not a measured metric. Domain authority is the one live signal (Ahrefs); relevance, spam risk and reply likelihood are heuristics." />
                  {p.isListicle && <Badge variant="outline" className="text-xs">listicle</Badge>}
                </div>
                {p.title && <div className="text-xs text-muted-foreground mt-0.5 truncate pl-14">{p.title}</div>}
                <div className="mt-2 pl-14 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>relevance <b className="text-foreground/80">{Math.round(p.relevance * 100)}%</b> <span className="text-muted-foreground/50">est.</span></span>
                  <span>freshness <b className="text-foreground/80">{p.freshness}{p.freshnessYear ? ` (${p.freshnessYear})` : ""}</b></span>
                  <span>spam risk <b className={spamCls[p.spamRisk]}>{p.spamRisk}</b> <span className="text-muted-foreground/50">est.</span></span>
                  <span>reply <b className={replyCls[p.replyLikelihood]}>{p.replyLikelihood}</b> <span className="text-muted-foreground/50">est.</span></span>
                  <span>authority <b className="text-foreground/80">{p.domainAuthority != null ? `${p.domainAuthority}/100` : "n/a"}</b> <span className="text-success/60">live</span></span>
                </div>
                <div className="mt-2 pl-14 text-sm">Angle: <span className="text-highlight-ink">{p.angle}</span></div>
                <div className="mt-2 pl-14">
                  {st.status === "done" ? (
                    <a href={st.ref} target="_blank" rel="noreferrer" className="text-sm text-success flex items-center gap-1 hover:underline"><CheckCircle2 className="h-4 w-4" /> Task created — open <ExternalLink className="h-3 w-3" /></a>
                  ) : (
                    <Button size="sm" variant="outline" disabled={st.status === "loading"} onClick={() => createTask(i)}>
                      {st.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ticket className="h-3.5 w-3.5" />} Create outreach task
                    </Button>
                  )}
                  {st.status === "error" && <span className="text-xs text-destructive ml-2">{st.error}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
