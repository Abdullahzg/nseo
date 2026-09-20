// The campaign's tools: discover → qualify → resolve contact. Each is one bounded unit that the
// orchestrator can call, and each writes a human-readable event with the model metadata behind it.
//
// Honesty rules baked in here:
//   - relevance is ALWAYS a Nemotron judgment (never a keyword heuristic); if the model fails, the
//     prospect stays "discovered" and an error event is written
//   - DR is "measured" (Ahrefs), "fixture" (demo data, labelled), or "unverified" — never invented
//   - a score computed without authority data is stored as score_basis = "relevance_only"
import { supabaseAdmin } from "@/lib/db/supabase";
import { webSearch, searchProvider } from "@/lib/search/webSearch";
import { registrableDomain } from "@/lib/util/domain";
import { isSuppressed, upsertDomain, upsertAuthor, upsertContact, upsertArticle, linkArticleAuthor } from "@/lib/db/queries";
import { fetchPage } from "@/lib/extract/fetch";
import { extractMetadata, type ExtractedMeta } from "@/lib/extract/metadata";
import { extractReadability } from "@/lib/extract/readability";
import { fetchDomainRating } from "@/lib/enrich/domainRating";
import { maxOfferFor } from "@/lib/negotiation/pricing";
import { getNegotiationSettings } from "@/lib/negotiation/settings";
import { isRoleEmail } from "@/lib/email/roleEmail";
import { isPlaceholderEmail } from "@/lib/enrich/personFilter";
import { scrapePageSignals } from "@/lib/enrich/pageSignals";
import { resolveEmailCascade } from "@/lib/enrich/cascade";
import { json as nebiusJson, NebiusError } from "@/lib/ai/nebius";
import { getCampaign, updateProspect, getProspect, upsertProspect, recordEvent, listProspects } from "./queries";
import { DEMO_FIXTURES, demoContactFor } from "./demo";
import type { Campaign, Prospect, ScoreBreakdown } from "./types";

function hostOf(url: string): string {
  try { return registrableDomain(new URL(url).hostname.replace(/^www\./, "")); } catch { return ""; }
}

// ─── Discovery ───────────────────────────────────────────────────────────────

const QUERIES_SCHEMA = { name: "discovery_queries", schema: { type: "object", properties: { queries: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 10 } }, required: ["queries"], additionalProperties: false } };
const isQueries = (v: unknown): v is { queries: string[] } => Array.isArray((v as any)?.queries) && (v as any).queries.every((q: unknown) => typeof q === "string" && q.trim().length > 3);

/** Nano plans fresh search angles from the keywords, avoiding ones already used. */
export async function planDiscoveryQueries(camp: Campaign): Promise<{ queries: string[] }> {
  const { data: prior } = await supabaseAdmin.from("campaign_prospects").select("provenance").eq("campaign_id", camp.id).limit(500);
  const used = [...new Set(((prior ?? []) as any[]).map((r) => r.provenance?.query).filter(Boolean))] as string[];
  const r = await nebiusJson<{ queries: string[] }>({
    role: "fast", thinking: false, max_tokens: 400, schema: QUERIES_SCHEMA, validate: isQueries,
    messages: [
      { role: "system", content: "You plan web-search queries that find editorial publications (blogs, magazines, roundups, reviews) where a product could be featured or linked. Output JSON only." },
      { role: "user", content: `Product: ${camp.what_you_sell ?? camp.name} (${camp.website_url ?? "no url"})
Keywords: ${camp.keywords.join(", ")}
Already searched (do not repeat): ${used.slice(-20).join(" | ") || "none"}
Return 6 diverse queries that would surface articles like "best X tools", "X roundup", "X review", "how to X" on real publications. No site: operators.` },
    ],
  });
  const queries = r.data.queries.map((q) => q.trim()).filter(Boolean).slice(0, 8);
  await recordEvent({ campaign_id: camp.id, agent: "strategy", action: "plan_queries", engine: "model", llm: r.meta, human: `Planned ${queries.length} search angles: ${queries.slice(0, 3).map((q) => `“${q}”`).join(", ")}${queries.length > 3 ? "…" : ""}`, detail: { queries, avoided: used.length } });
  return { queries };
}

export interface DiscoverResult { found: number; created: number; duplicates: number; suppressed: number; provider: string }

export async function discoverBatch(camp: Campaign, queries: string[], maxPerQuery = 8): Promise<DiscoverResult> {
  if (camp.demo_mode) return discoverFixtures(camp);
  const { data: existing } = await supabaseAdmin.from("campaign_prospects").select("domain_host").eq("campaign_id", camp.id);
  const known = new Set(((existing ?? []) as any[]).map((r) => r.domain_host));

  // Publications the owner already knows come first — no search credit spent, no model call to find them.
  const seeded = await loadSeeds(camp, known);
  const provider = camp.search_web === false ? null : searchProvider();
  if (!provider) {
    if (seeded > 0 || (camp.seed_contacts?.length ?? 0) > 0) return { found: seeded, created: seeded, duplicates: 0, suppressed: 0, provider: "seed" };
    throw new Error("No search provider: add a Tavily key in Settings, or list publications you already know");
  }
  const res: DiscoverResult = { found: seeded, created: seeded, duplicates: 0, suppressed: 0, provider };
  const errors: string[] = [];
  for (const query of queries.slice(0, 6)) {
    const t0 = Date.now();
    const hits = await webSearch(query, maxPerQuery, undefined, (m) => errors.push(m));
    res.found += hits.length;
    let createdForQuery = 0;
    for (let i = 0; i < hits.length; i++) {
      const host = hostOf(hits[i].url);
      if (!host || !host.includes(".")) continue;
      if (known.has(host)) { res.duplicates++; continue; }
      if (await isSuppressed(host)) { res.suppressed++; continue; }
      const { id, created } = await upsertProspect({ campaign_id: camp.id, domain_host: host, prospect_url: hits[i].url, title: hits[i].title || null, provenance: { source: `websearch:${provider}`, query, position: i + 1, discovered_at: new Date().toISOString() } });
      if (created) {
        known.add(host); res.created++; createdForQuery++;
        await recordEvent({ campaign_id: camp.id, agent: "discovery", action: "prospect_found", engine: "system", prospect_id: id, human: `Found ${host} — “${(hits[i].title || hits[i].url).slice(0, 70)}” (via ${provider}, query “${query}”)`, detail: { host, url: hits[i].url, query, position: i + 1 } });
      } else res.duplicates++;
    }
    await recordEvent({ campaign_id: camp.id, agent: "discovery", action: "search_batch", engine: "system", human: `Searched ${provider} for “${query}” — ${hits.length} results, ${createdForQuery} new publications`, detail: { query, hits: hits.length, created: createdForQuery, duration_ms: Date.now() - t0, errors } });
  }
  if (res.found === 0 && errors.length) throw new Error(`Search failed: ${errors[0]}`);
  return res;
}

/** Owner-supplied publications → prospects with provenance "seed". Returns how many were new. */
async function loadSeeds(camp: Campaign, known: Set<string>): Promise<number> {
  let created = 0;
  for (let i = 0; i < (camp.seed_contacts ?? []).length; i++) {
    const seed = camp.seed_contacts[i];
    const host = hostOf(seed.url);
    if (!host || known.has(host)) continue;
    const { id, created: isNew } = await upsertProspect({ campaign_id: camp.id, domain_host: host, prospect_url: seed.url, title: null, provenance: { source: "seed", query: "provided by owner", position: i + 1, discovered_at: new Date().toISOString() } });
    if (!isNew) continue;
    known.add(host); created++;
    await recordEvent({ campaign_id: camp.id, agent: "discovery", action: "prospect_found", engine: "system", prospect_id: id, human: `Added ${host} — a publication you named${seed.email ? " (with the editor's address)" : ""}`, detail: { host, url: seed.url, seed: true, has_email: !!seed.email } });
  }
  if (created) await recordEvent({ campaign_id: camp.id, agent: "discovery", action: "search_batch", engine: "system", human: `Loaded ${created} publication${created === 1 ? "" : "s"} you already know — they are evaluated like any other`, detail: { seed: true, created } });
  return created;
}

async function discoverFixtures(camp: Campaign): Promise<DiscoverResult> {
  const { data: existing } = await supabaseAdmin.from("campaign_prospects").select("domain_host").eq("campaign_id", camp.id);
  const known = new Set(((existing ?? []) as any[]).map((r) => r.domain_host));
  const res: DiscoverResult = { found: DEMO_FIXTURES.length, created: 0, duplicates: 0, suppressed: 0, provider: "demo-fixture" };
  for (let i = 0; i < DEMO_FIXTURES.length; i++) {
    const f = DEMO_FIXTURES[i];
    if (known.has(f.host)) { res.duplicates++; continue; }
    const { id, created } = await upsertProspect({ campaign_id: camp.id, domain_host: f.host, prospect_url: f.url, title: f.title, provenance: { source: "demo-fixture", query: "demo scenario", position: i + 1, discovered_at: new Date().toISOString(), synthetic: true } });
    if (created) { res.created++; await recordEvent({ campaign_id: camp.id, agent: "discovery", action: "prospect_found", engine: "fixture", prospect_id: id, human: `Found ${f.host} — “${f.title}” (demo fixture)`, detail: { host: f.host, synthetic: true } }); }
    else res.duplicates++;
  }
  await recordEvent({ campaign_id: camp.id, agent: "discovery", action: "search_batch", engine: "fixture", human: `Loaded ${res.created} demo publications (fixture data — every judgment on them is a real model call)`, detail: { synthetic: true, created: res.created } });
  return res;
}

// ─── Qualification ───────────────────────────────────────────────────────────

interface RelevanceVerdict { relevance_0_100: number; why_fit: string; placement_angle: string; spam_risk: "low" | "medium" | "high"; is_editorial: boolean }
const RELEVANCE_SCHEMA = { name: "relevance_verdict", schema: { type: "object", properties: { relevance_0_100: { type: "integer", minimum: 0, maximum: 100 }, why_fit: { type: "string" }, placement_angle: { type: "string" }, spam_risk: { type: "string", enum: ["low", "medium", "high"] }, is_editorial: { type: "boolean" } }, required: ["relevance_0_100", "why_fit", "placement_angle", "spam_risk", "is_editorial"], additionalProperties: false } };
const isRelevance = (v: unknown): v is RelevanceVerdict => { const o = v as any; return !!o && Number.isFinite(o.relevance_0_100) && typeof o.why_fit === "string" && ["low", "medium", "high"].includes(o.spam_risk) && typeof o.is_editorial === "boolean"; };

export interface EvaluateResult { prospect_id: string; qualified: boolean; score: number; score_basis: "full" | "relevance_only"; reason: string }

export async function evaluateProspect(prospectId: string): Promise<EvaluateResult> {
  const p = await getProspect(prospectId);
  if (!p) throw new Error("prospect not found");
  const camp = await getCampaign(p.campaign_id);
  if (!camp) throw new Error("campaign not found");
  const fixture = DEMO_FIXTURES.find((f) => f.host === p.domain_host);

  // 1) Article text (plain fetch). Fixtures have .invalid URLs, so the model judges the title + blurb.
  let text = fixture?.blurb ?? "";
  let title = p.title ?? "";
  let meta: ExtractedMeta = {};
  if (!fixture && p.prospect_url) {
    const page = await fetchPage(p.prospect_url).catch(() => null);
    if (page?.html) {
      meta = extractMetadata(page.html, page.finalUrl);
      const rdy = await extractReadability(page.html, page.finalUrl).catch(() => null);
      text = (rdy?.textContent ?? "").slice(0, 5000);
      title = rdy?.title || meta.title || title;
    }
  }

  // 2) Authority: measured, fixture, or unverified — the source travels with the number.
  let dr: number | null = null;
  let drSource = "unverified";
  if (fixture) { dr = fixture.dr; drSource = "fixture"; }
  else if (process.env.AHREFS_API_KEY) {
    const r = await fetchDomainRating(p.domain_host).catch(() => null);
    if (r && typeof r.dr === "number") { dr = r.dr; drSource = `measured:${r.source}`; await upsertDomain(p.domain_host, { dr: r.dr, dr_checked_at: new Date().toISOString(), metrics_source: r.source } as any).catch(() => {}); }
  }

  // 3) MODEL: relevance. Throws on failure — there is no keyword fallback.
  const r = await nebiusJson<RelevanceVerdict>({
    role: "fast", thinking: false, max_tokens: 600, schema: RELEVANCE_SCHEMA, validate: isRelevance,
    messages: [
      { role: "system", content: "You evaluate whether a web article/publication is a good placement target for a product's SEO outreach. Judge editorial quality (real content vs link farm), topical fit, and realistic fit of the product. JSON only." },
      { role: "user", content: `Product: ${camp.what_you_sell ?? camp.name} (${camp.website_url ?? ""})
Target keywords: ${camp.keywords.join(", ")}
Publication: ${p.domain_host}
Article title: ${title || "(unknown)"}
Article excerpt:
"""${(text || title).slice(0, 3000)}"""
Return: relevance_0_100 (int), why_fit (<=25 words), placement_angle (<=15 words), spam_risk, is_editorial.` },
    ],
  });
  const v = r.data;
  const relevance = Math.max(0, Math.min(100, Math.round(v.relevance_0_100)));

  // 4) CODE: gates and score. Unverified authority never fails a gate; it changes the score basis.
  const drPass = dr == null ? null : dr >= camp.min_dr;
  const relevancePass = relevance >= 40;
  const editorialPass = v.is_editorial && v.spam_risk !== "high";
  const qualified = drPass !== false && relevancePass && editorialPass;
  const score_basis: "full" | "relevance_only" = dr == null ? "relevance_only" : "full";
  const score = score_basis === "full" ? Math.round(0.45 * relevance + 0.55 * Math.min(100, dr!)) : relevance;

  const settings = await getNegotiationSettings();
  const tier = maxOfferFor(dr, null, null, settings.pricing_rules);
  const ceiling = tier && camp.max_per_deal != null ? Math.min(tier.offer, Number(camp.max_per_deal)) : tier ? tier.offer : camp.max_per_deal != null ? Number(camp.max_per_deal) : null;

  const breakdown: ScoreBreakdown = {
    authority: { value: dr, source: drSource },
    relevance: { value: relevance, source: "model", model: r.meta.model },
    traffic: { value: null, source: "unverified" },
    spam_risk: { level: v.spam_risk, source: "model" },
    fair_value_range: ceiling != null ? [Math.round(ceiling * 0.6), ceiling] : null,
  };
  const checks = [
    { label: `DR ≥ ${camp.min_dr}`, state: (drPass == null ? "unverified" : drPass ? "pass" : "fail") as "pass" | "fail" | "unverified" },
    { label: "Topical fit", state: (relevancePass ? "pass" : "fail") as "pass" | "fail" | "unverified" },
    { label: "Editorial (not a link farm)", state: (editorialPass ? "pass" : "fail") as "pass" | "fail" | "unverified" },
  ];
  const reason = qualified
    ? `${v.why_fit}${dr == null ? " (authority unverified — relevance only)" : ""}`
    : drPass === false ? `DR ${dr}, below your floor of ${camp.min_dr}` : !relevancePass ? `relevance ${relevance}/100 — ${v.why_fit}` : `${v.spam_risk}-risk / non-editorial — ${v.why_fit}`;

  await updateProspect(prospectId, {
    status: qualified ? "qualified" : "rejected", opportunity_score: score, score_basis, score_breakdown: breakdown, ceiling,
    qualification: { checks, title, why_fit: v.why_fit, placement_angle: v.placement_angle, is_editorial: v.is_editorial, article_author: meta.author ?? null },
  });
  if (qualified) await ensureProspectAuthor({ ...p, qualification: { checks, article_author: meta.author ?? null } }).catch(() => {});

  const drText = dr == null ? "DR unverified" : `DR ${dr}${drSource === "fixture" ? " (fixture)" : ""}`;
  await recordEvent({
    campaign_id: camp.id, agent: "qualification", action: qualified ? "prospect_qualified" : "prospect_rejected", engine: "model", llm: r.meta, prospect_id: prospectId,
    human: qualified ? `Qualified ${p.domain_host} — relevance ${relevance}/100, ${drText}. ${v.why_fit}` : `Rejected ${p.domain_host} — ${reason}`,
    detail: { score, score_basis, relevance, dr, dr_source: drSource, ceiling, checks, placement_angle: v.placement_angle, spam_risk: v.spam_risk },
  });
  return { prospect_id: prospectId, qualified, score, score_basis, reason };
}

// ─── Contact resolution ──────────────────────────────────────────────────────

/** Every prospect gets a real authors row so threading/inbox/enrichment key on author_id. */
export async function ensureProspectAuthor(p: Prospect): Promise<string> {
  if (p.author_id) return p.author_id;
  const dom = await upsertDomain(p.domain_host, { name: p.domain_host } as any);
  const byline = (p.qualification?.article_author ?? "").trim();
  const fullName = byline && !isRoleEmail(byline) ? byline : `${p.domain_host.replace(/^www\./, "")} Editorial`;
  const author = await upsertAuthor({ full_name: fullName, primary_domain_id: dom.id, source: "campaign" } as any);
  await updateProspect(p.id, { author_id: author.id });
  if (p.prospect_url) {
    const article = await upsertArticle({ url_canonical: p.prospect_url, title: p.title ?? undefined, domain_id: dom.id } as any).catch(() => null);
    if (article) await linkArticleAuthor(article.id, author.id).catch(() => {});
  }
  return author.id;
}

export interface ContactResult { ok: boolean; email?: string; name?: string | null; source?: string; confidence?: number; steps: string[] }

export async function resolveContactForProspect(prospectId: string): Promise<ContactResult> {
  let p = await getProspect(prospectId);
  if (!p) throw new Error("prospect not found");
  const camp = await getCampaign(p.campaign_id);
  if (!camp) throw new Error("campaign not found");
  const steps: string[] = [];
  await updateProspect(prospectId, { status: "resolving_contact" });
  try {
    const authorId = await ensureProspectAuthor(p);
    p = (await getProspect(prospectId)) ?? p;
    let result: ContactResult | null = null;

    const host = p.domain_host;
    const seedEmail = (camp.seed_contacts ?? []).find((s) => hostOf(s.url) === host && s.email)?.email ?? null;
    if (camp.demo_mode) {
      const c = demoContactFor(p.domain_host);
      steps.push("demo: simulated editor assigned (a fixture has no real address)");
      result = { ok: true, email: c.email, name: c.name, source: "demo-simulated", confidence: 100, steps };
    } else if (seedEmail) {
      steps.push("address provided by the owner at setup");
      result = { ok: true, email: seedEmail, name: null, source: "provided", confidence: 100, steps };
    } else {
      const { data: author } = await supabaseAdmin.from("authors").select("id, full_name").eq("id", authorId).maybeSingle();
      const cascade = author ? await resolveEmailCascade(
        { id: (author as any).id, name: (author as any).full_name, host: p.domain_host, publication: p.domain_host },
        { onStep: (s) => steps.push(s), patternCache: new Map(), hunterDomains: new Map(), domainVerify: new Map() },
      ).catch((e: any) => { steps.push(`cascade error: ${e?.message}`); return null; }) : null;
      if (cascade) result = { ok: true, email: cascade.email, name: cascade.ownerName ?? null, source: cascade.source, confidence: cascade.score ?? 60, steps };
      if (!result) {
        for (const url of [`https://${p.domain_host}/contact`, `https://${p.domain_host}/about`, `https://${p.domain_host}`]) {
          const sig = await Promise.race([scrapePageSignals(url).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
          const em = sig?.emails.find((e) => !isRoleEmail(e) && !isPlaceholderEmail(e));
          if (em) { steps.push(`found ${em} on ${new URL(url).pathname || "/"}`); result = { ok: true, email: em, source: "page-scrape", confidence: 90, steps }; break; }
        }
      }
    }

    if (result?.ok && result.email && (result.source === "provided" || (!isRoleEmail(result.email) && !isPlaceholderEmail(result.email)))) {
      await upsertContact({ author_id: authorId, type: "mailto", value: `mailto:${result.email}`, confidence: Math.min(1, (result.confidence ?? 60) / 100), source: result.source ?? "campaign" } as any).catch(() => {});
      await updateProspect(prospectId, { status: "ready", contact_email: result.email, contact_name: result.name ?? null, contact_source: result.source, contact_confidence: result.confidence ?? null });
      await recordEvent({ campaign_id: camp.id, agent: "contact", action: "contact_resolved", engine: camp.demo_mode ? "fixture" : "system", prospect_id: prospectId, human: `Found ${result.name ? `${result.name} ` : "an editor "}at ${p.domain_host}${camp.demo_mode ? " (simulated)" : ` via ${result.source}`}`, detail: { source: result.source, confidence: result.confidence, steps } });
      return result;
    }
    await updateProspect(prospectId, { status: "qualified", contact_attempts: (p.contact_attempts ?? 0) + 1 });
    await recordEvent({ campaign_id: camp.id, agent: "contact", action: "contact_missing", engine: "system", level: "warn", prospect_id: prospectId, human: `No verifiable editor address at ${p.domain_host} yet (attempt ${(p.contact_attempts ?? 0) + 1} of 3)`, detail: { steps } });
    return { ok: false, steps: [...steps, "no usable contact found"] };
  } catch (e: any) {
    await updateProspect(prospectId, { status: "qualified", contact_attempts: (p.contact_attempts ?? 0) + 1 }).catch(() => {});
    throw e;
  }
}

/** Batch helpers used by the orchestrator. Each stops at `limit` and reports what it did. */
export async function qualifyBatch(camp: Campaign, limit: number): Promise<{ evaluated: number; qualified: number; errors: string[] }> {
  const pending = await listProspects(camp.id, "discovered", limit);
  const out = { evaluated: 0, qualified: 0, errors: [] as string[] };
  for (const p of pending) {
    try { const r = await evaluateProspect(p.id); out.evaluated++; if (r.qualified) out.qualified++; }
    catch (e: any) {
      out.errors.push(e?.message ?? String(e));
      await recordEvent({ campaign_id: camp.id, agent: "qualification", action: "qualification_error", engine: "system", level: "error", prospect_id: p.id, human: `Could not evaluate ${p.domain_host}: ${e?.message ?? e}`, detail: { kind: e instanceof NebiusError ? e.kind : "unknown" } });
      if (e instanceof NebiusError && (e.kind === "auth" || e.kind === "not_configured" || e.kind === "budget")) throw e;
    }
  }
  return out;
}

export async function contactBatch(camp: Campaign, limit: number): Promise<{ attempted: number; found: number }> {
  const qualified = (await listProspects(camp.id, "qualified", 50)).filter((x) => (x.contact_attempts ?? 0) < 3).slice(0, limit);
  const out = { attempted: 0, found: 0 };
  for (const p of qualified) {
    out.attempted++;
    try { const r = await resolveContactForProspect(p.id); if (r.ok) out.found++; }
    catch (e: any) { await recordEvent({ campaign_id: camp.id, agent: "contact", action: "contact_error", engine: "system", level: "error", prospect_id: p.id, human: `Contact lookup failed for ${p.domain_host}: ${e?.message ?? e}` }); }
  }
  return out;
}
