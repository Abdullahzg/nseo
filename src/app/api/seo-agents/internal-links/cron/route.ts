import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { runInternalLinksSweep } from "@/lib/seo-agents/internalLinks";
import { closeIndexingBrowser } from "@/lib/indexing/fetchRendered";
import { saveInternalLinkOpportunities, type InternalLinkOppInput } from "@/lib/db/queries";
import { getWebhook } from "@/lib/linkaudit/slack";

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

// Nightly whole-site internal-linking sweep: crawl, ground anchors, persist the backlog (deduped
// so only genuinely new opportunities count as "new"), and post a short Slack digest. Pass ?dry=1
// to run + persist WITHOUT posting to Slack.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";

  try {
    const report = await runInternalLinksSweep({ limit: 120 });
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
    const persisted = await saveInternalLinkOpportunities(rows);

    const linkify = report.opportunities.filter((o) => o.placement === "linkify").length;
    const header =
      persisted.created > 0
        ? `:link: *Internal linking — ${persisted.created} new opportunit${persisted.created === 1 ? "y" : "ies"}*`
        : `:link: *Internal linking sweep* — no new opportunities today`;
    const lines = [
      header,
      `Crawled ${report.crawled} pages across ${report.targets.length} money page${report.targets.length === 1 ? "" : "s"}. ` +
        `${report.opportunities.length} total in backlog · ${linkify} ready to linkify (anchor already on the page).`,
      ...report.opportunities.slice(0, 5).map(
        (o) => `• ${o.sourcePath} → ${o.targetPath}  _"${o.anchor}"_ ${o.placement === "linkify" ? "" : "(needs a sentence)"}`,
      ),
    ];
    const text = lines.join("\n");

    let posted = false;
    let slackError: string | undefined;
    if (!dry && persisted.created > 0) {
      const webhook = await getWebhook();
      if (!webhook) {
        slackError = "no Slack webhook configured";
      } else {
        const res = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: AbortSignal.timeout(15_000),
        }).catch((e) => ({ ok: false, status: 0, _err: e?.message }) as any);
        posted = (res as Response).ok;
        if (!posted) slackError = (res as any)._err ?? `Slack HTTP ${(res as Response).status}`;
      }
    }

    return NextResponse.json({
      ok: true,
      crawled: report.crawled,
      targets: report.targets.length,
      total: report.opportunities.length,
      created: persisted.created,
      posted,
      slackError,
      preview: text,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "sweep failed" }, { status: 500 });
  } finally {
    await closeIndexingBrowser().catch(() => {});
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
