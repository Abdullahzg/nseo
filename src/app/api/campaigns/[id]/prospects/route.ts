import { NextRequest, NextResponse } from "next/server";
import { canSee } from "@/lib/campaign/access";
import { supabaseAdmin } from "@/lib/db/supabase";

/**
 * GET — every publication the campaign has looked at, with what was decided about it and why:
 * the page, the verdict (each check and the reason), the editor found, the email sent, the reply,
 * the deal. This is the list behind every "found 12 / qualified 8 / emailed 7" number.
 */
export interface ProspectRow {
  id: string; host: string; url: string | null; title: string | null; source: string; synthetic: boolean;
  status: string; stage: string; stage_label: string;
  score: number | null; score_basis: string | null; dr: number | null; dr_source: string | null; relevance: number | null;
  page_type: string | null; why: string | null; checks: { label: string; state: string }[];
  editor: { name: string | null; email: string | null; source: string | null } | null; contact_attempts: number;
  email: { id: string; subject: string; status: string; sent_at: string | null; negotiation_status: string | null; reply: string | null; intervention_type: string | null } | null;
  deal: { agreed: number; asked: number | null } | null;
  ceiling: number | null; persona: string | null;
}

const STAGE: Record<string, [string, string]> = {
  discovered: ["found", "Found — waiting to be read"], rejected: ["rejected", "Rejected"], qualified: ["qualified", "Qualified — finding an editor"],
  resolving_contact: ["qualified", "Finding an editor"], ready: ["ready", "Editor found — email due"], outreached: ["emailed", "Emailed — waiting for a reply"],
  replied: ["replied", "Replied"], negotiating: ["negotiating", "Negotiating"], escalated: ["needs_you", "Needs you"], deal: ["deal", "Deal"], lost: ["closed", "Closed"],
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { camp, ok } = await canSee(req, id);
  if (!camp || !ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [{ data: prospects }, { data: emails }, { data: deals }] = await Promise.all([
    supabaseAdmin.from("campaign_prospects").select("*").eq("campaign_id", id).order("created_at", { ascending: true }),
    supabaseAdmin.from("outreach_emails").select("id, prospect_id, subject, status, sent_at, negotiation_status, reply_excerpt, intervention_type").eq("campaign_id", id).eq("kind", "initial"),
    supabaseAdmin.from("deals").select("anchor_email_id, domain_host, agreed_price, original_ask, status").eq("campaign_id", id).neq("status", "cancelled"),
  ]);
  const emailByProspect = new Map(((emails ?? []) as any[]).map((e) => [e.prospect_id, e]));
  const dealByAnchor = new Map(((deals ?? []) as any[]).map((d) => [d.anchor_email_id, d]));
  const dealByHost = new Map(((deals ?? []) as any[]).map((d) => [d.domain_host, d]));
  const rows: ProspectRow[] = ((prospects ?? []) as any[]).map((p) => {
    const q = p.qualification ?? {};
    const bd = p.score_breakdown ?? {};
    const e = emailByProspect.get(p.id);
    const d = (e && dealByAnchor.get(e.id)) || dealByHost.get(p.domain_host);
    const checks: { label: string; state: string }[] = Array.isArray(q.checks) ? q.checks : [];
    const failed = checks.filter((c) => c.state === "fail").map((c) => c.label);
    const why = p.status === "rejected" ? `${failed.length ? failed.join(", ") + " — " : ""}${q.why_fit ?? ""}`.trim() || null : q.why_fit ?? null;
    const [stage, stage_label] = STAGE[p.status] ?? [p.status, p.status];
    return {
      id: p.id, host: p.domain_host, url: p.prospect_url ?? null, title: q.title ?? p.title ?? null, source: p.provenance?.source ?? "", synthetic: !!p.provenance?.synthetic,
      status: p.status, stage, stage_label,
      score: p.opportunity_score != null ? Number(p.opportunity_score) : null, score_basis: p.score_basis ?? null,
      dr: bd.authority?.value ?? null, dr_source: bd.authority?.source ?? null, relevance: bd.relevance?.value ?? null,
      page_type: q.page_type ?? null, why, checks,
      editor: p.contact_email ? { name: p.contact_name ?? null, email: p.contact_email, source: p.contact_source ?? null } : null, contact_attempts: p.contact_attempts ?? 0,
      email: e ? { id: e.id, subject: e.subject ?? "", status: e.status, sent_at: e.sent_at ?? null, negotiation_status: e.negotiation_status ?? null, reply: e.reply_excerpt ?? null, intervention_type: e.intervention_type ?? null } : null,
      deal: d ? { agreed: Number(d.agreed_price), asked: d.original_ask != null ? Number(d.original_ask) : null } : null,
      ceiling: p.ceiling != null ? Number(p.ceiling) : null, persona: p.demo_persona ?? null,
    };
  });
  return NextResponse.json({ prospects: rows });
}
