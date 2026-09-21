import { NextRequest, NextResponse } from "next/server";
import { identifyCaller, scopeOf, actorFor } from "@/lib/auth/service";
import { listInterventions, listCampaigns } from "@/lib/campaign/queries";
import { answerIntervention, dismissIntervention } from "@/lib/campaign/outreach";
import { ACTIVE_PHASES } from "@/lib/campaign/types";
import { withKeys } from "@/lib/ai/context";
import { getOwnerKeys } from "@/lib/db/queries";
import { loadThread } from "@/lib/negotiation/thread";

export const maxDuration = 60;

/** GET — the Needs-You queue for the caller. */
export async function GET(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const scope = scopeOf(caller);
  const status = (req.nextUrl.searchParams.get("status") ?? "open") as "open" | "resolved" | "dismissed";
  const [items0, camps] = await Promise.all([listInterventions({ ...scope, status }), listCampaigns(scope)]);
  // Each card carries the whole conversation so far, so you can see what was said before you answer.
  const items = await Promise.all(items0.map(async (iv: any) => ({ ...iv, thread: iv.anchor_email_id ? await loadThread(iv.anchor_email_id) : [] })));
  const openCount = status === "open" ? items.length : (await listInterventions({ ...scope, status: "open" })).length;
  return NextResponse.json({ interventions: items, open_count: openCount, campaigns_in_progress: camps.filter((c) => ACTIVE_PHASES.includes(c.phase)).length });
}

/** POST {id, answer} — answer and resume. {id, dismiss:true} — close. {id, take_over:true} — hand the thread to you. */
export async function POST(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (!caller || caller.kind === "cron") return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const mine = await listInterventions({ ...scopeOf(caller), status: "open" });
  if (!mine.some((i) => i.id === id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const by = actorFor(caller);
  if (body?.dismiss) return NextResponse.json({ ok: await dismissIntervention(id, by, false) });
  if (body?.take_over) return NextResponse.json({ ok: await dismissIntervention(id, by, true) });
  const answer = String(body?.answer ?? "").trim();
  if (!answer) return NextResponse.json({ error: "answer required" }, { status: 400 });
  const keys = await getOwnerKeys(caller.kind === "owner" ? caller.email : null);
  const r = await withKeys(keys, () => answerIntervention(id, answer, by));
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
