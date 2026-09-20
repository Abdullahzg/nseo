import { NextRequest, NextResponse } from "next/server";
import { identifyCaller } from "@/lib/auth/service";
import { supabaseAdmin } from "@/lib/db/supabase";

export const maxDuration = 30;

// GET /api/campaigns/[id]/template — fetch the email template for this campaign.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await identifyCaller(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await params;

  // Look up campaign's email_template_id
  const { data: camp, error: campErr } = await supabaseAdmin
    .from("campaigns")
    .select("email_template_id")
    .eq("id", id)
    .maybeSingle();

  if (campErr || !camp) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

  let templateId = camp.email_template_id;

  // If no template assigned, find the default email template
  if (!templateId) {
    const { data: defaultTpl } = await supabaseAdmin
      .from("email_templates")
      .select("id")
      .eq("channel", "email")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    templateId = defaultTpl?.id;
  }

  if (!templateId) {
    return NextResponse.json({ subject: "", body: "", guidance: "", id: null });
  }

  const { data: tpl, error: tplErr } = await supabaseAdmin
    .from("email_templates")
    .select("id, subject, body, guidance")
    .eq("id", templateId)
    .maybeSingle();

  if (tplErr || !tpl) return NextResponse.json({ error: "template not found" }, { status: 404 });

  return NextResponse.json({ id: tpl.id, subject: tpl.subject, body: tpl.body, guidance: tpl.guidance ?? "" });
}

// PATCH /api/campaigns/[id]/template — update the email template.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await identifyCaller(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const { subject, body: tplBody } = body as { subject?: string; body?: string };

  // Look up campaign's email_template_id
  const { data: camp } = await supabaseAdmin
    .from("campaigns")
    .select("email_template_id")
    .eq("id", id)
    .maybeSingle();

  let templateId = camp?.email_template_id;

  // If no template assigned, find the default email template
  if (!templateId) {
    const { data: defaultTpl } = await supabaseAdmin
      .from("email_templates")
      .select("id")
      .eq("channel", "email")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    templateId = defaultTpl?.id;
  }

  if (!templateId) {
    return NextResponse.json({ error: "no template found to update" }, { status: 404 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (subject !== undefined) patch.subject = subject;
  if (tplBody !== undefined) patch.body = tplBody;

  const { error } = await supabaseAdmin
    .from("email_templates")
    .update(patch)
    .eq("id", templateId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
