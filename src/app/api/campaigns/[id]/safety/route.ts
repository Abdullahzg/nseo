import { NextRequest, NextResponse } from "next/server";
import { canSee } from "@/lib/campaign/access";
import { supabaseAdmin } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";

/**
 * What the campaign refused to do, and why. Two kinds of refusal:
 *   - compliance: terms the agent may not agree to (an unqualified paid link, no disclosure).
 *   - security: a reply that tried to instruct the agent instead of answering it.
 * Both are decided by code, so this endpoint reports facts rather than opinions.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { camp, ok } = await canSee(req, id);
  if (!camp || !ok) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [{ data: deals }, { data: flagged }, { data: cards }, { data: events }] = await Promise.all([
    supabaseAdmin.from("deals").select("domain_host, agreed_price, link_rel, disclosure, compliance").eq("campaign_id", id).neq("status", "cancelled"),
    supabaseAdmin.from("outreach_emails").select("id, injection, reply_excerpt, prospect:campaign_prospects(domain_host, contact_name)").eq("campaign_id", id).not("injection", "is", null),
    supabaseAdmin.from("interventions").select("id, type, status, agent_plan, editor_quote, anchor_email_id, prospect:campaign_prospects(domain_host)").eq("campaign_id", id).in("type", ["compliance_block", "suspicious_content"]),
    supabaseAdmin.from("agent_events").select("action, human, created_at").eq("campaign_id", id).in("action", ["intervention_created", "near_duplicates_dropped", "queue_ranked"]).order("id", { ascending: false }).limit(40),
  ]);

  return NextResponse.json({
    deals: ((deals ?? []) as any[]).map((d) => ({
      host: d.domain_host, price: Number(d.agreed_price ?? 0),
      link_rel: d.link_rel, disclosure: d.disclosure,
      verdict: d.compliance?.verdict ?? null, why: d.compliance?.why ?? null, rules: d.compliance?.rules ?? [],
    })),
    injections: ((flagged ?? []) as any[]).map((f) => ({
      id: f.id, host: f.prospect?.domain_host ?? "", editor: f.prospect?.contact_name ?? null,
      verdict: f.injection?.verdict ?? "suspicious", score: f.injection?.score ?? 0,
      matches: f.injection?.matches ?? [],
      quote: String(f.reply_excerpt ?? "").slice(0, 400),
    })),
    cards: ((cards ?? []) as any[]).map((c) => ({ id: c.id, type: c.type, status: c.status, plan: c.agent_plan, quote: c.editor_quote, host: c.prospect?.domain_host ?? "", anchor: c.anchor_email_id })),
    events: (events ?? []) as any[],
  });
}
