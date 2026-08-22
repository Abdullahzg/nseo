import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { runGeoScan } from "@/lib/seo-agents/geo";

export const maxDuration = 120;

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  const session = await auth().catch(() => null);
  return !!session;
}

// Nightly GEO check — runs the default prompts through every configured AI engine so
// geo_checks accumulates history even if nobody opens the AI Citations tab that day. Google's
// AI Overview in particular is genuinely intermittent (confirmed live), so a rolling hit-rate
// needs a check every day to mean anything. No Slack post — this is purely to build history;
// the "Check AI answers" button in the UI is still how a person reviews results.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const report = await runGeoScan();
    return NextResponse.json({
      ok: true,
      answered: report.answered,
      prompts: report.prompts,
      enginesUsed: report.enginesUsed,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "GEO check failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
