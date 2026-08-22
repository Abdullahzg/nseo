// Backlink outreach pipeline. Reuses the EXISTING outreach system end to end: discovery finds
// linkable pages (v4 backlinkTargets), we save each as a real author/domain/article/contact +
// link it to a normal campaign + workflow, then email-finding, pitch-drafting, sending, and reply
// handling all run through the machinery that already exists. This module only adds the
// backlink-specific glue: a per-target campaign wrapper, the discovery→prospect bridge, a
// backlink-flavored pitch, and a "did the link actually go live" check.
import * as cheerio from "cheerio";
import PQueue from "p-queue";

import { supabaseAdmin } from "@/lib/db/supabase";
import {
  createCampaign, createWorkflow, createEmailTemplate, getEmailTemplate,
  upsertDomain, upsertAuthor, upsertArticle, linkArticleAuthor,
  linkAuthorsToCampaign, addWorkflowProspects, isSuppressed,
  upsertOutreachEmail, updateOutreachEmail,
} from "@/lib/db/queries";
import { runBacklinkTargets } from "@/lib/seo-agents/backlinkTargets";
import { fetchRaw } from "@/lib/indexing/fetchRendered";
import { toPath } from "@/lib/indexing/template";
import { llmChat } from "@/lib/seo-agents/llm";
import { extractByline, publicationName } from "./authorName";

export interface BacklinkCampaign {
  id: string;
  campaign_id: string;
  workflow_id: string;
  template_id: string | null;
  target_url: string;
  target_path: string;
  topic: string | null;
  status: string;
  created_at: string;
}

export type Stage = "found" | "emailing" | "ready" | "sent" | "replied" | "won" | "lost";

function topicFrom(path: string): string {
  const slug = path.split("/").filter(Boolean).pop() ?? "";
  return slug.replace(/[-_]+/g, " ").trim() || "our tool";
}

function normalizeTarget(input: string): { url: string; path: string } {
  const domain = "imagine.art";
  const path = toPath(input.startsWith("http") ? input : `https://${domain}${input.startsWith("/") ? "" : "/"}${input}`);
  return { url: `https://${domain}${path}`, path };
}

// ── Campaign wrapper: one backlink campaign per target page ────────────────────
export async function ensureBacklinkCampaign(targetInput: string): Promise<BacklinkCampaign> {
  const { url, path } = normalizeTarget(targetInput);

  const { data: existing } = await supabaseAdmin
    .from("backlink_campaigns").select("*").eq("target_path", path).maybeSingle();
  if (existing) return existing as BacklinkCampaign;

  const topic = topicFrom(path);
  const campaign = await createCampaign({ name: `[Backlinks] ${path}`, keywords: [topic] });
  const workflow = await createWorkflow({ campaign_id: campaign.id, name: `Backlink outreach — ${path}` });

  // The offer is stated in the subject and in the first line of the ask, not buried.
  //
  // The version this replaces asked "would you consider adding ImagineArt as an option?" and offered a
  // free account, assets, or data. To a publisher who sells placements that is not an incentive — it asks
  // them to work for nothing and makes the sender look like they do not know how the business works. The
  // measured result was a 0.4% win rate, and the target of 50 links a week is arithmetically unreachable
  // by volume (it would need ~12,500 sends against a ~3,430/week ceiling), so the rate is the only lever.
  //
  // No number is quoted, deliberately. Naming a figure first either overpays a small site or insults a
  // large one, and it hands away the negotiation before they have said what they want. Asking them to
  // name terms also qualifies them in one reply: a rate card back means yes-in-principle, and everything
  // after that is the negotiator's job.
  const subject = `Paid collaboration on your ${topic} piece`;
  const body =
    `Hi {{author_name}},\n\n{{custom_line}}\n\n` +
    `I'll be direct, since I know you get a lot of these: we'd like to pay for a collaboration. ` +
    `ImagineArt is an AI image and video generator (${url}), and we'd like to be included in that piece. ` +
    `We have budget allocated for this and we're happy to work to your usual rate and terms.\n\n` +
    `If you're open to it, reply with what you charge and how you prefer to handle it, and I'll get it moving.\n\n` +
    `The piece I mean: {{article_link}}\n\nThanks,\nThe ImagineArt team`;
  const guidance =
    `This is PAID backlink outreach. Write ONLY a 1-2 sentence opener referencing the recipient's specific ` +
    `article (title given) — something that shows a person read it, naming a detail a skim would miss. ` +
    `Warm and plain. Do NOT pitch, do NOT mention money, payment, budget or a rate, do NOT write the ask, ` +
    `links, greeting or sign-off — the template supplies all of that immediately after your sentences. ` +
    `Never open with "I hope this finds you well" or "I came across your article".`;
  const template = await createEmailTemplate({ name: `Backlink pitch — ${path}`, subject, body, guidance });

  const { data, error } = await supabaseAdmin
    .from("backlink_campaigns")
    .insert({ campaign_id: campaign.id, workflow_id: workflow.id, template_id: template.id, target_url: url, target_path: path, topic })
    .select().single();
  if (error) throw error;
  return data as BacklinkCampaign;
}

export async function listBacklinkCampaigns(): Promise<(BacklinkCampaign & { stageCounts: Record<string, number>; total: number })[]> {
  const { data: camps } = await supabaseAdmin.from("backlink_campaigns").select("*").order("created_at", { ascending: false });
  const out = [];
  for (const c of (camps ?? []) as BacklinkCampaign[]) {
    const { data: rows } = await supabaseAdmin.from("backlink_prospects").select("stage").eq("backlink_campaign_id", c.id);
    const stageCounts: Record<string, number> = {};
    for (const r of rows ?? []) stageCounts[(r as any).stage] = (stageCounts[(r as any).stage] ?? 0) + 1;
    out.push({ ...c, stageCounts, total: (rows ?? []).length });
  }
  return out;
}

// ── Discovery → real prospects (the bridge into the existing outreach tables) ──
export async function runBacklinkDiscovery(bl: BacklinkCampaign, opts: { maxProspects?: number } = {}): Promise<{ found: number; saved: number; skipped: number }> {
  const report = await runBacklinkTargets({ target: bl.target_url, maxProspects: opts.maxProspects ?? 15 });

  // Domains already in this campaign — don't re-add.
  const { data: existing } = await supabaseAdmin.from("backlink_prospects").select("domain").eq("backlink_campaign_id", bl.id);
  const seen = new Set((existing ?? []).map((r: any) => r.domain));

  const queue = new PQueue({ concurrency: 4 });
  const authorIds: string[] = [];
  let saved = 0, skipped = 0;

  await Promise.all(report.prospects.map((p) => queue.add(async () => {
    try {
      if (seen.has(p.domain)) { skipped++; return; }
      if (await isSuppressed(p.domain)) { skipped++; return; }

      // Byline (real person) if we can find one; else a "<Publication> Editorial" pseudo-author.
      const raw = await fetchRaw(p.url);
      const byline = raw?.ok && raw.html ? extractByline(raw.html) : null;
      const fullName = byline ?? `${publicationName(p.domain)} Editorial`;

      const domain = await upsertDomain(p.domain, { name: publicationName(p.domain) });
      const author = await upsertAuthor({ full_name: fullName, primary_domain_id: domain.id, source: "backlink", role: "writer" });
      const article = await upsertArticle({ url_canonical: p.url, title: p.title || p.domain, domain_id: domain.id });
      await linkArticleAuthor(article.id, author.id);
      authorIds.push(author.id);

      await supabaseAdmin.from("backlink_prospects").upsert({
        backlink_campaign_id: bl.id, author_id: author.id, domain: p.domain, prospect_url: p.url,
        angle: p.angle, score: p.composite, stage: "found", updated_at: new Date().toISOString(),
      }, { onConflict: "backlink_campaign_id,author_id", ignoreDuplicates: true });
      saved++;
    } catch { skipped++; }
  })));

  if (authorIds.length) {
    await linkAuthorsToCampaign(bl.campaign_id, authorIds);
    await addWorkflowProspects(bl.workflow_id, authorIds);
  }
  return { found: report.prospects.length, saved, skipped };
}

// ── Draft backlink pitches for prospects that have an email (reuses outreach_emails) ──
export async function draftBacklinkPitches(bl: BacklinkCampaign): Promise<{ drafted: number; skippedNoEmail: number }> {
  const template = bl.template_id ? await getEmailTemplate(bl.template_id) : null;
  const { data: prospects } = await supabaseAdmin
    .from("backlink_prospects")
    .select("id, author_id, prospect_url, stage")
    .eq("backlink_campaign_id", bl.id)
    .in("stage", ["found", "emailing", "ready"]);
  const rows = (prospects ?? []) as any[];
  if (!rows.length) return { drafted: 0, skippedNoEmail: 0 };

  // Stitch author name / email / article title with separate queries (no FK-embed dependency).
  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const urls = [...new Set(rows.map((r) => r.prospect_url))];
  const { data: authors } = await supabaseAdmin.from("authors").select("id, full_name").in("id", authorIds);
  // owner_name rides along because the address is not always the byline's. Hunter's domain-search step
  // can return an editor or founder at the same publication — often the better contact for a link, since
  // they can actually place one — and the pitch has to be addressed to whoever it really goes to.
  const { data: contacts } = await supabaseAdmin.from("contacts").select("author_id, value, owner_name, owner_position").eq("type", "mailto").in("author_id", authorIds);
  const { data: articles } = await supabaseAdmin.from("articles").select("url_canonical, title").in("url_canonical", urls);
  const nameById = new Map((authors ?? []).map((a: any) => [a.id, a.full_name]));
  const emailById = new Map((contacts ?? []).map((c: any) => [c.author_id, c.value]));
  const ownerById = new Map(
    (contacts ?? []).filter((c: any) => c.owner_name).map((c: any) => [c.author_id, { name: c.owner_name as string, position: (c.owner_position ?? null) as string | null }]),
  );
  const titleByUrl = new Map((articles ?? []).map((a: any) => [a.url_canonical, a.title]));

  let drafted = 0, skippedNoEmail = 0;
  for (const p of rows) {
    if (!emailById.has(p.author_id)) { skippedNoEmail++; continue; }
    const byline = nameById.get(p.author_id) ?? "there";
    const owner = ownerById.get(p.author_id);
    // Who the mail actually reaches. When the address belongs to someone else, greeting the byline would
    // open "Hi Sarah," to a different person — the one mistake a recipient cannot un-see.
    const recipientName = owner?.name ?? byline;
    const title = titleByUrl.get(p.prospect_url) || p.prospect_url;

    // The opener still references the ARTICLE (that is the reason for writing), but the model is told who
    // it is addressing and how they relate to it, so it cannot claim "your article" to someone who did
    // not write it.
    const relation = owner
      ? `You are writing to ${owner.name}${owner.position ? ` (${owner.position})` : ""} at this publication. `
        + `The article was written by ${byline}, NOT by the person you are addressing — refer to it as their `
        + `publication's piece, never as "your article".`
      : `You are writing to ${byline}, who wrote the article.`;
    const opener = await llmChat({
      system: template?.guidance,
      maxTokens: 140,
      prompt: `${relation}\nThe article: "${title}". Write the opener now (1-2 sentences).`,
    });
    const customLine = opener?.content?.trim() || (owner
      ? "I came across a piece on your site and thought it was a genuinely useful roundup."
      : "I came across your piece and thought it was a genuinely useful roundup.");

    const subject = template?.subject ?? `A resource for your piece`;
    const body = (template?.body ?? "Hi {{author_name}},\n\n{{custom_line}}\n\n{{article_link}}")
      .replace(/\{\{author_name\}\}/g, String(recipientName).split(" ")[0])
      .replace(/\{\{custom_line\}\}/g, customLine)
      .replace(/\{\{article_link\}\}/g, p.prospect_url);

    const oe = await upsertOutreachEmail({ workflow_id: bl.workflow_id, author_id: p.author_id, template_id: bl.template_id ?? undefined, subject, body, status: "ready" });
    await supabaseAdmin.from("backlink_prospects").update({ stage: "ready", outreach_email_id: oe.id, updated_at: new Date().toISOString() }).eq("id", p.id);
    drafted++;
  }
  return { drafted, skippedNoEmail };
}

// ── Sync funnel stages from the reused outreach_emails (sent / replied) ────────
export async function refreshStages(blId: string): Promise<void> {
  const { data: prospects } = await supabaseAdmin
    .from("backlink_prospects")
    .select("id, stage, link_live_at, outreach_email_id")
    .eq("backlink_campaign_id", blId);
  const rows = (prospects ?? []) as any[];
  const emailIds = rows.map((p) => p.outreach_email_id).filter(Boolean);
  const { data: emails } = emailIds.length
    ? await supabaseAdmin.from("outreach_emails").select("id, status, sent_at, replied_at").in("id", emailIds)
    : { data: [] };
  const emailById = new Map((emails ?? []).map((e: any) => [e.id, e]));
  for (const p of rows) {
    if (p.link_live_at) { if (p.stage !== "won") await setStage(p.id, "won"); continue; }
    const e = p.outreach_email_id ? emailById.get(p.outreach_email_id) : null;
    if (!e) continue;
    let stage: Stage | null = null;
    if (e.replied_at) stage = "replied";
    else if (e.sent_at || e.status === "sent") stage = "sent";
    else if (e.status === "ready" || e.status === "scheduled" || e.status === "draft") stage = "ready";
    if (stage && stage !== p.stage) await setStage(p.id, stage);
  }
}

async function setStage(id: string, stage: Stage): Promise<void> {
  await supabaseAdmin.from("backlink_prospects").update({ stage, updated_at: new Date().toISOString() }).eq("id", id);
}

// ── "Did the link actually go live?" — re-crawl the prospect page for a link to the target ──
export async function verifyBacklinks(bl: BacklinkCampaign): Promise<{ checked: number; live: number }> {
  const { data: prospects } = await supabaseAdmin
    .from("backlink_prospects").select("id, prospect_url, outreach_email_id, link_live_at").eq("backlink_campaign_id", bl.id);
  const queue = new PQueue({ concurrency: 4 });
  let checked = 0, live = 0;
  await Promise.all(((prospects ?? []) as any[]).map((p) => queue.add(async () => {
    if (p.link_live_at) { live++; return; }
    checked++;
    const raw = await fetchRaw(p.prospect_url);
    if (!raw?.ok || !raw.html) return;
    const $ = cheerio.load(raw.html);
    let found = false;
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      try { if (toPath(new URL(href, p.prospect_url).toString()) === bl.target_path && new URL(href, p.prospect_url).host.includes("imagine.art")) found = true; } catch { /* ignore */ }
    });
    if (found) {
      live++;
      await supabaseAdmin.from("backlink_prospects").update({ stage: "won", link_live_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", p.id);
      if (p.outreach_email_id) await updateOutreachEmail(p.outreach_email_id, { success_at: new Date().toISOString(), success_link: p.prospect_url, success_notes: "Backlink verified live by crawler." });
    }
  })));
  return { checked, live };
}

/** How much to trust an email address, derived from how it was obtained.
 *
 *  This is the distinction that decides who gets emailed first. `sourced` means the address was found
 *  somewhere real — on their article page, a social profile, or via Blitz from their LinkedIn.
 *  `verified` means it was CONSTRUCTED from a domain pattern but Reoon then confirmed the mailbox
 *  accepts mail. `guess` means constructed and never confirmed, or confirmed only as catch-all —
 *  which is where bounces come from, and why these sort last rather than being silently mixed in.
 *
 *  Kept as a pure function of `source` so the ordering can never disagree with the badge shown. */
export type EmailTrust = "sourced" | "verified" | "guess" | "none";

export function emailTrust(source: string | null): EmailTrust {
  if (!source) return "none";
  if (source === "pattern-verified") return "verified";
  if (source === "pattern" || source === "pattern-catchall") return "guess";
  return "sourced";
}

/** Rank order for EmailTrust, highest first. Used as a sort key, so it lives next to the type. */
export const EMAIL_TRUST_RANK: Record<EmailTrust, number> = { sourced: 3, verified: 2, guess: 1, none: 0 };

// ── Funnel data for the UI ─────────────────────────────────────────────────────
export async function getFunnel(blId: string): Promise<any> {
  const { data: bl } = await supabaseAdmin.from("backlink_campaigns").select("*").eq("id", blId).maybeSingle();
  if (!bl) return null;
  await refreshStages(blId);
  const { data: prospects } = await supabaseAdmin
    .from("backlink_prospects")
    // outreach_email_id is REQUIRED here, not optional: the attention block below maps over
    // `p.outreach_email_id`, and while it was missing from this select every id was undefined, so
    // `emailIds` was always empty and the interventions / awaiting-payment / ai-paused counts silently
    // reported zero no matter what the negotiator had actually parked. It also joins the drafted pitch.
    .select("id, author_id, domain, prospect_url, angle, score, stage, link_live_at, outreach_email_id")
    .eq("backlink_campaign_id", blId)
    .order("score", { ascending: false });
  const pRows = (prospects ?? []) as any[];
  const authorIds = [...new Set(pRows.map((p) => p.author_id))];
  const { data: authors } = authorIds.length ? await supabaseAdmin.from("authors").select("id, full_name").in("id", authorIds) : { data: [] };
  // `source` and `confidence` come along because the UI ranks on email QUALITY, not just presence:
  // a scraped address and a constructed guess are not the same prospect. See EMAIL_TRUST.
  const { data: contacts } = authorIds.length
    ? await supabaseAdmin.from("contacts").select("author_id, value, source, confidence, owner_name, owner_position").eq("type", "mailto").in("author_id", authorIds)
    : { data: [] };

  // Domain Rating, looked up per host. Stored on `domains.dr` (Ahrefs), so the table can show and sort
  // on real authority rather than the article-count proxy baked into `scores.composite`.
  const hosts = [...new Set(pRows.map((p) => p.domain).filter(Boolean))];
  const { data: domainRows } = hosts.length
    ? await supabaseAdmin.from("domains").select("host, dr").in("host", hosts)
    : { data: [] };
  const drByHost = new Map((domainRows ?? []).map((d: any) => [d.host, d.dr]));

  // The drafted pitch per prospect. The team could not find anywhere to read or edit what the AI had
  // written — the drafts existed as `ready` outreach_emails with no surface at all.
  const pitchIds = pRows.map((p) => p.outreach_email_id).filter(Boolean);
  const { data: pitchRows } = pitchIds.length
    ? await supabaseAdmin.from("outreach_emails")
        .select("id, subject, body, status, sent_at, scheduled_at, edited_at, edited_by")
        .in("id", pitchIds)
    : { data: [] };
  const pitchById = new Map((pitchRows ?? []).map((m: any) => [m.id, m]));

  const nameById = new Map((authors ?? []).map((a: any) => [a.id, a.full_name]));
  const emailById = new Map((contacts ?? []).map((c: any) => [c.author_id, c]));
  const rows = pRows.map((p) => {
    const c = emailById.get(p.author_id);
    const value = c?.value ? String(c.value).replace(/^mailto:/, "") : null;
    return {
      id: p.id, domain: p.domain, prospectUrl: p.prospect_url, angle: p.angle, score: p.score,
      stage: p.stage, author: nameById.get(p.author_id) ?? null, hasEmail: !!value,
      email: value, linkLiveAt: p.link_live_at,
      // The three signals the prospect list ranks on, surfaced separately rather than blended into one
      // opaque number — so a person can see WHY a prospect is near the top and disagree with it.
      dr: drByHost.get(p.domain) ?? null,
      emailSource: c?.source ?? null,
      emailConfidence: c?.confidence ?? null,
      emailTrust: emailTrust(c?.source ?? null),
      // Who the address actually belongs to, when it is not the byline. A Hunter domain-search alt
      // contact — an editor or founder at the same publication. Shown so an operator reviewing the pitch
      // can see it is addressed to a different person on purpose.
      emailOwner: c?.owner_name ?? null,
      emailOwnerPosition: c?.owner_position ?? null,
      // The pitch itself, so it can be read and edited in place rather than existing invisibly.
      pitch: (() => {
        const m = p.outreach_email_id ? pitchById.get(p.outreach_email_id) : null;
        if (!m) return null;
        return {
          id: m.id, subject: m.subject, body: m.body, status: m.status,
          sentAt: m.sent_at ?? null, scheduledAt: m.scheduled_at ?? null,
          editedAt: m.edited_at ?? null, editedBy: m.edited_by ?? null,
          // Only an unsent pitch is editable. Editing a sent one would misrepresent what went out.
          editable: !m.sent_at && m.status !== "sent",
        };
      })(),
    };
  });
  const stageCounts: Record<string, number> = {};
  for (const r of rows) stageCounts[r.stage] = (stageCounts[r.stage] ?? 0) + 1;

  // What is parked waiting on a person. This is the only part of the funnel a human MUST act on, so it
  // is computed here rather than left for the page to infer — a count the UI derives itself would
  // drift from what the negotiator actually did.
  const emailIds = pRows.map((p) => p.outreach_email_id).filter(Boolean);
  let attention = { interventions: [] as Array<{ id: string; type: string; ask: string | null; who: string | null }>, awaitingPayment: 0, aiPaused: 0 };
  if (emailIds.length) {
    const { data: mails } = await supabaseAdmin
      .from("outreach_emails")
      .select("id, author_id, intervention_type, intervention_ask, negotiation_status, payment_status, ai_managed, replied_at")
      .in("id", emailIds);
    for (const m of ((mails ?? []) as any[])) {
      if (m.intervention_type) {
        attention.interventions.push({ id: m.id, type: m.intervention_type, ask: m.intervention_ask ?? null, who: nameById.get(m.author_id) ?? null });
      }
      // "agreed but not yet paid" is the payment-approval gate.
      if (m.negotiation_status === "agreed" && m.payment_status !== "paid") attention.awaitingPayment++;
      // A replied thread the AI is NOT managing will sit forever unless a person answers it.
      if (m.replied_at && !m.ai_managed) attention.aiPaused++;
    }
  }

  return { campaign: bl, prospects: rows, stageCounts, total: rows.length, attention };
}
