"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { StatusHeader, type CampaignState } from "@/components/campaign/StatusHeader";
import { ActivityFeed, type FeedEvent } from "@/components/campaign/ActivityFeed";

const STATE_POLL_MS = 15_000;
const AUTO_STEP_MS = 12_000;

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
  const [note, setNote] = useState<string | null>(null);
  const newest = useRef(0);

  const loadState = useCallback(async () => {
    const r = await fetch(`/api/campaigns/${id}`, { cache: "no-store" });
    if (r.status === 404) { setNotFound(true); return; }
    if (r.ok) setState(await r.json());
  }, [id]);

  const eventsRef = useRef<FeedEvent[]>([]);
  useEffect(() => { eventsRef.current = events; }, [events]);

  const loadFeed = useCallback(async (mode: "new" | "older" = "new") => {
    const oldest = eventsRef.current[eventsRef.current.length - 1]?.id ?? 0;
    const q = mode === "new" ? (newest.current ? `?after_id=${newest.current}` : "") : `?before_id=${oldest}`;
    const r = await fetch(`/api/campaigns/${id}/feed${q}`, { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    const incoming: FeedEvent[] = d.events ?? [];
    const merge = (prev: FeedEvent[], add: FeedEvent[], front: boolean) => { const seen = new Set(prev.map((e) => e.id)); const fresh = add.filter((e) => !seen.has(e.id)); return front ? [...fresh, ...prev] : [...prev, ...fresh]; };
    if (mode === "new") { if (incoming.length) { setEvents((prev) => merge(prev, incoming, true)); newest.current = Math.max(newest.current, incoming[0].id); } }
    else { setEvents((prev) => merge(prev, incoming, false)); if (incoming.length < 60) setHasMore(false); }
    setLoadingFeed(false);
  }, [id]);

  useEffect(() => { loadState(); loadFeed("new"); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read-only refresh while the tab is visible. Never triggers work.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") { loadState(); loadFeed("new"); } }, STATE_POLL_MS);
    return () => clearInterval(t);
  }, [loadState, loadFeed]);

  const steppingRef = useRef(false);
  const step = useCallback(async () => {
    if (steppingRef.current) return;
    steppingRef.current = true; setStepping(true); setStepError(null);
    try {
      const r = await fetch(`/api/campaigns/${id}/tick`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) setStepError(d.error ?? "The step failed. The feed has the details.");
      else if (d.action === "rate_limited" || d.action === "locked") { setNote("A step just ran. The next one starts in a few seconds."); setTimeout(() => setNote(null), 4000); }
    } catch (e: any) { setStepError(e?.message ?? "Network error"); }
    finally { steppingRef.current = false; setStepping(false); await loadState(); await loadFeed("new"); }
  }, [id, loadState, loadFeed]);

  // Demo auto-run: only while visible, only while active, only in demo mode. The interval is
  // stable (its deps change only when the campaign's activity flips), so 20 s is really 20 s.
  const active = !!state?.campaign.demo_mode && !!state.is_active && !state.campaign.paused;
  useEffect(() => {
    if (!autoStep || !active) return;
    const kick = setTimeout(() => { if (document.visibilityState === "visible") step(); }, 800);
    const t = setInterval(() => { if (document.visibilityState === "visible") step(); }, AUTO_STEP_MS);
    return () => { clearInterval(t); clearTimeout(kick); };
  }, [autoStep, active, step]);

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
      {note && <div className="text-sm text-ink-3 fade-in">{note}</div>}
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
