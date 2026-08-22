import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth/service";
import { ensureBacklinkCampaign, runBacklinkDiscovery, listBacklinkCampaigns } from "@/lib/backlinks/pipeline";
import { kickEnrichment } from "@/lib/backlinks/enrich";
import { closeIndexingBrowser } from "@/lib/indexing/fetchRendered";

export const maxDuration = 300;

// Auth lives in @/lib/auth/service so the agent and the crons are recognised by one rule. The
// local version this replaced returned true when CRON_SECRET was unset — a fail-open that the
// shared helper does not have.

// GET → list backlink campaigns with stage counts.
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, campaigns: await listBacklinkCampaigns() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "failed" }, { status: 500 });
  }
}

// POST { target } → create (or reuse) a backlink campaign for that page AND run discovery once.
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const target = typeof body.target === "string" && body.target.trim() ? body.target.trim() : null;
  if (!target) return NextResponse.json({ ok: false, error: "target page is required" }, { status: 400 });
  try {
    const bl = await ensureBacklinkCampaign(target);
    const discovery = await runBacklinkDiscovery(bl, { maxProspects: Number(body.maxProspects) || 15 });
    // Chain straight into email finding. Prospects without an address are silently skipped by
    // draftBacklinkPitches, so a campaign that stops at discovery is a campaign that never sends.
    const enrich = await kickEnrichment(bl.campaign_id);
    return NextResponse.json({ ok: true, campaign: bl, discovery, enrich });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "failed" }, { status: 500 });
  } finally {
    await closeIndexingBrowser().catch(() => {});
  }
}
