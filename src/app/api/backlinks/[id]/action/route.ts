import { NextRequest, NextResponse } from "next/server";
import { kickEnrichment } from "@/lib/backlinks/enrich";
import { isAuthorized } from "@/lib/auth/service";
import { supabaseAdmin } from "@/lib/db/supabase";
import { runBacklinkDiscovery, draftBacklinkPitches, verifyBacklinks, type BacklinkCampaign } from "@/lib/backlinks/pipeline";
import { closeIndexingBrowser } from "@/lib/indexing/fetchRendered";

export const maxDuration = 300;

// Auth lives in @/lib/auth/service so a person, a cron and the agent are recognised by one
// rule. The local copy this replaced also returned true when CRON_SECRET was unset.

// POST { action: "enrich" | "draft" | "verify" | "discover" } — advance one stage of the funnel.
// enrich reuses the existing email-finder; draft writes pitches into outreach_emails (which the
// existing Sending page + cron then send); verify re-crawls prospects for a live link.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action ?? "");

  const { data: bl } = await supabaseAdmin.from("backlink_campaigns").select("*").eq("id", id).maybeSingle();
  if (!bl) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const campaign = bl as BacklinkCampaign;

  try {
    if (action === "discover") {
      const discovery = await runBacklinkDiscovery(campaign, { maxProspects: Number(body.maxProspects) || 15 });
      // Newly found prospects need addresses before they are worth anything, so enrichment follows
      // automatically here too rather than waiting for someone to press a second button.
      const enrich = await kickEnrichment(campaign.campaign_id);
      return NextResponse.json({ ok: true, discovery, enrich });
    }
    if (action === "draft") {
      return NextResponse.json({ ok: true, draft: await draftBacklinkPitches(campaign) });
    }
    if (action === "verify") {
      return NextResponse.json({ ok: true, verify: await verifyBacklinks(campaign) });
    }
    if (action === "enrich") {
      return NextResponse.json({ ok: true, enrich: await kickEnrichment(campaign.campaign_id) });
    }
    return NextResponse.json({ ok: false, error: `unknown action "${action}"` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "failed" }, { status: 500 });
  } finally {
    await closeIndexingBrowser().catch(() => {});
  }
}
