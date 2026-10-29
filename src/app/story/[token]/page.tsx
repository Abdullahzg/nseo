import { notFound } from "next/navigation";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/db/supabase";
import { storyFacts, scrub, type Story } from "@/lib/campaign/story";
import { StoryView, Replay } from "@/components/campaign/Story";
import { Wordmark } from "@/components/layout/Logo";
import type { Campaign } from "@/lib/campaign/types";
import type { FeedEvent } from "@/components/campaign/ActivityFeed";

export const dynamic = "force-dynamic";

/**
 * The shareable, read-only story of one campaign. No sign-in, no keys, no email addresses:
 * every string is scrubbed, model reasoning is kept (it is the point), raw details are dropped.
 */
export default async function SharedStory({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{8,}$/.test(token)) notFound();
  const { data } = await supabaseAdmin.from("campaigns").select("*").eq("share_token", token).maybeSingle();
  if (!data) notFound();
  const camp = data as Campaign;
  const facts = await storyFacts(camp);
  const story = ((camp as any).story as Story | null) ?? null;
  const { data: ev } = await supabaseAdmin.from("agent_events").select("id, agent, action, human, engine, level, model, tokens_in, tokens_out, latency_ms, cost_usd, created_at, detail").eq("campaign_id", camp.id).order("id", { ascending: false }).limit(500);
  const events: FeedEvent[] = ((ev ?? []) as any[]).map((e) => ({ ...e, human: scrub(String(e.human)), reasoning: null, detail: { to: (e.detail as any)?.to } }));
  return (
    <div className="min-h-svh flex flex-col">
      <header className="border-b border-rule"><div className="mx-auto max-w-5xl px-4 sm:px-6 h-14 flex items-center justify-between"><Wordmark className="text-lg" /><span className="text-xs text-ink-3">A campaign's story, shared read-only · <Link href="/setup" className="text-ink-2 hover:text-ink">run your own →</Link></span></div></header>
      <main className="flex-1"><div className="mx-auto max-w-5xl px-4 sm:px-6 pt-8 pb-24 space-y-10">
        <div className="text-xs text-ink-3">{camp.name} · {camp.keywords.join(" · ")} · {camp.demo_mode ? "live run, no email sent" : "real campaign"} · {camp.phase.replace("_", " ")}</div>
        <StoryView story={story} facts={facts} readOnly />
        <Replay events={events} />
      </div></main>
      <footer className="border-t border-rule"><div className="mx-auto max-w-5xl px-4 sm:px-6 py-3 text-xs text-ink-3">Decisions by NVIDIA Nemotron 3 on Nebius Token Factory. Addresses are not shown on shared stories.</div></footer>
    </div>
  );
}
