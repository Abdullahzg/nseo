// Tick economics: one tick at a time per campaign, hard daily caps, and a global Nebius token
// budget fed by every model call. On breach, campaigns pause with a reason the UI shows.
import { supabaseAdmin } from "@/lib/db/supabase";
import { NebiusError, setUsageSink, type LLMMeta } from "@/lib/ai/nebius";
import { getCampaign, updateCampaign, recordEvent } from "./queries";
import type { Campaign } from "./types";

export const TICKS_PER_CAMPAIGN_PER_DAY = Number(process.env.TICKS_PER_CAMPAIGN_PER_DAY ?? 120);
export const GUEST_MAX_TICKS = Number(process.env.GUEST_MAX_TICKS ?? 60);
export const NEBIUS_DAILY_TOKEN_BUDGET = Number(process.env.NEBIUS_DAILY_TOKEN_BUDGET ?? 2_000_000);
export const TICK_LOCK_SECONDS = 60;

const day = () => new Date().toISOString().slice(0, 10);

/** Postgres-side lock: the UPDATE only wins if the previous lock expired. */
export async function acquireTickLock(campaignId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("acquire_tick_lock", { p_campaign: campaignId, p_seconds: TICK_LOCK_SECONDS });
  if (error) throw new Error(`tick lock: ${error.message}`);
  return data === true;
}

export async function releaseTickLock(campaignId: string): Promise<void> {
  await supabaseAdmin.from("campaigns").update({ tick_lock_until: null }).eq("id", campaignId);
}

/** Per-campaign daily cap and guest lifetime cap. Returns the reason to stop, or null. */
export async function checkTickCaps(camp: Campaign): Promise<string | null> {
  const today = day();
  const ticksToday = camp.ticks_day === today ? camp.ticks_today : 0;
  if (ticksToday >= TICKS_PER_CAMPAIGN_PER_DAY) return `daily tick cap (${TICKS_PER_CAMPAIGN_PER_DAY}) reached — resumes tomorrow`;
  if (camp.guest_id && camp.tick_count >= GUEST_MAX_TICKS) return `demo limit of ${GUEST_MAX_TICKS} steps reached`;
  return null;
}

export async function bumpTickCounters(camp: Campaign): Promise<void> {
  const today = day();
  await updateCampaign(camp.id, { tick_count: (camp.tick_count ?? 0) + 1, ticks_today: camp.ticks_day === today ? (camp.ticks_today ?? 0) + 1 : 1, ticks_day: today, last_tick_at: new Date().toISOString() });
}

// ─── Global token budget ─────────────────────────────────────────────────────

export async function tokensUsedToday(): Promise<number> {
  const { data } = await supabaseAdmin.from("app_state").select("value").eq("key", `tokens:${day()}`).maybeSingle();
  return Number((data as any)?.value?.total ?? 0);
}

export async function addTokens(n: number): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("add_tokens", { p_key: `tokens:${day()}`, p_n: n });
  if (error) { console.error("[budget] add_tokens failed:", error.message); return 0; }
  return Number(data ?? 0);
}

/** Throws NebiusError("budget") when today's global allowance is spent. */
export async function assertTokenBudget(): Promise<{ used: number; budget: number }> {
  const used = await tokensUsedToday();
  if (used >= NEBIUS_DAILY_TOKEN_BUDGET) throw new NebiusError("budget", `Daily Nebius token budget reached (${used.toLocaleString()} of ${NEBIUS_DAILY_TOKEN_BUDGET.toLocaleString()})`);
  return { used, budget: NEBIUS_DAILY_TOKEN_BUDGET };
}

let sinkInstalled = false;
export function installUsageSink() {
  if (sinkInstalled) return;
  sinkInstalled = true;
  setUsageSink(async (m: LLMMeta) => { await addTokens((m.tokens_in ?? 0) + (m.tokens_out ?? 0)); });
}

/** Pause a campaign with a visible reason (budget, auth, cap). */
export async function pauseCampaign(campaignId: string, reason: string, kind: "budget" | "nebius" | "cap" | "user"): Promise<void> {
  await updateCampaign(campaignId, { paused: true, paused_reason: reason, paused_kind: kind });
  const camp = await getCampaign(campaignId);
  if (camp) await recordEvent({ campaign_id: campaignId, agent: "system", action: "campaign_paused", engine: "system", level: "warn", human: `Paused — ${reason}`, detail: { kind } });
}
