// GEO Citation Agent (#9). Runs buyer-intent prompts through the AI answer engines your
// customers actually use and measures where ImagineArt vs competitors appear + which sources
// each engine cites — turning "are we in the AI answers?" into a tracked, per-engine number.
//
// Engines (each lights up when its key is set; the report says honestly which ran):
//   • Perplexity   — Sonar via OPENROUTER_API_KEY (real inline citations)
//   • ChatGPT      — gpt-4o-mini-search-preview via OPENAI_API_KEY (web-search citations)
//   • Gemini       — gemini-2.5-flash + google_search grounding via GEMINI_API_KEY
//   • Google AIO   — Google's AI Overview / featured snippet via SERPER_API_KEY
// No fabrication: an engine with no key is reported as unavailable, and a prompt an engine
// didn't answer is not counted toward that engine's share of voice.
import PQueue from "p-queue";

import { logGeoChecks, getGeoHitRates } from "@/lib/db/queries";
import { llmChat, llmEnabled } from "./llm";
import type { GeoEngineId, GeoEngineStatus, GeoPromptResult, GeoReport } from "./types";

export const DEFAULT_PROMPTS = [
  "What is the best AI image generator?",
  "Best free AI image generator online",
  "Best AI video generator",
  "How can I swap faces in a video with AI?",
  "Best AI art generator for beginners",
  "Top text-to-image AI tools",
];

export const DEFAULT_COMPETITORS = [
  "Midjourney", "Leonardo", "Canva", "Runway", "Kling", "Pika", "Adobe Firefly", "DALL-E", "Ideogram",
];

const BRAND_ALIASES = ["imagineart", "imagine.art", "imagine art"];
// Hosts you can't realistically earn an editorial mention on — excluded from actionable gaps.
const NON_EDITORIAL = /(^|\.)(youtube|twitter|x|facebook|instagram|pinterest|tiktok|linkedin|reddit|quora|google|apple)\.com$/i;

function mentions(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle.toLowerCase());
}
function domainOf(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

interface EngineAnswer { content: string; citations: string[]; surface?: string }

// ── Engine adapters ─────────────────────────────────────────────────────────────
// Each returns the answer text + cited URLs, or null when the engine gave no usable answer.

async function askPerplexity(prompt: string, model: string): Promise<EngineAnswer | null> {
  const res = await llmChat({ model, prompt, maxTokens: 600, temperature: 0.2, timeoutMs: 30_000 });
  if (!res || !res.content) return null;
  return { content: res.content, citations: res.citations };
}

async function askChatGpt(prompt: string): Promise<EngineAnswer | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.length < 20) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // Search-preview models browse the web and return url_citation annotations. They don't
      // accept a temperature param, so we omit it.
      body: JSON.stringify({
        model: "gpt-4o-mini-search-preview",
        messages: [{ role: "user", content: prompt }],
        web_search_options: {},
        max_tokens: 700,
      }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const msg = data.choices?.[0]?.message ?? {};
    const content: string = msg.content ?? "";
    if (!content) return null;
    const citations: string[] = Array.isArray(msg.annotations)
      ? msg.annotations.map((a: any) => a?.url_citation?.url ?? a?.url).filter((u: unknown): u is string => typeof u === "string" && u.startsWith("http"))
      : [];
    return { content, citations };
  } catch {
    return null;
  }
}

async function askGemini(prompt: string): Promise<EngineAnswer | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.length < 20) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
        }),
        signal: AbortSignal.timeout(35_000),
      },
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const cand = data.candidates?.[0];
    const content: string = (cand?.content?.parts ?? []).map((p: any) => p?.text).filter(Boolean).join(" ");
    if (!content) return null;
    // Grounding chunks carry the real source domain in web.title; web.uri is a Google redirect,
    // so prefer the title when it's domain-shaped.
    const chunks: any[] = cand?.groundingMetadata?.groundingChunks ?? [];
    const citations: string[] = chunks
      .map((c) => {
        const title = (c?.web?.title ?? "").trim();
        if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title)) return `https://${title}`;
        return typeof c?.web?.uri === "string" ? c.web.uri : "";
      })
      .filter(Boolean);
    return { content, citations };
  } catch {
    return null;
  }
}

// Google's AI Overview when present, else the featured snippet (answerBox) — both are Google's
// own algorithmic answer surface. Returns null when neither is shown (we don't invent one from
// plain organic results).
async function askGoogleAio(prompt: string): Promise<EngineAnswer | null> {
  const key = process.env.SERPER_API_KEY;
  if (!key || key.length < 10) return null;
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: prompt, gl: "us", hl: "en" }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const aio = data.aiOverview;
    if (aio && (aio.snippet || aio.text || Array.isArray(aio.textBlocks))) {
      const text: string = aio.snippet || aio.text ||
        (Array.isArray(aio.textBlocks) ? aio.textBlocks.map((b: any) => b?.snippet ?? "").join(" ") : "");
      const refs: string[] = Array.isArray(aio.references)
        ? aio.references.map((r: any) => r?.link ?? r?.url).filter((u: unknown): u is string => typeof u === "string" && u.startsWith("http"))
        : [];
      if (text) return { content: text, citations: refs, surface: "AI Overview" };
    }
    const box = data.answerBox;
    if (box && (box.snippet || box.answer)) {
      const text: string = box.answer || box.snippet || "";
      const link: string | undefined = box.link || box.source;
      return { content: text, citations: link && link.startsWith("http") ? [link] : [], surface: "featured snippet" };
    }
    return null; // Google showed no AI Overview or featured snippet for this query.
  } catch {
    return null;
  }
}

interface EngineDef {
  id: GeoEngineId;
  label: string;
  available: boolean;
  reason?: string;
  ask: (prompt: string) => Promise<EngineAnswer | null>;
}

function resolveEngines(perplexityModel: string, selected?: GeoEngineId[]): EngineDef[] {
  const openai = process.env.OPENAI_API_KEY;
  const gemini = process.env.GEMINI_API_KEY;
  const serper = process.env.SERPER_API_KEY;
  const all: EngineDef[] = [
    {
      id: "perplexity", label: "Perplexity",
      available: llmEnabled(), reason: llmEnabled() ? undefined : "OPENROUTER_API_KEY not set",
      ask: (p) => askPerplexity(p, perplexityModel),
    },
    {
      id: "chatgpt", label: "ChatGPT",
      available: !!openai && openai.length >= 20, reason: !!openai && openai.length >= 20 ? undefined : "OPENAI_API_KEY not set",
      ask: askChatGpt,
    },
    {
      id: "gemini", label: "Gemini",
      available: !!gemini && gemini.length >= 20, reason: !!gemini && gemini.length >= 20 ? undefined : "GEMINI_API_KEY not set",
      ask: askGemini,
    },
    {
      id: "google_aio", label: "Google AI Overview",
      available: !!serper && serper.length >= 10, reason: !!serper && serper.length >= 10 ? undefined : "SERPER_API_KEY not set",
      ask: askGoogleAio,
    },
  ];
  return selected?.length ? all.filter((e) => selected.includes(e.id)) : all;
}

export interface GeoOptions {
  prompts?: string[];
  brand?: string;
  competitors?: string[];
  /** Perplexity model override (back-compat). */
  model?: string;
  /** Restrict to these engines; default = all configured. */
  engines?: GeoEngineId[];
}

export async function runGeoScan(opts: GeoOptions = {}): Promise<GeoReport> {
  const startedAt = new Date();
  const prompts = (opts.prompts?.length ? opts.prompts : DEFAULT_PROMPTS).slice(0, 10);
  const brand = opts.brand ?? "ImagineArt";
  const competitors = opts.competitors?.length ? opts.competitors : DEFAULT_COMPETITORS;
  const perplexityModel = opts.model ?? "perplexity/sonar";
  const notes: string[] = [];

  const engineDefs = resolveEngines(perplexityModel, opts.engines);
  const active = engineDefs.filter((e) => e.available);
  const brandAliases = [brand, ...BRAND_ALIASES];

  const finish = async (results: GeoPromptResult[]): Promise<GeoReport> => {
    // Log every check (answered or not), then read back a rolling hit-rate per (prompt, engine)
    // — including the row just logged. A single scan's 0% is noise; "answered 3/10 of the last
    // checks" is the truth, since engine availability (esp. Google AI Overview) genuinely
    // fluctuates over hours with no per-request randomness. Both steps are best-effort.
    await logGeoChecks(
      results.map((r) => ({
        prompt: r.prompt, engine: r.engine, answered: !r.error,
        brandMentioned: r.brandMentioned, surface: r.surface, citedDomains: r.citedDomains,
      })),
    ).catch(() => {});
    const hitRates = await getGeoHitRates(results.map((r) => ({ prompt: r.prompt, engine: r.engine })), 10).catch(
      () => ({}) as Record<string, { checked: number; answered: number }>,
    );
    for (const r of results) {
      const hr = hitRates[`${r.prompt}::${r.engine}`];
      if (hr) r.recentHitRate = hr;
    }

    const answered = results.filter((r) => !r.error);
    const sov = (rs: GeoPromptResult[]) => (rs.length ? rs.filter((r) => r.brandMentioned).length / rs.length : 0);
    const compSov = (rs: GeoPromptResult[]): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const c of competitors) {
        const n = rs.filter((r) => r.competitorsMentioned.includes(c)).length;
        if (n > 0) out[c] = n / (rs.length || 1);
      }
      return out;
    };

    // Per-engine status (every engine listed — available or not — so gaps are visible).
    const engines: GeoEngineStatus[] = engineDefs.map((e) => {
      const mine = answered.filter((r) => r.engine === e.id);
      const mineAll = results.filter((r) => r.engine === e.id);
      const engineHitRate = mineAll.reduce(
        (acc, r) => {
          const hr = hitRates[`${r.prompt}::${r.engine}`];
          if (hr) { acc.checked += hr.checked; acc.answered += hr.answered; }
          return acc;
        },
        { checked: 0, answered: 0 },
      );
      return {
        id: e.id, label: e.label, available: e.available, reason: e.reason,
        answered: mine.length, brandShareOfVoice: sov(mine), competitorShareOfVoice: compSov(mine),
        recentHitRate: engineHitRate.checked > 0 ? engineHitRate : undefined,
      };
    });
    const enginesUsed = engines.filter((e) => e.answered > 0).map((e) => e.label);

    // Cited-domain leaderboard across all answers.
    const domainCount = new Map<string, number>();
    for (const r of answered) for (const d of r.citedDomains) domainCount.set(d, (domainCount.get(d) ?? 0) + 1);
    const citedDomainLeaderboard = [...domainCount.entries()].map(([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count);

    // Source gaps: domains cited alongside a competitor but never alongside us.
    const brandDomains = new Set<string>();
    const competitorDomains = new Set<string>();
    for (const r of answered) {
      if (r.brandMentioned) r.citedDomains.forEach((d) => brandDomains.add(d));
      if (r.competitorsMentioned.length) r.citedDomains.forEach((d) => competitorDomains.add(d));
    }
    const sourceGaps = citedDomainLeaderboard.filter(
      (d) => competitorDomains.has(d.domain) && !brandDomains.has(d.domain) && !BRAND_ALIASES.includes(d.domain) && !NON_EDITORIAL.test(d.domain),
    );

    const finishedAt = new Date();
    return {
      brand, competitors, model: perplexityModel, engines, enginesUsed,
      prompts: prompts.length, answered: answered.length,
      brandShareOfVoice: sov(answered), competitorShareOfVoice: compSov(answered),
      citedDomainLeaderboard, sourceGaps, results, notes,
      startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
    };
  };

  // Note which engines are configured vs skipped, so the UI never overstates coverage.
  const skipped = engineDefs.filter((e) => !e.available);
  if (skipped.length) notes.push(`Not checked: ${skipped.map((e) => `${e.label} (${e.reason})`).join("; ")}.`);

  if (active.length === 0) {
    notes.push("No AI engines are configured — add OPENROUTER_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or SERPER_API_KEY.");
    return finish([]);
  }

  // Fan out: every prompt × every active engine, bounded concurrency.
  const queue = new PQueue({ concurrency: 4 });
  const results: GeoPromptResult[] = [];
  await Promise.all(
    prompts.flatMap((prompt) =>
      active.map((eng) =>
        queue.add(async () => {
          const r = await eng.ask(prompt).catch(() => null);
          if (!r) {
            results.push({ prompt, engine: eng.id, brandMentioned: false, competitorsMentioned: [], citedDomains: [], answerExcerpt: "", error: "no answer" });
            return;
          }
          results.push({
            prompt, engine: eng.id, surface: r.surface,
            brandMentioned: brandAliases.some((a) => mentions(r.content, a)),
            competitorsMentioned: competitors.filter((c) => mentions(r.content, c)),
            citedDomains: [...new Set(r.citations.map(domainOf).filter((d): d is string => !!d))],
            answerExcerpt: r.content.slice(0, 240),
          });
        }),
      ),
    ),
  );

  if (results.every((r) => r.error)) notes.push("No engine returned an answer — check model ids / API credits.");

  // Transparency: an engine that ran but answered nothing isn't broken — say why.
  for (const eng of active) {
    const answered = results.filter((r) => r.engine === eng.id && !r.error).length;
    if (answered === 0) {
      notes.push(
        eng.id === "google_aio"
          ? "Google AI Overview returned nothing — Google showed no AI Overview or featured snippet for these prompts (it varies by query and phrasing)."
          : `${eng.label} returned no answers — the API may be rate-limited, out of credits, or blocking these prompts.`,
      );
    }
  }

  return finish(results);
}
