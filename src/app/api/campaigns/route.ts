import { NextRequest, NextResponse } from "next/server";
import { identifyCaller } from "@/lib/auth/service";
import { supabaseAdmin } from "@/lib/db/supabase";
import { getCampaigns, createCampaign } from "@/lib/db/queries";

// GET /api/campaigns — list campaigns (newest first).
export async function GET() {
  try {
    const campaigns = await getCampaigns();
    return NextResponse.json(campaigns);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/campaigns — create a campaign. Accepts both the legacy discovery fields and
// the agentic objective fields (budget, deals goal, autonomy mode, constraints).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const caller = await identifyCaller(req);
    const ownerEmail = caller?.kind === "user" ? caller.email : null;

    const { name, keywords, region, target_hits, seed_writer_name, seed_article_url, seed_domains, seed_article_urls } = body;
    const hasSeed = seed_writer_name || seed_article_url || seed_domains?.length || seed_article_urls?.length;
    if (!name || (!keywords?.length && !hasSeed && !body.website_url)) {
      return NextResponse.json({ error: "name and at least one of keywords / sites / articles / website are required" }, { status: 400 });
    }

    const campaign = await createCampaign({
      name, keywords: keywords ?? [], region, target_hits,
      seed_writer_name, seed_article_url, seed_domains, seed_article_urls,
    });

    // Agentic objective fields (best-effort patch; legacy DBs without migration 062 still work).
    const objPatch: Record<string, unknown> = {
      owner_email: ownerEmail,
      website_url: body.website_url ?? null,
      objective: body.objective ?? null,
      autonomy_mode: body.autonomy_mode ?? "autonomous",
      ...(body.budget_total != null ? { budget_total: Number(body.budget_total) } : {}),
      ...(body.currency ? { currency: body.currency } : {}),
      ...(body.min_dr != null ? { min_dr: Number(body.min_dr) } : {}),
      ...(Array.isArray(body.geos) ? { geos: body.geos } : {}),
      ...(body.desired_deals != null ? { desired_deals: Number(body.desired_deals) } : {}),
      ...(body.max_per_deal != null ? { max_per_deal: Number(body.max_per_deal) } : {}),
      ...(Array.isArray(body.excluded_domains) ? { excluded_domains: body.excluded_domains } : {}),
      ...(body.constraints_text ? { constraints_text: String(body.constraints_text) } : {}),
      ...(body.demo_mode != null ? { demo_mode: !!body.demo_mode } : {}),
      ...(body.email_template_id ? { email_template_id: body.email_template_id } : {}),
      phase: "draft",
    };
    await supabaseAdmin.from("campaigns").update(objPatch).eq("id", campaign.id).then(
      () => undefined,
      () => undefined
    );

    const { data: full } = await supabaseAdmin.from("campaigns").select("*").eq("id", campaign.id).maybeSingle();
    return NextResponse.json(full ?? campaign, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
