import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/db/supabase";
import { GUEST_COOKIE, verifyGuestToken } from "@/lib/auth/guest";
import { devOwnerBypass, devOwnerEmail, ownerAllowed } from "@/lib/auth/service";
import { money } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

/** With one campaign this redirects to it; with several it lists them. */
export default async function CampaignsIndex() {
  const jar = await cookies();
  let scope: { owner_email?: string; guest_id?: string } | null = null;
  if (devOwnerBypass()) scope = { owner_email: devOwnerEmail() };
  else {
    try { const { auth } = await import("@auth"); const s = await auth(); if (ownerAllowed(s?.user?.email)) scope = { owner_email: s!.user!.email! }; } catch { /* no auth */ }
    if (!scope) { const gid = verifyGuestToken(jar.get(GUEST_COOKIE)?.value); if (gid) scope = { guest_id: gid }; }
  }
  if (!scope) redirect("/setup");
  let q = supabaseAdmin.from("campaigns").select("id, name, phase, keywords, budget_total, budget_used, desired_deals, demo_mode, created_at").order("created_at", { ascending: false }).limit(50);
  q = scope.guest_id ? q.eq("guest_id", scope.guest_id) : q.eq("owner_email", scope.owner_email!).is("guest_id", null);
  const { data } = await q;
  const rows = (data ?? []) as any[];
  if (rows.length === 0) redirect("/setup");
  if (rows.length === 1) redirect(`/campaigns/${rows[0].id}`);
  return (
    <div>
      <div className="flex items-end justify-between gap-4 mb-6">
        <h1 className="serif text-3xl font-semibold">Campaigns</h1>
        <Link href="/setup" className="btn">New campaign</Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((c) => (
          <Link key={c.id} href={`/campaigns/${c.id}`} className="card p-4 hover:border-ink-2 transition-colors">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold truncate">{c.name}</div>
              <span className="chip">{String(c.phase).replace("_", " ")}</span>
            </div>
            <div className="text-sm text-ink-2 mt-1 truncate">{(c.keywords as string[]).join(" · ")}</div>
            <div className="text-xs text-ink-3 mt-3 mono">{money(c.budget_used)} of {money(c.budget_total)} · goal {c.desired_deals}{c.demo_mode ? " · demo" : ""}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
