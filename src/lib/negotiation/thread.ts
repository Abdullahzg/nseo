// One thread, both directions, in time order. Our sends are outreach_emails rows; the editor's
// replies live on the anchor: `reply_excerpt` is the latest and `reply_history` is every one of
// them, so no earlier message is lost from the conversation the Negotiator (or you) reads.
import { supabaseAdmin } from "@/lib/db/supabase";

export interface ThreadMsg { from: "us" | "them"; body: string; at: string | null; subject?: string | null }

export interface ReplyHistoryEntry { at: string; from: string | null; subject: string | null; body: string }

/** The editor's replies on an anchor row, oldest first, from the history with the latest as a fallback. */
export function repliesOf(anchor: { reply_history?: unknown; reply_excerpt?: string | null; replied_at?: string | null; reply_from?: string | null; reply_subject?: string | null }): ReplyHistoryEntry[] {
  const hist = Array.isArray(anchor.reply_history) ? (anchor.reply_history as any[]).filter((h) => h && typeof h.body === "string" && h.body.trim()) : [];
  const out: ReplyHistoryEntry[] = hist.map((h) => ({ at: String(h.at ?? ""), from: h.from ?? null, subject: h.subject ?? null, body: String(h.body) }));
  const latest = (anchor.reply_excerpt ?? "").trim();
  if (latest && !out.some((h) => h.body.trim() === latest)) out.push({ at: anchor.replied_at ?? "", from: anchor.reply_from ?? null, subject: anchor.reply_subject ?? null, body: latest });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Build the ordered thread from the rows of one anchor (the anchor itself plus its children). */
export function threadFromRows(rows: any[]): ThreadMsg[] {
  const msgs: ThreadMsg[] = [];
  for (const r of rows) {
    if (r.body && (r.status === "sent" || r.status === "sending")) msgs.push({ from: "us", body: r.body, at: r.sent_at ?? r.created_at ?? null, subject: r.subject ?? null });
    if (r.kind === "initial") for (const h of repliesOf(r)) msgs.push({ from: "them", body: h.body, at: h.at || null, subject: h.subject });
  }
  // Time order; a message without a time keeps its place after the one before it.
  return msgs.map((m, i) => ({ m, i })).sort((a, b) => { const ta = a.m.at ?? "", tb = b.m.at ?? ""; if (ta && tb && ta !== tb) return ta.localeCompare(tb); return a.i - b.i; }).map((x) => x.m);
}

export async function loadThread(anchorId: string): Promise<ThreadMsg[]> {
  const { data } = await supabaseAdmin.from("outreach_emails").select("id, kind, body, subject, status, created_at, sent_at, reply_excerpt, reply_history, replied_at, reply_from, reply_subject").or(`id.eq.${anchorId},parent_id.eq.${anchorId}`).order("created_at", { ascending: true });
  return threadFromRows((data ?? []) as any[]);
}
