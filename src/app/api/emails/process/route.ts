import { NextRequest, NextResponse } from "next/server";
import PQueue from "p-queue";
import type { Transporter } from "nodemailer";
import { getDueEmails, updateOutreachEmail, getUserEmailConfig, getUserAppPasswordEnc, getFollowupParent, addressHasOtherSentInitial, reburstScheduledInitials } from "@/lib/db/queries";
import { isRoleEmail } from "@/lib/email/roleEmail";
import { supabaseAdmin } from "@/lib/db/supabase";
import { sendEmail, createPooledUserTransport, sendVia } from "@/lib/email/smtp";
import { decryptSecret } from "@/lib/crypto";
import { acquireLock, releaseLock, incrDailyCount } from "@/lib/redis";
import { auth } from "@auth";
import { isPlaceholderEmail } from "@/lib/enrich/personFilter";

export const maxDuration = 300;

// Burst-send tuning. No spacing, no daily-cap throttle (by design — one optimal time, send
// everything). Concurrency is high enough to clear ~1500 on one account inside a single run,
// while pooled transports (maxConnections 5/sender) keep Gmail logins sane.
const SEND_CONCURRENCY = 12;
const DRAIN_BATCH = 250;
const TIME_BUDGET_MS = 255_000; // stay under maxDuration (300s) and the 290s lock
const MAX_TOTAL = 8000;         // hard backstop against any pathological loop

const LOCK_KEY = "lock:emails:process";

// Authorized if: no CRON_SECRET configured (local dev), OR the trigger's Bearer token /
// ?key= matches (Vercel cron AND Upstash QStash both send this), OR a valid app session
// (the manual "process now" button).
async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  const session = await auth().catch(() => null);
  return !!session;
}

// Sends any scheduled emails whose time has arrived. Any trigger can call this (Vercel cron
// once/day on Hobby, or Upstash QStash every ~30 min for timezone-accurate delivery). A
// Redis lock ensures overlapping triggers never double-send, and a per-workflow daily
// counter enforces the daily cap durably across serverless instances.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const lockToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const got = await acquireLock(LOCK_KEY, 290, lockToken);
  if (!got) {
    return NextResponse.json({ skipped: "another send run is in progress" });
  }

  const day = new Date().toISOString().slice(0, 10); // UTC date bucket for the daily counter
  // Per-sender credential + config cache (each email sends from its own user's Gmail).
  const senderCache = new Map<string, { pass: string | null; fromName?: string }>();
  const senderInfo = async (email: string) => {
    if (!senderCache.has(email)) {
      const [enc, cfg] = await Promise.all([getUserAppPasswordEnc(email), getUserEmailConfig(email)]);
      senderCache.set(email, { pass: decryptSecret(enc), fromName: cfg.from_name });
    }
    return senderCache.get(email)!;
  };
  // One pooled SMTP transport per sender, reused across the whole burst (closed in finally).
  const txPool = new Map<string, Transporter>();

  let sent = 0, failed = 0, cappedSkipped = 0, dupSkipped = 0;
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  try {
    // Reply detection runs BEFORE the send loop — so a follow-up that's due right now sees the
    // freshest reply status and the send-time guard below can park it if the recipient replied
    // since it was scheduled. (Read-only; failures never block sending.)
    let replies = { accountsChecked: 0, repliesFound: 0, errors: [] as string[] };
    try {
      const { runReplyDetection } = await import("@/lib/email/imap");
      replies = await runReplyDetection();
    } catch (e: any) { replies.errors.push(e?.message ?? "reply detection error"); }

    // Pull any queued INITIALS (including a backlog scheduled under the old spaced model) onto
    // the single burst instant, so they come due and go out together instead of trickling.
    let rebursted = 0;
    try { rebursted = await reburstScheduledInitials(); } catch { /* best-effort — never blocks sending */ }

    // ── Burst drain ──────────────────────────────────────────────────────────
    // Send every due email in parallel (bounded concurrency, pooled transports), looping
    // until the queue is empty or we near the function time budget. NO spacing and NO
    // daily-cap throttle by design — a one-optimal-time batch (even ~1500 on one account)
    // clears within the hour. Every per-email guard is preserved.
    let drained = 0;

    // In-run duplicate-inbox guard: never send two INITIALS to the same address within this
    // run. The DB guard (addressHasOtherSentInitial) only catches ALREADY-SENT initials, and
    // parallel sends can race past it before either is marked sent, so we also claim here.
    const claimedInitialTo = new Set<string>();
    // Sources that mean "we built this address and never confirmed it". Kept in sync with
    // emailTrust() in src/lib/backlinks/pipeline.ts.
    const GUESS_SOURCES = new Set(["pattern", "pattern-catchall"]);
    let guessSkipped = 0;
    let placeholderSkipped = 0;

    const sendOne = async (email: any): Promise<void> => {
      if (!email.recipient) {
        await updateOutreachEmail(email.id, { status: "failed", error: "No recipient email address" });
        failed++; results.push({ id: email.id, ok: false, error: "no recipient" });
        return;
      }
      // Never send to a role/generic org mailbox (press@, info@, git@hf.co, …) — not a person,
      // and shared across many authors. Park it so it stops (and won't follow up).
      if (isRoleEmail(email.recipient)) {
        await updateOutreachEmail(email.id, { status: "failed", error: "Skipped: generic/role address (not a person)", followup_skipped: true });
        results.push({ id: email.id, ok: false, error: "role address" });
        return;
      }
      const isThreadReply = email.kind === "followup" || email.kind === "negotiation";

      // EMAIL-TRUST GATE. A "pattern"/"pattern-catchall" address was CONSTRUCTED from a domain
      // guess, never confirmed to accept mail — and `pattern-verified` has never once appeared in
      // this database, meaning Reoon has confirmed exactly zero of them. Measured before this gate:
      // 163 emails had already been sent to guessed addresses against an overall bounce rate of
      // ~24%, and bounces are what burn a sending domain.
      //
      // Parked rather than deleted, and follow-ups suppressed, so the prospect survives for a real
      // address to be found later. Set ALLOW_GUESSED_EMAILS=1 to deliberately send to guesses.
      if (!isThreadReply && GUESS_SOURCES.has(email.recipientSource ?? "") && process.env.ALLOW_GUESSED_EMAILS !== "1") {
        await updateOutreachEmail(email.id, {
          status: "failed",
          error: "Skipped: address was guessed from a domain pattern, never verified",
          followup_skipped: true,
        });
        guessSkipped++;
        results.push({ id: email.id, ok: false, error: "unverified guessed address" });
        return;
      }

      // A documentation placeholder scraped off a page — `user@domain.com`, `example@domain.com`.
      //
      // This has no ALLOW_ override, unlike the guess gate above, because there is no circumstance in
      // which sending to one is the right call: it is not a low-confidence address, it is not an address
      // at all. It also cannot be caught by the guess gate, which keys on source, because these arrive
      // tagged `page-scrape` — the HIGHEST trust rank in emailTrust(), above pattern-verified.
      //
      // Extraction is now guarded in three places, so nothing new should reach here. This stays as the
      // gate of last resort for the rows written before that fix, which are already in the database.
      if (!isThreadReply && isPlaceholderEmail(email.recipient)) {
        await updateOutreachEmail(email.id, {
          status: "failed",
          error: "Skipped: recipient is a documentation placeholder, not a real mailbox",
          followup_skipped: true,
        });
        placeholderSkipped++;
        results.push({ id: email.id, ok: false, error: "placeholder address" });
        return;
      }

      // Duplicate-inbox guard (INITIALS only): skip an initial whose recipient inbox already
      // got an initial (already sent, per the DB, OR claimed earlier in this same run). Follow-
      // ups / negotiation replies continue an existing thread, and admin test-sends
      // (recipient_override) always deliver to the test address, so both are exempt.
      if (!isThreadReply && !email.recipient_override) {
        const key = email.recipient.toLowerCase();
        if (claimedInitialTo.has(key) || await addressHasOtherSentInitial(email.recipient, email.id)) {
          await updateOutreachEmail(email.id, { status: "failed", error: "Skipped: recipient inbox already contacted in another campaign", followup_skipped: true });
          dupSkipped++; results.push({ id: email.id, ok: false, error: "duplicate inbox — contacted elsewhere" });
          return;
        }
        claimedInitialTo.add(key);
      }

      const sender = email.sender_email as string | undefined;
      const sentBy = email.sent_by_email as string | undefined;
      // CC whoever actually clicked Send when it went out through a shared inbox, so they
      // see replies and can reply themselves.
      const cc = sentBy && sentBy !== sender ? sentBy : undefined;

      // Follow-ups thread into the original: pull the parent's Message-ID for In-Reply-To.
      // Also a last-second guard — if the recipient replied or converted since this follow-up
      // was scheduled, park it instead of nagging someone who already engaged.
      let inReplyTo: string | undefined;
      if (isThreadReply && email.parent_id) {
        const parent = await getFollowupParent(email.parent_id).catch(() => null);
        // A NUDGE follow-up must not go out if they've since replied/converted. A NEGOTIATION
        // reply is the opposite — it's our answer TO their reply — so it always proceeds.
        if (email.kind === "followup" && (parent?.replied_at || parent?.success_at)) {
          await updateOutreachEmail(email.id, { status: "draft", scheduled_at: null });
          results.push({ id: email.id, ok: false, error: "parent replied — follow-up skipped" });
          return;
        }
        inReplyTo = parent?.message_id ?? undefined;
      }

      let res;
      if (sender) {
        const info = await senderInfo(sender);
        if (!info.pass) {
          await updateOutreachEmail(email.id, { status: "failed", error: `Sender ${sender} has no app password set` });
          failed++; results.push({ id: email.id, ok: false, error: "no app password" });
          return;
        }
        let tx = txPool.get(sender);
        if (!tx) { tx = createPooledUserTransport(sender, info.pass); txPool.set(sender, tx); }
        res = await sendVia(tx, { user: sender, fromName: info.fromName, to: email.recipient, subject: email.subject ?? "(no subject)", body: email.body ?? "", cc, inReplyTo, references: inReplyTo });
      } else {
        // Legacy path — no per-user sender: fall back to the server SMTP identity.
        res = await sendEmail({ to: email.recipient, subject: email.subject ?? "(no subject)", body: email.body ?? "", cc, inReplyTo, references: inReplyTo });
      }

      if (res.ok) {
        // Store the Message-ID so IMAP reply detection can thread replies to this send.
        await updateOutreachEmail(email.id, { status: "sent", sent_at: new Date().toISOString(), error: undefined, message_id: res.messageId ?? undefined });
        await incrDailyCount(sender ?? email.workflow_id, day).catch(() => {}); // counted for the status page, no longer a throttle
        sent++; results.push({ id: email.id, ok: true });
      } else {
        await updateOutreachEmail(email.id, { status: "failed", error: res.error });
        failed++; results.push({ id: email.id, ok: false, error: res.error });
      }
    };

    const startTs = Date.now();
    while (Date.now() - startTs < TIME_BUDGET_MS && drained < MAX_TOTAL) {
      const batch = await getDueEmails(DRAIN_BATCH);
      if (!batch.length) break;
      const queue = new PQueue({ concurrency: SEND_CONCURRENCY });
      for (const email of batch) queue.add(() => sendOne(email));
      await queue.onIdle();
      drained += batch.length;
    }
    const due = { length: drained }; // response shape: how many due emails we processed this run

    // Reply handling and follow-ups are owned by the campaign tick (src/lib/campaign/outreach.ts),
    // not by the sender: one place answers editors, so a thread can never be answered twice.
    return NextResponse.json({ due: due.length, rebursted, sent, failed, cappedSkipped, dupSkipped, guessSkipped, placeholderSkipped, replies, results });
  } finally {
    // Close every pooled SMTP connection opened for this burst.
    for (const tx of txPool.values()) { try { tx.close(); } catch { /* best-effort */ } }
    await releaseLock(LOCK_KEY, lockToken);
  }
}

// Vercel cron / QStash may issue GET — support both.
export async function GET(req: NextRequest) {
  return POST(req);
}
