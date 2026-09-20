import { NextRequest, NextResponse } from "next/server";
import { identifyCaller, scopeOf } from "@/lib/auth/service";
import { listDealsForScope, listCampaigns } from "@/lib/campaign/queries";
import { ACTIVE_PHASES } from "@/lib/campaign/types";

export async function GET(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const scope = scopeOf(caller);
  const [deals, camps] = await Promise.all([listDealsForScope(scope), listCampaigns(scope)]);
  const goal = camps.reduce((s, c) => s + (c.desired_deals ?? 0), 0);
  const budget = camps.reduce((s, c) => s + Number(c.budget_total ?? 0), 0);
  const used = camps.reduce((s, c) => s + Number(c.budget_used ?? 0), 0);
  const saved = deals.reduce((s, d) => s + Math.max(0, Number(d.original_ask ?? 0) - Number(d.agreed_price ?? 0)), 0);
  return NextResponse.json({ deals, totals: { deals: deals.length, goal, budget, used, saved }, in_progress: camps.filter((c) => ACTIVE_PHASES.includes(c.phase)).length });
}
