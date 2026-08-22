import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { runRankWatcher } from "@/lib/seo-agents/rankWatcher";
import { closeIndexingBrowser } from "@/lib/indexing/fetchRendered";

export const maxDuration = 300;

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  const session = await auth().catch(() => null);
  return !!session;
}

// Report-only: finds money-page queries in positions 4–10 (GSC) + on-page fix recommendations.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const report = await runRankWatcher({});
    return NextResponse.json({ ok: true, report });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "rank-watcher failed" }, { status: 500 });
  } finally {
    await closeIndexingBrowser().catch(() => {});
  }
}
