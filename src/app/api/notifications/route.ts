import { NextRequest, NextResponse } from "next/server";
import { identifyCaller, scopeOf } from "@/lib/auth/service";
import { supabaseAdmin } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";

// The moments worth a pop-up: a deal, a card for you, a reply, a finished campaign, a send that failed.
const NOTABLE = ["deal_agreed", "intervention_created", "demo_reply_written", "replies_received", "campaign_completed", "send_failed", "tick_error", "thread_withdrawn", "counter_sent", "outreach_sent"];

/** GET ?after_id= — notable feed events across the caller's campaigns since an id, newest first (max 20). */
export async function GET(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (!caller || caller.kind === "cron") return NextResponse.json({ events: [], newest_id: 0 });
  const scope = scopeOf(caller);
  let cq = supabaseAdmin.from("campaigns").select("id, name");
  cq = scope.guest_id ? cq.eq("guest_id", scope.guest_id) : scope.owner_email ? cq.eq("owner_email", scope.owner_email).is("guest_id", null) : cq.eq("id", "00000000-0000-0000-0000-000000000000");
  const { data: camps } = await cq;
  const ids = ((camps ?? []) as any[]).map((c) => c.id);
  if (!ids.length) return NextResponse.json({ events: [], newest_id: 0 });
  const name = new Map(((camps ?? []) as any[]).map((c) => [c.id, c.name as string]));
  const after = Number(req.nextUrl.searchParams.get("after_id") ?? 0) || 0;
  let q = supabaseAdmin.from("agent_events").select("id, campaign_id, agent, action, human, level, created_at, thread_id, detail").in("campaign_id", ids).in("action", NOTABLE).order("id", { ascending: false }).limit(20);
  if (after > 0) q = q.gt("id", after);
  const { data } = await q;
  // Each pop-up points at the exact thing: the card, the deal, the thread — which opens and glows.
  const hrefFor = (e: any) => {
    const t = e.thread_id ? String(e.thread_id) : "";
    if (e.action === "intervention_created") return `/needs-you${t ? `?focus=${t}` : ""}`;
    if (e.action === "deal_agreed") return `/deals${e.detail?.deal_id ? `?focus=${e.detail.deal_id}` : ""}`;
    if (e.action === "campaign_completed") return `/campaigns/${e.campaign_id}?tab=story`;
    if (["demo_reply_written", "counter_sent", "thread_withdrawn", "outreach_sent", "replies_received"].includes(e.action)) return `/campaigns/${e.campaign_id}?tab=conversations${t ? `&focus=${t}` : ""}`;
    return `/campaigns/${e.campaign_id}`;
  };
  const events = ((data ?? []) as any[]).map(({ detail, ...e }) => ({ ...e, campaign_name: name.get(e.campaign_id) ?? "", href: hrefFor({ ...e, detail }) }));
  return NextResponse.json({ events, newest_id: events[0]?.id ?? after });
}
