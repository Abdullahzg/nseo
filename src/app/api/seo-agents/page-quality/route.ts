import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { runPageQuality } from "@/lib/seo-agents/pageQuality";

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

// Report-only: scores a template's programmatic pages for unique/thin/duplicate/quality and
// returns a publish/noindex/hold verdict per page. No writes.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const template = typeof body.template === "string" && body.template.trim() ? body.template.trim() : undefined;
  const urls = Array.isArray(body.urls) ? (body.urls as unknown[]).filter((u): u is string => typeof u === "string" && u.trim().length > 0) : undefined;
  const limit = typeof body.limit === "number" && body.limit > 0 ? Math.min(body.limit, 80) : undefined;
  const llm = typeof body.llm === "boolean" ? body.llm : undefined;
  try {
    const report = await runPageQuality({ template, urls, limit, llm });
    return NextResponse.json({ ok: true, report });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Page quality scan failed" }, { status: 500 });
  }
}
