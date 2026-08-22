// Topic clusters: one pillar post plus N supporting posts, planned from real demand data and then
// written unattended.
//
// The keyword selection here is the part that has to be honest. It comes entirely from Google Search
// Console: queries where we ALREADY get impressions but rank badly. That is measured demand against
// measured weakness, which is a far better reason to write something than a third-party volume
// estimate or an intuition about what people search. There is no search-volume or keyword-difficulty
// source connected to this app, so none is used or reported.
import {
  searchAnalytics, daysAgo, isGscConfigured, gscProperty, type SearchAnalyticsRow,
} from "@/lib/indexing/gsc";
import { blogSlugTaken, type WriterVoice } from "@/lib/db/queries";
import { slugify } from "@/lib/blog/fields";
import { anthropicClient, baseWriterParams } from "./anthropic";
import { renderVoiceSystem } from "./voice";
import type Anthropic from "@anthropic-ai/sdk";

export interface KeywordOpportunity {
  keyword: string;
  impressions: number;
  clicks: number;
  position: number;
  /** impressions × how far we are from the top 3. Ranks "big demand, bad position" to the top. */
  opportunity: number;
}

/** Queries we already rank well for don't need a new article, so they are excluded from candidates. */
const ALREADY_WINNING_POSITION = 5;
const MIN_IMPRESSIONS = 50;
const MAX_POSITION = 30;

export function scoreOpportunity(r: SearchAnalyticsRow): number {
  return r.impressions * Math.max(0, r.position - 3);
}

/**
 * Striking-distance queries from Search Console, best opportunity first.
 *
 * `seed` narrows to a topic area (substring match) so a cluster can be scoped to something the team
 * actually wants to write about, rather than always returning the same site-wide top queries.
 */
export async function keywordOpportunities(
  seed?: string,
  limit = 60,
): Promise<{ opportunities: KeywordOpportunity[]; property: string | null; window: string; notes: string[] }> {
  const notes: string[] = [];
  if (!isGscConfigured()) {
    return { opportunities: [], property: null, window: "", notes: ["Search Console is not connected, so there is no demand data to plan a cluster from."] };
  }
  const startDate = daysAgo(90);
  const endDate = daysAgo(1);
  const rows = await searchAnalytics({ startDate, endDate, dimensions: ["query"], rowLimit: 25000 });
  if (!rows.length) {
    return { opportunities: [], property: gscProperty(), window: `${startDate} to ${endDate}`, notes: ["Search Console returned no rows for this window."] };
  }

  const needle = seed?.trim().toLowerCase();
  const candidates = rows
    .filter((r) => r.impressions >= MIN_IMPRESSIONS)
    .filter((r) => r.position >= ALREADY_WINNING_POSITION && r.position <= MAX_POSITION)
    .filter((r) => (needle ? (r.keys[0] ?? "").toLowerCase().includes(needle) : true));

  if (needle && candidates.length === 0) {
    notes.push(`No striking-distance queries contain "${seed}". Either we have no measured demand there yet, or we already rank well for it.`);
  }

  const opportunities = candidates
    .map((r) => ({
      keyword: r.keys[0], impressions: r.impressions, clicks: r.clicks, position: r.position,
      opportunity: Math.round(scoreOpportunity(r)),
    }))
    .sort((a, b) => b.opportunity - a.opportunity)
    .slice(0, limit);

  return { opportunities, property: gscProperty(), window: `${startDate} to ${endDate}`, notes };
}

// ── Plan shape ───────────────────────────────────────────────────────────────

export interface ClusterPlanItem {
  keyword: string;
  title: string;
  /** One line on the specific take, so the reviewer can judge it without reading an outline. */
  angle: string;
  /** Lightweight section headings. Enough to review; the per-article run grounds the FAQ headings
   *  in real People Also Ask data at write time. */
  headings: string[];
  word_count: number;
  /** Measured demand behind this choice, carried through so the plan is auditable. */
  impressions: number;
  position: number;
  /** Assigned at approval time, not at plan time (see approveClusterPlan). */
  slug?: string;
  /** Sibling slugs this post must link to. Computed server-side. */
  links_to?: string[];
}

export interface ClusterPlan {
  pillar: ClusterPlanItem;
  supporting: ClusterPlanItem[];
  /** The exact GSC rows the plan was built from, so a reviewer can check the reasoning. */
  evidence: KeywordOpportunity[];
  notes: string[];
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    pillar: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Must be one of the supplied keywords, verbatim." },
        title: { type: "string", description: "At least 35 characters. Sentence case." },
        angle: { type: "string" },
        headings: { type: "array", items: { type: "string" } },
        word_count: { type: "integer" },
      },
      required: ["keyword", "title", "angle", "headings", "word_count"],
      additionalProperties: false,
    },
    supporting: {
      type: "array",
      items: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "Must be one of the supplied keywords, verbatim." },
          title: { type: "string", description: "At least 35 characters. Sentence case." },
          angle: { type: "string" },
          headings: { type: "array", items: { type: "string" } },
          word_count: { type: "integer" },
        },
        required: ["keyword", "title", "angle", "headings", "word_count"],
        additionalProperties: false,
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["pillar", "supporting", "notes"],
  additionalProperties: false,
} as const;

const PLANNER_SYSTEM = `You plan SEO topic clusters. A cluster is one broad pillar article plus
several narrower supporting articles, each targeting a distinct query, all linking to each other.

You will be given REAL Google Search Console data: queries where this site already earns impressions
but ranks poorly. Every keyword you choose must be one of those, copied verbatim. Do not invent a
keyword, do not reword one, and do not merge two into a phrase that nobody searched.

Rules that matter:
- The pillar takes the broadest, highest-demand query. Supporting posts take narrower, distinct ones.
- No two posts may target the same query or two near-identical phrasings of it. If the data contains
  "ai video generator free" and "free ai video generator", pick ONE and say so in notes.
- Each supporting post must be genuinely its own article, not a section of the pillar. If a keyword
  only deserves a paragraph, leave it out and note that.
- Word counts: the pillar is the long one (2000 to 3000). Supporting posts are 1200 to 1800.
- Titles must be at least 35 characters, in sentence case, and contain their target keyword.
- Headings are a sketch for a human reviewer, not a final outline. 4 to 7 per post.
- You have NO search volume or keyword difficulty data. Impressions and average position are what you
  have, and they are measured, not estimated. Never refer to volume or difficulty.

Use notes to tell the reviewer what you deliberately excluded and why. That is the most useful part
of the plan for someone deciding whether to approve it.`;

/**
 * Plan a cluster from real GSC opportunities.
 *
 * Structured output, one non-streaming call: the reviewer needs the whole plan at once to judge it,
 * and there is nothing to stream progressively.
 */
export async function planCluster(
  seedKeyword: string,
  voice: WriterVoice,
  size: number,
): Promise<{ plan: ClusterPlan | null; error?: string; usage?: Record<string, number> }> {
  const client = anthropicClient();
  if (!client) return { plan: null, error: "ANTHROPIC_API_KEY is not set." };

  const { opportunities, property, window, notes } = await keywordOpportunities(seedKeyword, 60);
  if (!opportunities.length) {
    return { plan: null, error: notes[0] ?? `No striking-distance queries found for "${seedKeyword}".` };
  }

  const supportingCount = Math.max(1, Math.min(size - 1, 11));
  const evidence = opportunities.slice(0, 40);
  const table = evidence
    .map((o) => `"${o.keyword}" — ${o.impressions.toLocaleString()} impressions, position ${o.position.toFixed(1)}, opportunity ${o.opportunity.toLocaleString()}`)
    .join("\n");

  const prompt = [
    `Site: ${property ?? "(unknown)"}. Search Console window: ${window}.`,
    `Topic area requested: "${seedKeyword}".`,
    "",
    "Real striking-distance queries (measured impressions, current average position, and an",
    "opportunity score of impressions multiplied by distance from position 3):",
    table,
    "",
    `Plan a cluster: 1 pillar plus exactly ${supportingCount} supporting posts.`,
    "Every keyword must be copied verbatim from the list above.",
  ].join("\n");

  try {
    const res = await client.messages.create({
      ...baseWriterParams("high"),
      max_tokens: 8000,
      // The voice matters for titles and angles, so include it. Cached, since it is the same block
      // the writer uses.
      system: [
        { type: "text", text: PLANNER_SYSTEM },
        { type: "text", text: renderVoiceSystem(voice), cache_control: { type: "ephemeral", ttl: "1h" } },
      ],
      output_config: { effort: "high", format: { type: "json_schema", schema: PLAN_SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    } as Anthropic.MessageCreateParamsNonStreaming);

    if (res.stop_reason === "refusal") return { plan: null, error: "The model declined to plan this cluster." };
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    if (!text) return { plan: null, error: "Empty planning response." };
    const raw = JSON.parse(text) as { pillar: ClusterPlanItem; supporting: ClusterPlanItem[]; notes: string[] };

    // Trust nothing: every keyword must exist verbatim in the data we supplied. A hallucinated
    // keyword would otherwise become a whole article targeting a query nobody searches.
    const byKeyword = new Map(evidence.map((o) => [o.keyword.toLowerCase(), o]));
    const planNotes = [...(raw.notes ?? []), ...notes];

    const attach = (item: ClusterPlanItem): ClusterPlanItem | null => {
      const hit = byKeyword.get(item.keyword.trim().toLowerCase());
      if (!hit) {
        planNotes.push(`Dropped "${item.keyword}": not one of the measured queries, so it has no evidence behind it.`);
        return null;
      }
      return { ...item, keyword: hit.keyword, impressions: hit.impressions, position: hit.position };
    };

    const pillar = attach(raw.pillar);
    if (!pillar) return { plan: null, error: "The planner did not choose a pillar keyword from the real data." };

    // Dedupe: same keyword twice, or the pillar repeated as a supporting post.
    const seen = new Set([pillar.keyword.toLowerCase()]);
    const supporting: ClusterPlanItem[] = [];
    for (const s of raw.supporting ?? []) {
      const item = attach(s);
      if (!item) continue;
      const k = item.keyword.toLowerCase();
      if (seen.has(k)) {
        planNotes.push(`Dropped a duplicate targeting "${item.keyword}".`);
        continue;
      }
      seen.add(k);
      supporting.push(item);
    }

    return {
      plan: { pillar, supporting, evidence, notes: planNotes },
      usage: {
        input_tokens: res.usage.input_tokens,
        output_tokens: res.usage.output_tokens,
        cache_read_input_tokens: res.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  } catch (e: any) {
    return { plan: null, error: e?.message ?? "cluster planning failed" };
  }
}

/**
 * Mint unique slugs and compute the interlink map, at approval time.
 *
 * This is what makes unattended interlinking safe. Slugs are known for every post in the cluster
 * BEFORE the first word is written, and each post is told exactly which sibling slugs to link to, so
 * the model can only reference siblings that will actually exist. Asking it to invent sibling URLs
 * would produce links to pages that never get published.
 */
export async function resolveClusterSlugs(plan: ClusterPlan): Promise<ClusterPlan> {
  const taken = new Set<string>();
  const mint = async (title: string, keyword: string): Promise<string> => {
    const base = slugify(title) || slugify(keyword) || "post";
    let candidate = base;
    let n = 2;
    // Check both the in-flight set and the database (which also enforces uniqueness at insert).
    while (taken.has(candidate) || (await blogSlugTaken(candidate))) {
      candidate = `${base}-${n++}`.slice(0, 80);
      if (n > 50) { candidate = `${base}-${Math.random().toString(16).slice(2, 6)}`; break; }
    }
    taken.add(candidate);
    return candidate;
  };

  const pillar = { ...plan.pillar, slug: await mint(plan.pillar.title, plan.pillar.keyword) };
  const supporting: ClusterPlanItem[] = [];
  for (const s of plan.supporting) {
    supporting.push({ ...s, slug: await mint(s.title, s.keyword) });
  }

  // Pillar links down to every supporting post. Each supporting post links up to the pillar plus up
  // to two laterals, so the cluster is genuinely interlinked without every post linking to all.
  pillar.links_to = supporting.map((s) => s.slug!).filter(Boolean);
  supporting.forEach((s, i) => {
    const laterals = [supporting[(i + 1) % supporting.length], supporting[(i + 2) % supporting.length]]
      .filter((x) => x && x.slug && x.slug !== s.slug)
      .map((x) => x!.slug!);
    s.links_to = [pillar.slug!, ...new Set(laterals)];
  });

  return { ...plan, pillar, supporting };
}

/** Flatten a plan into the order articles get written: pillar first, so supporting posts can link
 *  to something that already exists if a run is interrupted partway. */
export function planItems(plan: ClusterPlan): ClusterPlanItem[] {
  return [plan.pillar, ...plan.supporting];
}

/** Rough token cost estimate for the approval screen. One click can otherwise start a very large
 *  spend with no indication of scale. Based on observed usage: ~11k output tokens per article, plus
 *  research, with most input served from cache. */
export function estimateClusterCost(plan: ClusterPlan): { articles: number; est_output_tokens: number; est_usd: number } {
  const articles = 1 + plan.supporting.length;
  const perArticleOutput = 12_000;
  const perArticleCachedInput = 90_000;
  const est_output_tokens = articles * perArticleOutput;
  // Sonnet 5 list pricing: $3/Mtok input, $15/Mtok output; cache reads ~0.1x input.
  const est_usd = (est_output_tokens / 1e6) * 15 + (articles * perArticleCachedInput / 1e6) * 0.3;
  return { articles, est_output_tokens, est_usd: Math.round(est_usd * 100) / 100 };
}


/* ─────────────────────────────────────────────────────────────────────────────────────────────────
   Editing an approved-pending plan.

   Reviewing a plan you cannot change is not reviewing — the only options were approve it or throw it
   away and re-plan. So titles, angles, headings and word counts are editable, and a supporting post
   can be dropped.

   What is NOT freely editable is the KEYWORD. Every keyword in a plan was matched back to a real
   Search Console row (see attach() above), and that grounding is the whole basis for the plan being
   trustworthy: impressions and position travel with the item and are shown to the reviewer. A
   free-text keyword would quietly become an unevidenced guess wearing another item's numbers. So a
   keyword may only be changed to another keyword that appears in the same evidence set, and its
   metrics are re-attached from that row.
   ───────────────────────────────────────────────────────────────────────────────────────────────── */

export interface PlanEditResult {
  plan: ClusterPlan | null;
  error?: string;
  /** What was silently corrected, so the UI can say so rather than appearing to accept bad input. */
  notes: string[];
}

const MIN_WORDS = 300;
const MAX_WORDS = 6000;
const MAX_HEADINGS = 24;

/**
 * Validate a plan edit against the original. Pure, so the selfcheck can pin the rules.
 *
 * `original` supplies the evidence set and the untouchable fields; `edit` is what the reviewer sent.
 */
export function sanitizeClusterPlanEdit(original: ClusterPlan, edit: unknown): PlanEditResult {
  const notes: string[] = [];
  if (!edit || typeof edit !== "object") return { plan: null, error: "No plan supplied.", notes };

  const e = edit as { pillar?: unknown; supporting?: unknown };
  if (!e.pillar || typeof e.pillar !== "object") return { plan: null, error: "The plan needs a pillar.", notes };
  if (!Array.isArray(e.supporting)) return { plan: null, error: "The plan needs a list of supporting posts.", notes };
  if (e.supporting.length < 1) return { plan: null, error: "A cluster needs at least one supporting post.", notes };
  if (e.supporting.length > 11) return { plan: null, error: "A cluster is capped at 12 posts.", notes };

  // Keyword → real metrics, from the evidence this plan was built on.
  const evidence = new Map(
    (original.evidence ?? []).map((r) => [r.keyword.toLowerCase(), r]),
  );

  const clean = (raw: unknown, fallback: ClusterPlanItem, label: string): ClusterPlanItem | string => {
    const it = (raw ?? {}) as Record<string, unknown>;

    const keyword = String(it.keyword ?? "").trim();
    if (!keyword) return `${label} has no keyword.`;
    const row = evidence.get(keyword.toLowerCase());
    if (!row) {
      return `"${keyword}" is not one of the Search Console queries this plan was built from. ` +
        `Pick a keyword from the evidence list so the impressions and position stay real.`;
    }

    const title = String(it.title ?? "").trim();
    if (!title) return `${label} needs a title.`;

    let word_count = Math.round(Number(it.word_count));
    if (!Number.isFinite(word_count)) word_count = fallback.word_count;
    if (word_count < MIN_WORDS || word_count > MAX_WORDS) {
      const clamped = Math.max(MIN_WORDS, Math.min(MAX_WORDS, word_count));
      notes.push(`${label}: word count ${word_count} clamped to ${clamped}.`);
      word_count = clamped;
    }

    const headings = (Array.isArray(it.headings) ? it.headings : fallback.headings)
      .map((h) => String(h ?? "").trim())
      .filter(Boolean)
      .slice(0, MAX_HEADINGS);
    if (!headings.length) return `${label} needs at least one heading.`;

    return {
      keyword,
      title,
      angle: String(it.angle ?? "").trim() || fallback.angle,
      headings,
      word_count,
      // Re-attached from the evidence row, never taken from the client: these are the numbers the
      // reviewer is trusting, and they must always match the keyword actually chosen.
      impressions: row.impressions,
      position: row.position,
    };
  };

  const pillar = clean(e.pillar, original.pillar, "The pillar");
  if (typeof pillar === "string") return { plan: null, error: pillar, notes };

  const supporting: ClusterPlanItem[] = [];
  const seen = new Set<string>([pillar.keyword.toLowerCase()]);
  for (let i = 0; i < e.supporting.length; i++) {
    const fallback = original.supporting[i] ?? original.supporting[0] ?? original.pillar;
    const item = clean(e.supporting[i], fallback, `Supporting post ${i + 1}`);
    if (typeof item === "string") return { plan: null, error: item, notes };
    // Two posts on the same keyword would compete with each other, which is the exact problem a
    // cluster exists to avoid.
    if (seen.has(item.keyword.toLowerCase())) {
      notes.push(`Dropped a duplicate of "${item.keyword}".`);
      continue;
    }
    seen.add(item.keyword.toLowerCase());
    supporting.push(item);
  }
  if (!supporting.length) return { plan: null, error: "A cluster needs at least one supporting post.", notes };

  return {
    plan: { pillar, supporting, evidence: original.evidence ?? [], notes: original.notes ?? [] },
    notes,
  };
}
