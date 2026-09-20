"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { StatusHeader, type CampaignState } from "@/components/campaign/StatusHeader";
import { ActivityFeed, type FeedEvent } from "@/components/campaign/ActivityFeed";

const STATE_POLL_MS = 15_000;
const AUTO_STEP_MS = 20_000;

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<CampaignState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [stepping, setStepping] = useState(false);
  const [autoStep, setAutoStep] = useState(true);
  const [stepError, setStepError] = useState<string | null>(null);
  const newest = useRef(0);

  const loadState = useCallback(async () => {
    const r = await fetch(`/api/campaigns/${id}`, { cache: "no-store" });
    if (r.status === 404) { setNotFound(true); return; }
    if (r.ok) setState(await r.json());
  }, [id]);

  const loadFeed = useCallback(async (mode: "new" | "older" = "new") => {
    const q = mode === "new" ? (newest.current ? `?after_id=${newest.current}` : "") : `?before_id=${events[events.length - 1]?.id ?? 0}`;
    const r = await fetch(`/api/campaigns/${id}/feed${q}`, { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    const incoming: FeedEvent[] = d.events ?? [];
    if (mode === "new") { if (incoming.length) { setEvents((prev) => [...incoming, ...prev]); newest.current = Math.max(newest.current, incoming[0].id); } }
    else { setEvents((prev) => [...prev, ...incoming]); if (incoming.length < 60) setHasMore(false); }
    setLoadingFeed(false);
  }, [id, events]);

  useEffect(() => { loadState(); loadFeed("new"); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read-only refresh while the tab is visible. Never triggers work.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") { loadState(); loadFeed("new"); } }, STATE_POLL_MS);
    return () => clearInterval(t);
  }, [loadState, loadFeed]);

  const step = useCallback(async () => {
    if (stepping) return;
    setStepping(true); setStepError(null);
    try {
      const r = await fetch(`/api/campaigns/${id}/tick`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) setStepError(d.error ?? "The step failed. The feed has the details.");
    } catch (e: any) { setStepError(e?.message ?? "Network error"); }
    finally { setStepping(false); await loadState(); await loadFeed("new"); }
  }, [id, stepping, loadState, loadFeed]);

  // Demo auto-run: only while visible, only while active, only in demo mode.
  useEffect(() => {
    if (!autoStep || !state?.campaign.demo_mode || !state.is_active || state.campaign.paused) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") step(); }, AUTO_STEP_MS);
    const kick = setTimeout(() => { if (document.visibilityState === "visible" && events.length < 3) step(); }, 800);
    return () => { clearInterval(t); clearTimeout(kick); };
  }, [autoStep, state?.campaign.demo_mode, state?.is_active, state?.campaign.paused, step]); // eslint-disable-line react-hooks/exhaustive-deps

  async function control(action: "pause" | "resume" | "stop") {
    if (action === "stop" && !confirm("Stop this campaign? It cannot be resumed.")) return;
    setBusy(action);
    try { await fetch(`/api/campaigns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }); await loadState(); await loadFeed("new"); }
    finally { setBusy(null); }
  }

  if (notFound) return <div className="card p-6 max-w-xl"><div className="label mb-2">Not found</div><p>This campaign does not exist or belongs to someone else.</p></div>;
  if (!state) return <div className="space-y-4" aria-busy="true"><div className="skeleton h-4 w-1/3" /><div className="skeleton h-10 w-3/4" /><div className="grid grid-cols-4 gap-3"><div className="skeleton h-20" /><div className="skeleton h-20" /><div className="skeleton h-20" /><div className="skeleton h-20" /></div><div className="skeleton h-40" /></div>;

  return (
    <div className="space-y-10">
      <StatusHeader s={state} busy={busy} onControl={control} onStep={step} stepping={stepping} autoStep={autoStep} setAutoStep={setAutoStep} />
      {stepError && <div className="card border-danger-soft bg-danger-soft/40 p-4 text-sm"><span className="font-semibold text-danger">Step failed.</span> {stepError}</div>}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="label">What the agent did, newest first</h2>
          <span className="text-xs text-ink-3">Tap a line to see which Nemotron model decided it, and why.</span>
        </div>
        <ActivityFeed events={events} loading={loadingFeed} onMore={() => loadFeed("older")} hasMore={hasMore && events.length >= 60} />
      </section>
    </div>
  );
}
