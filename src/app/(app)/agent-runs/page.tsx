"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Bot, Loader2, CheckCircle2, XCircle, Clock, RefreshCw, ChevronRight,
  Play, Pause, Square, AlertTriangle, Activity, Cpu, Zap, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AgentRun {
  id: string;
  campaign_id: string | null;
  agent: string;
  tick_kind: string | null;
  adk_session_id: string | null;
  status: string;
  stats: Record<string, unknown>;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

interface AgentEvent {
  id: number;
  campaign_id: string;
  run_id: string | null;
  agent: string;
  action: string;
  tool: string | null;
  prospect_id: string | null;
  thread_id: string | null;
  state_before: Record<string, unknown> | null;
  state_after: Record<string, unknown> | null;
  duration_ms: number | null;
  status: string;
  error_code: string | null;
  level: string;
  detail: Record<string, unknown>;
  created_at?: string;
}

interface Campaign {
  id: string;
  name: string;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return "just now";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

function durationLabel(started: string, finished: string | null): string {
  if (!finished) return "running...";
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusIcon(status: string) {
  switch (status) {
    case "completed": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "failed": return <XCircle className="h-4 w-4 text-destructive" />;
    case "running": return <Loader2 className="h-4 w-4 text-highlight-ink animate-spin" />;
    default: return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function eventLevelBadge(level: string) {
  switch (level) {
    case "error": return <Badge variant="destructive" className="text-[10px] px-1 py-0">ERROR</Badge>;
    case "warn": return <Badge variant="outline" className="text-[10px] px-1 py-0 border-warning text-warning">WARN</Badge>;
    default: return null;
  }
}

function agentIcon(agent: string) {
  const lower = agent.toLowerCase();
  if (lower.includes("discover")) return <Zap className="h-3.5 w-3.5" />;
  if (lower.includes("qualif")) return <Shield className="h-3.5 w-3.5" />;
  if (lower.includes("contact") || lower.includes("resolv")) return <Bot className="h-3.5 w-3.5" />;
  if (lower.includes("outreach")) return <Bot className="h-3.5 w-3.5" />;
  if (lower.includes("negotiat")) return <Activity className="h-3.5 w-3.5" />;
  if (lower.includes("orchestrat") || lower.includes("tick") || lower.includes("campaign")) return <Cpu className="h-3.5 w-3.5" />;
  return <Bot className="h-3.5 w-3.5" />;
}

export default function AgentRunsPage() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (selectedCampaign !== "all") params.set("campaign_id", selectedCampaign);
      const res = await fetch(`/api/agent-runs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs ?? []);
      }
    } catch {}
    setLoading(false);
  }, [selectedCampaign]);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch("/api/campaigns");
      if (res.ok) {
        const data = await res.json();
        setCampaigns((data.campaigns ?? []).map((c: any) => ({ id: c.id, name: c.name })));
      }
    } catch {}
  }, []);

  const loadEvents = useCallback(async (campaignId: string) => {
    setEventsLoading(true);
    try {
      const res = await fetch(`/api/agent-runs/events?campaign_id=${campaignId}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
      }
    } catch {}
    setEventsLoading(false);
  }, []);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);
  useEffect(() => { loadRuns(); }, [loadRuns]);

  useEffect(() => {
    if (expandedRun) {
      const run = runs.find((r) => r.id === expandedRun);
      if (run?.campaign_id) loadEvents(run.campaign_id);
    }
  }, [expandedRun, runs, loadEvents]);

  // Stats summary
  const totalRuns = runs.length;
  const completedRuns = runs.filter((r) => r.status === "completed").length;
  const failedRuns = runs.filter((r) => r.status === "failed").length;
  const runningRuns = runs.filter((r) => r.status === "running").length;
  const uniqueAgents = new Set(runs.map((r) => r.agent)).size;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-light flex items-center gap-2 tracking-tight">
            <Cpu className="h-6 w-6 text-highlight-ink" /> Agent Runs
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Every Strands agent execution — discovery, qualification, contact resolution, outreach,
            negotiation, and orchestration ticks. Expand any run to see the full event timeline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={selectedCampaign}
            onChange={(e) => setSelectedCampaign(e.target.value)}
          >
            <option value="all">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={loadRuns} className="gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-2xl font-bold tabular-nums">{totalRuns}</p>
          <p className="text-xs text-muted-foreground">Total runs</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-2xl font-bold tabular-nums text-green-500">{completedRuns}</p>
          <p className="text-xs text-muted-foreground">Completed</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-2xl font-bold tabular-nums text-destructive">{failedRuns}</p>
          <p className="text-xs text-muted-foreground">Failed</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-2xl font-bold tabular-nums text-highlight-ink">{runningRuns}</p>
          <p className="text-xs text-muted-foreground">Running</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-2xl font-bold tabular-nums">{uniqueAgents}</p>
          <p className="text-xs text-muted-foreground">Unique agents</p>
        </div>
      </div>

      {/* Runs list */}
      <div className="rounded-xl border border-border overflow-hidden bg-card">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading agent runs...
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-sm text-muted-foreground">
            <Cpu className="h-8 w-8 text-muted-foreground/40" />
            <p>No agent runs yet. Start a campaign to see Strands agent activity here.</p>
            <Link href="/campaigns/autonomous">
              <Button variant="outline" size="sm">Go to Campaigns</Button>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {runs.map((run) => (
              <div key={run.id}>
                <button
                  onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                >
                  <ChevronRight className={cn(
                    "h-4 w-4 text-muted-foreground/60 shrink-0 transition-transform",
                    expandedRun === run.id && "rotate-90"
                  )} />
                  {statusIcon(run.status)}
                  <div className="flex items-center gap-2 min-w-0">
                    {agentIcon(run.agent)}
                    <span className="text-sm font-medium truncate">{run.agent}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {run.tick_kind ?? run.status}
                  </Badge>
                  {run.campaign_id && (
                    <Link
                      href={`/campaigns/${run.campaign_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs text-highlight-ink hover:underline shrink-0 hidden sm:inline"
                    >
                      view campaign
                    </Link>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground shrink-0 tabular-nums">
                    {durationLabel(run.created_at, run.finished_at)}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {timeAgo(run.created_at)}
                  </span>
                </button>

                {expandedRun === run.id && (
                  <div className="border-t border-border bg-muted/20 px-4 py-3 space-y-2">
                    {/* Run details */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div><span className="text-muted-foreground">Run ID:</span> <span className="font-mono">{run.id.slice(0, 8)}</span></div>
                      <div><span className="text-muted-foreground">Agent:</span> {run.agent}</div>
                      <div><span className="text-muted-foreground">Started:</span> {new Date(run.created_at).toLocaleString()}</div>
                      {run.finished_at && <div><span className="text-muted-foreground">Finished:</span> {new Date(run.finished_at).toLocaleString()}</div>}
                      {run.error && <div className="col-span-full text-destructive">{run.error}</div>}
                      {Object.keys(run.stats).length > 0 && (
                        <div className="col-span-full">
                          <span className="text-muted-foreground">Stats:</span>{" "}
                          <span className="font-mono text-[11px]">{JSON.stringify(run.stats)}</span>
                        </div>
                      )}
                    </div>

                    {/* Event timeline */}
                    {run.campaign_id && (
                      <div className="mt-3">
                        <p className="text-xs font-semibold text-muted-foreground mb-2">Event Timeline</p>
                        {eventsLoading ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                            <Loader2 className="h-3 w-3 animate-spin" /> Loading events...
                          </div>
                        ) : events.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">No events recorded for this campaign.</p>
                        ) : (
                          <div className="space-y-1 max-h-[300px] overflow-y-auto">
                            {events.slice(0, 50).map((ev) => (
                              <div key={ev.id} className="flex items-start gap-2 text-xs py-1 border-b border-border/50 last:border-0">
                                <span className="text-muted-foreground/60 tabular-nums shrink-0 w-16">
                                  {ev.duration_ms != null ? `${ev.duration_ms}ms` : ""}
                                </span>
                                {eventLevelBadge(ev.level)}
                                <span className="font-medium shrink-0">{ev.agent}</span>
                                <span className="text-muted-foreground shrink-0">→</span>
                                <span className="truncate">{ev.action}{ev.tool ? ` (${ev.tool})` : ""}</span>
                                {ev.status !== "ok" && (
                                  <Badge variant={ev.status === "error" ? "destructive" : "outline"} className="text-[10px] shrink-0">
                                    {ev.status}
                                  </Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
