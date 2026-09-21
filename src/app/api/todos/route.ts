import { NextRequest, NextResponse } from "next/server";
import { identifyCaller, scopeOf } from "@/lib/auth/service";
import { todosFor, setTodoDone } from "@/lib/campaign/todos";
import { canSee } from "@/lib/campaign/access";

export const dynamic = "force-dynamic";

/** GET — your to-do list across campaigns (?campaign_id= for one). */
export async function GET(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (!caller || caller.kind === "cron") return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const todos = await todosFor(scopeOf(caller), req.nextUrl.searchParams.get("campaign_id") ?? undefined);
  return NextResponse.json({ todos, open: todos.filter((t) => !t.done_at).length });
}

/** POST {campaign_id, key, done} — tick one off (or un-tick). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const campaignId = String(body?.campaign_id ?? ""), key = String(body?.key ?? "");
  if (!campaignId || !key) return NextResponse.json({ error: "campaign_id and key required" }, { status: 400 });
  const { ok } = await canSee(req, campaignId);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  await setTodoDone(campaignId, key, body?.done !== false);
  return NextResponse.json({ ok: true });
}
