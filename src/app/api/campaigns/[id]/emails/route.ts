import { NextRequest, NextResponse } from "next/server";
import { canSee } from "@/lib/campaign/access";
import { supabaseAdmin } from "@/lib/db/supabase";
import { recordEvent, updateProspect } from "@/lib/campaign/queries";
import { actorFor } from "@/lib/auth/service";

/**
 * POST {id, action: "approve" | "discard", subject?, body?} — real mode with "approve each first
 * email": approve (optionally edited) sends it on the next scheduler pass; discard drops the
 * email and closes the prospect. Nothing here is a model call.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { caller, camp, ok } = await canSee(req, id);
  if (!camp || !ok || caller?.kind === "cron") return NextResponse.json({ error: "not found" }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const emailId = String(b?.id ?? ""), action = String(b?.action ?? "");
  if (!emailId || !["approve", "discard"].includes(action)) return NextResponse.json({ error: "id and action (approve|discard) required" }, { status: 400 });
  const { data: row } = await supabaseAdmin.from("outreach_emails").select("id, status, subject, body, to_email, prospect_id, kind").eq("id", emailId).eq("campaign_id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "email not found" }, { status: 404 });
  if ((row as any).status !== "awaiting_approval") return NextResponse.json({ error: `This email is ${String((row as any).status).replace("_", " ")}, not awaiting approval.` }, { status: 409 });
  const host = String((row as any).to_email ?? "").split("@")[1] ?? "the editor";
  if (action === "approve") {
    const subject = typeof b?.subject === "string" && b.subject.trim() ? b.subject.trim().slice(0, 150) : (row as any).subject;
    const body = typeof b?.body === "string" && b.body.trim().length > 20 ? b.body.trim().slice(0, 5000) : (row as any).body;
    const edited = subject !== (row as any).subject || body !== (row as any).body;
    await supabaseAdmin.from("outreach_emails").update({ status: "scheduled", scheduled_at: new Date().toISOString(), subject, body }).eq("id", emailId);
    await recordEvent({ campaign_id: id, agent: "you", action: "email_approved", engine: "system", thread_id: emailId, prospect_id: (row as any).prospect_id ?? null, human: `You approved the email to ${host}${edited ? " (with your edits)" : ""} — it goes out on the next scheduler pass`, detail: { by: actorFor(caller), edited, subject } });
    return NextResponse.json({ ok: true, status: "scheduled" });
  }
  await supabaseAdmin.from("outreach_emails").update({ status: "failed", error: "discarded by you", followup_skipped: true }).eq("id", emailId);
  if ((row as any).kind === "initial" && (row as any).prospect_id) await updateProspect((row as any).prospect_id, { status: "lost" });
  await recordEvent({ campaign_id: id, agent: "you", action: "email_discarded", engine: "system", thread_id: emailId, prospect_id: (row as any).prospect_id ?? null, human: `You discarded the email to ${host} — the publication is closed`, detail: { by: actorFor(caller) } });
  return NextResponse.json({ ok: true, status: "discarded" });
}
