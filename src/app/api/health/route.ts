import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase";
import { ping } from "@/lib/ai/nebius";
import { MODELS } from "@/lib/ai/models";
import { tokensUsedToday, NEBIUS_DAILY_TOKEN_BUDGET } from "@/lib/campaign/guard";

export const dynamic = "force-dynamic";

/** /api/health — liveness. ?deep=1 also checks the DB, Nebius model routing and today's token use. */
export async function GET(req: NextRequest) {
  const deep = req.nextUrl.searchParams.get("deep") === "1";
  const out: Record<string, unknown> = { ok: true, ts: new Date().toISOString(), models: MODELS };
  if (deep) {
    const [db, nb, tokens] = await Promise.all([
      supabaseAdmin.from("app_state").select("key").limit(1).then((r) => (r.error ? `error: ${r.error.message}` : "ok")),
      ping(),
      tokensUsedToday().catch(() => -1),
    ]);
    out.db = db; out.nebius = nb; out.tokens_today = tokens; out.token_budget = NEBIUS_DAILY_TOKEN_BUDGET;
    out.ok = db === "ok" && nb.ok;
  }
  return NextResponse.json(out, { status: out.ok ? 200 : 503 });
}
