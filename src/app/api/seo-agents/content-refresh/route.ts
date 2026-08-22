import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { runContentRefresh } from "@/lib/seo-agents/contentRefresh";
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

// Report-only: manual mode briefs a single URL (works today); auto mode finds GSC decliners.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const url = typeof body.url === "string" && body.url.trim() ? body.url.trim() : undefined;
  try {
    const report = await runContentRefresh({ url });
    return NextResponse.json({ ok: true, report });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "content-refresh failed" }, { status: 500 });
  } finally {
    await closeIndexingBrowser().catch(() => {});
  }
}
