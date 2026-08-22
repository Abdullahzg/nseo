import { NextRequest, NextResponse } from "next/server";
import { identifyCaller, actorFor } from "@/lib/auth/service";
import {
  getUserEmailConfig, getUserAppPasswordEnc, resolveInboxAccount,
  updateOutreachEmail, isSuppressed,
  createCampaign, createWorkflow, linkAuthorsToCampaign, addWorkflowProspects,
} from "@/lib/db/queries";
import { supabaseAdmin } from "@/lib/db/supabase";
import { decryptSecret } from "@/lib/crypto";
import { sendEmailAs } from "@/lib/email/smtp";
import { isRoleEmail } from "@/lib/enrich/personFilter";
import { emailTrust } from "@/lib/backlinks/pipeline";

export const maxDuration = 30;

/**
 * Start a brand-new thread with someone who has been discovered but never contacted.
 *
 * The Inbox could only ever continue conversations that already existed — every outbound thread had to
 * originate from a workflow send or a backlink campaign. So the obvious thing (you find a good writer,
 * you want to email them now) was the one thing it couldn't do, and people went around the tool.
 *
 * This is a genuine send, so it gets the same guards the batch path has rather than a shortcut around
 * them: suppression list, role-address rejection, the guessed-address gate, and a duplicate check. It
 * also writes a real `outreach_emails` row with `kind: "initial"`, which is what makes the thread appear
 * in the Inbox, count toward the Status page's reply/win rates, and be adoptable by the AI negotiator
 * later. A raw SMTP send with no row would be invisible to every one of those.
 */
/**
 * The workflow every one-off send belongs to.
 *
 * `outreach_emails.workflow_id` is NOT NULL and every list, stat and filter in the app joins through
 * it — the Status page's reply/win rates, the Negotiation thread list, the send queue. Making the
 * column nullable to support one-off sends would mean auditing all of them, and a thread with no
 * workflow would silently disappear from most views.
 *
 * So a one-off gets a real, shared workflow instead: "Direct outreach". It is honest (these ARE a
 * hand-curated campaign), it keeps every existing query working unchanged, and it means direct sends
 * are visible and measurable alongside everything else rather than being a separate invisible class.
 */
async function ensureDirectWorkflow(): Promise<{ workflowId: string; campaignId: string }> {
  const NAME = "Direct outreach";
  const { data: existing } = await supabaseAdmin
    .from("workflows").select("id, campaign_id").eq("name", NAME).limit(1).maybeSingle();
  if (existing) return { workflowId: (existing as any).id, campaignId: (existing as any).campaign_id };

  const campaign = await createCampaign({ name: NAME, keywords: [] });
  const workflow = await createWorkflow({ campaign_id: campaign.id, name: NAME });
  return { workflowId: workflow.id, campaignId: campaign.id };
}

export async function POST(req: NextRequest) {
  const caller = await identifyCaller(req);
  const me = actorFor(caller);
  if (!me) return NextResponse.json({ ok: false, error: "not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const authorId = typeof body.author_id === "string" ? body.author_id : null;
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const toOverride = typeof body.to === "string" ? body.to.trim() : "";

  if (!authorId) return NextResponse.json({ ok: false, error: "Pick a person to email." }, { status: 400 });
  if (!subject) return NextResponse.json({ ok: false, error: "A subject is required." }, { status: 400 });
  if (!text) return NextResponse.json({ ok: false, error: "The message is empty." }, { status: 400 });

  const account = await resolveInboxAccount(me, req.nextUrl.searchParams.get("as"));

  // Resolve the recipient and, importantly, HOW we got the address.
  const { data: author } = await supabaseAdmin
    .from("authors").select("id, full_name, primary_domain_id").eq("id", authorId).maybeSingle();
  if (!author) return NextResponse.json({ ok: false, error: "That person is not in the database." }, { status: 404 });

  const { data: contact } = await supabaseAdmin
    .from("contacts").select("value, source").eq("author_id", authorId).eq("type", "mailto").limit(1).maybeSingle();

  const recipient = toOverride || (contact?.value ? String(contact.value).replace(/^mailto:/, "") : "");
  if (!recipient) {
    return NextResponse.json({ ok: false, error: "No email address on file for this person. Run “Re-find email” first." }, { status: 400 });
  }

  // ---- The same guards the batch send path applies. A one-off must not be a way around them. ----
  if (isRoleEmail(recipient)) {
    return NextResponse.json({ ok: false, error: `${recipient} is a generic/role mailbox, not a person.` }, { status: 400 });
  }
  // Only gate on trust when we are using the address we found; an explicitly typed override is the
  // sender taking responsibility for it.
  if (!toOverride && emailTrust(contact?.source ?? null) === "guess" && process.env.ALLOW_GUESSED_EMAILS !== "1") {
    return NextResponse.json({
      ok: false,
      error: "That address was constructed from a domain pattern and never verified — sending to it risks a bounce. Type it explicitly to override.",
    }, { status: 400 });
  }
  const domainHost = recipient.split("@")[1] ?? "";
  if (domainHost && await isSuppressed(domainHost).catch(() => false)) {
    return NextResponse.json({ ok: false, error: `${domainHost} is on the suppression list.` }, { status: 400 });
  }

  // Don't quietly start a second conversation with someone already in one.
  const { data: existing } = await supabaseAdmin
    .from("outreach_emails").select("id, status, sent_at")
    .eq("author_id", authorId).eq("kind", "initial")
    .not("sent_at", "is", null).limit(1).maybeSingle();
  if (existing && !body.force) {
    return NextResponse.json({
      ok: false, alreadyContacted: true,
      error: "This person has already been emailed. Open the existing thread, or pass force to email again.",
    }, { status: 409 });
  }

  const pass = decryptSecret(await getUserAppPasswordEnc(account)) ?? null;
  if (!pass) {
    return NextResponse.json({ ok: false, error: `No Gmail app password on file for ${account}. Add it in Settings.` }, { status: 400 });
  }
  const cfg = await getUserEmailConfig(account);

  // The row is created BEFORE the send, so a send that fails still leaves a record of the attempt
  // rather than vanishing. Status is corrected either way once we know the outcome.
  const { workflowId, campaignId } = await ensureDirectWorkflow();
  // Attach the person to the campaign/workflow so the thread is reachable from the normal surfaces,
  // not just from the Inbox that created it.
  await linkAuthorsToCampaign(campaignId, [authorId]).catch(() => {});
  await addWorkflowProspects(workflowId, [authorId]).catch(() => {});

  // Inserted directly rather than through upsertOutreachEmail / updateOutreachEmail. Both are
  // deliberately narrow allow-lists — neither models `kind`, `sender_email`, `sent_by_email`,
  // `ai_managed` or `recipient_override` — and widening a validated allow-list so one caller can pass
  // more fields weakens the guard for the four call sites that depend on it. A compose row genuinely
  // has a shape those helpers do not describe.
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("outreach_emails")
    .insert({
      workflow_id: workflowId,
      author_id: authorId,
      subject, body: text,
      status: "ready",
      kind: "initial",
      sender_email: account,
      sent_by_email: me,
      ai_managed: false,
      recipient_override: toOverride || null,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return NextResponse.json({ ok: false, error: insErr?.message ?? "Couldn't record the send." }, { status: 500 });
  }
  const row = inserted as { id: string };

  const res = await sendEmailAs({ user: account, pass, fromName: cfg.from_name, to: recipient, subject, body: text });

  if (!res.ok) {
    await updateOutreachEmail(row.id, { status: "failed", error: res.error ?? "send failed" }).catch(() => {});
    return NextResponse.json({ ok: false, error: res.error ?? "Send failed" }, { status: 500 });
  }

  await updateOutreachEmail(row.id, {
    status: "sent",
    sent_at: new Date().toISOString(),
    message_id: res.messageId ?? null,
  }).catch(() => {});

  return NextResponse.json({ ok: true, id: row.id, to: recipient, from: account, subject });
}
