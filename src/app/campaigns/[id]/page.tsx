"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Activity, Bot, CircleStop, DollarSign, Hand, Loader2, Pause, Play, Plus,
  Radar, Search, ShieldAlert, Sparkles, Target, Users, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
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

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<CampaignState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [assistText, setAssistText] = useState<Record<string, string>>({});
  const lastEventId = useRef(0);
  const autoTickRef = useRef(false);

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

  // Live follow-up loop: while active and idle-ish, drive ticks every ~25s.
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
    try {
      if (action === "start") {
        await fetch(`/api/campaigns/${id}/start`, { method: "POST" });
        toast.success("Campaign started — agents are working.");
      } else if (action === "tick") {
        const r = await fetch(`/api/campaigns/${id}/tick`, { method: "POST" }).then((x) => x.json());
        toast.success(`Tick done (${r.action ?? r.mode ?? ""}).`);
      } else {
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold">{c.name}</h1>
            <Badge variant={c.phase === "completed" ? "default" : c.phase === "stopped" || c.emergency_stopped ? "destructive" : "secondary"}>
              {c.emergency_stopped ? "EMERGENCY STOPPED" : PHASE_LABELS[c.phase] ?? c.phase}
            </Badge>
            {c.demo_mode && <Badge variant="outline" className="border-amber-500/50 text-amber-500">DEMO MODE · simulated publishers</Badge>}
            {c.autonomy_mode === "autonomous" && <Badge variant="outline" className="border-violet-500/50 text-violet-400">AUTONOMOUS</Badge>}
          </div>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            {c.objective || "Acquire editorial placements."}{c.website_url ? ` · ${c.website_url}` : ""}
            {c.keywords?.length ? ` · ${(c.keywords as string[]).join(", ")}` : ""}
          </p>
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
        </div>
      </div>

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
            return (
              <div key={a.agent} className={cn("rounded-lg border p-3", a.lastActionAt && Date.now() - a.lastActionAt < 120_000 ? "border-emerald-500/40 bg-emerald-500/5" : "")}>
                <div className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4" /> {a.label}</div>
                <div className="mt-1 text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">{a.lastDetail || "idle"}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{a.lastActionAt ? timeAgo(new Date(a.lastActionAt).toISOString()) : "—"}</div>
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
              <Hand className="h-4 w-4" /> Action required — human decisions requested by the agents ({openInterventions.length})
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
                    {busy === `assist-${iv.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Resume agent
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Timeline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Live activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[480px] overflow-y-auto space-y-1.5 pr-2">
              {[...state.events].reverse().slice(0, 120).map((ev) => (
                <div key={ev.id} className="flex gap-2 text-xs border-l-2 pl-2 py-0.5"
                  style={{ borderColor: ev.level === "error" ? "#ef4444" : ev.level === "warn" ? "#f59e0b" : "rgba(16,185,129,.6)" }}>
                  <span className="text-muted-foreground whitespace-nowrap">{new Date(ev.ts).toLocaleTimeString()}</span>
                  <span className="font-medium whitespace-nowrap">{ev.agent}</span>
                  <span className="whitespace-nowrap">{ev.action.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground truncate">{eventSummary(ev)}</span>
                </div>
              ))}
              {!state.events.length && <p className="text-sm text-muted-foreground">No activity yet — press Start.</p>}
            </div>
          </CardContent>
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
                  <div className="text-[11px] text-muted-foreground">Replies received</div>
                </div>
                <div className="rounded-lg border p-2">
                  <div className="text-xl font-semibold">{dealsCount}</div>
                  <div className="text-[11px] text-muted-foreground">Deals agreed</div>
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
              {state.deals.length === 0 && <p className="text-sm text-muted-foreground">No deals yet. The agents are working on it.</p>}
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
  if (ev.action === "prospect_found") return `${d.host ?? ""}`;
  if (ev.action === "search_batch") return `"${(d.query ?? "").slice(0, 40)}" → ${d.hits ?? 0} hits, ${d.created ?? 0} new`;
  if (ev.action === "prospect_qualified" || ev.action === "prospect_rejected") return `${d.host ?? ""} score ${d.score ?? "?"} · ceiling ${d.ceiling ?? "placement-only"} · ${d.reason_code ?? ""}`;
  if (ev.action.startsWith("contact")) return `${d.host ?? ""} via ${d.source ?? "?"}${d.confidence ? ` (${d.confidence}% conf)` : ""}`;
  if (ev.action.startsWith("outreach")) return `${d.host ?? ""} → ${d.subject ?? ""}`;
  if (ev.action.includes("agreed")) return `${d.host ?? ""} at ${d.price ?? 0}${d.waived ? " (waived)" : ""}`;
  if (ev.action === "phase_transition") return d.reason ?? "";
  return Object.keys(d).length ? JSON.stringify(d).slice(0, 90) : "";
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
  return defs.map(({ agent, label }) => {
    const evs = byAgent.get(agent) ?? [];
    const last = evs[evs.length - 1];
    return { agent, label, lastActionAt: last ? new Date(last.ts).getTime() : null, lastDetail: last ? eventSummary(last) : null };
  });
}
