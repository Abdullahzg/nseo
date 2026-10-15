// One negotiation step for a thread: classify the latest reply → apply policy → draft → persist
// (and send, in real mode). The anchor row (the initial email) carries the thread's state.
import { supabaseAdmin } from "@/lib/db/supabase";
import { threadFromRows } from "./thread";
import { readTerms, assess, complianceAsk, type LinkRel, type Consideration } from "@/lib/compliance/policy";
import { scanUntrusted, describeAttack } from "@/lib/security/injection";
import { getNegotiationSettings } from "./settings";
import { maxOfferFor } from "./pricing";
import { classifyReplyIntent, draftNegotiationReply, type ThreadMessage, type ReplyClassification, type DraftResult } from "./agent";
import { updateOutreachEmail, getUserEmailConfig, addSuppression } from "@/lib/db/queries";
import { planWithDefaults } from "@/lib/campaign/plan";
import { deliverOutreach } from "@/lib/email/deliver";
import type { LLMMeta } from "@/lib/ai/nebius";

function firstNameFromEmail(e?: string | null): string | undefined {
  if (!e) return undefined;
  const local = (e.split("@")[0] || "").split(/[._+-]/)[0] || "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : undefined;
}

export const INTERVENTION_REASON: Record<string, string> = {
  compliance_block: "Agreeing would have meant paying for a link that passes ranking credit, which Google treats as link spam.",
  suspicious_content: "This reply tried to give the agent instructions, so no model was asked and nothing was answered.",
  asset_request: "They want a document or assets the AI cannot attach on its own.",
  identity_verification: "They want proof of who we are (LinkedIn / website / references).",
  sync_contact: "They want a live call or meeting, which only a person can take.",
  scheduling: "They want availability or a calendar link.",
  redirect: "They pointed us to a different contact to email.",
  process_portal: "They want us to submit via a form or portal.",
  legal_contract: "They want a contract or NDA handled.",
  payment_details: "They want invoice / PO / bank / tax details.",
  factual_question: "They asked a factual question the AI must not invent an answer to.",
  over_policy: "They want terms beyond our price ceiling or policy.",
  inbound_attachment: "They sent a file for us to review.",
  other_channel: "They want to move to another channel (WhatsApp / phone).",
  thread_limit: "The thread reached its maximum length without closing.",
  budget_exception: "Their price is above what the agent may approve on its own.",
  other: "This reply needs a person.",
};

export interface NegotiationResult {
  ok: boolean;
  anchorId: string;
  intent: ReplyClassification["intent"] | null;
  classification: ReplyClassification | null;
  draft: DraftResult | null;
  ceiling: number | null;
  theirPrice: number | null;
  /** agreed | declined | needs_human | negotiating | stalled */
  statusHint: string;
  persistedAs: "sent" | "simulated" | "failed" | "needs_human" | "declined" | "skipped";
  interventionType?: string;
  interventionAsk?: string;
  interventionReason?: string;
  /** The reply the model wrote but code held back (fabrication guard), so the owner can see what it wanted to say. */
  withheldDraft?: string | null;
  /** What the editor's words say about the link and the disclosure, read by code. */
  terms?: { linkRel: LinkRel; disclosed: boolean | null; consideration: Consideration };
  /** The compliance verdict on those terms, with the rules it rests on. */
  compliance?: { verdict: string; why: string; action: string; rules: { id: string; title: string; url: string }[] } | null;
  /** Set when the reply tried to give the agent instructions. */
  injection?: { verdict: string; score: number; matches: { rule: string; why: string; span: string }[] } | null;
  editorQuote?: string | null;
  agreedPrice?: number | null;
  replyRowId?: string | null;
  llm: LLMMeta[];
  error?: string;
}

export async function negotiateThread(anchorId: string, opts: { assistInput?: string | null; demo: boolean; ultraCallsUsed?: number }): Promise<NegotiationResult> {
  const llm: LLMMeta[] = [];
  const base: NegotiationResult = { ok: false, anchorId, intent: null, classification: null, draft: null, ceiling: null, theirPrice: null, statusHint: "negotiating", persistedAs: "skipped", llm };
  const assisting = !!opts.assistInput?.trim();

  const { data: initial } = await supabaseAdmin
    .from("outreach_emails")
    .select("id, workflow_id, campaign_id, author_id, prospect_id, subject, to_email, sender_email, sent_by_email, message_id, max_offer, original_ask, negotiation_status, author:authors!outreach_emails_author_id_fkey(full_name, domain:domains(host, name, dr, organic_traffic, us_traffic_share)), prospect:campaign_prospects(contact_name, domain_host)")
    .eq("id", anchorId).maybeSingle();
  if (!initial) return { ...base, error: "thread anchor not found" };

  const { data: rowsRaw } = await supabaseAdmin
    .from("outreach_emails")
    .select("id, kind, body, subject, created_at, reply_excerpt, reply_subject, reply_from, reply_history, replied_at, sent_at, status")
    .or(`id.eq.${anchorId},parent_id.eq.${anchorId}`)
    .order("created_at", { ascending: true });
  const rows = (rowsRaw ?? []) as any[];
  // Every message both ways, in time order: the editor's earlier replies are part of the conversation too.
  const thread: ThreadMessage[] = threadFromRows(rows).map((m) => ({ from: m.from, body: m.body }));
  const latestReply: any = rows.find((r) => r.kind === "initial" && r.reply_excerpt) ?? null;
  if (!latestReply) return { ...base, error: "no reply on thread" };

  const settings0 = await getNegotiationSettings();
  const { data: campForPlan } = (initial as any).campaign_id ? await supabaseAdmin.from("campaigns").select("plan").eq("id", (initial as any).campaign_id).maybeSingle() : { data: null };
  const plan = planWithDefaults((campForPlan as any)?.plan);
  const settings = { ...settings0, auto_accept_below: plan.auto_accept_below, human_approval_above: plan.human_approval_above, aggressiveness: plan.tone };
  const dom: any = (initial as any).author?.domain ?? null;
  const tier = maxOfferFor(dom?.dr ?? null, dom?.organic_traffic ?? null, dom?.us_traffic_share ?? null, settings.pricing_rules);
  const ceiling = (initial as any).max_offer != null ? Number((initial as any).max_offer) : (tier?.offer ?? null);
  const editorQuote = (latestReply.reply_excerpt ?? "").slice(0, 600);

  // 0) SECURITY, before any model call. The reply came from a stranger; if it reads like an attempt
  // to give the agent instructions, no model is asked anything and the owner decides.
  const scan = scanUntrusted(`${latestReply.reply_subject ?? ""}\n${latestReply.reply_excerpt ?? ""}`);
  const injection = scan.matches.length ? { verdict: scan.verdict, score: scan.score, matches: scan.matches.map((m) => ({ rule: m.rule, why: m.why, span: m.span })) } : null;
  if (injection) await updateOutreachEmail(anchorId, { injection });
  if (scan.verdict === "attack") {
    await supabaseAdmin.from("outreach_emails").delete().eq("parent_id", anchorId).eq("kind", "negotiation").eq("status", "draft");
    await updateOutreachEmail(anchorId, { negotiation_status: "needs_human", intervention_type: "suspicious_content", intervention_ask: `the message ${describeAttack(scan)}`, intervention_reason: "This reply tried to give the agent instructions, so no model was asked and nothing was answered.", intervention_at: new Date().toISOString() });
    return { ...base, ok: true, intent: "needs_human", editorQuote, ceiling, statusHint: "needs_human", persistedAs: "needs_human", interventionType: "suspicious_content", interventionAsk: `the message ${describeAttack(scan)}`, interventionReason: "This reply tried to give the agent instructions, so no model was asked and nothing was answered.", injection };
  }

  // What the editor's words say about the link and the label. Code reads this, never the model:
  // a compliance verdict that could be talked out of its judgement is not a verdict.
  const read = readTerms(`${latestReply.reply_subject ?? ""}\n${latestReply.reply_excerpt ?? ""}`);

  // 1) MODEL: what did they mean?
  const cls = await classifyReplyIntent(latestReply.reply_excerpt ?? "", latestReply.reply_subject ?? "");
  llm.push(cls.llm);
  const theirPrice = cls.priceMentioned;
  await updateOutreachEmail(anchorId, {
    reply_intent: cls.intent, reply_price: theirPrice, reply_sentiment: cls.sentiment,
    ...(theirPrice != null && (initial as any).original_ask == null ? { original_ask: theirPrice } : {}),
  });
  const withCls = { ...base, intent: cls.intent, classification: cls, ceiling, theirPrice, editorQuote };

  const park = async (type: string, ask: string, reason?: string, withheldDraft?: string | null): Promise<NegotiationResult> => {
    await supabaseAdmin.from("outreach_emails").delete().eq("parent_id", anchorId).eq("kind", "negotiation").eq("status", "draft");
    await updateOutreachEmail(anchorId, { negotiation_status: "needs_human", intervention_type: type, intervention_ask: ask, intervention_reason: reason ?? INTERVENTION_REASON[type] ?? INTERVENTION_REASON.other, intervention_at: new Date().toISOString() });
    return { ...withCls, ok: true, statusHint: "needs_human", persistedAs: "needs_human", interventionType: type, interventionAsk: ask, interventionReason: reason ?? INTERVENTION_REASON[type] ?? INTERVENTION_REASON.other, withheldDraft: withheldDraft ?? null };
  };

  // 2) POLICY gates (code-owned).
  // Something that is never purchasable, whatever the price: a guaranteed verdict, or a link
  // written into the terms of the deal.
  if (read.prohibited && !assisting) {
    return { ...(await park("over_policy", `asked for something we cannot buy: ${read.prohibited.title.toLowerCase()}`, read.prohibited.title)), terms: { linkRel: read.linkRel, disclosed: read.disclosed, consideration: "paid" }, compliance: { verdict: "refuse", why: read.prohibited.title, action: "Decline these terms, or ask the owner.", rules: [{ id: read.prohibited.id, title: read.prohibited.title, url: read.prohibited.url }] }, injection };
  }
  const ourMessages = thread.filter((m) => m.from === "us").length;
  if (ourMessages >= (settings.max_thread_length ?? 4) && !assisting) {
    return park("thread_limit", `${ourMessages} replies without closing`, INTERVENTION_REASON.thread_limit);
  }
  // Standing answers from the plan: some things you told the agent up front, so it need not ask.
  let standing: string | null = null;
  if (cls.intent === "needs_human" && !assisting) {
    const t = cls.interventionType;
    if ((t === "sync_contact" || t === "scheduling") && plan.if_asked_for_call === "email_only") standing = "We handle everything by email on our side, no calls; happy to answer anything in writing. (Standing answer from the owner's plan.)";
    else if (t === "factual_question" && plan.if_asked_about_traffic === "use_facts" && plan.facts) standing = `Facts the owner has approved you to state: ${plan.facts}`;
    if (!standing) return park(t ?? "other", cls.interventionAsk ?? "asked for something the AI cannot do");
  }
  if (cls.intent === "auto" || cls.intent === "irrelevant") {
    await updateOutreachEmail(anchorId, { reply_kind: cls.intent === "auto" ? "auto" : "reply" });
    return { ...withCls, ok: true, statusHint: "skipped", persistedAs: "skipped" };
  }
  if (theirPrice != null && !assisting) {
    const absoluteMax = settings.absolute_max_price ?? Infinity;
    if (theirPrice > absoluteMax) {
      return park("budget_exception", `asks ${settings.currency} ${theirPrice}, above the absolute maximum of ${settings.currency} ${absoluteMax}`);
    }
    // Above the ceiling but under the absolute max: negotiate DOWN (Ultra). Never accept above the ceiling — code enforces that in the draft.
  }

  // Sign as the person whose inbox this goes out from.
  // Sign with the owner's configured name (Settings) even in demo, where nothing is sent from a mailbox.
  let productName = "our product";
  let ownerEmail: string | null = (initial as any).sender_email ?? null;
  if ((initial as any).campaign_id) {
    const { data: camp } = await supabaseAdmin.from("campaigns").select("website_url, name, what_you_sell, owner_email").eq("id", (initial as any).campaign_id).maybeSingle();
    productName = (camp as any)?.what_you_sell || (camp as any)?.website_url?.replace(/^https?:\/\//, "").replace(/\/$/, "") || (camp as any)?.name || productName;
    ownerEmail = ownerEmail || (camp as any)?.owner_email || null;
  }
  const senderCfg = ownerEmail ? await getUserEmailConfig(ownerEmail).catch(() => null) : null;
  let senderName = senderCfg?.from_name?.trim().split(/\s+/)[0] || firstNameFromEmail(ownerEmail);
  senderName = senderName || "the team";

  // 3) MODEL (or a policy closing): write the next email.
  const draft = await draftNegotiationReply({
    settings, thread, authorName: (initial as any).prospect?.contact_name || (initial as any).author?.full_name || "there", publication: dom?.name ?? dom?.host ?? (initial as any).prospect?.domain_host ?? "",
    ceiling, floor: settings.min_price, lastIntent: cls.intent, theirPrice, senderName, productName,
    assistInput: assisting ? opts.assistInput : standing ?? (plan.facts ? `Facts the owner has approved you to state if relevant: ${plan.facts}` : null), ultraCallsUsed: opts.ultraCallsUsed ?? 0,
  });
  if (draft.llm) llm.push(draft.llm);
  if (draft.needsHuman) return park(draft.interventionType ?? "other", draft.interventionAsk ?? "reply would need something the AI cannot provide", undefined, draft.withheldDraft ?? null);
  // The owner may already have approved a figure for THIS thread (a Needs-you budget card answered
  // with a number raises the thread's max_offer). Accepting at or under it must not ask again.
  let approvalThreshold = settings.human_approval_above ?? Infinity;
  const { count: approvals } = await supabaseAdmin.from("interventions").select("id", { count: "exact", head: true }).eq("anchor_email_id", anchorId).eq("type", "budget_exception").eq("status", "resolved");
  if ((approvals ?? 0) > 0 && (initial as any).max_offer != null) approvalThreshold = Math.max(approvalThreshold, Number((initial as any).max_offer));
  if (draft.statusHint === "agreed" && !assisting && (draft.suggestedOffer ?? theirPrice ?? 0) > approvalThreshold) {
    return park("budget_exception", `wants to accept ${settings.currency} ${draft.suggestedOffer ?? theirPrice}, above the ${settings.currency} ${approvalThreshold} it may approve alone`);
  }

  // 4) COMPLIANCE (code-owned, like the money). Money or a free product changing hands turns a
  // link into a paid link, and Google is explicit that a paid link has to be qualified. The agent
  // may agree to a placement; it may not agree to buy ranking credit.
  const moneyInvolved = (draft.suggestedOffer ?? 0) > 0 || (theirPrice ?? 0) > 0 || ((initial as any).original_ask ?? 0) > 0;
  const consideration: Consideration = moneyInvolved ? "paid" : read.consideration ?? "none";
  const terms = { linkRel: read.linkRel, disclosed: read.disclosed, consideration };
  const verdict = assess({ ...terms, hostedSection: read.hostedSection });
  const compliance = { verdict: verdict.verdict, why: verdict.why, action: verdict.action, rules: verdict.rules.map((r) => ({ id: r.id, title: r.title, url: r.url })) };
  if (draft.statusHint === "agreed" && verdict.verdict === "refuse" && !assisting) {
    return { ...(await park("compliance_block", verdict.action, verdict.why)), terms, compliance, injection };
  }
  // Agreeing to a paid placement whose link is not yet qualified: the agreement goes out WITH the
  // condition attached, written by code so its wording cannot drift.
  const needsAsk = consideration !== "none" && verdict.verdict !== "compliant" && !/rel=|sponsored/i.test(draft.body);
  if (needsAsk && draft.body) draft.body = `${draft.body.replace(/\n\nBest,\n/, "\n\n__ASK__\n\nBest,\n")}`.replace("__ASK__", complianceAsk(consideration)).trim();

  // Hard no / unsubscribe → suppress the domain so no campaign ever emails them again.
  // A real editor's "no" is respected everywhere. A demo editor is the model playing a part: its
  // "no" must never put a real publication on the never-contact list.
  if ((cls.intent === "hard_no" || cls.intent === "unsubscribe") && !opts.demo) {
    if (dom?.host) await addSuppression("domain", dom.host, `reply ${cls.intent}`).catch(() => {});
  }

  // 4) PERSIST + transport. Demo: simulated (no SMTP, ever). Real: the owner's Gmail via deliverOutreach.
  const subject = /^re:/i.test(initial.subject ?? "") ? initial.subject : `Re: ${initial.subject ?? "(no subject)"}`;
  await supabaseAdmin.from("outreach_emails").delete().eq("parent_id", anchorId).eq("kind", "negotiation").eq("status", "draft");
  let status: "sent" | "failed" = "sent";
  let messageId: string | null = null;
  let sendError: string | null = null;
  if (opts.demo) {
    messageId = `<demo-${crypto.randomUUID()}@simulated.local>`;
  } else {
    const recipient = (initial as any).to_email ?? "";
    const r: any = recipient
      ? await deliverOutreach({ to: recipient, subject, body: draft.body, sender: initial.sender_email, sentBy: initial.sent_by_email, inReplyTo: initial.message_id ?? undefined, references: initial.message_id ?? undefined }).catch((e: any) => ({ ok: false, error: e?.message }))
      : { ok: false, error: "no recipient on thread" };
    status = r?.ok ? "sent" : "failed";
    messageId = r?.messageId ?? null;
    sendError = status === "failed" ? (r?.error ?? "send failed") : null;
  }
  const { data: row } = await supabaseAdmin.from("outreach_emails").insert({
    workflow_id: initial.workflow_id, campaign_id: (initial as any).campaign_id ?? null, author_id: initial.author_id, parent_id: anchorId,
    kind: "negotiation", subject, body: draft.body, status, to_email: (initial as any).to_email ?? null,
    sent_at: status === "sent" ? new Date().toISOString() : null, message_id: messageId, error: sendError,
    sender_email: initial.sender_email, sent_by_email: initial.sent_by_email, ai_managed: true, max_offer: ceiling,
    negotiation_status: draft.statusHint, simulated: opts.demo,
  }).select("id").single();

  const waived = /\b(waive[ds]?|free of charge|no cost|no charge|complimentary|on the house|gratis|won'?t charge)\b/i.test(latestReply.reply_excerpt ?? "");
  const agreedPrice = draft.statusHint === "agreed" ? (waived ? 0 : (draft.suggestedOffer ?? theirPrice ?? null)) : null;
  await updateOutreachEmail(anchorId, {
    negotiation_status: draft.statusHint,
    ...(draft.statusHint === "agreed" ? { agreed_price: agreedPrice } : {}),
    ...(assisting ? { intervention_ask: null, intervention_reason: null, intervention_at: null, intervention_type: null } : {}),
  });

  return {
    ...withCls, ok: true, draft, statusHint: draft.statusHint,
    persistedAs: status === "failed" ? "failed" : opts.demo ? "simulated" : "sent",
    agreedPrice, replyRowId: (row as any)?.id ?? null, error: sendError ?? undefined,
    terms, compliance, injection,
  };
}
