// Agentic tool implementations (new hackathon work).
//
// Each function here is one TOOL the ADK agent service (or the UI) can invoke via
// /api/agent/*. They orchestrate proven legacy machinery — they never reimplement it:
//   discovery      → search/webSearch.ts + campaign dedupe/canonicalization
//   qualification  → score/qualify.ts gates + negotiation/pricing tiers + Gemini semantics
//   contact intel  → enrich/cascade.ts (full author cascade or domain-level mini-cascade)
//   outreach       → outreach_emails rows consumed by the guarded burst processor
//   negotiation    → negotiation/run.ts negotiateThread() (classify→HITL→draft→clamp→send)
//
// Deterministic money math and safety gates stay in code. Gemini only does semantic work.
import { supabaseAdmin } from "@/lib/db/supabase";
import { webSearch, searchProvider } from "@/lib/search/webSearch";
import { registrableDomain } from "@/lib/util/domain";
import { isSuppressed, upsertDomain, upsertAuthor, upsertContact, upsertArticle, linkArticleAuthor } from "@/lib/db/queries";
import { generateDiscoveryQueries } from "@/lib/pipeline/queries";
import { fetchPage } from "@/lib/extract/fetch";
import { extractMetadata, type ExtractedMeta } from "@/lib/extract/metadata";
import { extractReadability } from "@/lib/extract/readability";
import { fetchDomainRating } from "@/lib/enrich/domainRating";
import { qualifyProspect, DR_MIN } from "@/lib/score/qualify";
import { maxOfferFor } from "@/lib/negotiation/pricing";
import { getNegotiationSettings } from "@/lib/negotiation/settings";
import { sanitizeBody } from "@/lib/negotiation/agent";
import { isRoleEmail } from "@/lib/email/roleEmail";
import { isPlaceholderEmail } from "@/lib/enrich/personFilter";
import { scrapePageSignals } from "@/lib/enrich/pageSignals";
import { aiScrapeEmail, aiScrapeEnabled } from "@/lib/enrich/aiScrape";
import { domainSearchHunter, hunterEnabled, pickFromDomainSearch } from "@/lib/enrich/hunter";
import { resolveEmailCascade } from "@/lib/enrich/cascade";
import { llmJson } from "@/lib/ai/gemini";
import {
  getCampaignRow, updateProspect, getProspect, setProspectEvaluation,
  upsertCampaignProspect, recordAgentEvent,
} from "./queries";
import type { ScoreBreakdown, DiscoveryProvenance, AgentEventInput } from "./types";

// ─── shared helpers ───────────────────────────────────────────────────────────

export async function emitEvent(
  campaignId: string | null | undefined,
  agent: string,
  action: string,
  extra: Partial<AgentEventInput> = {}
): Promise<void> {
  await recordAgentEvent({ campaign_id: campaignId ?? null, agent, action, ...extra }).catch(() => {});
}

function hostOf(url: string): string {
  try {
    return registrableDomain(new URL(url).hostname.replace(/^www\./, ""));
  } catch {
    return "";
  }
}

async function campaignExclusions(campaignId: string): Promise<{ excluded: Set<string>; knownHosts: Set<string> }> {
  const camp = await getCampaignRow(campaignId);
  const excluded = new Set<string>(
    ((camp?.excluded_domains ?? []) as string[]).map((d) => d.toLowerCase().replace(/^www\./, ""))
  );
  const { data: existing } = await supabaseAdmin
    .from("campaign_prospects").select("domain_host").eq("campaign_id", campaignId);
  const knownHosts = new Set(((existing ?? []) as any[]).map((r) => r.domain_host));
  return { excluded, knownHosts };
}

// ─── discovery ────────────────────────────────────────────────────────────────

/** Strategy: fresh, diverse search queries for this campaign's keywords/angle. */
export async function planDiscoveryQueries(campaignId: string): Promise<{ queries: string[]; provider: string }> {
  const camp = await getCampaignRow(campaignId);
  if (!camp) throw new Error("campaign not found");
  const keywords = (camp.keywords ?? []) as string[];
  // Avoid repeating angles we already searched (provenance of past prospects).
  const { data: prior } = await supabaseAdmin
    .from("campaign_prospects")
    .select("provenance")
    .eq("campaign_id", campaignId)
    .limit(500);
  const used = ((prior ?? []) as any[])
    .map((r) => r.provenance?.query).filter(Boolean) as string[];
  const out = await generateDiscoveryQueries([], [...new Set(used)], keywords.length ? keywords : undefined);
  await emitEvent(campaignId, "strategy", "plan_queries", {
    detail: { count: out.length, provider: llmProviderName(), keywords },
    tool: "generateDiscoveryQueries",
  });
  return { queries: out, provider: llmProviderName() };
}

function llmProviderName(): string {
  // Local import avoidance: read env directly to label provenance.
  return process.env.GEMINI_API_KEY ? "gemini" : process.env.OPENROUTER_API_KEY ? "openrouter" : "heuristic-fallback";
}

export interface DiscoverBatchResult {
  found: number;
  created: number;
  duplicates: number;
  suppressed: number;
  per_query: Array<{ query: string; hits: number; created: number }>;
}

/** Run a batch of queries through the live search provider; persist new prospects. */
export async function discoverBatch(
  campaignId: string,
  queries: string[],
  opts: { maxPerQuery?: number } = {}
): Promise<DiscoverBatchResult> {
  const maxPerQuery = opts.maxPerQuery ?? 8;
  const provider = searchProvider();
  const { excluded, knownHosts } = await campaignExclusions(campaignId);
  const res: DiscoverBatchResult = { found: 0, created: 0, duplicates: 0, suppressed: 0, per_query: [] };

  for (const query of queries.slice(0, 30)) {
    const t0 = Date.now();
    const hits = provider ? await webSearch(query, maxPerQuery) : [];
    let createdForQuery = 0;
    res.found += hits.length;
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      const host = hostOf(hit.url);
      if (!host || !host.includes(".")) continue;
      if (excluded.has(host)) { continue; }
      if (knownHosts.has(host)) { res.duplicates++; continue; }
      if (await isSuppressed(host)) { res.suppressed++; continue; }
      const prov: DiscoveryProvenance = {
        source: provider ? `websearch:${provider}` : "none",
        query,
        position: i + 1,
        discovered_at: new Date().toISOString(),
      };
      const { id, created } = await upsertCampaignProspect({
        campaign_id: campaignId,
        domain_host: host,
        prospect_url: hit.url,
        title: hit.title || null,
        provenance: prov,
      });
      if (created) {
        knownHosts.add(host);
        res.created++;
        createdForQuery++;
        await emitEvent(campaignId, "discovery", "prospect_found", {
          prospect_id: id,
          detail: { host, title: hit.title, query, position: i + 1 },
        });
      } else {
        res.duplicates++;
      }
    }
    res.per_query.push({ query, hits: hits.length, created: createdForQuery });
    await emitEvent(campaignId, "discovery", "search_batch", {
      tool: `webSearch:${provider ?? "none"}`,
      duration_ms: Date.now() - t0,
      detail: { query, hits: hits.length, created: createdForQuery },
    });
  }
  return res;
}

// ─── qualification & valuation ────────────────────────────────────────────────

interface RelevanceVerdict {
  relevance_0_100: number;
  why_fit: string;
  placement_angle: string;
  spam_risk: "low" | "medium" | "high";
  is_editorial: boolean;
}

function isRelevance(v: unknown): v is RelevanceVerdict {
  const o = v as any;
  return o && typeof o.relevance_0_100 === "number" && typeof o.why_fit === "string";
}

/** Heuristic relevance fallback when no LLM key: keyword overlap against page text. */
function heuristicRelevance(text: string, title: string, keywords: string[]): number {
  const hay = `${title}\n${text}`.toLowerCase();
  if (!keywords.length) return 40;
  let score = 0;
  for (const kw of keywords) {
    const terms = kw.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
    const matched = terms.filter((t) => hay.includes(t)).length;
    if (matched > 0) score += Math.round((matched / Math.max(1, terms.length)) * 60);
  }
  return Math.min(100, score / Math.max(1, keywords.length) + 20);
}

export interface EvaluateResult {
  prospect_id: string;
  qualified: boolean;
  opportunity_score: number;
  breakdown: ScoreBreakdown;
  ceiling: number | null;
  checks: { label: string; state: "pass" | "fail" | "unverified" }[];
}

/** Article understanding + deterministic scoring + pricing ceiling for one prospect. */
export async function evaluateProspect(prospectId: string): Promise<EvaluateResult | null> {
  const p = await getProspect(prospectId);
  if (!p) return null;
  const camp = await getCampaignRow(p.campaign_id);
  const t0 = Date.now();

  // 1) Live article fetch + extraction (reuses pipeline fetch with Playwright fallback).
  let text = "";
  let title = p.title ?? "";
  let meta: ExtractedMeta = {};
  if (p.prospect_url) {
    const page = await fetchPage(p.prospect_url).catch(() => null);
    if (page?.html) {
      meta = extractMetadata(page.html, page.finalUrl);
      const rdy = await extractReadability(page.html, page.finalUrl).catch(() => null);
      text = (rdy?.textContent ?? "").slice(0, 6000);
      title = rdy?.title || meta.title || title;
    }
  }

  // 2) Domain metrics — measured Ahrefs DR when available; traffic stays unverified on free tier.
  const drRes = await fetchDomainRating(p.domain_host).catch(() => null);
  if (drRes) {
    await upsertDomain(p.domain_host, {
      dr: drRes.dr,
      dr_checked_at: new Date().toISOString(),
      metrics_source: drRes.source,
      name: meta.publisher,
    }).catch(() => {});
  }
  const { data: domRow } = await supabaseAdmin
    .from("domains").select("dr, organic_traffic, us_traffic_share").eq("host", p.domain_host).maybeSingle();
  const dr = (domRow as any)?.dr ?? drRes?.dr ?? null;

  // 3) Semantic relevance via Gemini (structured); deterministic fallback otherwise.
  const keywords = (camp?.keywords ?? []) as string[];
  const llmOut = await llmJson<RelevanceVerdict>(
    `You are evaluating whether a web article is a good placement target for an SEO outreach campaign.
Campaign website: ${camp?.website_url ?? "(unknown)"}
Campaign objective: ${camp?.objective ?? "acquire relevant editorial placements"}
Target keywords/topics: ${keywords.join(", ") || "(none given)"}
Article title: ${title}
Article excerpt:
"""${text.slice(0, 3000) || title}"""
Return ONLY JSON: {"relevance_0_100": <int>, "why_fit": "<=25 words why this site fits", "placement_angle": "<=15 words suggested angle", "spam_risk": "low"|"medium"|"high", "is_editorial": true|false}
Judge editorial quality (real content vs link farm), topical fit to the keywords, and realistic fit of the product.`,
    isRelevance,
    { maxTokens: 220, temperature: 0.2 }
  );
  const relevance = llmOut ? Math.max(0, Math.min(100, Math.round(llmOut.data.relevance_0_100))) : heuristicRelevance(text, title, keywords);

  // 4) Deterministic qualification gates (legacy rules; unverified ≠ fail).
  const qual = qualifyProspect({
    dr: typeof dr === "number" ? dr : null,
    organicTraffic: (domRow as any)?.organic_traffic ?? null,
    usTrafficShare: (domRow as any)?.us_traffic_share ?? null,
    relevance,
    mentionCount: 0,
    articleCount: 1,
    hasEmail: false,
    contactConfidence: 0,
  });

  // 5) Pricing ceiling from editable tiers (deterministic; null → placement-only).
  const settings = await getNegotiationSettings();
  const tier = maxOfferFor(typeof dr === "number" ? dr : null, (domRow as any)?.organic_traffic ?? null, (domRow as any)?.us_traffic_share ?? null, settings.pricing_rules);
  const campaignCeiling = camp?.max_per_deal != null ? Number(camp.max_per_deal) : null;
  const ceiling =
    tier && campaignCeiling != null ? Math.min(tier.offer, campaignCeiling)
    : tier ? tier.offer
    : campaignCeiling;

  // 6) Opportunity score — deterministic blend over present signals (explainable).
  const drScore = typeof dr === "number" ? Math.min(100, dr) : null;
  const reachProxy = 50; // unknown until contact resolution; re-weighted then
  const parts: Array<{ w: number; v: number }> = [];
  if (drScore != null) parts.push({ w: 0.4, v: drScore });
  parts.push({ w: 0.45, v: relevance });
  parts.push({ w: 0.15, v: reachProxy * (qual.trafficPass === false || qual.usPass === false ? 0.5 : 1) });
  const wsum = parts.reduce((s, x) => s + x.w, 0) || 1;
  const opportunity_score = Math.round(parts.reduce((s, x) => s + x.w * x.v, 0) / wsum);

  const breakdown: ScoreBreakdown = {
    authority: typeof dr === "number" ? { value: dr, source: drRes ? `measured:${drRes.source}` : "stored" } : { value: null, source: "unverified" },
    relevance: { value: relevance, source: llmOut ? (llmOut.provider === "gemini" ? "gemini" as const : "heuristic" as const) : "heuristic" },
    traffic: (domRow as any)?.organic_traffic != null ? { value: Number((domRow as any).organic_traffic), source: "measured" } : { value: null, source: "unverified (free Ahrefs plan)" },
    geographic: (domRow as any)?.us_traffic_share != null ? { value: Number((domRow as any).us_traffic_share), source: "measured" } : { value: null, source: "unverified" },
    contact_reachability: { value: 50, source: "pending contact resolution" },
    spam_risk: { level: llmOut?.data.spam_risk ?? "medium", source: llmOut ? llmOut.provider : "default" },
    fair_value_range: ceiling != null ? [Math.round((settings.min_price ?? 0) + (ceiling - (settings.min_price ?? 0)) * 0.6), ceiling] : null,
    provider_notes: [
      ...(llmOut ? [`why_fit: ${llmOut.data.why_fit}`, `angle: ${llmOut.data.placement_angle}`] : []),
    ],
  };

  await setProspectEvaluation(prospectId, {
    score: opportunity_score,
    breakdown,
    qualified: qual.qualified,
    qualification: {
      checks: qual.checks,
      fit: qual.fit,
      title,
      article_author: meta.author ?? null,
      published_at: meta.publishedAt ?? null,
      why_fit: llmOut?.data.why_fit ?? null,
      placement_angle: llmOut?.data.placement_angle ?? null,
      is_editorial: llmOut?.data.is_editorial ?? true,
    },
    ceiling,
  });

  // Qualified prospects immediately get their identity row (byline when the article had one)
  // so contact resolution and legacy threading work downstream.
  if (qual.qualified) {
    await ensureProspectAuthor({ ...p, qualification: { article_author: meta.author } }).catch(() => {});
  }

  await emitEvent(p.campaign_id, "qualification", qual.qualified ? "prospect_qualified" : "prospect_rejected", {
    prospect_id: prospectId,
    duration_ms: Date.now() - t0,
    detail: {
      host: p.domain_host, score: opportunity_score, relevance,
      dr_source: breakdown.authority?.source, ceiling,
      reason_code: qual.qualified ? "PASSES_GATES" : `FAILS:${qual.checks.filter((c) => c.state === "fail").map((c) => c.label).join(",")}`,
    },
  });

  return { prospect_id: prospectId, qualified: qual.qualified, opportunity_score, breakdown, ceiling, checks: qual.checks };
}

// ─── contact intelligence ─────────────────────────────────────────────────────

/**
 * Every campaign prospect gets a REAL authors row (byline when the article gave us one,
 * else the "{Domain} Editorial" pseudo-author convention used by the backlinks pipeline).
 * This is what lets the entire legacy machinery work unchanged: contact storage, SMTP/IMAP
 * threading, inbox grouping per author, reply attribution, and the enrichment cascade.
 */
export async function ensureProspectAuthor(prospect: any): Promise<string> {
  if (prospect.author_id) return prospect.author_id;
  const dom = await upsertDomain(prospect.domain_host, { name: prospect.domain_host });
  const byline = (prospect.qualification?.article_author ?? "").trim();
  const prettyHost = prospect.domain_host.replace(/^www\./, "");
  const fullName = byline && !isRoleEmail(byline) ? byline : `${prettyHost} Editorial`;
  const author = await upsertAuthor({
    full_name: fullName,
    primary_domain_id: dom.id,
    source: "agent-campaign",
  });
  await updateProspect(prospect.id, { author_id: author.id });
  // Link the discovered article to this author like the pipeline does.
  if (prospect.prospect_url) {
    const article = await upsertArticle({ url_canonical: prospect.prospect_url, title: prospect.title ?? undefined, domain_id: dom.id }).catch(() => null);
    if (article) await linkArticleAuthor(article.id, author.id).catch(() => {});
  }
  return author.id;
}

export interface ContactResolution {
  ok: boolean;
  email?: string;
  source?: string;
  confidence?: number;
  owner_name?: string | null;
  steps: string[];
}

/** Full cascade for authors, domain-level mini-cascade otherwise. Persists contacts rows. */
export async function resolveContactForProspect(prospectId: string): Promise<ContactResolution> {
  let p = await getProspect(prospectId);
  if (!p) return { ok: false, steps: ["prospect not found"] };
  const t0 = Date.now();
  const steps: string[] = [];
  await updateProspect(prospectId, { status: "resolving_contact" });

  const authorId = await ensureProspectAuthor(p).catch(() => null);
  p = (await getProspect(prospectId)) ?? p;

  let result: ContactResolution | null = null;

  if (authorId) {
    const { data: author } = await supabaseAdmin
      .from("authors").select("id, full_name").eq("id", authorId).maybeSingle();
    if (author) {
      const { data: dom } = await supabaseAdmin
        .from("domains").select("host, name").or(`host.eq.${p.domain_host},name.eq.${p.domain_host}`).limit(1).maybeSingle();
      const cascade = await resolveEmailCascade(
        { id: author.id, name: author.full_name, host: (dom as any)?.host ?? p.domain_host, publication: (dom as any)?.name ?? p.domain_host },
        {
          onStep: (s) => steps.push(s),
          patternCache: new Map(),
          hunterDomains: new Map(),
          domainVerify: new Map(),
        }
      ).catch(() => null);
      if (cascade) {
        result = { ok: true, email: cascade.email, source: cascade.source, confidence: cascade.score, owner_name: cascade.ownerName ?? null, steps };
      }
    }
  }

  if (!result) {
    result = await domainLevelContact(p.domain_host, steps);
  }

  if (result.ok && result.email && !isRoleEmail(result.email) && !isPlaceholderEmail(result.email)) {
    // Persist via the guarded upsert (rejects role mailboxes/placeholder junk at the DB boundary).
    if (!authorId) return { ...result, ok: false, steps: [...steps, "no author row to attach the contact to"] };
    await upsertContact({
      author_id: authorId,
      type: "mailto",
      value: result.email.startsWith("mailto:") ? result.email : `mailto:${result.email}`,
      confidence: Math.min(1, (result.confidence ?? 60) / 100),
      source: result.source ?? "agent-cascade",
    }).catch(() => {});
    await updateProspect(prospectId, {
      status: "ready",
      contact_email: result.email,
      contact_source: result.source,
      contact_confidence: result.confidence ?? null,
      notes: { contact_steps: steps },
    });
  } else {
    // No usable address: stay qualified but flagged — a later pass may find one (new article,
    // provider key added). Never park a qualified prospect as dead on a transient miss.
    await updateProspect(prospectId, {
      status: "qualified",
      notes: { contact_steps: steps, contact_failed: true },
    });
    result.ok = false;
    result.steps.push("no usable contact found");
  }

  await emitEvent(p.campaign_id, "contact_intel", result.ok ? "contact_resolved" : "contact_missing", {
    prospect_id: prospectId,
    duration_ms: Date.now() - t0,
    detail: { host: p.domain_host, source: result.source, confidence: result.confidence, email_domain: result.email?.split("@")[1], owner_name: result.owner_name },
  });
  return result;
}

/** Domain-level fallback: homepage+contact scrape → AI scan → Hunter domain search → tagged pattern guess. */
async function domainLevelContact(host: string, steps: string[]): Promise<ContactResolution> {
  for (const url of [`https://${host}/contact`, `https://${host}/about`, `https://${host}`]) {
    const sig = await scrapePageSignals(url).catch(() => null);
    const em = sig?.emails.find((e) => !isRoleEmail(e) && !isPlaceholderEmail(e));
    if (em) { steps.push(`found email on ${new URL(url).pathname}`); return { ok: true, email: em, source: "page-scrape", confidence: 90, steps }; }
  }
  if (aiScrapeEnabled()) {
    const em = await aiScrapeEmail("", host, () => {}).catch(() => null);
    if (em && !isRoleEmail(em) && !isPlaceholderEmail(em)) { steps.push("AI-scan found an address"); return { ok: true, email: em, source: "ai-scrape", confidence: 75, steps }; }
  }
  if (hunterEnabled()) {
    const ds = await domainSearchHunter(host).catch(() => null);
    if (ds) {
      const pick = pickFromDomainSearch(ds, "");
      if (pick && pick.person.type === "personal" && !isRoleEmail(pick.person.email)) {
        steps.push(`Hunter: contacting ${[pick.person.firstName, pick.person.lastName].filter(Boolean).join(" ")}`);
        return {
          ok: true,
          email: pick.person.email,
          source: "hunter-domain-alt",
          confidence: Math.min(75, pick.person.confidence),
          owner_name: [pick.person.firstName, pick.person.lastName].filter(Boolean).join(" ") || null,
          steps,
        };
      }
    }
  }
  steps.push("no sourced address; refusing an unverified guess");
  return { ok: false, steps };
}

export { DR_MIN };
