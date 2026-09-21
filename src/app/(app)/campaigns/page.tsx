import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/db/supabase";
import { GUEST_COOKIE, verifyGuestToken } from "@/lib/auth/guest";
import { devOwnerBypass, devOwnerEmail, ownerAllowed } from "@/lib/auth/service";
import { money } from "@/lib/ui/format";
import { StaggerList } from "@/components/ui/motion";

export const dynamic = "force-dynamic";

function CampaignCard({ c, active, phase }: { c: any; active: boolean; phase: string }) {
  return (
    <Link href={`/campaigns/${c.id}`} className="card p-4 hover:border-ink-2 transition-colors block">
      <div className="flex items-center gap-3">
        {active && <span className="orb !w-5 !h-5 !border-[3px] shrink-0" aria-hidden="true" />}
        <div className="font-semibold truncate flex-1">{c.name}</div>
        <span className={`chip ${c.phase === "completed" ? "chip-accent" : ""}`}>{phase}</span>
      </div>
      <div className="text-sm text-ink-2 mt-1 truncate">{(c.keywords as string[]).join(" · ")}</div>
      <div className="text-xs text-ink-3 mt-3 mono">{money(c.budget_used)} of {money(c.budget_total)} · goal {c.desired_deals}{c.demo_mode ? " · demo" : ""}</div>
    </Link>
  );
}

/** Lists every campaign, running first. */
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
  const ACTIVE = new Set(["planning", "discovering", "qualifying", "resolving_contacts", "outreaching", "monitoring"]);
  const PHASE: Record<string, string> = { planning: "planning", discovering: "searching", qualifying: "judging pages", resolving_contacts: "finding editors", outreaching: "writing emails", monitoring: "waiting for replies", completed: "finished", stopped: "stopped", failed: "failed" };
  const running = rows.filter((c) => ACTIVE.has(c.phase));
  const done = rows.filter((c) => !ACTIVE.has(c.phase));
  return (
    <div>
      <div className="flex items-end justify-between gap-4 mb-6">
        <h1 className="serif text-3xl font-semibold">Campaigns</h1>
        <Link href="/setup" className="btn">New campaign</Link>
      </div>
      {running.length > 0 && <><h2 className="label mb-3">Running now ({running.length})</h2><StaggerList className="grid gap-3 sm:grid-cols-2 mb-8">{running.map((c) => <CampaignCard key={c.id} c={c} active phase={PHASE[c.phase] ?? String(c.phase).replace("_", " ")} />)}</StaggerList></>}
      {done.length > 0 && <><h2 className="label mb-3">Finished ({done.length})</h2><StaggerList className="grid gap-3 sm:grid-cols-2">{done.map((c) => <CampaignCard key={c.id} c={c} active={false} phase={PHASE[c.phase] ?? String(c.phase).replace("_", " ")} />)}</StaggerList></>}
    </div>
  );
}
