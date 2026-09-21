"use client";

import { useCallback, useEffect, useState } from "react";
import { StoryView, Replay } from "./Story";
import type { Story, StoryFacts } from "@/lib/campaign/story";
import type { FeedEvent } from "./ActivityFeed";

export function StoryTab({ campaignId, tickCount }: { campaignId: string; tickCount: number }) {
  const [data, setData] = useState<{ story: Story | null; facts: StoryFacts; share_token?: string | null; reason?: string } | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [busy, setBusy] = useState<"write" | "share" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setErr(null); if (refresh) setBusy("write");
    const r = await fetch(`/api/campaigns/${campaignId}/story${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setErr(d.error ?? "Could not write the story."); return; }
    setData(d);
    if (d.share_token) setShareUrl(`${window.location.origin}/story/${d.share_token}`);
  }, [campaignId]);
  useEffect(() => { load(); }, [load, tickCount]);
  useEffect(() => { fetch(`/api/campaigns/${campaignId}/feed?all=1&limit=500`, { cache: "no-store" }).then((r) => r.json()).then((d) => setEvents(d.events ?? [])).catch(() => {}); }, [campaignId, tickCount]);

  async function share() {
    setBusy("share");
    const r = await fetch(`/api/campaigns/${campaignId}/story`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (r.ok) { setShareUrl(d.url); try { await navigator.clipboard.writeText(d.url); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* clipboard blocked */ } }
  }

  if (!data && !err) return <div className="space-y-3" aria-busy="true"><div className="skeleton h-8 w-2/3" /><div className="skeleton h-4 w-full" /><div className="skeleton h-4 w-11/12" /><div className="skeleton h-4 w-4/5" /><div className="text-xs text-ink-3">Nemotron 3 Super is writing the story from the ledger…</div></div>;
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="btn btn-sm" onClick={share} disabled={!!busy}>{busy === "share" ? "…" : shareUrl ? (copied ? "Link copied" : "Copy share link") : "Share this story"}</button>
        {shareUrl && <a href={shareUrl} target="_blank" rel="noreferrer" className="text-sm text-model underline break-all">{shareUrl}</a>}
        <span className="flex-1" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => load(true)} disabled={!!busy}>{busy === "write" ? "Rewriting…" : "Rewrite"}</button>
      </div>
      {err && <div className="card border-danger-soft bg-danger-soft/40 p-4 text-sm"><b className="text-danger">Could not write the story.</b> {err}</div>}
      {data && <StoryView story={data.story} facts={data.facts} />}
      {data?.reason && !data.story && <div className="text-sm text-ink-3">{data.reason}</div>}
      <Replay events={events} />
      <div className="text-xs text-ink-3">The shared page shows the story, the numbers and the replay with every email address removed. It never shows your keys or settings.</div>
    </div>
  );
}
