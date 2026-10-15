// What we already know about a publication, across every campaign the owner has run.
//
// The first campaign learns that creighton.edu's editor is Jonas, that his floor was $200, and
// that he asked for the link to be nofollow. Without this, the second campaign starts from zero,
// emails him as a stranger, and re-negotiates a price he already told us. With it, the Writer
// greets him by name and the Negotiator opens knowing his rate.
//
// Scoped to the owner: one person's negotiating history is not another's. Guests get the same
// behaviour within their own session.

import { supabaseAdmin } from "@/lib/db/supabase";

export interface PublicationMemory {
  domain_host: string;
  editor_name: string | null;
  editor_email: string | null;
  /** The last thing that happened: deal | declined | no_reply | needs_human | contacted. */
  last_outcome: string;
  /** What they agreed to last time, if anything. */
  last_price: number | null;
  /** The first number they asked for, which is the one worth remembering. */
  last_ask: number | null;
  /** What they said about the link: sponsored / nofollow / dofollow. */
  link_rel: string | null;
  times_contacted: number;
  last_contacted_at: string | null;
  note: string | null;
}

/** Everything the owner's past campaigns learned about these hosts. */
export async function recallPublications(ownerEmail: string | null, guestId: string | null, hosts: string[]): Promise<Map<string, PublicationMemory>> {
  const out = new Map<string, PublicationMemory>();
  if (!hosts.length || (!ownerEmail && !guestId)) return out;
  let q = supabaseAdmin.from("publication_memory").select("*").in("domain_host", hosts);
  q = guestId ? q.eq("guest_id", guestId) : q.eq("owner_email", ownerEmail!).is("guest_id", null);
  const { data } = await q;
  for (const row of ((data ?? []) as any[])) out.set(row.domain_host, row as PublicationMemory);
  return out;
}

/** Write down what this campaign learned. Called when a thread reaches an outcome. */
export async function rememberPublication(input: {
  ownerEmail: string | null; guestId: string | null; host: string;
  editorName?: string | null; editorEmail?: string | null;
  outcome: string; price?: number | null; ask?: number | null; linkRel?: string | null; note?: string | null;
}): Promise<void> {
  if (!input.host || (!input.ownerEmail && !input.guestId)) return;
  const scope: { guest_id: string | null; owner_email: string } = input.guestId ? { guest_id: input.guestId, owner_email: input.ownerEmail ?? "guest" } : { guest_id: null, owner_email: input.ownerEmail! };
  const { data: existing } = await supabaseAdmin.from("publication_memory").select("*")
    .eq("domain_host", input.host)
    .eq(input.guestId ? "guest_id" : "owner_email", input.guestId ?? input.ownerEmail!)
    .maybeSingle();
  const row = {
    ...scope,
    domain_host: input.host,
    editor_name: input.editorName ?? (existing as any)?.editor_name ?? null,
    editor_email: input.editorEmail ?? (existing as any)?.editor_email ?? null,
    last_outcome: input.outcome,
    last_price: input.price ?? (existing as any)?.last_price ?? null,
    last_ask: input.ask ?? (existing as any)?.last_ask ?? null,
    link_rel: input.linkRel ?? (existing as any)?.link_rel ?? null,
    times_contacted: Number((existing as any)?.times_contacted ?? 0) + 1,
    last_contacted_at: new Date().toISOString(),
    note: input.note ?? (existing as any)?.note ?? null,
  };
  // The unique index is functional (coalesce on guest_id), which ON CONFLICT cannot name, so the
  // row is updated by id when it exists and inserted otherwise.
  if (existing) await supabaseAdmin.from("publication_memory").update({ ...row, updated_at: new Date().toISOString() }).eq("id", (existing as any).id);
  else await supabaseAdmin.from("publication_memory").insert(row);
}

/**
 * One line for the Writer's prompt and the Negotiator's context. Deliberately plain: it is handed
 * to a model, so it states only what happened, never what to do about it.
 */
export function memoryBrief(m: PublicationMemory): string {
  const bits: string[] = [];
  if (m.editor_name) bits.push(`You have corresponded with ${m.editor_name} there before`);
  else bits.push("You have contacted this publication before");
  if (m.last_outcome === "deal" && m.last_price != null) bits.push(`and agreed ${m.last_price > 0 ? `$${m.last_price}` : "a free inclusion"} last time${m.last_ask && m.last_ask > m.last_price ? ` (their opening ask was $${m.last_ask})` : ""}`);
  else if (m.last_outcome === "declined") bits.push("and they declined last time");
  else if (m.last_outcome === "no_reply") bits.push("and they did not reply");
  if (m.link_rel) bits.push(`. Their link policy was ${m.link_rel}`);
  return `${bits.join(" ")}.`;
}

/** A short badge for the Publications tab. */
export function memoryLabel(m: PublicationMemory): string {
  if (m.last_outcome === "deal") return m.last_price ? `Worked with before · $${m.last_price}` : "Worked with before";
  if (m.last_outcome === "declined") return "Declined before";
  if (m.last_outcome === "no_reply") return "No reply before";
  return `Contacted ${m.times_contacted}×`;
}
