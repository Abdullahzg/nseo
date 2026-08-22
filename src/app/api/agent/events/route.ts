import { NextRequest } from "next/server";
import { authorizeAgent, unauthorized } from "@/lib/agent/gateway";
import { listAgentEvents, recordAgentEvent } from "@/lib/campaign/queries";

export const maxDuration = 60;

// GET /api/agent/events?campaign_id=&after_id=0&limit=200 — observability timeline feed
// (the UI polls this; the ADK service POSTs here).
export async function GET(req: NextRequest) {
  const a = await authorizeAgent(req);
  if (!a.ok) return unauthorized();
  const campaignId = req.nextUrl.searchParams.get("campaign_id");
  if (!campaignId) return Response.json({ error: "campaign_id required" }, { status: 400 });
  const afterId = Number(req.nextUrl.searchParams.get("after_id") ?? 0);
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 200)));
  const events = await listAgentEvents(campaignId, Number.isFinite(afterId) ? afterId : 0, limit);
  return Response.json({ events, last_id: events.length ? events[events.length - 1].id : afterId });
}

// POST /api/agent/events — the Python agent service records operational traces here.
// event_key dedupes at-least-once deliveries.
export async function POST(req: NextRequest) {
  const a = await authorizeAgent(req);
  if (!a.ok) return unauthorized();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "event or events[] required" }, { status: 400 });
  }
  const items = Array.isArray((body as any).events) ? (body as any).events : [body];
  let recorded = 0;
  for (const ev of items.slice(0, 200)) {
    const r = await recordAgentEvent(ev);
    if (r.recorded) recorded++;
  }
  return Response.json({ ok: true, recorded });
}
