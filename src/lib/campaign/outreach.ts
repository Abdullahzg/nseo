// Outreach + negotiation tools for the agentic campaign layer (new hackathon work).
//
// Outreach reuses the guarded burst processor: we only INSERT outreach_emails rows
// (status 'scheduled'); /api/emails/process performs every real send through the
// legacy trust gates (role/placeholder/guessed rejection, duplicate-inbox guards,
// pooled per-user SMTP, Message-ID stamping). In demo mode rows are marked sent
// immediately with a simulated marker — nothing ever leaves the machine.
import { supabaseAdmin } from "@/lib/db/supabase";
import { llmText } from "@/lib/ai/gemini";
import { sanitizeBody } from "@/lib/negotiation/agent";
import { negotiateThread } from "@/lib/negotiation/run";
import { getNegotiationSettings } from "@/lib/negotiation/settings";
import { isRoleEmail } from "@/lib/email/roleEmail";
import { isPlaceholderEmail } from "@/lib/enrich/personFilter";
import { addressHasOtherSentInitial, getUserEmailConfig } from "@/lib/db/queries";
import { sendEmail } from "@/lib/email/smtp";
import {
  getCampaignRow, getProspect, updateProspect, reserveBudget,
  createDeal, getDealByAnchor, updateDeal,
  resolveIntervention, setCampaignPhase, createIntervention,
} from "./queries";
import { emitEvent } from "./tools";
import type { DealTerms } from "./types";

// ─── workflow binding ─────────────────────────────────────────────────────────

export async function ensureAgenticWorkflow(campaign: any): Promise<string> {
  const name = `Agentic · ${campaign.name}`;
  const { data: existing } = await supabaseAdmin
    .from("workflows").select("id").eq("campaign_id", campaign.id).eq("name", name).limit(1).maybeSingle();
  if (existing) return (existing as any).id;
  const { data: wf, error } = await supabaseAdmin
    .from("workflows")
    .insert({ campaign_id: campaign.id, name, filters: {}, status: "ready" })
    .select("id")
    .single();
  if (error) throw error;
  return (wf as any).id;
}

async function campaignWorkflowIds(campaignId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("workflows").select("id").eq("campaign_id", campaignId);
  return ((data as any[]) ?? []).map((r) => r.id);
}

export interface CampaignThread {
  anchor_id: string;
  author_id: string | null;
  negotiation_status: string | null;
  replied_at: string | null;
}

export async function listCampaignThreads(campaignId: string): Promise<CampaignThread[]> {
  const ids = await campaignWorkflowIds(campaignId);
  if (!ids.length) return [];
  const { data } = await supabaseAdmin
    .from("outreach_emails")
    .select("id, author_id, negotiation_status, replied_at")
    .in("workflow_id", ids)
    .eq("kind", "initial");
  return ((data as any[]) ?? []).map((r) => ({
    anchor_id: r.id,
    author_id: r.author_id ?? null,
    negotiation_status: r.negotiation_status ?? null,
    replied_at: r.replied_at ?? null,
  }));
}

// ─── email template engine ──────────────────────────────────────────────────

/** Replace {{placeholder}} tokens with values. */
function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

/** Drop lines that contain an unfilled placeholder. */
function dropEmptyLines(template: string): string {
  return template.split("\n").filter((line) => !/\{\{[^}]+\}\}/.test(line)).join("\n");
}

/** Strip any leftover {{tokens}} and clean whitespace. */
function stripPlaceholders(text: string): string {
  return text.replace(/\{\{[^}]+\}\}/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

async function getDefaultTemplate(): Promise<{ subject: string; body: string; guidance: string } | null> {
  const { data } = await supabaseAdmin
    .from("email_templates").select("subject, body, guidance").eq("channel", "email").limit(1).maybeSingle();
  return (data as any) ?? null;
}

async function getTemplateById(id: string): Promise<{ subject: string; body: string; guidance: string } | null> {
  const { data } = await supabaseAdmin
    .from("email_templates").select("subject, body, guidance").eq("id", id).limit(1).maybeSingle();
  return (data as any) ?? null;
}

// ─── outreach ────────────────────────────────────────────────────────────────

interface OutreachDraft { subject: string; body: string; provider: string; simulated_reason?: string }

/** Personalized opener drafted from the stored article understanding, using templates when available. */
export async function draftOutreachEmail(
  prospect: any,
  campaign: any,
  sequence?: { subjectPrefix?: string; bodyPrefix?: string }
): Promise<OutreachDraft> {
  const q = prospect.qualification ?? {};
  const title = q.title ?? prospect.title ?? prospect.domain_host;
  const websiteName = campaign.website_url?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? campaign.name ?? "our product";
  const toolMentioned = q.placement_angle?.split(" ").slice(0, 4).join(" ") ?? campaign.keywords?.[0] ?? "AI tools";

  // Try to load the campaign's preferred template, or fall back to the first email template
  let template: { subject: string; body: string; guidance: string } | null = null;
  if (campaign.email_template_id) {
    template = await getTemplateById(campaign.email_template_id);
  }
  if (!template) {
    template = await getDefaultTemplate();
  }

  // Generate the AI personalized opener ({{custom_line}})
  const guidance = template?.guidance ?? "Write a warm, specific 2-3 sentence opener referencing their article.";
  const openerPrompt = `Write a short personalized opener for an outreach email.

THEIR ARTICLE: ${title}
PUBLICATION: ${prospect.domain_host}
OUR PRODUCT: ${websiteName}
WHY WE FIT: ${q.why_fit ?? "relevant to their coverage"}

RULES:
- 2-3 sentences. Warm, specific about THEIR article. Not salesy.
- Do NOT include greeting (Hi/Hey) or sign-off (Best/Thanks).
- Do NOT promise attachments, links, meetings, or payments.
- Plain text only. No em dashes or en dashes.
- Reference something specific about their article title or topic.

Output ONLY the personalized opening lines.`;
  const openerOut = await llmText(openerPrompt, { maxTokens: 300, temperature: 0.6 });
  const customLine = openerOut && openerOut.text.length > 20 ? sanitizeBody(openerOut.text) : `I came across your piece on ${title} and thought it was a great take on the space. The way you covered the intersection of technology and journalism really stood out.`;

  if (template) {
    // Resolve author name from prospect's author_id or qualification data
    let authorName = "there";
    let firstName = "";
    if (prospect.author_id) {
      try {
        const { data: author } = await supabaseAdmin.from("authors").select("full_name").eq("id", prospect.author_id).maybeSingle();
        if ((author as any)?.full_name) {
          authorName = (author as any).full_name;
          firstName = authorName.split(" ")[0];
        }
      } catch {}
    }
    if (!firstName) {
      // Try from qualification data
      const qAuthor = q.article_author ?? "";
      if (qAuthor && qAuthor !== "Unknown") {
        authorName = qAuthor;
        firstName = qAuthor.split(" ")[0];
      }
    }
    if (!firstName) firstName = "there";

    // Fill template with placeholders
    const vars: Record<string, string> = {
      author_name: authorName,
      first_name: firstName,
      pub_name: prospect.domain_host,
      website_name: websiteName,
      article_title: String(title).slice(0, 120),
      article_date: q.published_at?.slice(0, 10) ?? "",
      tool_mentioned: toolMentioned,
      custom_line: customLine,
      article_link: q.url ?? "",
    };
    let body = fillTemplate(template.body, vars);
    body = dropEmptyLines(body);
    body = stripPlaceholders(body);
    body = sanitizeBody(body);
    if (sequence?.bodyPrefix) body = sequence.bodyPrefix + body;

    let subject = fillTemplate(template.subject, vars);
    subject = stripPlaceholders(subject);
    if (!subject) subject = `Quick idea for your "${String(title).slice(0, 60)}" piece`;
    if (sequence?.subjectPrefix) subject = sequence.subjectPrefix + subject;

    return { subject, body, provider: openerOut?.provider ?? "template+fallback" };
  }

  // No template available — use LLM to draft the full email
  const prompt = `Write a short outreach email to the writer/editor of an article, asking whether they'd consider including or mentioning our product.

OUR PRODUCT SITE: ${campaign.website_url || "(see objective)"}
CAMPAIGN OBJECTIVE: ${campaign.objective || "editorial coverage for our product"}
TARGET TOPICS: ${(campaign.keywords ?? []).join(", ") || "n/a"}

THEIR ARTICLE: ${title}
WHY WE FIT (analysis): ${q.why_fit ?? "relevant to their coverage"}
SUGGESTED ANGLE: ${q.placement_angle ?? "a natural inclusion in their coverage"}
PUBLICATION: ${prospect.domain_host}

RULES:
- 4 to 6 sentences. Warm, human, specific. Not salesy.
- Reference something specific about THEIR article (use the title/topic naturally).
- Ask whether they accept such inclusions and what their rate would be.
- Do NOT promise attachments, links, meetings, or payments.
- Plain text only. Never use em dashes or en dashes.
- Start with a greeting and end with a sign-off.

Output ONLY the email body.`;
  const out = await llmText(prompt, { maxTokens: 500, temperature: 0.6 });
  let body = out ? sanitizeBody(out.text) : sanitizeBody(
    `Hi there,\n\n${customLine}\n\nWe build ${websiteName} and think it could be a natural fit for your coverage of ${toolMentioned}. Would you be open to including it, and if so what would your rate be?\n\nBest,`
  );
  if (sequence?.bodyPrefix) body = sequence.bodyPrefix + body;
  let subject = `Quick idea for your "${String(title).slice(0, 60)}" piece`;
  if (sequence?.subjectPrefix) subject = sequence.subjectPrefix + subject;
  return {
    subject,
    body,
    provider: out?.provider ?? "fallback-template",
  };
}

export interface SendResult {
  ok: boolean;
  email_id?: string;
  simulated?: boolean;
  reason?: string;
}

/**
 * Queue outreach to one prospect. Real mode inserts status='scheduled' (the burst processor
 * owns delivery + all safety gates). Demo mode records a SIMULATED send so downstream reply/
 * negotiation flows run identically without touching the outside world.
 */
export async function sendOutreachToProspect(prospectId: string): Promise<SendResult> {
  const t0 = Date.now();
  const p = await getProspect(prospectId);
  if (!p) return { ok: false, reason: "prospect not found" };
  const camp = await getCampaignRow(p.campaign_id);
  if (!camp) return { ok: false, reason: "campaign not found" };
  if (camp.emergency_stopped) return { ok: false, reason: "emergency stop active" };
  if (camp.paused_outreach && !camp.demo_mode) return { ok: false, reason: "outreach paused" };

  if (!p.contact_email) return { ok: false, reason: "no contact resolved" };
  if (isRoleEmail(p.contact_email)) return { ok: false, reason: "role mailbox refused" };
  if (isPlaceholderEmail(p.contact_email)) return { ok: false, reason: "placeholder address refused" };
  // Cross-campaign duplicate guard: never initial two threads into one inbox.
  if (!p.contact_email.includes("@simulated") && await addressHasOtherSentInitial(p.contact_email, "").catch(() => false)) {
    await updateProspect(prospectId, { status: "lost", notes: { reason: "inbox already contacted elsewhere" } });
    return { ok: false, reason: "duplicate inbox" };
  }

  const workflowId = await ensureAgenticWorkflow(camp);
  const draft = await draftOutreachEmail(p, camp);
  let authorId = p.author_id;
  if (!authorId) {
    try {
      const { data: a } = await supabaseAdmin.from("authors").select("id").eq("primary_domain_id", p.domain_host).limit(1).maybeSingle();
      authorId = (a as any)?.id ?? null;
    } catch { authorId = null; }
  }

  const demo = !!camp.demo_mode;
  // Demo mode: route ALL emails to the test inbox so the full flow is observable.
  const DEMO_RECIPIENT = "ab.ghouri03@gmail.com";
  const recipientEmail = demo ? DEMO_RECIPIENT : p.contact_email;

  // Per-domain rate limiting: max 3 emails per domain per hour
  if (!demo && recipientEmail) {
    const domain = recipientEmail.split("@")[1];
    if (domain) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabaseAdmin
        .from("outreach_emails")
        .select("id", { count: "exact", head: true })
        .like("to_email", `%@${domain}`)
        .gte("created_at", oneHourAgo);
      if ((count ?? 0) >= 3) {
        return { ok: false, reason: `rate limit: 3 emails/hour max for @${domain}` };
      }
    }
  }

  if (demo) {
    // Pre-assign the simulated publisher persona for this thread's scenario.
    try { const { assignDemoPersona } = await import("./demo"); await assignDemoPersona(prospectId); } catch {}
  }
  const row: Record<string, unknown> = {
    workflow_id: workflowId,
    author_id: authorId,
    kind: "initial",
    subject: draft.subject,
    body: draft.body,
    sender_email: camp.owner_email ?? null,
    sent_by_email: camp.owner_email ?? null,
    to_email: recipientEmail,
    ai_managed: true,
    max_offer: p.ceiling ?? null,
    ...(demo
      ? { status: "sent", sent_at: new Date().toISOString(), message_id: `<demo-${crypto.randomUUID()}@simulated.local>` }
      : { status: "scheduled", scheduled_at: new Date().toISOString() }),
  };
  const { data: inserted, error } = await supabaseAdmin.from("outreach_emails").insert(row as never).select("id").single();
  if (error) return { ok: false, reason: error.message };

  // Add tracking pixel for open tracking (real mode only)
  let sendBody = draft.body;
  if (!demo && inserted) {
    const pixelUrl = `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3100"}/api/track/open?id=${(inserted as any).id}`;
    sendBody += `\n<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />`;
  }

  // Demo mode: actually send the email via SMTP so it's observable in the inbox.
  if (demo) {
    try {
      await sendEmail({
        to: DEMO_RECIPIENT,
        subject: draft.subject,
        body: sendBody,
      });
      await supabaseAdmin.from("outreach_emails").update({
        status: "sent",
        sent_at: new Date().toISOString(),
      }).eq("id", (inserted as any).id);
    } catch (e: any) {
      // Log but don't fail — the row is recorded as sent for demo flow continuity.
      console.error("[demo-send] SMTP failed:", e?.message);
    }
  }

  await updateProspect(prospectId, { status: "outreached" });
  await emitEvent(p.campaign_id, "outreach", demo ? "outreach_sent_simulated" : "outreach_queued", {
    prospect_id: prospectId,
    thread_id: (inserted as any).id,
    detail: {
      host: p.domain_host, to_domain: p.contact_email?.split("@")[1],
      subject: draft.subject, drafter: draft.provider, simulated: demo,
      ceiling: p.ceiling ?? null,
    },
    duration_ms: Date.now() - t0,
  });
  return { ok: true, email_id: (inserted as any).id, simulated: demo };
}

// ─── multi-touch sequences ────────────────────────────────────────────────────

/** Default sequence: initial + 2 follow-ups spaced 2 and 4 days apart */
const DEFAULT_SEQUENCE_DELAYS_MS = [0, 2 * 86400_000, 4 * 86400_000];
const SEQUENCE_TEMPLATES = [
  { kind: "initial" as const, subjectPrefix: "", bodyPrefix: "" },
  { kind: "followup" as const, subjectPrefix: "Following up: ", bodyPrefix: "Just circling back on my previous email — " },
  { kind: "followup" as const, subjectPrefix: "Re: ", bodyPrefix: "Bumping this to the top of your inbox. " },
];

/**
 * Schedule the next touch in a multi-touch sequence for a prospect.
 * Checks if there are remaining steps and if the previous step hasn't been replied to.
 */
export async function scheduleNextSequenceTouch(prospectId: string): Promise<{ ok: boolean; scheduled?: boolean; reason?: string }> {
  const p = await getProspect(prospectId);
  if (!p) return { ok: false, reason: "prospect not found" };
  if (!p.contact_email) return { ok: false, reason: "no contact" };

  const camp = await getCampaignRow(p.campaign_id);
  if (!camp) return { ok: false, reason: "campaign not found" };
  if (camp.emergency_stopped) return { ok: false, reason: "emergency stop" };

  // Count existing emails in this thread
  const workflowId = await ensureAgenticWorkflow(camp);
  const { data: existing } = await supabaseAdmin
    .from("outreach_emails")
    .select("id, kind, replied_at, sent_at, scheduled_at")
    .eq("workflow_id", workflowId)
    .eq("author_id", p.author_id)
    .order("created_at", { ascending: true });

  const emails = (existing ?? []) as any[];
  const currentStep = emails.length;

  // No more steps in sequence
  if (currentStep >= SEQUENCE_TEMPLATES.length) {
    return { ok: true, scheduled: false, reason: "sequence complete" };
  }

  // Don't schedule if they already replied
  const hasReply = emails.some((e) => e.replied_at);
  if (hasReply) {
    return { ok: true, scheduled: false, reason: "already replied" };
  }

  const template = SEQUENCE_TEMPLATES[currentStep];
  const delayMs = DEFAULT_SEQUENCE_DELAYS_MS[currentStep];
  const scheduledAt = new Date(Date.now() + delayMs).toISOString();

  // Draft the follow-up email
  const draft = await draftOutreachEmail(p, camp, {
    subjectPrefix: template.subjectPrefix,
    bodyPrefix: template.bodyPrefix,
  });

  let authorId = p.author_id;
  if (!authorId) {
    try {
      const { data: a } = await supabaseAdmin.from("authors").select("id").eq("primary_domain_id", p.domain_host).limit(1).maybeSingle();
      authorId = (a as any)?.id ?? null;
    } catch { authorId = null; }
  }

  const demo = !!camp.demo_mode;
  const DEMO_RECIPIENT = "ab.ghouri03@gmail.com";
  const recipientEmail = demo ? DEMO_RECIPIENT : p.contact_email;

  const { error } = await supabaseAdmin.from("outreach_emails").insert({
    workflow_id: workflowId,
    author_id: authorId,
    kind: template.kind,
    parent_id: emails[0]?.id ?? null,
    subject: draft.subject,
    body: draft.body,
    sender_email: camp.owner_email ?? null,
    sent_by_email: camp.owner_email ?? null,
    to_email: recipientEmail,
    ai_managed: true,
    max_offer: p.ceiling ?? null,
    status: demo ? "sent" : "scheduled",
    sent_at: demo ? new Date().toISOString() : null,
    scheduled_at: demo ? null : scheduledAt,
    message_id: demo ? `<demo-${crypto.randomUUID()}@simulated.local>` : null,
  } as never);

  if (error) return { ok: false, reason: error.message };

  await emitEvent(camp.id, "outreach", "sequence_scheduled", {
    prospect_id: prospectId,
    detail: { step: currentStep + 1, total_steps: SEQUENCE_TEMPLATES.length, scheduled_at: scheduledAt, kind: template.kind, subject: draft.subject },
  });

  return { ok: true, scheduled: true };
}

/**
 * Process due follow-ups: find scheduled follow-ups whose scheduled_at has passed
 * and whose thread hasn't received a reply yet.
 */
export async function processDueFollowUps(campaignId: string): Promise<{ processed: number; skipped: number }> {
  const now = new Date().toISOString();
  const workflowIds = await campaignWorkflowIds(campaignId);
  if (!workflowIds.length) return { processed: 0, skipped: 0 };

  const { data: due } = await supabaseAdmin
    .from("outreach_emails")
    .select("id, parent_id, workflow_id, author_id, subject, body, to_email, scheduled_at")
    .in("workflow_id", workflowIds)
    .eq("status", "scheduled")
    .eq("kind", "followup")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", now);

  if (!due?.length) return { processed: 0, skipped: 0 };

  let processed = 0;
  let skipped = 0;

  for (const email of due as any[]) {
    // Check if the parent thread has received a reply
    if (email.parent_id) {
      const { data: parent } = await supabaseAdmin
        .from("outreach_emails")
        .select("replied_at")
        .eq("id", email.parent_id)
        .maybeSingle();
      if ((parent as any)?.replied_at) { skipped++; continue; }
    }

    // Mark as sent (the burst processor will handle actual delivery)
    await supabaseAdmin
      .from("outreach_emails")
      .update({ status: "sent", sent_at: now })
      .eq("id", email.id);

    processed++;
  }

  return { processed, skipped };
}

// ─── negotiation tick ─────────────────────────────────────────────────────────

export interface NegotiateOutcome {
  email_id: string;
  intent: string | null;
  action: string;              // sent | drafted | needs_human | agreed | declined | skipped | error
  offer: number | null;
  ceiling: number | null;
  intervention_type?: string;
  deal_id?: string;
  error?: string;
}

/**
 * One negotiation step for a campaign thread: classify → policy → draft → (maybe send),
 * then persist a structured deal when terms are agreed (budget-checked, never over budget).
 */
export async function negotiateCampaignThread(
  anchorEmailId: string,
  opts: { assistInput?: string | null; runId?: string | null } = {}
): Promise<NegotiateOutcome> {
  const base: NegotiateOutcome = { email_id: anchorEmailId, intent: null, action: "skipped", offer: null, ceiling: null };
  const { data: anchor } = await supabaseAdmin
    .from("outreach_emails")
    .select("id, workflow_id, author_id, negotiation_status, replied_at")
    .eq("id", anchorEmailId).maybeSingle();
  if (!anchor) return { ...base, action: "error", error: "thread not found" };
  const { data: wf } = await supabaseAdmin.from("workflows").select("campaign_id").eq("id", (anchor as any).workflow_id).maybeSingle();
  const campaignId = (wf as any)?.campaign_id;
  const camp = campaignId ? await getCampaignRow(campaignId) : null;

  if (camp?.emergency_stopped) return { ...base, action: "skipped", error: "emergency stop" };
  if (["agreed", "declined", "handoff"].includes(((anchor as any).negotiation_status ?? ""))) return base;

  const settings = await getNegotiationSettings();
  const autonomyMode = camp?.autonomy_mode ?? "autonomous";
  const autonomyOverride = autonomyMode === "autonomous";

  const result = await negotiateThread(anchorEmailId, {
    assistInput: opts.assistInput ?? null,
    autonomyOverride,
    // Demo campaigns run deterministic classification + scripted-counter fallback so the
    // arc can never be derailed by provider limits. Production keeps the full LLM path.
    heuristicOnly: !!camp?.demo_mode,
    demoScripted: !!camp?.demo_mode,
  }).catch((e: any) => ({ ok: false, error: e?.message }) as any);

  const intent = result.intent ?? null;
  const action: NegotiateOutcome["action"] =
    result.persistedAs === "needs_human" ? "needs_human"
      : result.sent ? "sent"
        : result.ok ? "drafted" : "error";

  // Thread-level runaway cap mirrors the legacy cron guard: escalate instead of nagging.
  if (result.ok && result.statusHint === "stalled") {
    await supabaseAdmin.from("outreach_emails").update({ negotiation_status: "stalled" }).eq("id", anchorEmailId);
  }

  // Structured deal on agreement — deterministic budget enforcement BEFORE celebrating.
  let dealId: string | undefined;
  if (result.statusHint === "agreed") {
    const price = Number(result.suggestedOffer ?? 0) || 0;
    const { data: auth0 } = await supabaseAdmin
      .from("authors").select("full_name, domain:domains(host, name)").eq("id", (anchor as any).author_id).maybeSingle();
    const host = ((auth0 as any)?.domain?.host) ?? "unknown";
    const waived = /\b(waive[ds]?|free of charge|no cost|no charge|complimentary|on the house|gratis|won'?t charge)\b/i.test(
      ((await supabaseAdmin.from("outreach_emails").select("reply_excerpt").eq("id", anchorEmailId).maybeSingle()).data as any)?.reply_excerpt ?? ""
    );
    const effectivePrice = waived ? 0 : price;

    if (effectivePrice > 0 && camp) {
      const budget = await reserveBudget(camp.id, effectivePrice, null, `deal committed: ${host}`);
      if (!budget.ok) {
        // NEVER exceed the budget autonomously: park as an over-policy human decision.
        await createInterventionSafe({
          campaign_id: camp.id,
          anchor_email_id: anchorEmailId,
          type: "over_policy",
          ask: `Agreed price ${camp.currency} ${effectivePrice} exceeds remaining budget (${camp.currency} ${budget.remaining})`,
          reason: "Budget authority exhausted; human must approve or renegotiate.",
          suggested_options: ["Approve over-budget spend", "Renegotiate lower", "Decline politely"],
        });
        await supabaseAdmin.from("outreach_emails").update({
          negotiation_status: "needs_human",
          intervention_type: "over_policy",
          intervention_ask: "agreed price exceeds remaining budget",
          intervention_at: new Date().toISOString(),
        }).eq("id", anchorEmailId);
        await emitEvent(camp.id, "negotiation", "deal_blocked_budget", {
          thread_id: anchorEmailId, level: "warn",
          detail: { host, requested: effectivePrice, remaining: budget.remaining },
        });
        return { email_id: anchorEmailId, intent, action: "needs_human", offer: effectivePrice, ceiling: result.ceiling ?? null, intervention_type: "over_policy" };
      }
      dealId = (await upsertDeal({
        campaignId: camp.id, anchorEmailId, authorId: (anchor as any).author_id, host,
        publication: (auth0 as any)?.domain?.name ?? host,
        terms: { price: effectivePrice, currency: camp.currency ?? "USD", conditions: ["agreed via AI negotiation"] },
        originalAsk: null, agreedPrice: effectivePrice,
      })).id;
    } else if (camp) {
      dealId = (await upsertDeal({
        campaignId: camp.id, anchorEmailId, authorId: (anchor as any).author_id, host,
        publication: (auth0 as any)?.domain?.name ?? host,
        terms: { price: 0, currency: camp.currency ?? "USD", conditions: [waived ? "fee waived by publisher" : "editorial inclusion, no fee"] },
        originalAsk: null, agreedPrice: 0,
      })).id;
    }

    if (camp) {
      await emitEvent(camp.id, "negotiation", "terms_agreed", {
        thread_id: anchorEmailId,
        state_before: String(intent), state_after: "TERMS_AGREED",
        detail: { host, price: effectivePrice, waived, deal_id: dealId },
      });
      // Completion check: goal reached?
      await checkCampaignCompletion(camp.id);
    }
  }

  if (result.persistedAs === "needs_human") {
    // The legacy path flagged the outreach row; mirror it as a durable intervention so the
    // campaign UI + ADK service see a resumable HITL request.
    const { data: cur } = await supabaseAdmin
      .from("outreach_emails").select("intervention_type, intervention_ask, intervention_reason").eq("id", anchorEmailId).maybeSingle();
    await createInterventionSafe({
      campaign_id: camp?.id ?? null,
      anchor_email_id: anchorEmailId,
      type: (cur as any)?.intervention_type ?? "other",
      ask: (cur as any)?.intervention_ask ?? "needs a human",
      reason: (cur as any)?.intervention_reason ?? "the AI cannot complete this step safely",
      suggested_options: defaultOptionsFor((cur as any)?.intervention_type ?? "other"),
    });
    await emitEvent(camp?.id ?? null, "negotiation", "intervention_opened", {
      thread_id: anchorEmailId, level: "warn",
      detail: { type: (cur as any)?.intervention_type, ask: (cur as any)?.intervention_ask },
    });
  }

  return {
    email_id: anchorEmailId, intent, action,
    offer: result.suggestedOffer ?? null,
    ceiling: result.ceiling ?? null,
    intervention_type: result.persistedAs === "needs_human" ? "needs_human" : undefined,
    deal_id: dealId,
    error: result.error,
  };
}

function defaultOptionsFor(type: string): string[] {
  switch (type) {
    case "sync_contact": return ["Provide availability", "Decline call", "Take over thread"];
    case "scheduling": return ["Share availability text", "Send calendar link", "Decline"];
    case "asset_request": return ["Upload asset", "Describe where to get it", "Decline request"];
    case "payment_details": return ["Provide invoice/bank details", "Route to finance", "Decline"];
    case "factual_question": return ["Provide the answer", "Instruct agent to say it will follow up"];
    case "legal_contract": return ["Review & sign externally", "Decline terms", "Negotiate via human"];
    default: return ["Provide guidance", "Take over thread"];
  }
}

async function createInterventionSafe(input: {
  campaign_id?: string | null;
  anchor_email_id?: string | null;
  type: string;
  ask?: string;
  reason?: string;
  suggested_options?: string[];
}) {
  try {
    return await createIntervention(input);
  } catch { return null; }
}

async function upsertDeal(input: { campaignId: string; anchorEmailId: string; authorId: string | null; host: string; publication: string; terms: DealTerms; originalAsk: number | null; agreedPrice: number }): Promise<any> {
  const existing = await getDealByAnchor(input.anchorEmailId);
  if (existing) {
    await updateDeal(existing.id, { status: "terms_agreed", terms: input.terms, agreed_price: input.agreedPrice });
    return existing;
  }
  return createDeal({
    campaign_id: input.campaignId,
    anchor_email_id: input.anchorEmailId,
    author_id: input.authorId,
    domain_host: input.host,
    publication: input.publication,
    terms: input.terms,
    original_ask: input.originalAsk,
    agreed_price: input.agreedPrice,
    currency: input.terms.currency ?? "USD",
  });
}

// ─── replies tick ─────────────────────────────────────────────────────────────

export interface RepliesTickResult {
  detected: number;
  negotiated: number;
  needs_human: number;
  errors: string[];
}

/**
 * Bounded monitoring unit: sweep inbound mail once, then answer every unanswered,
 * AI-managed campaign thread within policy. Mirrors the legacy cron guards
 * (autoresponder skip, thread-length cap → escalate) but scoped to this campaign
 * and driven by campaign-level autonomy rather than the global singleton.
 */
export async function processRepliesTick(
  campaignId: string,
  opts: { runId?: string | null; detectReplies?: boolean } = {}
): Promise<RepliesTickResult> {
  const out: RepliesTickResult = { detected: 0, negotiated: 0, needs_human: 0, errors: [] };
  const camp = await getCampaignRow(campaignId);
  if (!camp) { out.errors.push("campaign not found"); return out; }
  if (camp.emergency_stopped) { out.errors.push("emergency stop"); return out; }

  if (opts.detectReplies !== false) {
    if (camp.demo_mode) {
      // Demo mode: simulated publisher personas inject through the REAL reply-recording
      // path; no IMAP is touched and nothing external ever sees these threads.
      try {
        const { injectDemoReplies } = await import("./demo");
        const n = await injectDemoReplies(campaignId);
        out.detected = n;
        if (n > 0) {
          await emitEvent(campaignId, "inbox_triage", "demo_replies_injected", { detail: { count: n, simulated: true } });
        }
      } catch (e: any) {
        out.errors.push(`demo injection: ${e?.message}`);
      }
    } else {
      try {
        const { runReplyDetection } = await import("@/lib/email/imap");
        const r = await runReplyDetection();
        out.detected = r.repliesFound ?? 0;
        await emitEvent(campaignId, "inbox_triage", "reply_sweep", {
          tool: "imap.runReplyDetection", detail: { accounts: r.accountsChecked, found: r.repliesFound },
        });
      } catch (e: any) {
        out.errors.push(`reply detection: ${e?.message}`);
      }
    }
  }

  const settings = await getNegotiationSettings();
  const threads = await listCampaignThreads(campaignId);
  for (const th of threads) {
    if (!th.replied_at) continue;
    if (["agreed", "declined", "needs_human", "handoff"].includes(th.negotiation_status ?? "")) continue;
    // Autoresponders aren't negotiated (legacy rule).
    const { data: kindRow } = await supabaseAdmin
      .from("outreach_emails").select("reply_kind").eq("id", th.anchor_id).maybeSingle();
    if (((kindRow as any)?.reply_kind ?? "") === "auto") continue;
    // Thread-length cap (legacy runaway guard).
    const { data: negRows } = await supabaseAdmin
      .from("outreach_emails").select("kind, status, parent_id").or(`id.eq.${th.anchor_id},parent_id.eq.${th.anchor_id}`);
    const rowsT = (negRows ?? []) as any[];
    const sentNegs = rowsT.filter((r) => r.kind === "negotiation" && r.status === "sent").length;
    if (sentNegs >= (settings.max_thread_length ?? 4)) {
      await createInterventionSafe({
        campaign_id: campaignId, anchor_email_id: th.anchor_id, type: "other",
        ask: "Long AI back-and-forth, a person should take over",
        reason: `Reached the ${settings.max_thread_length ?? 4}-reply cap.`,
      });
      out.needs_human++;
      continue;
    }
    const latestReply = rowsT.map((r) => r.replied_at).filter(Boolean).sort().pop() as string | undefined;
    // Legacy runaway guard: if our latest negotiation send is NEWER than their latest reply,
    // this message is already answered — never answer twice (the auto-reply runaway bug).
    if (latestReply) {
      const lastAnswer = rowsT
        .filter((r) => r.kind === "negotiation" && r.status === "sent")
        .map((r) => r.sent_at)
        .filter(Boolean)
        .sort()
        .pop() as string | undefined;
      if (lastAnswer && lastAnswer >= latestReply) continue;
    }
    const r = await negotiateCampaignThread(th.anchor_id, { runId: opts.runId }).catch((e) => ({ action: "error", error: e?.message, email_id: th.anchor_id, intent: null, offer: null, ceiling: null }) as NegotiateOutcome);
    if (r.action === "sent" || r.action === "drafted") out.negotiated++;
    if (r.action === "needs_human") out.needs_human++;
    if (r.action === "error") out.errors.push(r.error ?? "negotiation error");
  }
  return out;
}

// ─── HITL resume ──────────────────────────────────────────────────────────────

export interface ResumeResult { ok: boolean; resumed_negotiation?: boolean; outcome?: NegotiateOutcome; error?: string }

/** Human answered an intervention: persist the trusted input and resume the SAME thread. */
export async function resumeFromIntervention(
  interventionId: string,
  assistInput: string,
  resolvedBy: string
): Promise<ResumeResult> {
  const iv = await resolveIntervention(interventionId, assistInput, resolvedBy);
  if (!iv) return { ok: false, error: "intervention not open / not found" };
  await emitEvent(iv.campaign_id, "hitl", "intervention_resolved", {
    thread_id: iv.anchor_email_id,
    detail: { type: iv.type, answered_by: resolvedBy, input_chars: assistInput.length },
  });

  if (!iv.anchor_email_id) return { ok: true, resumed_negotiation: false };
  // Asset-backed interventions keep the uploaded file on the legacy columns; the negotiator
  // picks it up via its own assist path when present.
  const outcome = await negotiateCampaignThread(iv.anchor_email_id, { assistInput });
  await supabaseAdmin.from("interventions").update({
    result_action: outcome.action,
    ...(outcome.deal_id ? {} : {}),
  }).eq("id", interventionId);
  return { ok: true, resumed_negotiation: true, outcome };
}

// ─── completion ───────────────────────────────────────────────────────────────

/** Deterministic completion: goal reached, budget exhausted, pool dry, or stopped. */
export async function checkCampaignCompletion(campaignId: string): Promise<{ completed: boolean; reason?: string }> {
  const camp = await getCampaignRow(campaignId);
  if (!camp || camp.phase === "completed" || camp.phase === "stopped") return { completed: false };
  const desired = camp.desired_deals ?? null;
  if (desired != null) {
    const { count } = await supabaseAdmin
      .from("deals").select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId).in("status", ["terms_agreed", "awaiting_content", "awaiting_payment_approval", "placement_pending", "live", "verified", "closed"]);
    if ((count ?? 0) >= desired) {
      await setCampaignPhase(campaignId, "completed", "goal_reached");
      await emitEvent(campaignId, "campaign_manager", "campaign_completed", { detail: { reason: "goal_reached", deals: count } });
      return { completed: true, reason: "goal_reached" };
    }
  }
  const total = Number(camp.budget_total ?? 0);
  const used = Number(camp.budget_used ?? 0);
  if (total > 0 && total - used < 5) {
    // Effectively exhausted (< $5 headroom): nothing further can close autonomously.
    const { count } = await supabaseAdmin
      .from("deals").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId);
    await setCampaignPhase(campaignId, "completed", "budget_exhausted");
    await emitEvent(campaignId, "campaign_manager", "campaign_completed", { detail: { reason: "budget_exhausted", deals: count } });
    return { completed: true, reason: "budget_exhausted" };
  }
  return { completed: false };
}
