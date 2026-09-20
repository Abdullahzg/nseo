import { NextRequest, NextResponse } from "next/server";
import { listEvents } from "@/lib/campaign/queries";
import { canSee } from "@/lib/campaign/access";

const HIDDEN = new Set(["policy_noop"]);

/** GET — the human-readable activity feed, newest first. ?after_id= for live updates, ?before_id= for paging. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { camp, ok } = await canSee(req, id);
  if (!camp || !ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  const after_id = Number(req.nextUrl.searchParams.get("after_id") ?? 0) || undefined;
  const before_id = Number(req.nextUrl.searchParams.get("before_id") ?? 0) || undefined;
  const all = req.nextUrl.searchParams.get("all") === "1";
  const agent = req.nextUrl.searchParams.get("agent");
  if (agent) {
    // Everything one agent did, newest first — the detail behind its pipeline card.
    const keys = agent === "discovery" ? ["discovery", "strategy"] : [agent];
    const { supabaseAdmin } = await import("@/lib/db/supabase");
    const { data } = await supabaseAdmin.from("agent_events").select("*").eq("campaign_id", id).in("agent", keys).order("id", { ascending: false }).limit(300);
    const events = ((data ?? []) as any[]).filter((e) => !HIDDEN.has(e.action));
    return NextResponse.json({ events, newest_id: events[0]?.id ?? 0 });
  }
  const events = (await listEvents(id, { after_id, before_id, limit: 60 })).filter((e) => all || !HIDDEN.has(e.action));
  return NextResponse.json({ events, newest_id: events[0]?.id ?? after_id ?? 0 });
}
