"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Activity, Bot, ChevronDown, ChevronRight, CircleStop, DollarSign, Hand, Loader2, Pause, Play, Plus,
  Radar, Search, Settings, ShieldAlert, Sparkles, Target, Users, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface CampaignState {
  campaign: any;
  is_active: boolean;
  prospects_by_status: Record<string, number>;
  deals: any[];
  interventions: any[];
  events: any[];
  budget: { total: number; used: number; remaining: number; currency: string };
}

const AGENT_ICONS: Record<string, any> = {
  strategy: Sparkles,
  discovery: Search,
  qualification: Target,
  contact_intel: Users,
  outreach: Zap,
  inbox_triage: Activity,
  negotiation: Bot,
  hitl: Hand,
  deal: DollarSign,
  campaign_manager: Radar,
};

const PHASE_LABELS: Record<string, string> = {
  draft: "Draft", planning: "Planning", discovering: "Discovering", qualifying: "Qualifying",
  resolving_contacts: "Resolving contacts", outreaching: "Outreaching", monitoring: "Monitoring",
  completing: "Completing", completed: "Completed", stopped: "Stopped", failed: "Failed",
};

const PHASE_ORDER = ["draft", "planning", "discovering", "qualifying", "resolving_contacts", "outreaching", "monitoring", "completing", "completed"];

const PHASE_DESCRIPTIONS: Record<string, string> = {
  draft: "Not started yet",
  planning: "Building strategy — deciding which publications to target",
  discovering: "Scanning the web for relevant publications and contacts",
  qualifying: "Evaluating each prospect — checking domain authority and fit",
  resolving_contacts: "Finding email addresses for qualified prospects",
  outreaching: "Sending personalized outreach emails",
  monitoring: "Watching for replies and managing ongoing conversations",
  completing: "Wrapping up — finalizing deals and generating report",
  completed: "All done!",
  stopped: "Stopped by user",
  failed: "Something went wrong",
};

// Pipeline stages and which agents belong to each
const PIPELINE_STAGES = [
  { key: "discovering", label: "Discover", agents: ["discovery"] },
  { key: "qualifying", label: "Qualify", agents: ["qualification"] },
  { key: "resolving_contacts", label: "Contact", agents: ["contact_intel"] },
  { key: "outreaching", label: "Outreach", agents: ["outreach"] },
  { key: "monitoring", label: "Negotiate", agents: ["negotiation", "inbox_triage"] },
];

function fmtMoney(v: number | null | undefined, cur = "USD") {
  if (v == null) return "—";
  return `${cur} ${Number(v).toLocaleString()}`;
}

function timeAgo(ts: string): string {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function phaseProgress(phase: string): number {
  if (phase === "completed") return 100;
  if (phase === "stopped" || phase === "failed") return 0;
  const i = PHASE_ORDER.indexOf(phase);
  if (i < 0) return 0;
  return Math.min(100, ((i + 1) / PHASE_ORDER.length) * 100);
}

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<CampaignState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [assistText, setAssistText] = useState<Record<string, string>>({});
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [activitySearch, setActivitySearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const lastEventId = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${id}`, { cache: "no-store" });
      if (!res.ok) return;
      const d: CampaignState = await res.json();
      setState(d);
      if (d.events?.length) lastEventId.current = d.events[d.events.length - 1].id;
    } catch { /* transient */ }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const t = setInterval(async () => {
      if (!state || !state.is_active || busy) return;
      try {
        await fetch(`/api/campaigns/${id}/tick`, { method: "POST" });
        load();
      } catch { /* transient */ }
    }, 25000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, state?.is_active]);

  async function control(action: string) {
    setBusy(action);
    // Optimistic UI: immediately update state for responsive feel
    if (state?.campaign) {
      const optimistic = { ...state };
      if (action === "pause") {
        optimistic.campaign = { ...optimistic.campaign, paused_outreach: true, paused_discovery: true, paused_negotiation: true };
      } else if (action === "resume") {
        optimistic.campaign = { ...optimistic.campaign, paused_outreach: false, paused_discovery: false, paused_negotiation: false, emergency_stopped: false };
        if (optimistic.campaign.phase === "stopped") optimistic.campaign.phase = "discovering";
      } else if (action === "stop") {
        optimistic.campaign = { ...optimistic.campaign, phase: "stopped" };
      } else if (action === "emergency") {
        optimistic.campaign = { ...optimistic.campaign, emergency_stopped: true };
      }
      setState(optimistic);
    }
    try {
      if (action === "start") {
        await fetch(`/api/campaigns/${id}/start`, { method: "POST" });
        toast.success("Campaign started — agents are working.");
      } else if (action === "tick") {
        const r = await fetch(`/api/campaigns/${id}/tick`, { method: "POST" }).then((x) => x.json());
        toast.success(`Tick done (${r.action ?? r.mode ?? ""}).`);
      } else {
        if ((action === "emergency" || action === "stop") && !window.confirm(action === "emergency" ? "EMERGENCY STOP will halt ALL agents and outreach immediately. Are you sure?" : "Stop this campaign? It can be resumed later.")) return;
        const body: Record<string, unknown> =
          action === "pause" ? { paused_outreach: true, paused_discovery: true, paused_negotiation: true }
            : action === "resume" ? { action: "resume", paused_outreach: false, paused_discovery: false, paused_negotiation: false }
              : action === "stop" ? { action: "stop" }
                : { emergency_stopped: true };
        await fetch(`/api/campaigns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        toast.success(action === "emergency" ? "EMERGENCY STOP — everything halted." : `Campaign ${action}d.`);
      }
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const patch: Record<string, unknown> = {};
      if (settingsForm.budget_total) patch.budget_total = Number(settingsForm.budget_total);
      if (settingsForm.max_per_deal) patch.max_per_deal = Number(settingsForm.max_per_deal);
      if (settingsForm.min_dr) patch.min_dr = Number(settingsForm.min_dr);
      if (settingsForm.geos !== undefined) patch.geos = settingsForm.geos.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (settingsForm.excluded_domains !== undefined) patch.excluded_domains = settingsForm.excluded_domains.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (settingsForm.constraints_text !== undefined) patch.constraints_text = settingsForm.constraints_text;
      if (settingsForm.email_template_id !== undefined) patch.email_template_id = settingsForm.email_template_id || null;
      await fetch(`/api/campaigns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      toast.success("Settings saved.");
      setSettingsOpen(false);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  }

  async function cloneCampaign() {
    if (!window.confirm("Clone this campaign with all its settings?")) return;
    setBusy("clone");
    try {
      const r = await fetch(`/api/campaigns/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clone" }) }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      toast.success(`Cloned as "${r.name}"`);
      window.location.href = `/campaigns/${r.id}`;
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to clone");
    } finally {
      setBusy(null);
    }
  }

  async function deleteCampaign() {
    if (!window.confirm("DELETE this campaign and ALL its data? This cannot be undone.")) return;
    if (!window.confirm("Are you REALLY sure? All prospects, emails, deals, and events will be permanently deleted.")) return;
    setBusy("delete");
    try {
      await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
      toast.success("Campaign deleted.");
      window.location.href = "/campaigns";
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete");
    } finally {
      setBusy(null);
    }
  }

  async function exportData(format: "csv" | "json") {
    setExporting(true);
    try {
      const data = {
        campaign: state?.campaign,
        prospects_by_status: state?.prospects_by_status,
        deals: state?.deals,
        events: state?.events,
        budget: state?.budget,
      };
      const blob = new Blob([format === "json" ? JSON.stringify(data, null, 2) : convertToCSV(data)], { type: format === "json" ? "application/json" : "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${state?.campaign?.name ?? "campaign"}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported as ${format.toUpperCase()}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function assist(interventionId: string) {
    const input = (assistText[interventionId] ?? "").trim();
    if (!input) { toast.error("Provide the answer for the agent to continue."); return; }
    setBusy(`assist-${interventionId}`);
    try {
      const res = await fetch("/api/agent/interventions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: interventionId, assist_input: input }),
      });
      const d = await res.json();
      if (!res.ok || d?.ok === false) throw new Error(d?.error ?? "Failed");
      toast.success("Input delivered — the negotiation resumed.");
      setAssistText((t) => ({ ...t, [interventionId]: "" }));
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(null);
    }
  }

  const agentBoard = useMemo(() => buildAgentBoard(state), [state]);
  if (!state) {
    return <div className="p-10 text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading campaign…</div>;
  }

  const c = state.campaign;
  const budgetPct = state.budget.total > 0 ? Math.min(100, (state.budget.used / state.budget.total) * 100) : 0;
  const dealsCount = state.deals.filter((d) => d.status !== "cancelled").length;
  const goalPct = c.desired_deals ? Math.min(100, (dealsCount / c.desired_deals) * 100) : 0;
  const openInterventions = state.interventions.filter((i) => i.status === "open");

  const activeAgents = agentBoard.filter((a) => a.status === "active");
  const recentAgents = agentBoard.filter((a) => a.status === "recent");
  const lastEvent = state.events.length ? state.events[state.events.length - 1] : null;
  const lastEventAge = lastEvent ? Date.now() - new Date(lastEvent.ts).getTime() : null;

  // Determine current pipeline stage index
  const currentStageIdx = PHASE_ORDER.indexOf(c.phase);

  return (
    <div className="space-y-6">
      {/* Loading skeleton */}
      {!state && (
        <div className="space-y-4 animate-pulse">
          <div className="h-10 bg-white/5 rounded-lg w-1/3" />
          <div className="h-20 bg-white/5 rounded-lg" />
          <div className="grid grid-cols-3 gap-4">
            <div className="h-32 bg-white/5 rounded-lg" />
            <div className="h-32 bg-white/5 rounded-lg" />
            <div className="h-32 bg-white/5 rounded-lg" />
          </div>
        </div>
      )}

      {/* Live status bar */}
      {state.is_active && (
        <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/5 via-emerald-500/[0.02] to-transparent p-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-emerald-400">
                  {activeAgents.length > 0
                    ? `${activeAgents.map((a) => a.label).join(", ")} working…`
                    : recentAgents.length > 0
                      ? `${recentAgents[0].label} just finished`
                      : "Processing…"}
                </span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{PHASE_DESCRIPTIONS[c.phase] ?? c.phase}</span>
              </div>
              {lastEvent && (
                <div className="text-xs text-muted-foreground mt-1 truncate">
                  Last: <span className="text-foreground/70">{eventSummary(lastEvent)}</span>
                  {lastEventAge != null && <span className="ml-1 opacity-50">({timeAgo(new Date(lastEvent.ts).toISOString())})</span>}
                </div>
              )}
            </div>
            <Loader2 className="h-4 w-4 text-emerald-500 animate-spin shrink-0" />
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500/60 transition-all duration-1000 ease-out"
              style={{ width: `${phaseProgress(c.phase)}%` }} />
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold">{c.name}</h1>
            <Badge variant={c.phase === "completed" ? "default" : c.phase === "stopped" || c.emergency_stopped ? "destructive" : "secondary"}>
              {c.emergency_stopped ? "EMERGENCY STOPPED" : PHASE_LABELS[c.phase] ?? c.phase}
            </Badge>
            {c.demo_mode && <Badge variant="outline" className="border-amber-500/50 text-amber-500">DEMO MODE</Badge>}
            {c.autonomy_mode === "autonomous" && <Badge variant="outline" className="border-violet-500/50 text-violet-400">AUTONOMOUS</Badge>}
          </div>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            {c.objective || "Acquire editorial placements."}{c.website_url ? ` · ${c.website_url}` : ""}
            {c.keywords?.length ? ` · ${(c.keywords as string[]).join(", ")}` : ""}
          </p>
          {(c.geos?.length > 0 || c.constraints_text) && (
            <div className="flex flex-wrap gap-2 mt-2">
              {c.geos?.length > 0 && <Badge variant="outline" className="text-xs">Geo: {(c.geos as string[]).join(", ")}</Badge>}
              {c.constraints_text && <Badge variant="outline" className="text-xs max-w-xs truncate" title={c.constraints_text}>Constraints: {c.constraints_text}</Badge>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!state.is_active && c.phase !== "completed" && c.phase !== "stopped" && (
            <Button onClick={() => control("start")} disabled={!!busy} size="sm">
              {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start
            </Button>
          )}
          {state.is_active && (
            <>
              <Button variant="outline" size="sm" onClick={() => control("pause")} disabled={!!busy}>
                <Pause className="h-4 w-4" /> Pause
              </Button>
              <Button variant="outline" size="sm" onClick={() => control("tick")} disabled={!!busy}>
                {busy === "tick" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Tick now
              </Button>
            </>
          )}
          {(c.phase === "stopped" || c.paused_outreach) && (
            <Button variant="outline" size="sm" onClick={() => control("resume")} disabled={!!busy}>
              <Play className="h-4 w-4" /> Resume
            </Button>
          )}
          {state.is_active && (
            <Button variant="outline" size="sm" onClick={() => control("stop")} disabled={!!busy}>
              <CircleStop className="h-4 w-4" /> Stop
            </Button>
          )}
          {!c.emergency_stopped && (
            <Button variant="destructive" size="sm" onClick={() => control("emergency")} disabled={!!busy}>
              <ShieldAlert className="h-4 w-4" /> Emergency stop
            </Button>
          )}
          <div className="h-4 w-px bg-white/10" />
          <Button variant="ghost" size="sm" onClick={cloneCampaign} disabled={!!busy} title="Clone campaign">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => exportData("json")} disabled={exporting} title="Export JSON">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : "JSON"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => exportData("csv")} disabled={exporting} title="Export CSV">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : "CSV"}
          </Button>
          <Button variant="ghost" size="sm" onClick={deleteCampaign} disabled={!!busy} title="Delete campaign" className="text-destructive hover:text-destructive">
            <CircleStop className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Pipeline flow */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-1 overflow-x-auto">
            {PIPELINE_STAGES.map((stage, i) => {
              const stagePhaseIdx = PHASE_ORDER.indexOf(stage.key);
              const isComplete = currentStageIdx > stagePhaseIdx;
              const isCurrent = c.phase === stage.key || (stage.agents.some((a) => agentBoard.find((b) => b.agent === a)?.status === "active"));
              const isPending = !isComplete && !isCurrent;
              const stageAgentCounts = stage.agents.map((a) => agentBoard.find((b) => b.agent === a)).filter(Boolean);
              const totalItems = stageAgentCounts.reduce((sum, a) => sum + (a?.itemCount ?? 0), 0);
              const hasActive = stageAgentCounts.some((a) => a?.status === "active");

              return (
                <div key={stage.key} className="flex items-center">
                  <div className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all whitespace-nowrap",
                    isComplete && "bg-emerald-500/10 text-emerald-400",
                    isCurrent && "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30",
                    isPending && "text-muted-foreground/50",
                  )}>
                    {hasActive ? (
                      <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                    ) : isComplete ? (
                      <span className="h-3 w-3 rounded-full bg-emerald-500 shrink-0 flex items-center justify-center text-[8px] text-white">✓</span>
                    ) : (
                      <span className="h-3 w-3 rounded-full border border-current shrink-0" />
                    )}
                    <span>{stage.label}</span>
                    {totalItems > 0 && (
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                        hasActive ? "bg-emerald-500/30 text-emerald-300" : "bg-white/10 text-muted-foreground",
                      )}>
                        {totalItems}
                      </span>
                    )}
                  </div>
                  {i < PIPELINE_STAGES.length - 1 && (
                    <div className={cn(
                      "w-6 h-px mx-1 shrink-0",
                      isComplete ? "bg-emerald-500/50" : "bg-white/10",
                    )} />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Settings */}
      <Card>
        <button className="w-full flex items-center justify-between px-6 py-3 text-left" onClick={() => {
          if (!settingsOpen) {
            setSettingsForm({
              budget_total: String(c.budget_total ?? ""),
              max_per_deal: String(c.max_per_deal ?? ""),
              min_dr: String(c.min_dr ?? ""),
              geos: Array.isArray(c.geos) ? c.geos.join(", ") : (c.geos ?? ""),
              excluded_domains: Array.isArray(c.excluded_domains) ? c.excluded_domains.join(", ") : (c.excluded_domains ?? ""),
              constraints_text: c.constraints_text ?? "",
              email_template_id: c.email_template_id ?? "",
            });
          }
          setSettingsOpen(!settingsOpen);
        }}>
          <CardTitle className="text-sm font-medium flex items-center gap-2"><Settings className="h-4 w-4" /> Campaign settings</CardTitle>
          {settingsOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>
        {settingsOpen && (
          <CardContent className="pt-0 space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Budget (total)</label>
                <Input type="number" min={0} value={settingsForm.budget_total ?? ""} onChange={(e) => setSettingsForm((f) => ({ ...f, budget_total: e.target.value }))} placeholder="e.g. 500" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Max per deal</label>
                <Input type="number" min={0} value={settingsForm.max_per_deal ?? ""} onChange={(e) => setSettingsForm((f) => ({ ...f, max_per_deal: e.target.value }))} placeholder="e.g. 100" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Min DR</label>
                <Input type="number" min={0} max={100} value={settingsForm.min_dr ?? ""} onChange={(e) => setSettingsForm((f) => ({ ...f, min_dr: e.target.value }))} placeholder="e.g. 20" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Geos (comma-separated)</label>
                <Input value={settingsForm.geos ?? ""} onChange={(e) => setSettingsForm((f) => ({ ...f, geos: e.target.value }))} placeholder="e.g. US, UK, CA" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Excluded domains (comma-separated)</label>
              <Input value={settingsForm.excluded_domains ?? ""} onChange={(e) => setSettingsForm((f) => ({ ...f, excluded_domains: e.target.value }))} placeholder="e.g. competitor.com, spam.net" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Constraints / notes for agents</label>
              <Input value={settingsForm.constraints_text ?? ""} onChange={(e) => setSettingsForm((f) => ({ ...f, constraints_text: e.target.value }))} placeholder="e.g. Only English articles, no sponsored content" />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" onClick={saveSettings} disabled={savingSettings}>
                {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save settings
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Progress */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><Target className="h-4 w-4" /> Goal progress</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold">{dealsCount} / {c.desired_deals ?? "?"}</span>
              <span className="text-sm text-muted-foreground">placements agreed</span>
            </div>
            <Progress value={goalPct} className="mt-2" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><DollarSign className="h-4 w-4" /> Budget</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold">{fmtMoney(state.budget.used, state.budget.currency)}</span>
              <span className="text-sm text-muted-foreground">of {fmtMoney(state.budget.total, state.budget.currency)} · {fmtMoney(state.budget.remaining, state.budget.currency)} left</span>
            </div>
            <Progress value={budgetPct} className="mt-2" />
          </CardContent>
        </Card>
      </div>

      {/* Agent board */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Agents</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {agentBoard.map((a) => {
            const Icon = AGENT_ICONS[a.agent] ?? Bot;
            const isActive = a.status === "active";
            const isRecent = a.status === "recent";
            return (
              <div key={a.agent} className={cn(
                "rounded-lg border p-3 transition-all duration-300",
                isActive && "border-emerald-500/50 bg-emerald-500/5 shadow-[0_0_12px_rgba(16,185,129,0.08)]",
                isRecent && "border-emerald-500/20 bg-emerald-500/[0.02]",
                !isActive && !isRecent && "border-border/50",
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {isActive ? (
                      <span className="relative flex h-2.5 w-2.5 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      </span>
                    ) : isRecent ? (
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/40 shrink-0" />
                    ) : null}
                    <Icon className="h-4 w-4" /> {a.label}
                  </div>
                  {a.itemCount > 0 && (
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                      isActive ? "bg-emerald-500/30 text-emerald-300" : "bg-white/10 text-muted-foreground",
                    )}>
                      {a.itemCount}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">
                  {isActive && !a.lastDetail && <span className="inline-flex items-center gap-1 text-emerald-500"><Loader2 className="h-3 w-3 animate-spin" /> Working…</span>}
                  {a.lastDetail || <span className="opacity-40">idle</span>}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {a.lastActionAt ? timeAgo(new Date(a.lastActionAt).toISOString()) : "—"}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* HITL interventions */}
      {openInterventions.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-500">
              <Hand className="h-4 w-4" /> Action required ({openInterventions.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {openInterventions.map((iv) => (
              <div key={iv.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  <Badge variant="outline">{iv.type}</Badge>
                  <span className="font-medium">{iv.ask}</span>
                  <span className="text-xs text-muted-foreground">{timeAgo(iv.created_at)}</span>
                </div>
                {iv.reason && <p className="text-xs text-muted-foreground">Why paused: {iv.reason}</p>}
                <div className="flex gap-2">
                  <Input value={assistText[iv.id] ?? ""} onChange={(e) => setAssistText((t) => ({ ...t, [iv.id]: e.target.value }))}
                    placeholder="Your answer becomes the agent's trusted input…" />
                  <Button size="sm" disabled={busy === `assist-${iv.id}`} onClick={() => assist(iv.id)}>
                    {busy === `assist-${iv.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Resume
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Live activity — expandable */}
        <Card>
          <button
            className="w-full"
            onClick={() => setActivityExpanded((v) => !v)}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Activity className="h-4 w-4" /> Live activity
                  {state.events.length > 0 && (
                    <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-muted-foreground">{state.events.length}</span>
                  )}
                </span>
                <span className="text-muted-foreground">
                  {activityExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
              </CardTitle>
            </CardHeader>
          </button>
          {activityExpanded && (
            <CardContent>
              <div className="mb-3">
                <Input
                  value={activitySearch}
                  onChange={(e) => setActivitySearch(e.target.value)}
                  placeholder="Search activity by agent, action, or keyword…"
                  className="h-8 text-xs"
                />
              </div>
              <div className="max-h-[480px] overflow-y-auto space-y-1 pr-2">
                {[...state.events].reverse().filter((ev) => {
                  if (!activitySearch) return true;
                  const q = activitySearch.toLowerCase();
                  return ev.agent?.toLowerCase().includes(q) || ev.action?.toLowerCase().includes(q) || eventSummary(ev)?.toLowerCase().includes(q);
                }).slice(0, 120).map((ev) => (
                  <div key={ev.id} className="flex gap-2 text-xs border-l-2 pl-2 py-0.5 group"
                    style={{ borderColor: ev.level === "error" ? "#ef4444" : ev.level === "warn" ? "#f59e0b" : "rgba(16,185,129,.6)" }}>
                    <span className="text-muted-foreground whitespace-nowrap">{new Date(ev.ts).toLocaleTimeString()}</span>
                    <span className="font-medium whitespace-nowrap">{ev.agent}</span>
                    <span className="whitespace-nowrap text-foreground/70">{ev.action.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground truncate">{eventSummary(ev)}</span>
                  </div>
                ))}
                {!state.events.length && <p className="text-sm text-muted-foreground">No activity yet — press Start.</p>}
              </div>
            </CardContent>
          )}
          {!activityExpanded && state.events.length > 0 && (
            <CardContent className="pt-0">
              <div className="space-y-1">
                {[...state.events].reverse().slice(0, 3).map((ev) => (
                  <div key={ev.id} className="flex gap-2 text-xs border-l-2 pl-2 py-0.5 opacity-60"
                    style={{ borderColor: ev.level === "error" ? "#ef4444" : ev.level === "warn" ? "#f59e0b" : "rgba(16,185,129,.6)" }}>
                    <span className="text-muted-foreground whitespace-nowrap">{new Date(ev.ts).toLocaleTimeString()}</span>
                    <span className="font-medium whitespace-nowrap">{ev.agent}</span>
                    <span className="text-muted-foreground truncate">{eventSummary(ev)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>

        {/* Deals + funnel */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Funnel</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center">
                {[
                  ["discovered", "Found"], ["qualified", "Qualified"], ["ready", "Contacts"],
                  ["outreached", "Contacted"], ["negotiating", "Negotiating"],
                ].map(([k, label]) => (
                  <div key={k} className="rounded-lg border p-2">
                    <div className="text-xl font-semibold">{state.prospects_by_status[k] ?? 0}</div>
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2 text-center">
                <div className="rounded-lg border p-2">
                  <div className="text-xl font-semibold">{state.prospects_by_status.replied ?? 0}</div>
                  <div className="text-[11px] text-muted-foreground">Replies</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-xl font-semibold">{dealsCount}</div>
                  <div className="text-[11px] text-muted-foreground">Deals</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                Deals
                <Link href="/campaigns/new" className="text-xs font-normal text-primary inline-flex items-center gap-1"><Plus className="h-3 w-3" /> New</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {state.deals.length === 0 && <p className="text-sm text-muted-foreground">No deals yet — agents are working on it.</p>}
              {state.deals.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  <div>
                    <div className="font-medium">{d.publication || d.domain_host}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.original_ask != null && <>asked {fmtMoney(d.original_ask, d.currency)} · </>}
                      agreed {fmtMoney(d.agreed_price, d.currency)}
                      {d.original_ask != null && d.agreed_price != null && Number(d.original_ask) > Number(d.agreed_price) && (
                        <> · saved {fmtMoney(Number(d.original_ask) - Number(d.agreed_price), d.currency)}</>
                      )}
                    </div>
                  </div>
                  <Badge variant={d.status === "cancelled" ? "destructive" : "secondary"}>{d.status.replace(/_/g, " ")}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function eventSummary(ev: any): string {
  const d = ev.detail ?? {};
  switch (ev.action) {
    case "search_batch": {
      const q = (d.query ?? "").slice(0, 36);
      return `Searched "${q}" — ${d.hits ?? 0} hits, ${d.created ?? 0} new`;
    }
    case "prospect_found":
      return `Found ${d.host ?? d.domain ?? "site"}`;
    case "prospect_qualified":
      return `Qualified ${d.host ?? ""} (score ${d.score ?? "?"})`;
    case "prospect_rejected":
      return `Rejected ${d.host ?? ""} — ${d.reason_code ?? "low score"}`;
    case "contact_found":
    case "contact_resolved":
      return `Found contact for ${d.host ?? ""} via ${d.source ?? "scrape"}`;
    case "contact_not_found":
      return `No contact found for ${d.host ?? ""}`;
    case "outreach_sent":
    case "outreach_queued":
      return `Emailed ${d.host ?? ""} — "${(d.subject ?? "").slice(0, 40)}"`;
    case "outreach_failed":
      return `Failed to email ${d.host ?? ""}`;
    case "reply_detected":
      return `Reply from ${d.host ?? ""}`;
    case "proposal_sent":
    case "counter_sent":
      return `Sent offer to ${d.host ?? ""} at $${d.price ?? "?"}`;
    case "deal_agreed":
      return `Deal with ${d.host ?? ""} at $${d.price ?? "?"}${d.waived ? " (waived)" : ""}`;
    case "deal_lost":
      return `Lost deal with ${d.host ?? ""}`;
    case "phase_transition":
      return d.reason ?? `Moved to ${d.to ?? d.phase ?? ""}`;
    case "tick":
    case "tick_completed":
      return `Tick completed in ${d.duration_ms ?? "?"}ms`;
    default: {
      const parts: string[] = [];
      if (d.host) parts.push(d.host);
      if (d.query) parts.push(`"${String(d.query).slice(0, 30)}"`);
      if (d.score != null) parts.push(`score ${d.score}`);
      if (d.count != null) parts.push(`${d.count} items`);
      if (d.created != null) parts.push(`${d.created} new`);
      if (parts.length) return parts.join(" · ");
      return "";
    }
  }
}

function buildAgentBoard(state: CampaignState | null) {
  const defs: Array<{ agent: string; label: string }> = [
    { agent: "strategy", label: "Strategy" },
    { agent: "discovery", label: "Discovery" },
    { agent: "qualification", label: "Qualification" },
    { agent: "contact_intel", label: "Contact intel" },
    { agent: "outreach", label: "Outreach" },
    { agent: "inbox_triage", label: "Inbox triage" },
    { agent: "negotiation", label: "Negotiation" },
    { agent: "hitl", label: "Human-in-loop" },
    { agent: "deal", label: "Deals" },
    { agent: "campaign_manager", label: "Manager" },
  ];
  const byAgent = new Map<string, any[]>();
  for (const ev of state?.events ?? []) {
    if (!byAgent.has(ev.agent)) byAgent.set(ev.agent, []);
    byAgent.get(ev.agent)!.push(ev);
  }
  const now = Date.now();
  const pbs = state?.prospects_by_status ?? {};
  const itemCounts: Record<string, number> = {
    discovery: (pbs.discovered ?? 0),
    qualification: (pbs.qualified ?? 0) + (pbs.rejected ?? 0),
    contact_intel: (pbs.ready ?? 0),
    outreach: (pbs.outreached ?? 0),
    negotiation: (pbs.negotiating ?? 0) + (pbs.replied ?? 0),
  };

  return defs.map(({ agent, label }) => {
    const evs = byAgent.get(agent) ?? [];
    const last = evs[evs.length - 1];
    const lastTs = last ? new Date(last.ts).getTime() : 0;
    const age = lastTs ? now - lastTs : Infinity;
    const status: "active" | "recent" | "idle" = age < 30_000 ? "active" : age < 120_000 ? "recent" : "idle";
    return {
      agent,
      label,
      status,
      lastActionAt: lastTs || null,
      lastDetail: last ? eventSummary(last) : null,
      itemCount: itemCounts[agent] ?? 0,
    };
  });
}

function convertToCSV(data: any): string {
  const rows: string[] = [];
  // Campaign summary
  rows.push("Section,Field,Value");
  rows.push(`Campaign,name,"${data.campaign?.name ?? ""}"`);
  rows.push(`Campaign,phase,"${data.campaign?.phase ?? ""}"`);
  rows.push(`Campaign,budget_total,"${data.budget?.total ?? 0}"`);
  rows.push(`Campaign,budget_used,"${data.budget?.used ?? 0}"`);
  rows.push("");
  // Deals
  rows.push("Deal,Publication,Status,Price,Started,Completed");
  for (const d of data.deals ?? []) {
    rows.push(`Deal,"${d.publication_name ?? ""}","${d.status ?? ""}","${d.price ?? ""}","${d.created_at ?? ""}","${d.completed_at ?? ""}"`);
  }
  rows.push("");
  // Events (last 50)
  rows.push("Event,Agent,Action,Detail,Time");
  for (const e of (data.events ?? []).slice(-50)) {
    rows.push(`Event,"${e.agent ?? ""}","${e.action ?? ""}","${(e.detail?.summary ?? "").replace(/"/g, '""')}","${e.ts ?? ""}"`);
  }
  return rows.join("\n");
}
