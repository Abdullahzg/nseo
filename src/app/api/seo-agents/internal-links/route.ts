import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { runInternalLinks, runInternalLinksSweep } from "@/lib/seo-agents/internalLinks";
import { closeIndexingBrowser } from "@/lib/indexing/fetchRendered";
import {
  saveInternalLinkOpportunities,
  getInternalLinkOpportunities,
  markInternalLinkOpportunity,
  type InternalLinkOppInput,
} from "@/lib/db/queries";

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

// GET ?backlog=1&status=open → the persisted, ranked opportunity backlog (whole-site sweep).
export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  if (sp.get("backlog") === "1") {
    const status = sp.get("status") ?? undefined;
    const opportunities = await getInternalLinkOpportunities({ status: status || undefined });
    return NextResponse.json({ ok: true, opportunities });
  }
  return NextResponse.json({ ok: false, error: "pass ?backlog=1 to list the sweep backlog, or POST to run a scan" }, { status: 400 });
}

// PATCH { id, status, ticketUrl? } → mark a backlog item actioned/dismissed/open.
export async function PATCH(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const id = String(body.id ?? "");
  const status = String(body.status ?? "");
  if (!id || !["open", "actioned", "dismissed"].includes(status)) {
    return NextResponse.json({ ok: false, error: "id and a valid status (open|actioned|dismissed) required" }, { status: 400 });
  }
  await markInternalLinkOpportunity(id, status, typeof body.ticketUrl === "string" ? body.ticketUrl : undefined);
  return NextResponse.json({ ok: true });
}

// POST — run a scan. Two modes:
//   { sweep: true, limit?, persist? }  → whole-site sweep across all money pages (grounded).
//   { target, limit }                  → single target page (report-only, unchanged).
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  try {
    if (body.sweep) {
      const limit = Math.min(Math.max(Number(body.limit) || 80, 20), 150);
      const report = await runInternalLinksSweep({ limit });
      let persisted: { saved: number; created: number } | undefined;
      if (body.persist) {
        const rows: InternalLinkOppInput[] = report.opportunities.map((o) => ({
          source_path: o.sourcePath,
          target_path: o.targetPath,
          source_url: o.sourceUrl,
          source_title: o.sourceTitle,
          target_title: o.targetTitle,
          anchor: o.anchor,
          placement: o.placement,
          sentence: o.sentence,
          draft_sentence: o.draftSentence,
          score: o.score,
          shared_terms: o.sharedTerms,
        }));
        persisted = await saveInternalLinkOpportunities(rows);
      }
      return NextResponse.json({ ok: true, report, persisted });
    }

    const target = typeof body.target === "string" && body.target.trim() ? body.target.trim() : "/ai-image-generator";
    const limit = Math.min(Math.max(Number(body.limit) || 30, 5), 60);
    const report = await runInternalLinks({ target, limit });
    return NextResponse.json({ ok: true, report });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "internal-links scan failed" }, { status: 500 });
  } finally {
    await closeIndexingBrowser().catch(() => {});
  }
}
