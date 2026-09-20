import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/db/supabase";
import { GUEST_COOKIE, verifyGuestToken } from "@/lib/auth/guest";
import { devOwnerBypass, ownerAllowed } from "@/lib/auth/service";

export const dynamic = "force-dynamic";

/** Front door: an owner or guest with a campaign lands on it; everyone else lands on Setup. */
export default async function Home() {
  const jar = await cookies();
  await headers();
  let scope: { owner_email?: string; guest_id?: string } | null = null;
  if (devOwnerBypass()) scope = { owner_email: "dev@local" };
  else {
    try { const { auth } = await import("@auth"); const s = await auth(); if (ownerAllowed(s?.user?.email)) scope = { owner_email: s!.user!.email! }; } catch { /* no auth */ }
    if (!scope) { const gid = verifyGuestToken(jar.get(GUEST_COOKIE)?.value); if (gid) scope = { guest_id: gid }; }
  }
  if (scope) {
    let q = supabaseAdmin.from("campaigns").select("id").order("created_at", { ascending: false }).limit(1);
    q = scope.guest_id ? q.eq("guest_id", scope.guest_id) : q.eq("owner_email", scope.owner_email!).is("guest_id", null);
    const { data } = await q;
    if (data?.[0]?.id) redirect(`/campaigns/${(data[0] as any).id}`);
  }
  redirect("/setup");
}
