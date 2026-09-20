// Guest caps. Counted from the database so they survive restarts and multiple instances.
import { supabaseAdmin } from "@/lib/db/supabase";
import { ACTIVE_PHASES } from "./types";

export const GUEST_CONCURRENT = Number(process.env.GUEST_CONCURRENT ?? 2);
export const GUEST_PER_DAY = Number(process.env.GUEST_PER_DAY ?? 5);
export const GUEST_GLOBAL_PER_DAY = Number(process.env.GUEST_GLOBAL_PER_DAY ?? 20);

export async function guestCanLaunch(guestId: string): Promise<{ ok: boolean; reason?: string }> {
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { count: active } = await supabaseAdmin.from("campaigns").select("id", { count: "exact", head: true }).eq("guest_id", guestId).in("phase", ACTIVE_PHASES);
  if ((active ?? 0) >= GUEST_CONCURRENT) return { ok: false, reason: `You already have ${GUEST_CONCURRENT} demos running. Let one finish first.` };
  const { count: today } = await supabaseAdmin.from("campaigns").select("id", { count: "exact", head: true }).eq("guest_id", guestId).gte("created_at", dayStart.toISOString());
  if ((today ?? 0) >= GUEST_PER_DAY) return { ok: false, reason: `You have launched ${GUEST_PER_DAY} demos today. Come back tomorrow.` };
  const { count: global } = await supabaseAdmin.from("campaigns").select("id", { count: "exact", head: true }).not("guest_id", "is", null).gte("created_at", dayStart.toISOString());
  if ((global ?? 0) >= GUEST_GLOBAL_PER_DAY) return { ok: false, reason: "The public demo has hit today's global limit. Please try again tomorrow." };
  return { ok: true };
}
