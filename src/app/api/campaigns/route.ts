import { NextRequest, NextResponse } from "next/server";
import { identifyCaller, scopeOf } from "@/lib/auth/service";
import { supabaseAdmin } from "@/lib/db/supabase";
import { listCampaigns, recordEvent } from "@/lib/campaign/queries";
import { guestCanLaunch } from "@/lib/campaign/caps";
import { getUserEmailConfig } from "@/lib/db/queries";
import { json as nebiusJson, NebiusError } from "@/lib/ai/nebius";
import { withKeys, PLATFORM_KEY_FOR_OWNERS } from "@/lib/ai/context";
import { getOwnerKeys } from "@/lib/db/queries";
import { normalizePlan } from "@/lib/campaign/plan";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  return NextResponse.json(await listCampaigns(scopeOf(caller)));
}

export interface SeedContact { url: string; email?: string }
interface SetupBody { website_url: string; what_you_sell: string; keywords: string[]; desired_deals: number; budget_total: number; max_per_deal: number; demo_mode: boolean; name: string; seed_contacts: SeedContact[]; search_web: boolean }

/** "Publications you already know": a URL each, optionally with the editor's address. Real mode only. */
function parseSeeds(raw: unknown): { ok: true; seeds: SeedContact[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, seeds: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "seed_contacts must be a list" };
  const seeds: SeedContact[] = [];
  for (const item of raw.slice(0, 50)) {
    const u = String((item as any)?.url ?? "").trim();
    if (!u) continue;
    let url: URL;
    try { url = new URL(u.startsWith("http") ? u : `https://${u}`); } catch { return { ok: false, error: `Not a valid publication URL: ${u}` }; }
    if (!url.hostname.includes(".")) return { ok: false, error: `Not a valid publication URL: ${u}` };
    const email = String((item as any)?.email ?? "").trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: `Not a valid editor email: ${email}` };
    seeds.push(email ? { url: url.toString(), email } : { url: url.toString() });
  }
  return { ok: true, seeds };
}

function validate(b: any): { ok: true; v: SetupBody } | { ok: false; error: string } {
  const raw = String(b?.website_url ?? "").trim();
  const url = raw.startsWith("http") ? raw : `https://${raw}`;
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return { ok: false, error: "Enter a valid website URL." }; }
  if (!host.includes(".")) return { ok: false, error: "Enter a valid website URL." };
  const what = String(b?.what_you_sell ?? "").trim();
  if (what.length < 4) return { ok: false, error: "Tell us what you sell in one line." };
  const kws = Array.isArray(b?.keywords) ? b.keywords.map((k: unknown) => String(k).trim()).filter(Boolean) : [];
  if (kws.length < 3 || kws.length > 5) return { ok: false, error: "Give 3 to 5 keywords." };
  const deals = Number(b?.desired_deals), budget = Number(b?.budget_total), max = Number(b?.max_per_deal);
  if (!(deals >= 1 && deals <= 20)) return { ok: false, error: "Placements must be between 1 and 20." };
  if (!(budget >= 50 && budget <= 100000)) return { ok: false, error: "Budget must be between $50 and $100,000." };
  if (!(max >= 10 && max <= budget)) return { ok: false, error: "Max per placement must be at least $10 and no more than the total budget." };
  const seeds = parseSeeds(b?.seed_contacts);
  if (!seeds.ok) return seeds;
  return { ok: true, v: { website_url: url, what_you_sell: what, keywords: kws, desired_deals: deals, budget_total: budget, max_per_deal: max, demo_mode: b?.demo_mode !== false, name: String(b?.name ?? "").trim() || host, seed_contacts: b?.demo_mode !== false ? [] : seeds.seeds, search_web: b?.demo_mode !== false ? true : b?.search_web !== false } };
}

const PLAN_SCHEMA = { name: "plan", schema: { type: "object", properties: { plan: { type: "string" } }, required: ["plan"], additionalProperties: false } };
const isPlan = (x: unknown): x is { plan: string } => typeof (x as any)?.plan === "string" && (x as any).plan.length > 40;

/** POST /api/campaigns — create + start. POST ?preview=1 — the plain-English plan, nothing written. */
export async function POST(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (!caller || caller.kind === "cron") return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const r = validate(body);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  const v = r.v;
  const isGuest = caller.kind === "guest";
  if (isGuest && !v.demo_mode) return NextResponse.json({ error: "Guests can run demo campaigns only. Sign in as the owner to send real email." }, { status: 403 });
  const keys = await getOwnerKeys(caller.kind === "owner" ? caller.email : null);
  if (!v.demo_mode && caller.kind === "owner") {
    const cfg = await getUserEmailConfig(caller.email);
    if (!cfg.hasPassword) return NextResponse.json({ error: "Real mode needs a Gmail app password in Settings first." }, { status: 400 });
    if (!keys.nebius && !PLATFORM_KEY_FOR_OWNERS) return NextResponse.json({ error: "Real mode needs your Nebius Token Factory key in Settings first." }, { status: 400 });
    if (!keys.tavily && !process.env.TAVILY_API_KEY?.trim() && v.seed_contacts.length === 0) return NextResponse.json({ error: "Real mode needs a Tavily key in Settings, or at least one publication you already know." }, { status: 400 });
    if (!v.search_web && v.seed_contacts.length === 0) return NextResponse.json({ error: "List at least one publication, or allow searching the web." }, { status: 400 });
  }

  if (req.nextUrl.searchParams.get("preview") === "1") {
    try {
      const p = await withKeys(keys, () => nebiusJson<{ plan: string }>({
        role: "fast", thinking: false, max_tokens: 300, temperature: 0.3, schema: PLAN_SCHEMA, validate: isPlan,
        messages: [
          { role: "system", content: "You explain, in plain English and first person (\"I'll…\"), what an autonomous outreach agent is about to do for its owner. 3-4 sentences, no jargon, no markdown. JSON: {plan}." },
          { role: "user", content: `Product: ${v.what_you_sell} (${v.website_url}). Keywords: ${v.keywords.join(", ")}. Goal: ${v.desired_deals} placements. Budget: $${v.budget_total} total, at most $${v.max_per_deal} per placement. Mode: ${v.demo_mode ? "demo with simulated publications and editors" : "real email"}.${!v.demo_mode && v.seed_contacts.length ? ` Publications the owner already listed: ${v.seed_contacts.length}${v.search_web ? " (worked first, then web search)" : " — web search is OFF, so these are the only publications that will be evaluated and contacted; say so"}.` : ""}
Cover: ${v.seed_contacts.length && !v.search_web ? `working ONLY the ${v.seed_contacts.length} publication${v.seed_contacts.length === 1 ? "" : "s"} the owner listed (the owner turned web search off, so no other publication will be searched for or contacted), ` : v.seed_contacts.length ? `starting with the ${v.seed_contacts.length} publication${v.seed_contacts.length === 1 ? "" : "s"} the owner already named, then searching for publications about the keywords, ` : "searching for publications about the keywords, "}keeping those with topical fit and real authority (DR 50+), finding a human editor at each, emailing them, negotiating up to the per-placement cap, stopping at the goal or when the budget runs out, and asking the owner before anything unusual (calls, contracts, over-budget asks).` },
        ],
      }));
      let queries: string[] = [];
      try {
        const q = await withKeys(keys, () => nebiusJson<{ queries: string[] }>({
          role: "fast", thinking: false, max_tokens: 300, schema: { name: "queries", schema: { type: "object", properties: { queries: { type: "array", items: { type: "string" } } }, required: ["queries"], additionalProperties: false } }, validate: (x: unknown): x is { queries: string[] } => Array.isArray((x as any)?.queries),
          messages: [
            { role: "system", content: "You plan web-search queries that find editorial publications (blogs, magazines, roundups, reviews) where a product could be featured or linked. Output JSON only." },
            { role: "user", content: `Product: ${v.what_you_sell} (${v.website_url}). Keywords: ${v.keywords.join(", ")}. Return 6 diverse queries that would surface articles like "best X tools", "X roundup", "X review", "how to X" on real publications. No site: operators.` },
          ],
        }));
        queries = q.data.queries.map((s) => String(s).trim()).filter(Boolean).slice(0, 8);
      } catch { /* the plan still works without proposed angles; the Scout plans its own at run time */ }
      return NextResponse.json({ plan: p.data.plan, queries, model: p.meta.model, tokens: p.meta.tokens_in + p.meta.tokens_out, latency_ms: p.meta.latency_ms });
    } catch (e: any) {
      const kind = e instanceof NebiusError ? e.kind : "unknown";
      return NextResponse.json({ error: `Nebius Token Factory is not answering (${kind}): ${e?.message ?? e}`, kind }, { status: 503 });
    }
  }

  if (isGuest) { const g = await guestCanLaunch(caller.id); if (!g.ok) return NextResponse.json({ error: g.reason }, { status: 429 }); }
  const { data, error } = await supabaseAdmin.from("campaigns").insert({
    owner_email: caller.kind === "owner" ? caller.email : null, guest_id: isGuest ? caller.id : null,
    name: v.name, website_url: v.website_url, what_you_sell: v.what_you_sell, keywords: v.keywords, desired_deals: v.desired_deals,
    budget_total: v.budget_total, max_per_deal: v.max_per_deal, demo_mode: v.demo_mode, phase: "planning", plan_text: typeof body?.plan === "string" ? body.plan : null,
    seed_contacts: v.seed_contacts, search_web: v.search_web,
    plan: normalizePlan(body?.plan_settings), min_dr: normalizePlan(body?.plan_settings).min_dr ?? 50,
    next_tick_after: new Date().toISOString(),
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await recordEvent({ campaign_id: (data as any).id, agent: "you", action: "campaign_launched", engine: "system", human: `Launched: ${v.desired_deals} placement${v.desired_deals === 1 ? "" : "s"} about ${v.keywords.slice(0, 2).join(" / ")}, $${v.budget_total} budget${v.demo_mode ? " (demo)" : ""}` });
  return NextResponse.json(data, { status: 201 });
}
