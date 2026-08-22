import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth/service";
import { listBacklinkCampaigns, draftBacklinkPitches, verifyBacklinks } from "@/lib/backlinks/pipeline";

export const maxDuration = 300;

/**
 * Nightly upkeep for every backlink campaign: write the pitches that are missing, and re-check the
 * links we think are live.
 *
 * This closes the automation loop. The send autopilot only promotes `ready` emails to `scheduled` —
 * it never creates them. Drafting an initial pitch was, until now, only possible by a human pressing
 * "Draft pitches" on one campaign at a time, which meant autopilot could be switched on and still
 * send nothing forever because its queue was empty by construction.
 *
 * Drafting is safe to run repeatedly: `draftBacklinkPitches` only touches prospects in stage
 * found/emailing/ready that have an email and no pitch yet, and everything it writes lands as
 * `ready` — queued, never sent. Sending stays behind the autopilot cap and the send window.
 *
 * Verification is included because `verifyBacklinks` was one-shot and human-triggered: a prospect
 * already marked live is skipped forever, so a publisher quietly removing our link left the campaign
 * reporting a win that no longer existed. Running it nightly at least re-checks everything that has
 * NOT yet been found, and turns "did it go live" into a question nobody has to remember to ask.
 */
// Auth lives in @/lib/auth/service so a person, a cron and the agent are recognised by one
// rule. The local copy this replaced also returned true when CRON_SECRET was unset.

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const campaigns = await listBacklinkCampaigns().catch(() => []);
  const results: Array<{ target: string; drafted: number; skippedNoEmail: number; checked: number; live: number; error?: string }> = [];

  let totalDrafted = 0, totalSkipped = 0, totalLive = 0;

  for (const c of campaigns) {
    try {
      const draft = await draftBacklinkPitches(c);
      const verify = await verifyBacklinks(c);
      totalDrafted += draft.drafted;
      totalSkipped += draft.skippedNoEmail;
      totalLive += verify.live;
      results.push({ target: c.target_path, drafted: draft.drafted, skippedNoEmail: draft.skippedNoEmail, checked: verify.checked, live: verify.live });
    } catch (e) {
      // One bad campaign must not stop the rest — record it and carry on.
      results.push({
        target: c.target_path, drafted: 0, skippedNoEmail: 0, checked: 0, live: 0,
        error: e instanceof Error ? e.message : "failed",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    campaigns: campaigns.length,
    totalDrafted,
    // Surfaced deliberately: a high number here means enrichment is the bottleneck, not drafting.
    totalSkippedNoEmail: totalSkipped,
    totalLive,
    results,
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
