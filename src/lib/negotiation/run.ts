// One negotiation step for a thread: classify the latest reply → apply policy → draft → persist
// (and send, in real mode). The anchor row (the initial email) carries the thread's state.
import { supabaseAdmin } from "@/lib/db/supabase";
import { getNegotiationSettings } from "./settings";
import { maxOfferFor } from "./pricing";
import { classifyReplyIntent, draftNegotiationReply, type ThreadMessage, type ReplyClassification, type DraftResult } from "./agent";
import { updateOutreachEmail, getUserEmailConfig, addSuppression } from "@/lib/db/queries";
import { deliverOutreach } from "@/lib/email/deliver";
import type { LLMMeta } from "@/lib/ai/nebius";

function firstNameFromEmail(e?: string | null): string | undefined {
  if (!e) return undefined;
  const local = (e.split("@")[0] || "").split(/[._+-]/)[0] || "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : undefined;
}

export const INTERVENTION_REASON: Record<string, string> = {
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
    .select("id, workflow_id, campaign_id, author_id, subject, to_email, sender_email, sent_by_email, message_id, max_offer, original_ask, negotiation_status, author:authors!outreach_emails_author_id_fkey(full_name, domain:domains(host, name, dr, organic_traffic, us_traffic_share))")
    .eq("id", anchorId).maybeSingle();
  if (!initial) return { ...base, error: "thread anchor not found" };

  const { data: rowsRaw } = await supabaseAdmin
    .from("outreach_emails")
    .select("id, kind, body, subject, created_at, reply_excerpt, reply_subject, replied_at, sent_at, status")
    .or(`id.eq.${anchorId},parent_id.eq.${anchorId}`)
    .order("created_at", { ascending: true });
  const rows = (rowsRaw ?? []) as any[];
  const thread: ThreadMessage[] = [];
  let latestReply: any = null;
  for (const r of rows) {
    if (r.body && r.status !== "draft") thread.push({ from: "us", body: r.body });
    if (r.reply_excerpt) { thread.push({ from: "them", body: r.reply_excerpt }); latestReply = r; }
  }
  if (!latestReply) return { ...base, error: "no reply on thread" };

  const settings = await getNegotiationSettings();
  const dom: any = (initial as any).author?.domain ?? null;
  const tier = maxOfferFor(dom?.dr ?? null, dom?.organic_traffic ?? null, dom?.us_traffic_share ?? null, settings.pricing_rules);
  const ceiling = (initial as any).max_offer != null ? Number((initial as any).max_offer) : (tier?.offer ?? null);
  const editorQuote = (latestReply.reply_excerpt ?? "").slice(0, 600);

  // 1) MODEL: what did they mean?
  const cls = await classifyReplyIntent(latestReply.reply_excerpt ?? "", latestReply.reply_subject ?? "");
  llm.push(cls.llm);
  const theirPrice = cls.priceMentioned;
  await updateOutreachEmail(anchorId, {
    reply_intent: cls.intent, reply_price: theirPrice, reply_sentiment: cls.sentiment,
    ...(theirPrice != null && (initial as any).original_ask == null ? { original_ask: theirPrice } : {}),
  });
  const withCls = { ...base, intent: cls.intent, classification: cls, ceiling, theirPrice, editorQuote };

  const park = async (type: string, ask: string, reason?: string): Promise<NegotiationResult> => {
    await supabaseAdmin.from("outreach_emails").delete().eq("parent_id", anchorId).eq("kind", "negotiation").eq("status", "draft");
    await updateOutreachEmail(anchorId, { negotiation_status: "needs_human", intervention_type: type, intervention_ask: ask, intervention_reason: reason ?? INTERVENTION_REASON[type] ?? INTERVENTION_REASON.other, intervention_at: new Date().toISOString() });
    return { ...withCls, ok: true, statusHint: "needs_human", persistedAs: "needs_human", interventionType: type, interventionAsk: ask, interventionReason: reason ?? INTERVENTION_REASON[type] ?? INTERVENTION_REASON.other };
  };

  // 2) POLICY gates (code-owned).
  const ourMessages = thread.filter((m) => m.from === "us").length;
  if (ourMessages >= (settings.max_thread_length ?? 4) && !assisting) {
    return park("thread_limit", `${ourMessages} replies without closing`, INTERVENTION_REASON.thread_limit);
  }
  if (cls.intent === "needs_human" && !assisting) {
    return park(cls.interventionType ?? "other", cls.interventionAsk ?? "asked for something the AI cannot do");
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
  const senderCfg = (initial as any).sender_email ? await getUserEmailConfig((initial as any).sender_email).catch(() => null) : null;
  const senderName = senderCfg?.from_name?.trim().split(/\s+/)[0] || firstNameFromEmail((initial as any).sender_email) || "the team";
  let productName = "our product";
  if ((initial as any).campaign_id) {
    const { data: camp } = await supabaseAdmin.from("campaigns").select("website_url, name, what_you_sell").eq("id", (initial as any).campaign_id).maybeSingle();
    productName = (camp as any)?.what_you_sell || (camp as any)?.website_url?.replace(/^https?:\/\//, "").replace(/\/$/, "") || (camp as any)?.name || productName;
  }

  // 3) MODEL (or a policy closing): write the next email.
  const draft = await draftNegotiationReply({
    settings, thread, authorName: (initial as any).author?.full_name ?? "there", publication: dom?.name ?? dom?.host ?? "",
    ceiling, floor: settings.min_price, lastIntent: cls.intent, theirPrice, senderName, productName,
    assistInput: assisting ? opts.assistInput : null, ultraCallsUsed: opts.ultraCallsUsed ?? 0,
  });
  if (draft.llm) llm.push(draft.llm);
  if (draft.needsHuman) return park(draft.interventionType ?? "other", draft.interventionAsk ?? "reply would need something the AI cannot provide");
  const approvalThreshold = settings.human_approval_above ?? Infinity;
  if (draft.statusHint === "agreed" && !assisting && (draft.suggestedOffer ?? theirPrice ?? 0) > approvalThreshold) {
    return park("budget_exception", `wants to accept ${settings.currency} ${draft.suggestedOffer ?? theirPrice}, above the ${settings.currency} ${approvalThreshold} it may approve alone`);
  }

  // Hard no / unsubscribe → suppress the domain so no campaign ever emails them again.
  if (cls.intent === "hard_no" || cls.intent === "unsubscribe") {
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
  };
}
