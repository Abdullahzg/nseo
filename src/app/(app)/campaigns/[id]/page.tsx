"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatusHeader, type CampaignState } from "@/components/campaign/StatusHeader";
import { ActivityFeed, type FeedEvent } from "@/components/campaign/ActivityFeed";
import { EditorInbox } from "@/components/campaign/EditorInbox";
import { Pipeline } from "@/components/campaign/Pipeline";
import { Publications } from "@/components/campaign/Publications";
import { Tools } from "@/components/campaign/Tools";
import { Panel } from "@/components/ui/motion";
import { StoryTab } from "@/components/campaign/StoryTab";
import { Tour } from "@/components/campaign/Tour";
import { Safety } from "@/components/campaign/Safety";
import { Moments } from "@/components/campaign/Moments";

const STATE_POLL_MS = 15_000;
// The server refuses a browser step within 10 s of the previous one. Auto-run waits out whatever
// is left of that window after a step finishes, then goes straight on.
const MIN_STEP_SPACING_MS = 10_500;
const STEP_GAP_MS = 1_500;

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
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
  // Every thread is either done or waiting on the owner. The campaign is not broken and not
  // finished — there is simply nothing it may decide alone — so auto-run stops and says so
  // rather than ticking a no-op every ten seconds while the screen appears to be working.
  const [stalled, setStalled] = useState(false);
  const noops = useRef(0);
  const [tab, setTab] = useState<"activity" | "publications" | "conversations" | "tools" | "safety" | "story">(() => { try { const t = new URLSearchParams(window.location.search).get("tab"); return (["activity", "publications", "conversations", "tools", "safety", "story"].includes(t ?? "") ? t : "activity") as any; } catch { return "activity"; } });
  const [refreshKey, setRefreshKey] = useState(0);
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
      else if (d.action === "noop") { noops.current += 1; if (noops.current >= 2) { setStalled(true); setAutoStep(false); } }
      else { noops.current = 0; setStalled(false); }
    } catch (e: any) { setStepError(e?.message ?? "Network error"); }
    finally { steppingRef.current = false; setStepping(false); await loadState(); await loadFeed("new"); setRefreshKey((k) => k + 1); }
  }, [id, loadState, loadFeed]);

  // "Read the story" in the header switches the tab without a navigation.
  useEffect(() => { const h = (e: Event) => setTab((e as CustomEvent).detail); window.addEventListener("nseo:tab", h); return () => window.removeEventListener("nseo:tab", h); }, []);

  // While a step runs (up to 45 s) the header's live line follows the agents: poll state every 2 s.
  useEffect(() => {
    if (!stepping) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") loadState(); }, 2000);
    return () => clearInterval(t);
  }, [stepping, loadState]);

  // Auto-run: only while visible, only while active, only when no email is being sent. Each step
  // is scheduled from the END of the one before it rather than on a fixed interval. A fixed
  // interval was the wrong shape here: steps take 11-30 s, step() refuses to start while one is
  // already running, so every tick that landed mid-step was dropped and the real cadence doubled
  // to 24 s - and when a step finished early the page then sat idle waiting for the next tick.
  const active = !!state?.campaign.demo_mode && !!state.is_active && !state.campaign.paused;
  useEffect(() => {
    if (!autoStep || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const runAfter = (delay: number) => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        // A hidden tab is not watching; check back rather than burning a step it will not see.
        if (document.visibilityState !== "visible") return runAfter(2_000);
        const started = Date.now();
        await step();
        if (cancelled) return;
        runAfter(Math.max(STEP_GAP_MS, MIN_STEP_SPACING_MS - (Date.now() - started)));
      }, delay);
    };
    runAfter(800);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [autoStep, active, step]);

  async function control(action: "pause" | "resume" | "stop") {
    if (action === "stop" && !confirm("Stop this campaign? It cannot be resumed.")) return;
    setBusy(action);
    try { await fetch(`/api/campaigns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }); await loadState(); await loadFeed("new"); }
    finally { setBusy(null); }
  }

  async function remove() {
    if (!confirm("Delete this campaign and everything it recorded (publications, conversations, deals)? This cannot be undone.")) return;
    setBusy("delete");
    const r = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    setBusy(null);
    if (r.ok) router.push("/campaigns");
  }

  if (notFound) return <div className="card p-6 max-w-xl"><div className="label mb-2">Not found</div><p>This campaign does not exist or belongs to someone else.</p></div>;
  if (!state) return <div className="space-y-4" aria-busy="true"><div className="skeleton h-4 w-1/3" /><div className="skeleton h-10 w-3/4" /><div className="grid grid-cols-4 gap-3"><div className="skeleton h-20" /><div className="skeleton h-20" /><div className="skeleton h-20" /><div className="skeleton h-20" /></div><div className="skeleton h-40" /></div>;

  return (
    <div className="space-y-10">
      <StatusHeader s={state} busy={busy} onControl={control} onStep={step} stepping={stepping} autoStep={autoStep} setAutoStep={setAutoStep} onDelete={remove} />
      <Tour />
      <Moments state={state} events={events} />
      {stepError && <div className="card border-danger-soft bg-danger-soft/40 p-4 text-sm"><span className="font-semibold text-danger">Step failed.</span> {stepError}</div>}
      {stalled && (
        <div className="card border-attention-soft bg-attention-soft/40 p-4 text-sm fade-in">
          {state.open_interventions > 0 ? (
            <>
              <span className="font-semibold">It&apos;s your turn.</span>{" "}
              Every open thread is waiting on a decision only you can make, so the agent has stopped rather than
              keep asking itself the same question.{" "}
              <Link href="/needs-you" className="text-model underline font-medium">
                Answer {state.open_interventions} {state.open_interventions === 1 ? "question" : "questions"} →
              </Link>{" "}
              and it picks up where it left off.
            </>
          ) : (
            <>
              <span className="font-semibold">Nothing left to do on its own.</span>{" "}
              Every editor who was going to answer has answered. Use <b>Run next step</b> to check once more, or stop the campaign.
            </>
          )}
        </div>
      )}
      {note && <div className="text-sm text-ink-3 fade-in">{note}</div>}

      <div data-tour="agents"><Pipeline s={state} /></div>

      <div>
        <div data-tour="tabs" className="flex gap-1 border-b border-rule mb-6 overflow-x-auto [scrollbar-width:none] -mx-4 px-4 sm:mx-0 sm:px-0" role="tablist">
          {([["activity", "Activity"], ["publications", `Publications${state.numbers.found ? ` · ${state.numbers.found}` : ""}`], ["conversations", `Conversations${state.numbers.contacted ? ` · ${state.numbers.contacted}` : ""}`], ["tools", "Tools"], ["safety", "Safety"], ["story", "Story & replay"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 h-10 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${tab === k ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink-2"}`}>{label}</button>
          ))}
        </div>
        <Panel id={tab}>
        {tab === "activity" && (
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="label">What the agents did, newest first</h2>
              <span className="text-xs text-ink-3">Tap a line to see which Nemotron model decided it, and why.</span>
            </div>
            <ActivityFeed events={events} loading={loadingFeed} onMore={() => loadFeed("older")} hasMore={hasMore && events.length >= 60} />
          </section>
        )}
        {tab === "publications" && <Publications campaignId={id} refreshKey={refreshKey} />}
        {tab === "conversations" && (
          state.numbers.contacted > 0
            ? <EditorInbox campaignId={id} active={active && ["outreaching", "monitoring"].includes(state.campaign.phase)} onChanged={() => { loadState(); loadFeed("new"); setRefreshKey((k) => k + 1); }} />
            : <div className="card p-6 text-sm text-ink-2">No emails yet. Conversations appear here once the Writer has emailed an editor{state.campaign.demo_mode ? "" : " — replies arrive from your Gmail over IMAP"}.</div>
        )}
        {tab === "tools" && <Tools s={state} />}
        {tab === "safety" && <Safety campaignId={id} refreshKey={refreshKey} />}
        {tab === "story" && <StoryTab campaignId={id} tickCount={state.campaign.tick_count} />}
        </Panel>
      </div>
    </div>
  );
}
