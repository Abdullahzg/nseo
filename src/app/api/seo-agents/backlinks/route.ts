import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { runBacklinkTargets } from "@/lib/seo-agents/backlinkTargets";
import { scoreProspect } from "@/lib/seo-agents/authorScoring";
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

// Report-only. Two actions:
//  - { target } → find + score backlink prospects for that money page (#4 + #5)
//  - { scoreUrl } → score a single prospect URL ad-hoc (#5)
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  try {
    if (typeof body.scoreUrl === "string" && body.scoreUrl.trim()) {
      const url = body.scoreUrl.trim();
      const score = await scoreProspect(url, [], "AI tools");
      return NextResponse.json({ ok: true, score });
    }
    const target = typeof body.target === "string" && body.target.trim() ? body.target.trim() : "/ai-image-generator";
    const report = await runBacklinkTargets({ target });
    return NextResponse.json({ ok: true, report });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "backlinks failed" }, { status: 500 });
  } finally {
    await closeIndexingBrowser().catch(() => {});
  }
}
