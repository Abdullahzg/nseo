"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Activity, Bot, Check, ChevronDown, ChevronRight, CircleStop, Clock, DollarSign, Filter, Hand,
  Handshake, Inbox, Loader2, Mail, MessageSquare, Pause, Play, Plus, Radar, Search, Send, Settings,
  ShieldAlert, Sparkles, Target, Users, X, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ProspectTable } from "@/components/campaigns/ProspectTable";
import { cn } from "@/lib/utils";

interface CampaignState {
  campaign: any;
  is_active: boolean;
  prospects_by_status: Record<string, number>;
  prospects: any[];
  deals: any[];
  interventions: any[];
  events: any[];
  budget: { total: number; used: number; remaining: number; currency: string };
  email_stats: { total: number; sent: number; opened: number; bounced: number; openRate: number; bounceRate: number; variants: Record<string, { sent: number; opened: number; bounced: number; openRate: number }> };
  roi: {
    total_publisher_asking: number;
    final_placement_spend: number;
    negotiated_savings: number;
    savings_pct: number;
    placements_agreed: number;
    avg_agreed_price: number;
    reply_rate: number;
    agreement_rate: number;
    autonomy_rate: number;
    human_interventions: number;
    manual_actions_avoided: number;
  };
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
  human_delay: Clock,
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

function fmtMoney(v: number | null | undefined, cur = "USD") {
  if (v == null) return "—";
  return `${cur} ${Number(v).toLocaleString()}`;
}

function timeAgo(ts: string): string {
  const date = new Date(ts);
  if (isNaN(date.getTime())) return "just now";
  const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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
  const [settingsForm, setSettingsForm] = useState<Record<string, any>>({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [activitySearch, setActivitySearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [demoBannerDismissed, setDemoBannerDismissed] = useState(false);
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);
  const [expandedIntervention, setExpandedIntervention] = useState<string | null>(null);
  const [interventionThreads, setInterventionThreads] = useState<Record<string, any[]>>({});
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateData, setTemplateData] = useState<{ id: string | null; subject: string; body: string; guidance: string } | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<{ subject: string; body: string } | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [varsOpen, setVarsOpen] = useState(false);
  const lastEventId = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${id}`, { cache: "no-store" });
      if (!res.ok) { setLoadError(true); return; }
      setLoadError(false);
      const d: CampaignState = await res.json();
      setState(d);
      if (d.events?.length) lastEventId.current = d.events[d.events.length - 1].id;
    } catch { setLoadError(true); }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const t = setInterval(async () => {
      if (!state || !state.is_active || busy) return;
      try {
        await fetch(`/api/campaigns/${id}/tick`, { method: "POST" });
        load();
      } catch { /* transient */ }
    }, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, state?.is_active]);

  // Fetch email template when card is expanded
  useEffect(() => {
    if (!templateOpen) return;
    fetch(`/api/campaigns/${id}/template`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setTemplateData(d))
      .catch(() => {});
  }, [templateOpen, id]);

  async function saveTemplate() {
    if (!editingTemplate) return;
    setTemplateSaving(true);
    try {
      await fetch(`/api/campaigns/${id}/template`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingTemplate),
      });
      setTemplateData((prev) => prev ? { ...prev, ...editingTemplate } : prev);
      setEditingTemplate(null);
      toast.success("Template saved.");
    } catch {
      toast.error("Failed to save template.");
    } finally {
      setTemplateSaving(false);
    }
  }

  async function control(action: string) {
    setBusy(action);
    try {
      if (action === "start") {
        await fetch(`/api/campaigns/${id}/start`, { method: "POST" });
        toast.success("Campaign started — agents are working.");
      } else if (action === "tick") {
        const r = await fetch(`/api/campaigns/${id}/tick`, { method: "POST" }).then((x) => x.json());
        toast.success(`Tick done (${r.action ?? r.mode ?? ""}).`);
      } else {
        if (action === "emergency" || action === "stop") {
          const msg = action === "emergency" ? "EMERGENCY STOP will halt ALL agents immediately." : "Stop this campaign? It can be resumed later.";
          const confirmed = await new Promise<boolean>((resolve) => {
            toast(msg, {
              action: { label: "Confirm", onClick: () => resolve(true) },
              cancel: { label: "Cancel", onClick: () => resolve(false) },
              duration: 10000,
            });
          });
          if (!confirmed) return;
        }
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
      if (settingsForm.ab_variant_ids !== undefined) patch.ab_variant_ids = settingsForm.ab_variant_ids;
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
    const confirmed = await new Promise<boolean>((resolve) => {
      toast("Clone this campaign with all its settings?", {
        action: { label: "Clone", onClick: () => resolve(true) },
        cancel: { label: "Cancel", onClick: () => resolve(false) },
        duration: 8000,
      });
    });
    if (!confirmed) return;
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
    const step1 = await new Promise<boolean>((resolve) => {
      toast("DELETE this campaign and ALL its data? This cannot be undone.", {
        action: { label: "Yes, delete", onClick: () => resolve(true) },
        cancel: { label: "Cancel", onClick: () => resolve(false) },
        duration: 10000,
      });
    });
    if (!step1) return;
    const step2 = await new Promise<boolean>((resolve) => {
      toast("Are you REALLY sure? All data will be permanently deleted.", {
        action: { label: "Delete forever", onClick: () => resolve(true) },
        cancel: { label: "Cancel", onClick: () => resolve(false) },
        duration: 10000,
      });
    });
    if (!step2) return;
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

  async function importProspects(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setImporting(true);
    try {
      const csv = await file.text();
      const res = await fetch("/api/prospects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: id, csv }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      toast.success(`Imported ${data.imported} prospects${data.skipped ? `, ${data.skipped} skipped` : ""}`);
      if (data.errors?.length) toast.warning(`Rows with issues: ${data.errors.join("; ")}`);
      setImportOpen(false);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed");
    } finally {
      setImporting(false);
      e.target.value = "";
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

  async function fetchInterventionThread(interventionId: string, anchorEmailId?: string) {
    if (!anchorEmailId) return;
    if (interventionThreads[interventionId]) return;
    try {
      const res = await fetch(`/api/negotiation/threads?anchor_email_id=${encodeURIComponent(anchorEmailId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setInterventionThreads((t) => ({ ...t, [interventionId]: data.messages ?? data.thread ?? [] }));
    } catch { /* ignore */ }
  }

  async function abandonIntervention(interventionId: string, emailId: string) {
    const confirmed = await new Promise<boolean>((resolve) => {
      toast("Abandon this negotiation? The publisher will not be contacted again for this thread.", {
        action: { label: "Abandon", onClick: () => resolve(true) },
        cancel: { label: "Cancel", onClick: () => resolve(false) },
        duration: 10000,
      });
    });
    if (!confirmed) return;
    setBusy(`abandon-${interventionId}`);
    try {
      await fetch(`/api/negotiation/${encodeURIComponent(emailId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "handoff", reason: "abandoned_by_user" }),
      });
      toast.success("Negotiation abandoned.");
      setExpandedIntervention(null);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to abandon");
    } finally {
      setBusy(null);
    }
  }

  const agentBoard = useMemo(() => buildAgentBoard(state), [state]);

  if (!state) {
    if (loadError) {
      return (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive" />
          <p className="text-lg font-medium">Failed to load campaign.</p>
          <Button onClick={load} variant="outline">Retry</Button>
        </div>
      );
    }
    return (
      <div className="space-y-6 animate-pulse">
        {/* Verbose loading header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading campaign…</span>
          </div>
        </div>

        {/* Stat cards skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-1.5 w-full" />
            </div>
          ))}
        </div>

        {/* Pipeline skeleton */}
        <Skeleton className="h-12 w-full rounded-lg" />

        {/* Content skeletons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>

        {/* Agent board skeleton */}
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-2.5 w-2.5 rounded-full" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    );
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

  return (
    <div className="space-y-6">
      {/* Live status bar */}
      {state.is_active && (
        <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/5 via-emerald-500/[0.02] to-transparent p-3 sm:p-4">
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
                <span className="text-xs text-muted-foreground hidden sm:inline">·</span>
                <span className="text-xs text-muted-foreground hidden sm:inline">{PHASE_DESCRIPTIONS[c.phase] ?? c.phase}</span>
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
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-semibold truncate">{c.name}</h1>
            <Badge variant={c.phase === "completed" ? "default" : c.phase === "stopped" || c.emergency_stopped ? "destructive" : "secondary"}>
              {c.emergency_stopped ? "EMERGENCY STOPPED" : PHASE_LABELS[c.phase] ?? c.phase}
            </Badge>
            {c.demo_mode && <Badge variant="outline" className="border-amber-500/50 text-amber-500">DEMO MODE</Badge>}
            {c.autonomy_mode === "autonomous" && <Badge variant="outline" className="border-violet-500/50 text-violet-400">AUTONOMOUS</Badge>}
            <Badge variant="outline" className="border-emerald-500/50 text-emerald-400">
              {c.model_provider ? `${c.model_provider}` : "Strands"}
            </Badge>
            {state.events.some((ev) => ev.action?.includes("fallback") || ev.detail?.summary?.includes("fallback")) && (
              <Badge variant="outline" className="border-orange-500/50 text-orange-400">LLM FALLBACK</Badge>
            )}
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
          <Button variant="ghost" size="sm" onClick={cloneCampaign} disabled={!!busy} title="Clone campaign" aria-label="Clone campaign">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => exportData("json")} disabled={exporting} title="Export JSON">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : "JSON"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => exportData("csv")} disabled={exporting} title="Export CSV">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : "CSV"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)} title="Import prospects from CSV">
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Import"}
          </Button>
          <Button variant="ghost" size="sm" onClick={deleteCampaign} disabled={!!busy} title="Delete campaign" aria-label="Delete campaign" className="text-destructive hover:text-destructive">
            <CircleStop className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Persistent demo mode banner */}
      {c.demo_mode && !demoBannerDismissed && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-amber-500 font-medium">Demo Mode</span>
            <span className="text-muted-foreground">— simulated publishers and responses</span>
          </div>
          <button
            onClick={() => setDemoBannerDismissed(true)}
            className="text-muted-foreground hover:text-foreground text-xs ml-4 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Demo mode explainer */}
      {c.demo_mode && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <span className="text-amber-500 mt-0.5 text-sm">🧪</span>
            <div className="text-sm">
              <span className="font-medium text-amber-400">Demo Mode</span>
              <span className="text-muted-foreground"> — All outreach, replies, and deals are simulated. No real emails are sent. The agents run the full pipeline with fake publisher responses so you can see how everything works.</span>
            </div>
          </div>
        </div>
      )}



      {/* Campaign summary — plain English */}
      <Card className="border-primary/20">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Bot className="h-4 w-4" /> What happened in this campaign
          </h3>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="text-muted-foreground text-xs mb-1">Discovered</div>
              <div className="font-semibold text-lg">{(state.prospects_by_status.discovered ?? 0) + (state.prospects_by_status.qualified ?? 0) + (state.prospects_by_status.rejected ?? 0) + (state.prospects_by_status.ready ?? 0) + (state.prospects_by_status.outreached ?? 0) + (state.prospects_by_status.replied ?? 0) + (state.prospects_by_status.negotiating ?? 0)} prospects</div>
              <div className="text-xs text-muted-foreground">found by scanning the web for publications matching your keywords</div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="text-muted-foreground text-xs mb-1">Qualified</div>
              <div className="font-semibold text-lg">{(state.prospects_by_status.qualified ?? 0) + (state.prospects_by_status.ready ?? 0)} prospects</div>
              <div className="text-xs text-muted-foreground">passed DR & relevance checks ({state.prospects_by_status.rejected ?? 0} rejected)</div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="text-muted-foreground text-xs mb-1">Emailed</div>
              <div className="font-semibold text-lg">{state.email_stats.sent ?? 0} emails</div>
              <div className="text-xs text-muted-foreground">{state.email_stats.opened ?? 0} opened · {state.email_stats.bounced ?? 0} bounced</div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="text-muted-foreground text-xs mb-1">Deals</div>
              <div className="font-semibold text-lg">{dealsCount} agreed</div>
              <div className="text-xs text-muted-foreground">{state.roi.negotiated_savings > 0 ? `$${Math.round(state.roi.negotiated_savings)} saved via negotiation` : "no deals closed yet"}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pipeline Progress */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Radar className="h-4 w-4" /> Pipeline Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            {(() => {
              const events = state.events ?? [];
              const countByAction = (action: string) => events.filter((e) => e.action === action).length;
              const sumDetail = (action: string, key: string) =>
                events.filter((e) => e.action === action).reduce((s, e) => s + ((e.detail as any)?.[key] ?? 0), 0);

              const phases = [
                {
                  key: "discovery",
                  label: "Discovery",
                  icon: Search,
                  stats: `Found ${sumDetail("search_batch", "hits")} publications across ${countByAction("search_batch")} queries`,
                },
                {
                  key: "qualification",
                  label: "Qualification",
                  icon: Filter,
                  stats: `${countByAction("prospect_qualified")} passed, ${countByAction("prospect_rejected")} rejected`,
                },
                {
                  key: "contact_intel",
                  label: "Contact Resolution",
                  icon: Mail,
                  stats: `Found ${countByAction("contact_found")} emails, ${countByAction("contact_not_found")} still looking`,
                },
                {
                  key: "outreach",
                  label: "Outreach",
                  icon: Send,
                  stats: `${countByAction("outreach_sent")} emails sent`,
                },
                {
                  key: "monitoring",
                  label: "Monitoring",
                  icon: Inbox,
                  stats: `${countByAction("reply_detected")} replies received`,
                },
                {
                  key: "negotiation",
                  label: "Negotiation",
                  icon: Handshake,
                  stats: `${countByAction("deal_agreed")} deals agreed, ${countByAction("proposal_sent") + countByAction("counter_sent")} in progress`,
                },
              ];

              const phaseOrder = ["draft", "planning", "discovering", "qualifying", "resolving_contacts", "outreaching", "monitoring", "completed"];
              const currentIdx = phaseOrder.indexOf(state.campaign?.phase ?? "draft");

              const getPhaseIdx = (key: string) =>
                phaseOrder.indexOf(
                  key === "discovery" ? "discovering" :
                  key === "qualification" ? "qualifying" :
                  key === "contact_intel" ? "resolving_contacts" :
                  key === "outreach" ? "outreaching" :
                  key === "monitoring" ? "monitoring" :
                  key === "negotiation" ? "monitoring" : key
                );

              const agentForPhase: Record<string, string> = {
                discovery: "discovery",
                qualification: "qualification",
                contact_intel: "contact_intel",
                outreach: "outreach",
                monitoring: "inbox_triage",
                negotiation: "negotiation",
              };

              return phases.map((phase, i) => {
                const phaseIdx = getPhaseIdx(phase.key);
                const isComplete = currentIdx > phaseIdx || state.campaign?.phase === "completed";
                const isCurrent = currentIdx === phaseIdx ||
                  (phase.key === "negotiation" && currentIdx >= phaseOrder.indexOf("monitoring"));
                const Icon = phase.icon;
                const isExpanded = expandedPhase === phase.key;
                const phaseEvents = events
                  .filter((e) => e.agent === agentForPhase[phase.key])
                  .reverse()
                  .slice(0, 3);

                return (
                  <div key={phase.key} className="flex gap-3 pb-4 last:pb-0 relative">
                    {i < phases.length - 1 && (
                      <div className={`absolute left-4 top-8 w-0.5 h-full ${isComplete ? "bg-emerald-500" : "bg-white/10"}`} />
                    )}
                    <div className={`relative z-10 flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${
                      isComplete ? "bg-emerald-500/20 text-emerald-400" :
                      isCurrent ? "bg-blue-500/20 text-blue-400 animate-pulse" :
                      "bg-white/5 text-muted-foreground"
                    }`}>
                      {isComplete ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <button
                        className="w-full text-left"
                        onClick={() => setExpandedPhase(isExpanded ? null : phase.key)}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${isComplete ? "text-foreground" : isCurrent ? "text-foreground" : "text-muted-foreground"}`}>
                            {phase.label}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                            isComplete ? "bg-emerald-500/20 text-emerald-400" :
                            isCurrent ? "bg-blue-500/20 text-blue-400" :
                            "bg-white/5 text-muted-foreground"
                          }`}>
                            {isComplete ? "done" : isCurrent ? "active" : "pending"}
                          </span>
                          <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{phase.stats}</p>
                      </button>
                      {isExpanded && (
                        <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
                          {phaseEvents.length === 0 && (
                            <p className="text-[11px] text-muted-foreground italic">No events yet for this phase.</p>
                          )}
                          {phaseEvents.map((ev) => (
                            <div key={ev.id} className="flex gap-2 text-[11px]">
                              <span className="text-muted-foreground/60 whitespace-nowrap tabular-nums shrink-0">
                                {new Date(ev.ts).toLocaleTimeString()}
                              </span>
                              <span className="text-foreground/70 truncate">{eventSummary(ev)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </CardContent>
      </Card>

      {/* Planning / active phase status panel */}
      {(c.phase === "planning" || c.phase === "draft" || c.phase === "discovering") && state.is_active && (
        <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 via-card to-card">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="shrink-0 mt-1">
                <span className="relative flex h-4 w-4">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-4 w-4 rounded-full bg-emerald-500" />
                </span>
              </div>
              <div className="flex-1 min-w-0 space-y-4">
                {/* Phase header */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-emerald-300">
                      {PHASE_LABELS[c.phase] ?? c.phase}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {PHASE_DESCRIPTIONS[c.phase] ?? "Processing..."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={async () => {
                      setBusy("tick");
                      try {
                        await fetch(`/api/campaigns/${id}/tick`, { method: "POST" });
                        toast.success("Manual tick triggered.");
                        load();
                      } catch (e: any) { toast.error(e?.message ?? "Tick failed"); }
                      finally { setBusy(null); }
                    }} disabled={!!busy}>
                      {busy === "tick" ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
                      Force tick
                    </Button>
                  </div>
                </div>

                {/* Active agents working */}
                {activeAgents.length > 0 && (
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3">
                    <div className="text-xs font-medium text-emerald-400 mb-2 flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" /> Currently working
                    </div>
                    <div className="space-y-1.5">
                      {activeAgents.map((a) => (
                        <div key={a.agent} className="flex items-center gap-2 text-sm">
                          {(() => { const Icon = AGENT_ICONS[a.agent] ?? Bot; return <Icon className="h-3.5 w-3.5 text-emerald-400" />; })()}
                          <span className="font-medium">{a.label}</span>
                          {a.lastDetail && <span className="text-muted-foreground truncate">— {a.lastDetail}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* What's happening now */}
                {activeAgents.length === 0 && (
                  <div className="rounded-lg bg-muted/50 border border-border p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-1">Current status</div>
                    <p className="text-sm text-foreground/80">
                      {c.phase === "planning" && "Building strategy — deciding which publications to target. The strategy agent analyzes your keywords and objective to plan discovery queries."}
                      {c.phase === "discovering" && "Scanning the web for relevant publications and contacts. Discovery agents are searching using your keywords."}
                      {c.phase === "draft" && "Campaign created. Starting up agents..."}
                      {!["planning", "discovering", "draft"].includes(c.phase) && PHASE_DESCRIPTIONS[c.phase]}
                    </p>
                    {lastEvent && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Last event {timeAgo(new Date(lastEvent.ts).toISOString())}: {eventSummary(lastEvent)}
                      </p>
                    )}
                    {!lastEvent && (
                      <p className="text-xs text-muted-foreground mt-2 animate-pulse">
                        Waiting for first agent event — this may take a few seconds...
                      </p>
                    )}
                  </div>
                )}

                {/* Recent events timeline */}
                {state.events.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">Recent activity</div>
                    <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1">
                      {[...state.events].reverse().slice(0, 10).map((ev) => (
                        <div key={ev.id} className="flex gap-2 text-xs border-l-2 pl-2 py-0.5"
                          style={{ borderColor: ev.level === "error" ? "#ef4444" : ev.level === "warn" ? "#f59e0b" : "rgba(16,185,129,.5)" }}>
                          <span className="text-muted-foreground whitespace-nowrap tabular-nums">
                            {new Date(ev.ts).toLocaleTimeString()}
                          </span>
                          <span className="font-medium whitespace-nowrap text-foreground/80">{ev.agent}</span>
                          <span className="text-muted-foreground truncate">{eventSummary(ev)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {state.events.length === 0 && (
                  <p className="text-sm text-muted-foreground">Waiting for first agent event...</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
              ab_variant_ids: Array.isArray(c.ab_variant_ids) ? c.ab_variant_ids : [],
            });
          }
          setSettingsOpen(!settingsOpen);
        }}>
          <CardTitle className="text-sm font-medium flex items-center gap-2"><Settings className="h-4 w-4" /> Campaign settings</CardTitle>
          {settingsOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>
        {settingsOpen && (
          <CardContent className="pt-0 space-y-3">
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
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
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Email template</label>
                <Input value={settingsForm.email_template_id ?? ""} onChange={(e) => setSettingsForm((f) => ({ ...f, email_template_id: e.target.value }))} placeholder="Template ID (or leave empty for default)" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">A/B test variants (comma-separated IDs)</label>
                <Input value={settingsForm.ab_variant_ids?.join(", ") ?? ""} onChange={(e) => setSettingsForm((f) => ({ ...f, ab_variant_ids: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) }))} placeholder="e.g. abc123, def456" />
              </div>
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

      {/* Email Template */}
      <Card>
        <button className="w-full flex items-center justify-between px-6 py-3 text-left" onClick={() => setTemplateOpen(!templateOpen)}>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Mail className="h-4 w-4" /> Email template
            {templateData?.subject && !templateOpen && (
              <span className="text-xs text-muted-foreground font-normal truncate max-w-[300px]">— {templateData.subject}</span>
            )}
          </CardTitle>
          {templateOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>
        {templateOpen && (
          <CardContent className="pt-0">
            {!templateData && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading template…
              </div>
            )}
            {templateData && (
              <div className="space-y-4">
                {editingTemplate ? (
                  /* ── Edit mode ── */
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Subject</label>
                      <Input
                        value={editingTemplate.subject}
                        onChange={(e) => setEditingTemplate((t) => t ? { ...t, subject: e.target.value } : t)}
                        placeholder="Email subject line"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Body</label>
                      <textarea
                        value={editingTemplate.body}
                        onChange={(e) => setEditingTemplate((t) => t ? { ...t, body: e.target.value } : t)}
                        rows={12}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                        placeholder="Email body — use {{variables}} for personalization"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={saveTemplate} disabled={templateSaving}>
                        {templateSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingTemplate(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  /* ── Preview mode ── */
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Subject</div>
                      <div
                        className="text-sm font-semibold"
                        dangerouslySetInnerHTML={{ __html: highlightVariables(templateData.subject || "(empty)") }}
                      />
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-2">Body</div>
                      <div
                        className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/80"
                        dangerouslySetInnerHTML={{ __html: highlightVariables(templateData.body || "(empty)") }}
                      />
                    </div>

                    {/* Variables reference */}
                    <div className="rounded-lg border border-border overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
                        onClick={() => setVarsOpen(!varsOpen)}
                      >
                        <span className="text-xs font-medium text-muted-foreground">Available variables</span>
                        {varsOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                      </button>
                      {varsOpen && (
                        <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                          {[
                            ["{{author_name}}", "Author's first name"],
                            ["{{first_name}}", "Same as author_name"],
                            ["{{pub_name}}", "Publication name (e.g. \"techcrunch\")"],
                            ["{{website_name}}", "Your website name"],
                            ["{{article_title}}", "The article being referenced"],
                            ["{{article_date}}", "Publication date"],
                            ["{{tool_mentioned}}", "Your product/tool name"],
                            ["{{custom_line}}", "AI-generated personalized opener"],
                            ["{{article_link}}", "Link to the article"],
                            ["{{signer_name}}", "Your name"],
                          ].map(([v, desc]) => (
                            <div key={v} className="flex gap-2 py-0.5">
                              <code className="text-emerald-400 font-mono shrink-0">{v}</code>
                              <span className="text-muted-foreground">{desc}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {templateData.guidance && (
                      <div className="rounded-lg border border-border bg-muted/20 p-3">
                        <div className="text-xs font-medium text-muted-foreground mb-1">AI guidance</div>
                        <p className="text-xs text-foreground/70">{templateData.guidance}</p>
                      </div>
                    )}

                    <Button size="sm" onClick={() => setEditingTemplate({ subject: templateData.subject, body: templateData.body })}>
                      Edit template
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Progress */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><Target className="h-4 w-4" /> Goal progress</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-2xl font-semibold shrink-0">
                {c.desired_deals ? `${dealsCount} / ${c.desired_deals}` : "No goal set"}
              </span>
              <span className="text-sm text-muted-foreground truncate">
                {c.desired_deals ? "placements agreed" : "Set in settings to track progress"}
              </span>
            </div>
            <Progress value={goalPct} className="mt-2" />
            {!c.desired_deals && <p className="text-xs text-muted-foreground mt-1.5">Set a desired number of deals in settings to track goal progress.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium flex items-center gap-2"><DollarSign className="h-4 w-4" /> Budget</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-2xl font-semibold shrink-0">
                {!state.budget.total ? "No budget set" : fmtMoney(state.budget.used, state.budget.currency)}
              </span>
              {state.budget.total > 0 && (
                <span className="text-sm text-muted-foreground truncate">of {fmtMoney(state.budget.total, state.budget.currency)} · {fmtMoney(state.budget.remaining, state.budget.currency)} left</span>
              )}
            </div>
            <Progress value={budgetPct} className="mt-2" />
          </CardContent>
        </Card>
      </div>

      {/* Agent board */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Agents</CardTitle></CardHeader>
        <CardContent className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {agentBoard.map((a) => {
            const Icon = AGENT_ICONS[a.agent] ?? Bot;
            const isActive = a.status === "active";
            const isRecent = a.status === "recent";
            const isExpanded = expandedAgent === a.agent;
            const agentEvents = state.events.filter((ev) => ev.agent === a.agent).reverse().slice(0, 20);
            return (
              <div key={a.agent} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedAgent(isExpanded ? null : a.agent); } }}
                className={cn(
                "rounded-lg border p-3 transition-all duration-300 cursor-pointer hover:bg-muted/30",
                isActive && "border-emerald-500/50 bg-emerald-500/5 shadow-[0_0_12px_rgba(16,185,129,0.08)]",
                isRecent && "border-emerald-500/20 bg-emerald-500/[0.02]",
                !isActive && !isRecent && "border-border/50",
                isExpanded && "ring-1 ring-primary/30",
              )} onClick={() => setExpandedAgent(isExpanded ? null : a.agent)}>
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
                  <div className="flex items-center gap-2">
                    {a.itemCount > 0 && (
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                        isActive ? "bg-emerald-500/30 text-emerald-300" : "bg-white/10 text-muted-foreground",
                      )}>
                        {a.itemCount}
                      </span>
                    )}
                    {agentEvents.length > 0 && <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />}
                  </div>
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground line-clamp-1 min-h-[1.25rem]">
                  {isActive && !a.lastDetail && <span className="inline-flex items-center gap-1 text-emerald-500"><Loader2 className="h-3 w-3 animate-spin" /> Working…</span>}
                  {a.lastDetail && <span className="text-foreground/60">{cleanDetail(a.lastDetail)}</span>}
                  {!isActive && !a.lastDetail && <span className="opacity-40">idle</span>}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {a.lastActionAt ? timeAgo(new Date(a.lastActionAt).toISOString()) : "—"}
                </div>
                {/* Expanded detail: agent event log */}
                {isExpanded && agentEvents.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/50 space-y-1.5 max-h-[200px] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Activity log</div>
                    {agentEvents.map((ev) => (
                      <div key={ev.id} className="flex gap-2 text-[11px]">
                        <span className="text-muted-foreground/60 whitespace-nowrap tabular-nums">{new Date(ev.ts).toLocaleTimeString()}</span>
                        <span className="text-foreground/70">{eventSummary(ev)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {isExpanded && agentEvents.length === 0 && (
                  <div className="mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                    No events recorded for this agent yet.
                  </div>
                )}
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
            {openInterventions.map((iv) => {
              const isExpanded = expandedIntervention === iv.id;
              const thread = interventionThreads[iv.id] ?? [];
              const anchorEmailId = iv.anchor_email_id ?? iv.thread_id;

              return (
                <div key={iv.id} className="rounded-lg border border-border/60 overflow-hidden">
                  {/* Collapsed header — always visible */}
                  <button
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
                    onClick={() => {
                      const next = isExpanded ? null : iv.id;
                      setExpandedIntervention(next);
                      if (next && anchorEmailId) fetchInterventionThread(iv.id, anchorEmailId);
                    }}
                  >
                    <Badge variant="outline" className="shrink-0 text-[10px]">{iv.type}</Badge>
                    <span className="text-sm font-medium flex-1 min-w-0 truncate">{iv.ask}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{timeAgo(iv.created_at)}</span>
                    <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                  </button>

                  {/* Expanded view */}
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-3 border-t border-border/40">
                      {/* Thread chat */}
                      {thread.length > 0 && (
                        <div className="mt-3 space-y-2 max-h-[320px] overflow-y-auto pr-1">
                          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <MessageSquare className="h-3 w-3" /> Negotiation thread
                          </div>
                          {thread.map((msg: any, idx: number) => {
                            const isOurs = msg.direction === "outbound" || msg.from_me;
                            return (
                              <div key={idx} className={`flex ${isOurs ? "justify-end" : "justify-start"}`}>
                                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
                                  isOurs
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted/60 text-foreground"
                                }`}>
                                  <div className={`text-[10px] mb-0.5 ${isOurs ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                                    {isOurs ? "Us" : (msg.from_name ?? msg.from ?? "Publisher")}
                                  </div>
                                  <div className="whitespace-pre-wrap break-words">{msg.body ?? msg.text ?? msg.content ?? ""}</div>
                                  {msg.draft_pending && (
                                    <Badge variant="outline" className="mt-1 text-[9px] border-amber-500/50 text-amber-400">Draft pending</Badge>
                                  )}
                                  <div className={`text-[9px] mt-1 ${isOurs ? "text-primary-foreground/50" : "text-muted-foreground/60"}`}>
                                    {msg.ts ? new Date(msg.ts).toLocaleString() : ""}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* No thread available */}
                      {thread.length === 0 && anchorEmailId && (
                        <p className="text-xs text-muted-foreground italic mt-2">Loading thread data…</p>
                      )}
                      {thread.length === 0 && !anchorEmailId && (
                        <p className="text-xs text-muted-foreground italic mt-2">No thread available for this intervention.</p>
                      )}

                      {/* Intervention details */}
                      {iv.reason && (
                        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/70">Why paused:</span> {iv.reason}
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 pt-1">
                        <Input
                          value={assistText[iv.id] ?? ""}
                          onChange={(e) => setAssistText((t) => ({ ...t, [iv.id]: e.target.value }))}
                          placeholder="Type your answer to resume…"
                          className="h-8 text-xs flex-1"
                        />
                        <Button
                          size="sm"
                          disabled={busy === `assist-${iv.id}` || !(assistText[iv.id] ?? "").trim()}
                          onClick={() => assist(iv.id)}
                        >
                          {busy === `assist-${iv.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                          Resume
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busy === `abandon-${iv.id}`}
                          onClick={() => abandonIntervention(iv.id, anchorEmailId ?? iv.id)}
                        >
                          {busy === `abandon-${iv.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                          Abandon
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setExpandedIntervention(null)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
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
              {/* Qualification score breakdown */}
              {(state.prospects_by_status.qualified ?? 0) > 0 && (
                <div className="mt-3 pt-3 border-t space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">Qualification scores</div>
                  <div className="flex items-center gap-2 text-xs">
                    <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, ((state.prospects_by_status.qualified ?? 0) / Math.max(1, (state.prospects_by_status.discovered ?? 1))) * 100)}%` }} />
                    </div>
                    <span className="text-muted-foreground">{Math.round(((state.prospects_by_status.qualified ?? 0) / Math.max(1, (state.prospects_by_status.discovered ?? 1))) * 100)}%</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
                    <span>Approved: {state.prospects_by_status.qualified ?? 0}</span>
                    <span>Rejected: {state.prospects_by_status.rejected ?? 0}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Email tracking stats */}
          {state.email_stats && state.email_stats.total > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Email Performance</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Open rate</div>
                    <div className="flex items-end gap-2">
                      <span className="text-xl sm:text-2xl font-semibold">{state.email_stats.openRate}%</span>
                      <span className="text-xs text-muted-foreground mb-1">{state.email_stats.opened}/{state.email_stats.sent}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${state.email_stats.openRate}%` }} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Bounce rate</div>
                    <div className="flex items-end gap-2">
                      <span className="text-xl sm:text-2xl font-semibold">{state.email_stats.bounceRate}%</span>
                      <span className="text-xs text-muted-foreground mb-1">{state.email_stats.bounced}/{state.email_stats.sent}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-red-500 rounded-full" style={{ width: `${state.email_stats.bounceRate}%` }} />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
                  <div className="rounded-lg border p-2">
                    <div className="font-semibold">{state.email_stats.total}</div>
                    <div className="text-muted-foreground">Total</div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="font-semibold">{state.email_stats.sent}</div>
                    <div className="text-muted-foreground">Sent</div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="font-semibold">{state.email_stats.opened}</div>
                    <div className="text-muted-foreground">Opened</div>
                  </div>
                </div>
                {/* A/B variant breakdown */}
                {Object.keys(state.email_stats.variants ?? {}).length > 1 && (
                  <div className="mt-3 pt-3 border-t space-y-2">
                    <div className="text-xs font-medium text-muted-foreground">A/B test results</div>
                    <div className="grid gap-2">
                      {Object.entries(state.email_stats.variants).map(([vid, v]) => (
                        <div key={vid} className="flex items-center gap-3 text-xs">
                          <span className="font-mono text-muted-foreground w-20 truncate" title={vid}>{vid.slice(0, 8)}…</span>
                          <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${v.openRate}%` }} />
                          </div>
                          <span className="text-muted-foreground w-12 text-right">{v.openRate}%</span>
                          <span className="text-muted-foreground w-16 text-right">{v.opened}/{v.sent}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Campaign Metrics Dashboard */}
          {state.roi && (state.deals.length > 0 || state.roi.final_placement_spend > 0) && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Campaign Metrics</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">Publisher asking total</div>
                    <div className="text-lg sm:text-xl font-semibold">{fmtMoney(state.roi.total_publisher_asking, state.budget.currency)}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">Final placement spend</div>
                    <div className="text-lg sm:text-xl font-semibold">{fmtMoney(state.roi.final_placement_spend, state.budget.currency)}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">Negotiated savings</div>
                    <div className="text-lg sm:text-xl font-semibold text-emerald-400">{fmtMoney(state.roi.negotiated_savings, state.budget.currency)}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-muted-foreground">Savings</div>
                    <div className="text-lg sm:text-xl font-semibold text-emerald-400">{state.roi.savings_pct}%</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
                  <div className="rounded-lg border p-2">
                    <div className="font-semibold">{state.roi.placements_agreed}</div>
                    <div className="text-muted-foreground">Placements</div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="font-semibold">{fmtMoney(state.roi.avg_agreed_price, state.budget.currency)}</div>
                    <div className="text-muted-foreground">Avg price</div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="font-semibold">{state.roi.reply_rate}%</div>
                    <div className="text-muted-foreground">Reply rate</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-center text-xs">
                  <div className="rounded-lg border p-2">
                    <div className="font-semibold">{state.roi.agreement_rate}%</div>
                    <div className="text-muted-foreground">Agreement rate</div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="font-semibold">{state.roi.autonomy_rate}%</div>
                    <div className="text-muted-foreground">Autonomy rate</div>
                  </div>
                  <div className="rounded-lg border p-2">
                    <div className="font-semibold">{state.roi.human_interventions}</div>
                    <div className="text-muted-foreground">Human interventions</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                  {state.roi.manual_actions_avoided} manual actions avoided · {state.budget.remaining > 0 ? `${fmtMoney(state.budget.remaining, state.budget.currency)} budget remaining` : "budget exhausted"}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Deals</CardTitle>
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

      {/* Prospect table */}
      {(state as any).prospects && (state as any).prospects.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              <span>Prospects ({(state as any).prospects.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProspectTable prospects={(state as any).prospects} />
          </CardContent>
        </Card>
      )}

      {/* Import CSV modal */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold">Import Prospects from CSV</h3>
            <p className="text-sm text-muted-foreground">
              CSV must have a <code>url</code> or <code>domain</code> column. Optional: <code>name</code>, <code>email</code>.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={importProspects}
              disabled={importing}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-primary/90"
            />
            {importing && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Importing…</p>}
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setImportOpen(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function highlightVariables(text: string) {
  return text.replace(/\{\{(\w+)\}\}/g, '<span class="text-emerald-400 font-mono">{{$1}}</span>');
}

/** Shorten verbose agent status text for the card display. */
function cleanDetail(raw: string): string {
  if (!raw) return "";
  // Strip "Rejected host — FAILS:DR ≥ 50,Relevant" → "Rejected host — low DR"
  let s = raw
    .replace(/FAILS:\s*DR\s*≥?\s*\d+[^,]*/gi, "low DR")
    .replace(/FAILS:\s*[^,]+/gi, (m) => m.replace("FAILS:", "").trim().toLowerCase())
    .replace(/Relevant/gi, "")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/—\s*$/, "")
    .trim();
  // Truncate at 50 chars
  if (s.length > 50) s = s.slice(0, 47) + "…";
  return s;
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
    { agent: "human_delay", label: "Throttle" },
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
