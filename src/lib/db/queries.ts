// Shared identity-graph + email-engine queries used by the campaign flow. Everything campaign-
// specific lives in src/lib/campaign/queries.ts. Only functions with a live caller are here.
import { supabaseAdmin } from "./supabase";
import type { Author, Article, Contact, Domain, OutreachEmail, UserEmailConfig } from "@/lib/types";
import { decryptSecret } from "@/lib/crypto";
import { registrableDomain } from "@/lib/util/domain";
import { isRoleEmail } from "@/lib/email/roleEmail";
import { isPlaceholderEmail } from "@/lib/enrich/personFilter";

// Supabase REST caps at 1000 rows per request; paginate any simple select.
export async function fetchAllRows<T>(table: string, select: string, apply?: (q: any) => any): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];
  let from = 0;
  while (true) {
    let q = supabaseAdmin.from(table).select(select).range(from, from + PAGE - 1);
    if (apply) q = apply(q);
    const { data, error } = await (q as any);
    if (error || !data?.length) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// ─── Identity graph ──────────────────────────────────────────────────────────

export async function upsertDomain(host: string, data: Partial<Domain> = {}): Promise<Domain> {
  const { data: domain, error } = await supabaseAdmin
    .from("domains").upsert({ host, last_seen: new Date().toISOString(), ...data }, { onConflict: "host" }).select().single();
  if (error) throw error;
  return domain;
}

export async function upsertAuthor(data: Partial<Author> & { full_name: string; primary_domain_id?: string }): Promise<Author> {
  const { data: author, error } = await supabaseAdmin
    .from("authors").upsert({ ...data, updated_at: new Date().toISOString() }, { onConflict: "full_name,primary_domain_id", ignoreDuplicates: false }).select().single();
  if (error) throw error;
  return author;
}

export async function upsertArticle(data: Partial<Article> & { url_canonical: string }): Promise<Article> {
  const { data: article, error } = await supabaseAdmin
    .from("articles").upsert({ ...data, updated_at: new Date().toISOString() }, { onConflict: "url_canonical" }).select().single();
  if (error) throw error;
  return article;
}

export async function linkArticleAuthor(articleId: string, authorId: string) {
  await supabaseAdmin.from("article_authors").upsert({ article_id: articleId, author_id: authorId }, { onConflict: "article_id,author_id", ignoreDuplicates: true });
}

/** Single choke point for contact writes: role and placeholder mailboxes never reach the DB. */
export async function upsertContact(data: Partial<Contact> & { type: string; value: string }): Promise<Contact> {
  if (data.type === "mailto" && isRoleEmail(data.value)) return { ...(data as any), id: "", skipped_role_email: true } as unknown as Contact;
  if (data.type === "mailto" && isPlaceholderEmail(data.value)) return { ...(data as any), id: "", skipped_placeholder_email: true } as unknown as Contact;
  const { data: contact, error } = await supabaseAdmin
    .from("contacts").upsert(data, { onConflict: "author_id,type,value", ignoreDuplicates: true }).select().single();
  if (error) throw error;
  return contact;
}

export async function isSuppressed(host: string, authorName?: string): Promise<boolean> {
  const checks = [host];
  if (authorName) checks.push(authorName);
  const { data } = await supabaseAdmin.from("suppression").select("id").in("value", checks).limit(1);
  return (data?.length ?? 0) > 0;
}

// Known (name, email) pairs on a registrable domain — free email-pattern inference.
export async function getKnownEmailsByDomain(host: string): Promise<Array<{ name: string; email: string }>> {
  const reg = registrableDomain(host);
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("value, author:authors!inner(full_name, domain:domains!primary_domain_id!inner(host))")
    .eq("type", "mailto").ilike("author.domain.host", `%${reg}`).limit(500);
  return (data ?? [])
    .map((r: any) => ({ name: r.author?.full_name as string, email: (r.value as string).replace(/^mailto:/, "").toLowerCase(), host: (r.author?.domain?.host ?? "") as string }))
    .filter((r: any) => r.name && r.email)
    .filter((r: any) => registrableDomain(r.host) === reg && registrableDomain(r.email.split("@")[1] ?? "") === reg)
    .map((r: any) => ({ name: r.name, email: r.email }));
}

export async function getStoredLinkedin(authorId: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("contacts").select("value").eq("author_id", authorId).eq("type", "linkedin").limit(1).maybeSingle();
  const v = (data as any)?.value as string | undefined;
  if (!v) return null;
  return v.startsWith("http") ? v : `https://${v}`;
}

export async function getAuthorArticleUrls(authorId: string, limit = 50): Promise<string[]> {
  const aa = await fetchAllRows<{ article_id: string }>("article_authors", "article_id", (q) => q.eq("author_id", authorId));
  if (!aa.length) return [];
  const ids = aa.map((r) => r.article_id).slice(0, 500);
  const urls: string[] = [];
  for (let i = 0; i < ids.length && urls.length < limit; i += 200) {
    const { data } = await supabaseAdmin.from("articles").select("url_canonical, published_at").in("id", ids.slice(i, i + 200)).order("published_at", { ascending: false });
    urls.push(...(data ?? []).map((r: any) => r.url_canonical).filter(Boolean));
  }
  return urls.slice(0, limit);
}

// ─── Outreach emails ─────────────────────────────────────────────────────────

export async function updateOutreachEmail(id: string, data: Partial<Record<string, unknown>>): Promise<void> {
  const { error } = await supabaseAdmin.from("outreach_emails").update(data).eq("id", id);
  if (error) throw error;
}

/**
 * Send-time guard: has this inbox ALREADY received an initial from another thread? Only sent
 * initials count; follow-ups and negotiation replies legitimately reuse the inbox.
 */
export async function addressHasOtherSentInitial(recipientEmail: string, excludeId: string): Promise<boolean> {
  const clean = recipientEmail.replace(/^mailto:/i, "").trim().toLowerCase();
  if (!clean) return false;
  const { data } = await supabaseAdmin
    .from("outreach_emails").select("id").eq("status", "sent").eq("kind", "initial").ilike("to_email", clean).neq("id", excludeId).limit(1);
  return (data ?? []).length > 0;
}

/**
 * Record an inbound reply on the thread anchor, idempotently and monotonically: the same or an
 * older reply never re-stamps replied_at (the legacy auto-reply runaway). Returns true only for a
 * genuinely new reply.
 */
export async function recordReplyOnAnchor(
  anchorId: string,
  meta: { reply_kind?: string | null; reply_from?: string | null; reply_subject?: string | null; reply_excerpt?: string | null; reply_sentiment?: string | null; reply_intent?: string | null },
  replyAtIso: string,
): Promise<boolean> {
  const { data } = await supabaseAdmin.from("outreach_emails").select("replied_at, reply_excerpt").eq("id", anchorId).maybeSingle();
  const existingAt = (data as any)?.replied_at as string | null;
  const prev = ((data as any)?.reply_excerpt ?? "").trim();
  const next = (meta.reply_excerpt ?? "").trim();
  if (existingAt && prev && prev === next) return false;
  if (existingAt && replyAtIso && new Date(replyAtIso).getTime() <= new Date(existingAt).getTime()) return false;
  await supabaseAdmin.from("outreach_emails").update({ ...meta, replied_at: replyAtIso, bounced_at: null }).eq("id", anchorId);
  return true;
}

export async function logNegotiationActivity(anchorId: string, actor: string, action: string, detail?: string, authorId?: string | null): Promise<void> {
  try {
    await supabaseAdmin.from("negotiation_activity").insert({ anchor_id: anchorId, actor: actor || "unknown", action, detail: detail ?? null, author_id: authorId ?? null });
  } catch { /* best-effort audit */ }
}

export const FOLLOWUP_LEAD_MS = 24 * 60 * 60 * 1000;

/** Initial sends older than `days` with no reply/success, not skipped, no follow-up child yet. */
export async function getEmailsNeedingFollowup(days = 2, limit = 25): Promise<Array<{
  id: string; workflow_id: string; author_id: string; template_id: string | null;
  subject: string; sender_email: string | null; sent_by_email: string | null; message_id: string | null;
  recipient: string; author_name: string; publication: string; guidance: string | null;
}>> {
  const before = new Date(Date.now() - days * 86400_000).toISOString();
  const { data } = await supabaseAdmin
    .from("outreach_emails")
    .select("id, workflow_id, author_id, subject, sender_email, sent_by_email, message_id, to_email, author:authors(full_name, domain:domains(name, host))")
    .eq("status", "sent").eq("kind", "initial").is("replied_at", null).is("success_at", null).eq("followup_skipped", false)
    .lte("sent_at", before).order("sent_at", { ascending: true }).limit(limit * 3);
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const { data: kids } = await supabaseAdmin.from("outreach_emails").select("parent_id").eq("kind", "followup").in("parent_id", ids);
  const hasChild = new Set((kids ?? []).map((k: any) => k.parent_id));
  const out: any[] = [];
  for (const r of rows) {
    if (hasChild.has(r.id)) continue;
    const a: any = (r as any).author ?? {};
    const recipient = ((r as any).to_email ?? "") as string;
    if (!recipient) continue;
    out.push({
      id: r.id, workflow_id: r.workflow_id, author_id: r.author_id, template_id: null,
      subject: r.subject ?? "", sender_email: (r as any).sender_email ?? null, sent_by_email: (r as any).sent_by_email ?? null,
      message_id: (r as any).message_id ?? null, recipient,
      author_name: a.full_name ?? "there", publication: a.domain?.name ?? a.domain?.host ?? "your work", guidance: null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function createFollowupRow(data: {
  workflow_id: string; author_id: string; parent_id: string; subject: string; body: string;
  sender_email: string | null; sent_by_email: string | null; status?: string; scheduled_at?: string | null; to_email?: string | null; campaign_id?: string | null;
}): Promise<{ id: string }> {
  const { data: row, error } = await supabaseAdmin
    .from("outreach_emails")
    .insert({
      workflow_id: data.workflow_id, author_id: data.author_id, parent_id: data.parent_id, campaign_id: data.campaign_id ?? null,
      kind: "followup", subject: data.subject, body: data.body, to_email: data.to_email ?? null,
      status: data.status ?? "ready", scheduled_at: data.scheduled_at ?? null,
      sender_email: data.sender_email, sent_by_email: data.sent_by_email,
    })
    .select("id").single();
  if (error) throw error;
  return row;
}

export async function getFollowupParent(parentId: string): Promise<{ message_id: string | null; replied_at: string | null; success_at: string | null } | null> {
  const { data } = await supabaseAdmin.from("outreach_emails").select("message_id, replied_at, success_at").eq("id", parentId).single();
  if (!data) return null;
  return { message_id: (data as any).message_id ?? null, replied_at: (data as any).replied_at ?? null, success_at: (data as any).success_at ?? null };
}

/** Emails due to send now — REAL campaigns only. Guest/demo campaigns are structurally excluded. */
export async function getDueEmails(limit = 25): Promise<Array<OutreachEmail & { recipient?: string; recipientSource?: string | null }>> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("outreach_emails")
    .select("*, campaign:campaigns!inner(id, demo_mode, guest_id), author:authors(id, full_name, contacts(type, value, source))")
    .or(`status.eq.scheduled,and(status.eq.sending,claimed_at.lt.${new Date(Date.now() - 10 * 60_000).toISOString()})`).lte("scheduled_at", nowIso)
    .eq("campaign.demo_mode", false).is("campaign.guest_id", null)
    .order("scheduled_at", { ascending: true }).limit(limit);
  if (error) throw error;
  return (data ?? []).map((e: any) => {
    const mailto = (e.author?.contacts ?? []).find((c: any) => c.type === "mailto");
    const recipient = (e.to_email && String(e.to_email).trim()) || (mailto ? mailto.value.replace(/^mailto:/, "") : undefined);
    const recipientSource = mailto?.source ?? null;
    return { ...e, recipient, recipientSource };
  });
}

/** Pull any queued initials onto the sender's next send-window instant so they burst together. */
export async function reburstScheduledInitials(now = new Date()): Promise<number> {
  const { computeSmartSchedule } = await import("@/lib/email/schedule");
  const rows = await fetchAllRows<{ id: string; sender_email: string | null }>("outreach_emails", "id, sender_email", (q) => q.eq("status", "scheduled").eq("kind", "initial"));
  if (!rows.length) return 0;
  const bySender = new Map<string, string[]>();
  for (const r of rows) { const s = r.sender_email ?? ""; if (!bySender.has(s)) bySender.set(s, []); bySender.get(s)!.push(r.id); }
  let moved = 0;
  for (const [sender, ids] of bySender) {
    const cfg = sender ? await getUserEmailConfig(sender) : null;
    const config = { id: "", workflow_id: "", provider: "smtp" as const, created_at: "", timezone: cfg?.timezone ?? DEFAULT_USER_CONFIG.timezone, send_hour_start: cfg?.send_hour_start ?? DEFAULT_USER_CONFIG.send_hour_start, send_hour_end: cfg?.send_hour_end ?? DEFAULT_USER_CONFIG.send_hour_end, gap_minutes: 0, daily_cap: 0 };
    const at = computeSmartSchedule([{ id: "_", tz: config.timezone }], config, now)[0]?.at;
    if (!at) continue;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { error } = await supabaseAdmin.from("outreach_emails").update({ scheduled_at: at }).in("id", chunk).neq("scheduled_at", at);
      if (!error) moved += chunk.length;
    }
  }
  return moved;
}

// ─── Per-user email config (owner's Gmail app password, encrypted at rest) ───

const DEFAULT_USER_CONFIG = { timezone: "America/New_York", send_hour_start: 9, send_hour_end: 17, gap_minutes: 15, daily_cap: 50 };

export async function getUserEmailConfig(userEmail: string): Promise<UserEmailConfig> {
  const { data } = await supabaseAdmin.from("user_email_config").select("*").eq("user_email", userEmail).maybeSingle();
  return {
    user_email: userEmail,
    from_name: data?.from_name ?? undefined,
    timezone: data?.timezone ?? DEFAULT_USER_CONFIG.timezone,
    send_hour_start: data?.send_hour_start ?? DEFAULT_USER_CONFIG.send_hour_start,
    send_hour_end: data?.send_hour_end ?? DEFAULT_USER_CONFIG.send_hour_end,
    gap_minutes: data?.gap_minutes ?? DEFAULT_USER_CONFIG.gap_minutes,
    daily_cap: data?.daily_cap ?? DEFAULT_USER_CONFIG.daily_cap,
    hasPassword: !!data?.app_password_enc,
    hasNebiusKey: !!data?.nebius_api_key_enc,
    hasTavilyKey: !!data?.tavily_api_key_enc,
    nebiusKeyHint: keyHint(data?.nebius_api_key_enc),
    tavilyKeyHint: keyHint(data?.tavily_api_key_enc),
  };
}

function keyHint(enc: string | null | undefined): string | undefined {
  const k = decryptSecret(enc);
  return k ? `…${k.slice(-4)}` : undefined;
}

/** The owner's own API keys, decrypted, for one request (see src/lib/ai/context.ts). */
export async function getOwnerKeys(userEmail: string | null | undefined): Promise<{ nebius: string | null; tavily: string | null; owner: string | null }> {
  if (!userEmail) return { nebius: null, tavily: null, owner: null };
  const { data } = await supabaseAdmin.from("user_email_config").select("nebius_api_key_enc, tavily_api_key_enc").eq("user_email", userEmail).maybeSingle();
  return { nebius: decryptSecret(data?.nebius_api_key_enc), tavily: decryptSecret(data?.tavily_api_key_enc), owner: userEmail };
}

export async function upsertUserEmailConfig(userEmail: string, data: { app_password_enc?: string; nebius_api_key_enc?: string | null; tavily_api_key_enc?: string | null; from_name?: string; timezone?: string; send_hour_start?: number; send_hour_end?: number; gap_minutes?: number; daily_cap?: number }): Promise<void> {
  const { error } = await supabaseAdmin.from("user_email_config").upsert({ user_email: userEmail, ...data, updated_at: new Date().toISOString() }, { onConflict: "user_email" });
  if (error) throw error;
}

export async function getUserAppPasswordEnc(userEmail: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from("user_email_config").select("app_password_enc").eq("user_email", userEmail).maybeSingle();
  return (data?.app_password_enc as string | undefined) ?? null;
}

// ─── IMAP reply-detection support ────────────────────────────────────────────

export type OutstandingSentRow = { id: string; author_id: string; message_id: string | null; recipient: string; subject: string; sent_at: string; kind: string | null; parent_id: string | null };

/** Sent, un-replied, un-bounced emails from the last `days`, grouped by the mailbox that sent them. */
export async function getOutstandingSentForReplyCheck(days = 30, opts: { includeReplied?: boolean } = {}): Promise<Map<string, OutstandingSentRow[]>> {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  let q = supabaseAdmin
    .from("outreach_emails")
    .select("id, author_id, sender_email, message_id, subject, sent_at, kind, parent_id, to_email, campaign:campaigns!inner(demo_mode)")
    .eq("status", "sent").is("bounced_at", null).gte("sent_at", since).eq("campaign.demo_mode", false).limit(2000);
  if (!opts.includeReplied) q = q.is("replied_at", null);
  const { data } = await q;
  const out = new Map<string, OutstandingSentRow[]>();
  for (const e of (data ?? []) as any[]) {
    const recipient = (e.to_email ?? "") as string;
    if (!recipient) continue;
    const key = e.sender_email ?? "";
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push({ id: e.id, author_id: e.author_id, message_id: e.message_id ?? null, recipient, subject: e.subject ?? "", sent_at: e.sent_at, kind: e.kind ?? null, parent_id: e.parent_id ?? null });
  }
  return out;
}

export async function markRepliesChecked(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await supabaseAdmin.from("outreach_emails").update({ reply_checked_at: new Date().toISOString() }).in("id", ids);
}

export async function setAuthorDiscarded(authorId: string, discarded: boolean): Promise<void> {
  await supabaseAdmin.from("authors").update({ discarded }).eq("id", authorId);
}

export async function stopPendingFollowupsForAuthor(authorId: string, reason: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("outreach_emails").update({ status: "draft", scheduled_at: null, followup_skipped: true, error: reason })
    .eq("author_id", authorId).eq("kind", "followup").in("status", ["scheduled", "ready"]).select("id");
  return (data ?? []).length;
}

export async function addSuppression(type: string, value: string, reason?: string) {
  await supabaseAdmin.from("suppression").upsert({ type, value, reason }, { onConflict: "value", ignoreDuplicates: true });
}
