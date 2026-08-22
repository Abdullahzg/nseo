// Daily send autopilot. The user sets ONE number — "send up to N emails/day" — and this keeps
// the queue topped up to that ceiling automatically: each run it counts how many sends are
// already queued for the next 24h and schedules just enough READY emails (that have a real
// recipient) to reach N, spread across each recipient's local window via computeSmartSchedule.
// It never sends directly — the existing per-minute processor delivers the scheduled rows — and
// it only ever moves ready → scheduled, so it's safe to run often. Mirrors the follow-ups toggle.
import { redis } from "@/lib/redis";
import { supabaseAdmin } from "@/lib/db/supabase";
import { updateOutreachEmail } from "@/lib/db/queries";
import { inferTimezone } from "@/lib/email/timezones";
import { computeSmartSchedule, type ScheduleRecipient } from "@/lib/email/schedule";

const ENABLED_KEY = "autopilot:enabled";
const CAP_KEY = "autopilot:cap";
const DEFAULT_CAP = 25;
const MAX_CAP = 500;

export async function autopilotEnabled(): Promise<boolean> {
  const r = redis();
  if (!r) return false; // default OFF — sending on a schedule is opt-in
  const v = await r.get(ENABLED_KEY).catch(() => null);
  return !!v;
}
export async function autopilotCap(): Promise<number> {
  const r = redis();
  if (!r) return DEFAULT_CAP;
  const v = await r.get(CAP_KEY).catch(() => null);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_CAP, Math.floor(n)) : DEFAULT_CAP;
}
export async function setAutopilot(input: { enabled?: boolean; cap?: number }): Promise<void> {
  const r = redis();
  if (!r) return;
  if (typeof input.enabled === "boolean") await r.set(ENABLED_KEY, input.enabled ? 1 : 0);
  if (typeof input.cap === "number" && input.cap > 0) await r.set(CAP_KEY, Math.min(MAX_CAP, Math.floor(input.cap)));
}

interface ReadyRow {
  id: string;
  author: { timezone?: string | null; domain?: { host?: string; country?: string } | null; contacts?: { type: string; value: string }[] } | null;
}

/**
 * Top the queue up to the daily cap. Returns what it did. `force` runs even if the Redis toggle
 * is off (used by a manual "top up now" button); the scheduled cron passes force=false.
 */
export async function runAutopilot(opts: { force?: boolean } = {}): Promise<{ enabled: boolean; cap: number; alreadyQueued: number; scheduled: number }> {
  const enabled = await autopilotEnabled();
  const cap = await autopilotCap();
  if (!enabled && !opts.force) return { enabled, cap, alreadyQueued: 0, scheduled: 0 };

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 3600_000).toISOString();

  // How many sends are already queued to go out in the next 24h?
  const { count: alreadyQueued } = await supabaseAdmin
    .from("outreach_emails").select("id", { count: "exact", head: true })
    .eq("status", "scheduled").eq("kind", "initial")
    .gte("scheduled_at", now.toISOString()).lt("scheduled_at", in24h);
  const need = cap - (alreadyQueued ?? 0);
  if (need <= 0) return { enabled, cap, alreadyQueued: alreadyQueued ?? 0, scheduled: 0 };

  // Oldest READY initials that have a recipient email.
  const { data } = await supabaseAdmin
    .from("outreach_emails")
    .select("id, author:authors(timezone, domain:domains(host, country), contacts(type, value))")
    .eq("status", "ready").eq("kind", "initial")
    .order("created_at", { ascending: true })
    .limit(Math.min(need, MAX_CAP) * 3); // over-fetch; many won't have an email yet
  const rows = (data ?? []) as unknown as ReadyRow[];

  const recipients: ScheduleRecipient[] = [];
  for (const row of rows) {
    if (recipients.length >= need) break;
    const hasEmail = (row.author?.contacts ?? []).some((c) => c.type === "mailto");
    if (!hasEmail) continue;
    const tz = row.author?.timezone || inferTimezone(row.author?.domain?.host, row.author?.domain?.country, "America/New_York");
    recipients.push({ id: row.id, tz });
  }
  if (recipients.length === 0) return { enabled, cap, alreadyQueued: alreadyQueued ?? 0, scheduled: 0 };

  const slots = computeSmartSchedule(recipients, { daily_cap: need, gap_minutes: 15, send_hour_start: 9, send_hour_end: 17, timezone: "UTC" } as any, now);
  let scheduled = 0;
  for (const s of slots) {
    await updateOutreachEmail(s.id, { scheduled_at: s.at, status: "scheduled" });
    scheduled++;
  }
  return { enabled, cap, alreadyQueued: alreadyQueued ?? 0, scheduled };
}
