// Your to-do list, derived from what the campaign concluded: a deal means you owe a blurb and,
// once it is live, a payment; a card you answered "Thursday works" means a call to put on your
// calendar; an agreement means a signature. Nothing here is written by a model — every item is
// a rule over the deals and the answered cards, so it is always true. Only the tick is stored.
import { supabaseAdmin } from "@/lib/db/supabase";

export interface Todo {
  key: string;                    // stable per item, for ticking off
  campaign_id: string; campaign_name: string;
  what: string;                   // the action, in your terms
  why: string;                    // the line from the conversation that caused it
  when: "now" | "this_week" | "when_live" | "on_reply";
  when_label: string;
  who: string;                    // editor + publication
  href: string;                   // where to go to act
  done_at: string | null;
}

const WHEN: Record<Todo["when"], string> = { now: "now", this_week: "this week", when_live: "once the placement is live", on_reply: "when they reply" };

export async function todosFor(scope: { owner_email?: string; guest_id?: string }, campaignId?: string): Promise<Todo[]> {
  let cq = supabaseAdmin.from("campaigns").select("id, name, phase, demo_mode, owner_email, guest_id");
  cq = scope.guest_id ? cq.eq("guest_id", scope.guest_id) : scope.owner_email ? cq.eq("owner_email", scope.owner_email).is("guest_id", null) : cq.eq("id", "00000000-0000-0000-0000-000000000000");
  if (campaignId) cq = cq.eq("id", campaignId);
  const { data: camps } = await cq;
  const ids = ((camps ?? []) as any[]).map((c) => c.id);
  if (!ids.length) return [];
  const name = new Map(((camps ?? []) as any[]).map((c) => [c.id, c.name as string]));
  const [{ data: deals }, { data: ivs }, { data: done }, { data: anchors }] = await Promise.all([
    supabaseAdmin.from("deals").select("id, campaign_id, anchor_email_id, domain_host, agreed_price, original_ask, status, agreed_at, created_at").in("campaign_id", ids).neq("status", "cancelled"),
    supabaseAdmin.from("interventions").select("id, campaign_id, anchor_email_id, prospect_id, type, status, answer, editor_quote, resolved_at, created_at").in("campaign_id", ids),
    supabaseAdmin.from("todo_state").select("campaign_id, key, done_at").in("campaign_id", ids),
    supabaseAdmin.from("outreach_emails").select("id, to_email, prospect:campaign_prospects(domain_host, contact_name)").in("campaign_id", ids).eq("kind", "initial"),
  ]);
  const doneAt = new Map(((done ?? []) as any[]).map((d) => [`${d.campaign_id}:${d.key}`, d.done_at as string]));
  const who = new Map(((anchors ?? []) as any[]).map((a) => [a.id, `${a.prospect?.contact_name ?? "the editor"} at ${a.prospect?.domain_host ?? a.to_email?.split("@")[1] ?? "the publication"}`]));
  const out: Todo[] = [];
  const push = (t: Omit<Todo, "done_at" | "campaign_name" | "when_label">) => out.push({ ...t, campaign_name: name.get(t.campaign_id) ?? "", when_label: WHEN[t.when], done_at: doneAt.get(`${t.campaign_id}:${t.key}`) ?? null });

  for (const d of (deals ?? []) as any[]) {
    const w = (d.anchor_email_id && who.get(d.anchor_email_id)) || `the editor at ${d.domain_host}`;
    const saved = d.original_ask != null && Number(d.original_ask) > Number(d.agreed_price) ? ` (they asked $${Number(d.original_ask)}; agreed $${Number(d.agreed_price)})` : ` ($${Number(d.agreed_price)})`;
    push({ key: `deal:${d.id}:blurb`, campaign_id: d.campaign_id, what: `Send ${w} the blurb and link for the placement`, why: `Deal agreed${saved}. The agent promised "a short blurb and everything you need from our side".`, when: "now", who: w, href: `/campaigns/${d.campaign_id}?tab=conversations` });
    push({ key: `deal:${d.id}:pay`, campaign_id: d.campaign_id, what: `Pay ${d.domain_host} $${Number(d.agreed_price)}`, why: `The agreed price for the inclusion. Pay when the placement is live and the link is as agreed.`, when: "when_live", who: w, href: `/deals` });
  }
  for (const iv of (ivs ?? []) as any[]) {
    const w = (iv.anchor_email_id && who.get(iv.anchor_email_id)) || "the editor";
    const q = iv.editor_quote ? `“${String(iv.editor_quote).slice(0, 120)}${String(iv.editor_quote).length > 120 ? "…" : ""}”` : "";
    if (iv.status === "open") {
      push({ key: `iv:${iv.id}:answer`, campaign_id: iv.campaign_id, what: `Answer ${w} on Needs you (${String(iv.type).replace(/_/g, " ")})`, why: q || "The agent parked this thread for you.", when: "now", who: w, href: "/needs-you" });
      continue;
    }
    if (iv.status !== "resolved") continue;
    const a = String(iv.answer ?? "");
    const emailOnly = /email( is)? (only|easier|works)|no calls?|not (doing|taking) calls|by email/i.test(a);
    if ((iv.type === "sync_contact" || iv.type === "scheduling") && !emailOnly) push({ key: `iv:${iv.id}:call`, campaign_id: iv.campaign_id, what: `Put the call with ${w} on your calendar and send an invite`, why: `You answered: “${a.slice(0, 120)}”. The agent passed that on; the meeting itself is yours to schedule.`, when: "this_week", who: w, href: `/campaigns/${iv.campaign_id}?tab=conversations` });
    if (iv.type === "legal_contract") push({ key: `iv:${iv.id}:sign`, campaign_id: iv.campaign_id, what: `Review and sign ${w}'s agreement`, why: `${q} You answered: “${a.slice(0, 100)}”.`, when: "on_reply", who: w, href: `/campaigns/${iv.campaign_id}?tab=conversations` });
    if (iv.type === "payment_details") push({ key: `iv:${iv.id}:invoice`, campaign_id: iv.campaign_id, what: `Send ${w} your invoice or payment details`, why: q, when: "now", who: w, href: `/campaigns/${iv.campaign_id}?tab=conversations` });
    if (iv.type === "asset_request") push({ key: `iv:${iv.id}:files`, campaign_id: iv.campaign_id, what: `Send ${w} the files they asked for`, why: `${q} The agent cannot attach files; you answered: “${a.slice(0, 100)}”.`, when: "now", who: w, href: `/campaigns/${iv.campaign_id}?tab=conversations` });
    if (iv.type === "identity_verification") push({ key: `iv:${iv.id}:proof`, campaign_id: iv.campaign_id, what: `Confirm your identity to ${w} if they ask again`, why: q, when: "on_reply", who: w, href: `/campaigns/${iv.campaign_id}?tab=conversations` });
    if (iv.type === "process_portal") push({ key: `iv:${iv.id}:portal`, campaign_id: iv.campaign_id, what: `Submit to ${w} through their form or portal`, why: `${q} The agent can only email.`, when: "now", who: w, href: `/campaigns/${iv.campaign_id}?tab=conversations` });
  }
  const order: Record<Todo["when"], number> = { now: 0, this_week: 1, on_reply: 2, when_live: 3 };
  return out.sort((a, b) => (a.done_at ? 1 : 0) - (b.done_at ? 1 : 0) || order[a.when] - order[b.when]);
}

export async function setTodoDone(campaignId: string, key: string, done: boolean): Promise<void> {
  if (done) await supabaseAdmin.from("todo_state").upsert({ campaign_id: campaignId, key, done_at: new Date().toISOString() }, { onConflict: "campaign_id,key" });
  else await supabaseAdmin.from("todo_state").delete().eq("campaign_id", campaignId).eq("key", key);
}
