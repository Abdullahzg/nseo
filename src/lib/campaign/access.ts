import type { NextRequest } from "next/server";
import { identifyCaller, type Caller } from "@/lib/auth/service";
import { getCampaign } from "./queries";
import type { Campaign } from "./types";

/** Owners see their own campaigns; guests see theirs; cron sees all. */
export async function canSee(req: NextRequest, id: string): Promise<{ caller: Caller; camp: Campaign | null; ok: boolean }> {
  const caller = await identifyCaller(req);
  const camp = await getCampaign(id);
  if (!camp) return { caller, camp: null, ok: false };
  const ok = !!caller && (caller.kind === "cron" || (caller.kind === "owner" && camp.owner_email === caller.email && !camp.guest_id) || (caller.kind === "guest" && camp.guest_id === caller.id));
  return { caller, camp, ok };
}
