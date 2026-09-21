import { NextRequest, NextResponse } from "next/server";
import { identifyCaller, scopeOf, actorFor } from "@/lib/auth/service";
import { supabaseAdmin } from "@/lib/db/supabase";
import { recordEvent } from "@/lib/campaign/queries";
import { withKeys } from "@/lib/ai/context";
import { getOwnerKeys } from "@/lib/db/queries";
import { json as nebiusJson, NebiusError } from "@/lib/ai/nebius";
import { productName } from "@/lib/campaign/outreach";

export const maxDuration = 60;

async function loadDeal(req: NextRequest, id: string) {
  const caller = await identifyCaller(req);
  if (!caller || caller.kind === "cron") return { caller, deal: null as any };
  const scope = scopeOf(caller);
  let q = supabaseAdmin.from("deals").select("*, campaign:campaigns!inner(*)").eq("id", id);
  q = scope.guest_id ? q.eq("campaign.guest_id", scope.guest_id) : q.eq("campaign.owner_email", scope.owner_email!).is("campaign.guest_id", null);
  const { data } = await q.maybeSingle();
  return { caller, deal: data as any };
}

const NEXT: Record<string, string> = { terms_agreed: "awaiting_content", awaiting_content: "placement_pending", placement_pending: "live", live: "closed" };
const LABEL: Record<string, string> = { terms_agreed: "Terms agreed", awaiting_content: "Blurb sent — awaiting the placement", placement_pending: "Placement pending", live: "Live", closed: "Paid and closed" };

/**
 * PATCH {action: "advance" | "set", status?, live_url?} — you move a deal along: blurb sent → placement
 * pending → live (with the URL) → paid/closed. Next steps reads these.
 * POST {action: "blurb"} — the Writer drafts the blurb you owe the editor (Nano), saved on the deal.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { caller, deal } = await loadDeal(req, id);
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const target = b?.action === "set" && typeof b?.status === "string" && b.status in LABEL ? b.status : NEXT[deal.status];
  if (!target) return NextResponse.json({ error: `A ${deal.status} deal has no next step.` }, { status: 409 });
  const patch: Record<string, unknown> = { status: target, updated_at: new Date().toISOString() };
  const terms = { ...(deal.terms ?? {}) };
  if (typeof b?.live_url === "string" && b.live_url.trim()) terms.live_url = b.live_url.trim().slice(0, 500);
  if (target === "closed") { terms.paid_at = new Date().toISOString(); patch.closed_at = new Date().toISOString(); }
  patch.terms = terms;
  await supabaseAdmin.from("deals").update(patch).eq("id", id);
  await recordEvent({ campaign_id: deal.campaign_id, agent: "you", action: "deal_updated", engine: "system", thread_id: deal.anchor_email_id ?? null, human: `You marked the ${deal.domain_host} deal: ${LABEL[target]}${terms.live_url && target === "live" ? ` (${terms.live_url})` : ""}`, detail: { status: target, by: actorFor(caller) } });
  return NextResponse.json({ ok: true, status: target, label: LABEL[target] });
}

const BLURB_SCHEMA = { name: "blurb", schema: { type: "object", properties: { blurb: { type: "string" }, anchor_text: { type: "string" } }, required: ["blurb", "anchor_text"], additionalProperties: false } };
const isBlurb = (v: unknown): v is { blurb: string; anchor_text: string } => typeof (v as any)?.blurb === "string" && (v as any).blurb.trim().length > 60 && typeof (v as any)?.anchor_text === "string";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { deal } = await loadDeal(req, id);
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
  const camp = deal.campaign;
  try {
    const keys = await getOwnerKeys(camp.owner_email);
    const words = (t: string) => t.trim().split(/\s+/).length;
    const ask = (note: string) => withKeys(keys, () => nebiusJson<{ blurb: string; anchor_text: string }>({
      role: "fast", thinking: false, max_tokens: 500, temperature: 0.4, schema: BLURB_SCHEMA, validate: isBlurb,
      messages: [
        { role: "system", content: "You write the short, factual product blurb an editor asked for, to be dropped into their existing article. Plain text, three or four sentences, 70 to 110 words, third person, no hype adjectives, no claims that are not in the product description, no markdown. Also give a 2-5 word anchor text for the link. JSON: {blurb, anchor_text}." },
        { role: "user", content: `Product: ${productName(camp)} — ${camp.what_you_sell ?? camp.name}. Website: ${camp.website_url ?? ""}.\nPublication: ${deal.publication ?? deal.domain_host}. The placement is an inclusion in their article about ${camp.keywords.join(", ")}.${camp.plan?.facts ? `\nFacts you may use: ${camp.plan.facts}` : ""}${note}` },
      ],
    }));
    let r = await ask("");
    // Nano sometimes answers in one sentence; an editor will not run a 26-word blurb. One retry, then accept.
    if (words(r.data.blurb) < 40) r = await ask(`\nYour previous draft was ${words(r.data.blurb)} words; write 50 to 90 words in three sentences, still without inventing features.`);
    const terms = { ...(deal.terms ?? {}), blurb: r.data.blurb.trim(), anchor_text: r.data.anchor_text.trim(), blurb_model: r.meta.model };
    await supabaseAdmin.from("deals").update({ terms, updated_at: new Date().toISOString() }).eq("id", id);
    await recordEvent({ campaign_id: deal.campaign_id, agent: "outreach", action: "blurb_drafted", engine: "model", llm: r.meta, thread_id: deal.anchor_email_id ?? null, human: `Drafted the blurb you owe ${deal.domain_host} (${r.data.blurb.split(/\s+/).length} words)`, detail: { body: r.data.blurb, anchor_text: r.data.anchor_text } });
    return NextResponse.json({ ok: true, blurb: r.data.blurb, anchor_text: r.data.anchor_text, model: r.meta.model });
  } catch (e: any) {
    return NextResponse.json({ error: e instanceof NebiusError ? `Nebius (${e.kind}): ${e.message}` : e?.message ?? "failed" }, { status: 503 });
  }
}
