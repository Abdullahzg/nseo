// Outreach + reply handling for a campaign.
//
// Real mode: rows are inserted as `scheduled`; /api/emails/process (owner-only, Redis-locked) is
// the ONLY thing that ever sends. Demo mode: rows are recorded as simulated `sent` — no SMTP, no
// DEMO_RECIPIENT, nothing leaves the machine.
import { supabaseAdmin } from "@/lib/db/supabase";
import { json as nebiusJson, NebiusError } from "@/lib/ai/nebius";
import { sanitizeBody } from "@/lib/negotiation/agent";
import { negotiateThread, type NegotiationResult } from "@/lib/negotiation/run";
import { isRoleEmail } from "@/lib/email/roleEmail";
import { isPlaceholderEmail } from "@/lib/enrich/personFilter";
import { addressHasOtherSentInitial, createFollowupRow, getUserEmailConfig } from "@/lib/db/queries";
import { getCampaign, getProspect, updateProspect, reserveBudget, createDeal, getDealByAnchor, createIntervention, resolveIntervention, listProspects, listCampaignThreads, recordEvent, updateCampaign, setPhase, getDeals } from "./queries";
import { assignDemoPersona, injectDemoReplies } from "./demo";
import type { Campaign, Prospect } from "./types";

// ─── Workflow binding (the email engine groups sends by workflow) ─────────────

export async function ensureWorkflow(camp: Campaign): Promise<string> {
  const { data: existing } = await supabaseAdmin.from("workflows").select("id").eq("campaign_id", camp.id).limit(1).maybeSingle();
  if (existing) return (existing as any).id;
  const { data, error } = await supabaseAdmin.from("workflows").insert({ campaign_id: camp.id, name: camp.name, status: "ready" }).select("id").single();
  if (error) throw error;
  return (data as any).id;
}

// ─── Drafting ────────────────────────────────────────────────────────────────

interface OutreachDraft { subject: string; body: string }
const DRAFT_SCHEMA = { name: "outreach_email", schema: { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"], additionalProperties: false } };
const isDraft = (v: unknown): v is OutreachDraft => { const o = v as any; return !!o && typeof o.subject === "string" && o.subject.trim().length > 4 && typeof o.body === "string" && o.body.trim().length > 40; };

/** "restoria.app" → "Restoria": the name the model may call us when the owner gave only a URL. */
export function productName(camp: Campaign): string {
  try {
    const host = new URL(camp.website_url ?? "").hostname.replace(/^www\./, "");
    const label = host.split(".")[0] || host;
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch { return camp.name; }
}

export async function draftOutreachEmail(p: Prospect, camp: Campaign, signer: string): Promise<{ draft: OutreachDraft; meta: import("@/lib/ai/nebius").LLMMeta }> {
  const q = p.qualification ?? ({} as NonNullable<Prospect["qualification"]>);
  const editorFirst = (p.contact_name ?? "").split(/\s+/)[0] || "there";
  const r = await nebiusJson<OutreachDraft>({
    role: "fast", thinking: false, max_tokens: 500, temperature: 0.5, schema: DRAFT_SCHEMA, validate: isDraft,
    messages: [
      { role: "system", content: "You write short, specific, human outreach emails from a product team to an editor, asking to be included in a piece they wrote. Plain text. No em dashes. No bracketed placeholders. No claims about traffic, pricing, or files. JSON only: {subject, body}." },
      { role: "user", content: `Editor first name: ${editorFirst}
Publication: ${p.domain_host}
Their article: "${q.title ?? p.title ?? ""}"
Why it fits (from our analysis): ${q.why_fit ?? ""}
Suggested angle: ${q.placement_angle ?? ""}
Our product (what we sell): ${camp.what_you_sell ?? camp.name}
Our product name: ${productName(camp)} (${camp.website_url ?? ""}). Refer to us only by this name or as "our tool". The publication (${p.domain_host}) is NOT us; never present its name as ours.
Sign-off name: ${signer}

Write: a subject under 60 chars that references their article, and a body of 4-6 sentences: one genuine specific line about their article, what we make in one sentence, a clear ask (include us in that piece or a similar one), and ask what they typically charge for an inclusion. Start with "Hi ${editorFirst},". End with "Best,\n${signer}".` },
    ],
  });
  return { draft: { subject: r.data.subject.trim().slice(0, 120), body: sanitizeBody(r.data.body) }, meta: r.meta };
}

// ─── Sending (queueing) ──────────────────────────────────────────────────────

export interface SendResult { ok: boolean; email_id?: string; simulated?: boolean; reason?: string }

export async function sendOutreachToProspect(prospectId: string): Promise<SendResult> {
  const p = await getProspect(prospectId);
  if (!p) return { ok: false, reason: "prospect not found" };
  const camp = await getCampaign(p.campaign_id);
  if (!camp) return { ok: false, reason: "campaign not found" };
  if (!p.contact_email) return { ok: false, reason: "no contact resolved" };
  if (isRoleEmail(p.contact_email)) return { ok: false, reason: "role mailbox refused" };
  if (isPlaceholderEmail(p.contact_email)) return { ok: false, reason: "placeholder address refused" };
  const demo = !!camp.demo_mode;
  if (!demo) {
    if (!camp.owner_email) return { ok: false, reason: "real campaigns need an owner with a configured sender" };
    const cfg = await getUserEmailConfig(camp.owner_email);
    if (!cfg.hasPassword) return { ok: false, reason: "owner has no Gmail app password configured" };
    if (await addressHasOtherSentInitial(p.contact_email, "")) {
      await updateProspect(prospectId, { status: "lost" });
      return { ok: false, reason: "inbox already contacted by another campaign" };
    }
    const domain = p.contact_email.split("@")[1];
    const { count } = await supabaseAdmin.from("outreach_emails").select("id", { count: "exact", head: true }).like("to_email", `%@${domain}`).gte("created_at", new Date(Date.now() - 3600_000).toISOString());
    if ((count ?? 0) >= 3) return { ok: false, reason: `rate limit: 3 emails/hour for @${domain}` };
  }

  const senderCfg = camp.owner_email ? await getUserEmailConfig(camp.owner_email).catch(() => null) : null;
  const local = (camp.owner_email ?? "").split("@")[0].split(/[._+-]/)[0];
  const signer = senderCfg?.from_name?.trim() || (local ? local.charAt(0).toUpperCase() + local.slice(1) : "the team");
  const { draft, meta } = await draftOutreachEmail(p, camp, signer);
  const workflowId = await ensureWorkflow(camp);
  if (demo) await assignDemoPersona(prospectId);

  const { data: inserted, error } = await supabaseAdmin.from("outreach_emails").insert({
    workflow_id: workflowId, campaign_id: camp.id, author_id: p.author_id, prospect_id: p.id, kind: "initial",
    subject: draft.subject, body: draft.body, to_email: p.contact_email,
    sender_email: demo ? null : camp.owner_email, sent_by_email: demo ? null : camp.owner_email,
    ai_managed: true, max_offer: p.ceiling ?? null, simulated: demo,
    ...(demo ? { status: "sent", sent_at: new Date().toISOString(), message_id: `<demo-${crypto.randomUUID()}@simulated.local>` } : { status: "scheduled", scheduled_at: new Date().toISOString() }),
  }).select("id").single();
  if (error) return { ok: false, reason: error.message };

  await updateProspect(prospectId, { status: "outreached" });
  await recordEvent({
    campaign_id: camp.id, agent: "outreach", action: demo ? "outreach_sent_simulated" : "outreach_queued", engine: "model", llm: meta, prospect_id: prospectId, thread_id: (inserted as any).id,
    human: `${demo ? "Emailed (simulated)" : "Queued email to"} ${p.contact_name ?? "the editor"} at ${p.domain_host} — “${draft.subject}”`,
    detail: { subject: draft.subject, body: draft.body, to_domain: p.contact_email.split("@")[1], ceiling: p.ceiling, simulated: demo },
  });
  return { ok: true, email_id: (inserted as any).id, simulated: demo };
}

export async function outreachBatch(camp: Campaign, limit: number): Promise<{ sent: number; refused: Array<{ host: string; reason: string }> }> {
  const ready = (await listProspects(camp.id, "ready", 50)).filter((x) => x.contact_email).slice(0, limit);
  const out = { sent: 0, refused: [] as Array<{ host: string; reason: string }> };
  for (const p of ready) {
    try {
      const r = await sendOutreachToProspect(p.id);
      if (r.ok) out.sent++;
      else { out.refused.push({ host: p.domain_host, reason: r.reason ?? "refused" }); await recordEvent({ campaign_id: camp.id, agent: "outreach", action: "outreach_refused", engine: "policy", level: "warn", prospect_id: p.id, human: `Did not email ${p.domain_host} — ${r.reason}` }); }
    } catch (e: any) {
      out.refused.push({ host: p.domain_host, reason: e?.message ?? String(e) });
      await recordEvent({ campaign_id: camp.id, agent: "outreach", action: "outreach_error", engine: "system", level: "error", prospect_id: p.id, human: `Could not draft email to ${p.domain_host}: ${e?.message ?? e}` });
      if (e instanceof NebiusError && (e.kind === "auth" || e.kind === "not_configured" || e.kind === "budget")) throw e;
    }
  }
  return out;
}

// ─── Follow-ups (real mode only; demo replies arrive on the next tick) ───────

export const FOLLOWUP_AFTER_MS = Number(process.env.FOLLOWUP_AFTER_DAYS ?? 3) * 86400_000;

/** Initials sent long enough ago, unanswered, with no follow-up yet. Zero ⇒ the policy offers nothing, so an idle real campaign costs no model call. */
export async function listDueFollowups(camp: Campaign, limit = 10): Promise<any[]> {
  if (camp.demo_mode) return [];
  const since = new Date(Date.now() - FOLLOWUP_AFTER_MS).toISOString();
  const { data } = await supabaseAdmin.from("outreach_emails").select("id, workflow_id, author_id, prospect_id, subject, to_email, sender_email, sent_by_email").eq("campaign_id", camp.id).eq("kind", "initial").eq("status", "sent").is("replied_at", null).eq("followup_skipped", false).lte("sent_at", since).limit(limit);
  const due: any[] = [];
  for (const a of (data ?? []) as any[]) {
    const { data: kid } = await supabaseAdmin.from("outreach_emails").select("id").eq("parent_id", a.id).eq("kind", "followup").limit(1).maybeSingle();
    if (!kid) due.push(a);
  }
  return due;
}

export async function scheduleFollowups(camp: Campaign, limit = 10): Promise<{ scheduled: number }> {
  if (camp.demo_mode) return { scheduled: 0 };
  const data = await listDueFollowups(camp, limit);
  let scheduled = 0;
  for (const a of data) {
    await createFollowupRow({ workflow_id: a.workflow_id, author_id: a.author_id, parent_id: a.id, campaign_id: camp.id, to_email: a.to_email, subject: /^re:/i.test(a.subject ?? "") ? a.subject : `Re: ${a.subject}`, body: sanitizeBody(`Hi,\n\nJust circling back on my note below in case it got buried. Happy to answer any questions, and if it's not a fit, no worries at all.\n\nBest`), sender_email: a.sender_email, sent_by_email: a.sent_by_email, status: "scheduled", scheduled_at: new Date().toISOString() });
    scheduled++;
    await recordEvent({ campaign_id: camp.id, agent: "outreach", action: "followup_scheduled", engine: "policy", thread_id: a.id, prospect_id: a.prospect_id, human: `Scheduled a follow-up to ${a.to_email?.split("@")[1] ?? "the editor"} (no reply after ${Math.round(FOLLOWUP_AFTER_MS / 86400_000)} days)` });
  }
  return { scheduled };
}

// ─── Replies → negotiation → deals / interventions ───────────────────────────

export async function handleThread(camp: Campaign, anchorId: string, opts: { assistInput?: string | null } = {}): Promise<NegotiationResult> {
  const { data: anchor } = await supabaseAdmin.from("outreach_emails").select("id, prospect_id, author_id, negotiation_status, original_ask, to_email").eq("id", anchorId).maybeSingle();
  const a = anchor as any;
  const prospect = a?.prospect_id ? await getProspect(a.prospect_id) : null;
  const host = prospect?.domain_host ?? a?.to_email?.split("@")[1] ?? "the publication";
  const who = prospect?.contact_name ?? "the editor";

  const r = await negotiateThread(anchorId, { assistInput: opts.assistInput ?? null, demo: !!camp.demo_mode, ultraCallsUsed: camp.ultra_calls ?? 0 });
  if (r.llm.some((m) => /ultra/i.test(m.model))) await updateCampaign(camp.id, { ultra_calls: (camp.ultra_calls ?? 0) + 1 });
  if (!r.ok) {
    await recordEvent({ campaign_id: camp.id, agent: "negotiation", action: "negotiation_error", engine: "system", level: "error", thread_id: anchorId, prospect_id: prospect?.id, human: `Could not handle ${who}'s reply from ${host}: ${r.error}`, llm: r.llm });
    return r;
  }
  const price = r.theirPrice != null ? `$${r.theirPrice}` : null;
  const quote = r.editorQuote ? `“${r.editorQuote.slice(0, 90)}${r.editorQuote.length > 90 ? "…" : ""}”` : "";

  if (r.persistedAs === "needs_human") {
    const t = r.interventionType ?? "other";
    const PLAN: Record<string, [string, string]> = {
      sync_contact: [`${who} wants a call. The agent can't take one; it can tell them email works or pass on your availability.`, "Your availability, or a line to send instead (e.g. \"email is easier for us\")."],
      scheduling: [`${who} wants to schedule something. The agent has no calendar.`, "Your availability, or a line to send instead."],
      factual_question: [`${who} asked something only you know. The agent won't invent an answer.`, "The true answer, in a line."],
      budget_exception: [`The agent wants to accept ${price ?? "their price"}, but that is above what it may approve alone.`, `Approve ${price ?? "it"}, or give a counter figure.`],
      asset_request: [`${who} wants a file the agent cannot attach.`, "A link to it, or what to say instead."],
      identity_verification: [`${who} wants proof of who you are.`, "A link (site, LinkedIn) the agent may share."],
      redirect: [`${who} pointed to a different contact.`, "Confirm the new contact, or let it go."],
      process_portal: [`${who} wants a submission via a form or portal — outside email.`, "Do it yourself, or tell the agent to pass."],
      legal_contract: [`${who} wants a contract or NDA handled.`, "How to proceed."],
      payment_details: [`${who} wants invoice / PO / bank details.`, "The details to send, or how to proceed."],
      over_policy: [`${who} wants terms beyond a one-off placement (retainer, exclusivity).`, "Yes with limits, or no."],
      other_channel: [`${who} wants to move to WhatsApp / phone.`, "A line to send, or take over."],
      inbound_attachment: [`${who} sent a file the agent cannot read.`, "What it says, in a line."],
      thread_limit: ["The thread has gone several rounds without closing; the agent stopped rather than nag.", "A final line to send, or take over."],
      other: ["The agent hit something it should not decide alone.", "What should it say?"],
    };
    const [plan, needs] = PLAN[t] ?? PLAN.other;
    await createIntervention({ campaign_id: camp.id, anchor_email_id: anchorId, prospect_id: prospect?.id ?? null, type: r.interventionType ?? "other", editor_quote: r.editorQuote ?? null, agent_plan: plan, agent_needs: needs, assistable: r.classification?.assistable !== false });
    if (prospect) await updateProspect(prospect.id, { status: "escalated" });
    await recordEvent({ campaign_id: camp.id, agent: "negotiation", action: "intervention_created", engine: r.classification?.decided_by === "model" ? "model" : "policy", level: "warn", thread_id: anchorId, prospect_id: prospect?.id, llm: r.llm, human: `Needs you: ${who} at ${host} ${quote} — ${r.interventionReason ?? "a person is needed"}`, detail: { type: r.interventionType, ask: r.interventionAsk, intent: r.intent, decided_by: r.classification?.decided_by } });
    return r;
  }
  if (r.persistedAs === "skipped") {
    await recordEvent({ campaign_id: camp.id, agent: "negotiation", action: "reply_skipped", engine: "model", thread_id: anchorId, prospect_id: prospect?.id, llm: r.llm, human: `${host} sent an ${r.intent === "auto" ? "auto-reply" : "unrelated message"} — ignored`, detail: { intent: r.intent } });
    return r;
  }
  if (r.statusHint === "agreed") {
    const agreed = r.agreedPrice ?? 0;
    const existing = await getDealByAnchor(anchorId);
    if (!existing) {
      let ok = true, remaining = 0;
      if (agreed > 0) { const b = await reserveBudget(camp.id, agreed, null, `deal with ${host}`); ok = b.ok; remaining = b.remaining; }
      if (!ok) {
        await createIntervention({ campaign_id: camp.id, anchor_email_id: anchorId, prospect_id: prospect?.id ?? null, type: "budget_exception", editor_quote: r.editorQuote ?? null, agent_plan: `The agent agreed ${price} with ${who} but only $${remaining} of budget is left.`, agent_needs: "Raise the budget, or tell the agent to withdraw.", assistable: true });
        await recordEvent({ campaign_id: camp.id, agent: "negotiation", action: "budget_exhausted", engine: "policy", level: "warn", thread_id: anchorId, prospect_id: prospect?.id, llm: r.llm, human: `Agreed ${price} with ${host} but the budget cannot cover it ($${remaining} left) — needs you` });
        return r;
      }
      const deal = await createDeal({ campaign_id: camp.id, anchor_email_id: anchorId, author_id: a?.author_id ?? null, domain_host: host, publication: host, terms: { placement_type: "inclusion" }, original_ask: a?.original_ask ?? r.theirPrice ?? null, agreed_price: agreed, currency: camp.currency });
      if (prospect) await updateProspect(prospect.id, { status: "deal" });
      const ask = a?.original_ask ?? r.theirPrice;
      await recordEvent({ campaign_id: camp.id, agent: "negotiation", action: "deal_agreed", engine: r.draft?.engine === "model" ? "model" : "policy", thread_id: anchorId, prospect_id: prospect?.id, llm: r.llm, human: agreed > 0 ? `Deal with ${host} at $${agreed}${ask && ask > agreed ? ` (they asked $${ask} — saved $${ask - agreed})` : ""}` : `Deal with ${host} — free editorial inclusion`, detail: { deal_id: deal.id, agreed, original_ask: ask } });
    }
    return r;
  }
  if (r.statusHint === "declined") {
    if (prospect) await updateProspect(prospect.id, { status: "lost" });
    await recordEvent({ campaign_id: camp.id, agent: "negotiation", action: "declined", engine: "model", thread_id: anchorId, prospect_id: prospect?.id, llm: r.llm, human: `${host} declined ${quote} — closed politely, won't contact again`, detail: { intent: r.intent } });
    return r;
  }
  if (r.statusHint === "stalled") {
    await recordEvent({ campaign_id: camp.id, agent: "negotiation", action: "stalled", engine: "policy", thread_id: anchorId, prospect_id: prospect?.id, llm: r.llm, human: `Wound down the thread with ${host} — no progress after ${camp.demo_mode ? "several" : "several"} rounds` });
    return r;
  }
  // negotiating
  if (prospect) await updateProspect(prospect.id, { status: "negotiating" });
  const offer = r.draft?.suggestedOffer;
  const line = r.theirPrice != null && offer != null && offer < r.theirPrice ? `Countered $${offer} against ${who}'s $${r.theirPrice} ask at ${host}` : r.theirPrice == null ? `Replied to ${who} at ${host} — asked what they charge` : `Replied to ${who} at ${host} (they mentioned $${r.theirPrice})`;
  await recordEvent({ campaign_id: camp.id, agent: "negotiation", action: "counter_sent", engine: r.draft?.engine === "model" ? "model" : "policy", thread_id: anchorId, prospect_id: prospect?.id, llm: r.llm, human: line, detail: { intent: r.intent, their_price: r.theirPrice, our_offer: offer, ceiling: r.ceiling, body: r.draft?.body } });
  return r;
}

export interface RepliesTick { detected: number; handled: number; needs_human: number; deals: number; errors: string[] }

/** One bounded monitoring unit: sweep inbound (demo injects, real IMAP), then answer up to `limit` threads. */
export async function processReplies(camp: Campaign, limit: number): Promise<RepliesTick> {
  const out: RepliesTick = { detected: 0, handled: 0, needs_human: 0, deals: 0, errors: [] };
  if (camp.demo_mode) {
    out.detected = await injectDemoReplies(camp.id, camp.what_you_sell ?? camp.name);
    if (out.detected) await recordEvent({ campaign_id: camp.id, agent: "inbox", action: "replies_received", engine: "fixture", human: `${out.detected} editor ${out.detected === 1 ? "reply" : "replies"} arrived (simulated)`, detail: { simulated: true } });
  } else {
    try {
      const { runReplyDetection } = await import("@/lib/email/imap");
      const r = await runReplyDetection();
      out.detected = r.repliesFound ?? 0;
      if (out.detected) await recordEvent({ campaign_id: camp.id, agent: "inbox", action: "replies_received", engine: "system", human: `${out.detected} new ${out.detected === 1 ? "reply" : "replies"} found in the inbox`, detail: { accounts: r.accountsChecked } });
    } catch (e: any) { out.errors.push(`reply detection: ${e?.message}`); }
  }
  const threads = await listCampaignThreads(camp.id);
  let n = 0;
  for (const th of threads) {
    if (n >= limit) break;
    if (!th.replied_at || th.reply_kind === "auto") continue;
    if (["agreed", "declined", "needs_human", "stalled"].includes(th.negotiation_status ?? "")) continue;
    const { data: last } = await supabaseAdmin.from("outreach_emails").select("sent_at").eq("parent_id", th.id).eq("kind", "negotiation").eq("status", "sent").order("sent_at", { ascending: false }).limit(1);
    const lastAnswer = (last as any[])?.[0]?.sent_at as string | undefined;
    if (lastAnswer && lastAnswer >= th.replied_at) continue; // already answered — never answer twice
    n++;
    try {
      const r = await handleThread(camp, th.id);
      out.handled++;
      if (r.persistedAs === "needs_human") out.needs_human++;
      if (r.statusHint === "agreed") out.deals++;
    } catch (e: any) {
      out.errors.push(e?.message ?? String(e));
      await recordEvent({ campaign_id: camp.id, agent: "negotiation", action: "negotiation_error", engine: "system", level: "error", thread_id: th.id, human: `Could not handle a reply from ${th.to_email?.split("@")[1] ?? "an editor"}: ${e?.message ?? e}`, detail: { kind: e instanceof NebiusError ? e.kind : "unknown" } });
      if (e instanceof NebiusError && (e.kind === "auth" || e.kind === "not_configured" || e.kind === "budget")) throw e;
    }
  }
  return out;
}

/** A human answered a card: record it, resume the same thread with their words as context. */
export async function answerIntervention(id: string, answer: string, by: string): Promise<{ ok: boolean; result?: NegotiationResult; error?: string }> {
  const iv = await resolveIntervention(id, answer, by, "answered");
  if (!iv) return { ok: false, error: "intervention not open" };
  const camp = await getCampaign(iv.campaign_id);
  if (!camp) return { ok: false, error: "campaign not found" };
  await recordEvent({ campaign_id: camp.id, agent: "you", action: "intervention_answered", engine: "system", thread_id: iv.anchor_email_id, prospect_id: iv.prospect_id, human: `You answered: “${answer.slice(0, 100)}${answer.length > 100 ? "…" : ""}” — resuming the thread` });
  if (!iv.anchor_email_id) return { ok: true };
  if (iv.prospect_id) await updateProspect(iv.prospect_id, { status: "negotiating" });
  if (iv.type === "budget_exception") {
    // The answer may raise the ceiling for this thread ("approve 280" / a number).
    const n = Number((answer.match(/\d[\d,]*/)?.[0] ?? "").replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) await supabaseAdmin.from("outreach_emails").update({ max_offer: n }).eq("id", iv.anchor_email_id);
  }
  const result = await handleThread(camp, iv.anchor_email_id, { assistInput: answer });
  return { ok: true, result };
}

export async function dismissIntervention(id: string, by: string, takeOver = false): Promise<boolean> {
  const iv = await resolveIntervention(id, "", by, takeOver ? "taken_over" : "dismissed");
  if (!iv) return false;
  if (iv.anchor_email_id) await supabaseAdmin.from("outreach_emails").update({ negotiation_status: takeOver ? "handoff" : "stalled", ai_managed: !takeOver }).eq("id", iv.anchor_email_id);
  await recordEvent({ campaign_id: iv.campaign_id, agent: "you", action: takeOver ? "thread_taken_over" : "intervention_dismissed", engine: "system", thread_id: iv.anchor_email_id, prospect_id: iv.prospect_id, human: takeOver ? "You took over this thread — the agent will leave it alone" : "You dismissed this request — the thread is closed" });
  return true;
}

// ─── Completion (deterministic) ──────────────────────────────────────────────

export async function checkCompletion(camp: Campaign): Promise<{ completed: boolean; reason?: string }> {
  if (!["monitoring", "outreaching", "resolving_contacts"].includes(camp.phase)) return { completed: false };
  const deals = (await getDeals(camp.id)).filter((d) => d.status !== "cancelled").length;
  if (deals >= camp.desired_deals) {
    await setPhase(camp.id, "completed", "goal_reached");
    await recordEvent({ campaign_id: camp.id, agent: "manager", action: "campaign_completed", engine: "policy", human: `Done — ${deals} of ${camp.desired_deals} placements agreed. $${camp.budget_used} of $${camp.budget_total} committed.`, detail: { reason: "goal_reached", deals } });
    return { completed: true, reason: "goal_reached" };
  }
  if (camp.budget_total > 0 && camp.budget_total - camp.budget_used < 5) {
    await setPhase(camp.id, "completed", "budget_exhausted");
    await recordEvent({ campaign_id: camp.id, agent: "manager", action: "campaign_completed", engine: "policy", human: `Stopped — the budget is spent ($${camp.budget_used} of $${camp.budget_total}) with ${deals} deals.`, detail: { reason: "budget_exhausted", deals } });
    return { completed: true, reason: "budget_exhausted" };
  }
  return { completed: false };
}
