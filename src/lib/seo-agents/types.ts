// Shared shapes for the v2 SEO agents (report-only; assembled in-memory per run).

export interface LinkSuggestion {
  sourceUrl: string;
  sourcePath: string;
  sourceTitle: string;
  /** 0..1 topical relevance to the target. */
  score: number;
  /** Target keywords found on the source page (evidence). */
  sharedTerms: string[];
  /** Suggested anchor text for the new link. */
  anchor: string;
  reason: string;
  /**
   * Grounding — where/how to actually place the link, so a suggestion is copy-paste-ready
   * instead of "go find a spot".
   *   linkify      → `anchor` appears verbatim inside `sentence`; wrap it in a link.
   *   new_sentence → no good anchor exists on the page; add `draftSentence` (LLM-written).
   */
  placement: "linkify" | "new_sentence";
  /** The exact sentence on the source page to edit (the linkify target, or nearest context). */
  sentence: string;
  /** For new_sentence placements: a ready-to-insert sentence that naturally links the target. */
  draftSentence?: string;
}

export interface InternalLinkReport {
  target: string;
  targetPath: string;
  targetTitle: string;
  crawled: number;
  alreadyLinking: number;
  suggestions: LinkSuggestion[];
  notes: string[];
  startedAt: string;
  finishedAt: string;
}

/** One grounded opportunity in a whole-site sweep — a LinkSuggestion tagged with its target. */
export interface SweepOpportunity extends LinkSuggestion {
  targetPath: string;
  targetTitle: string;
}

export interface InternalLinkSweepReport {
  domain: string;
  crawled: number;
  /** Per money-page target: how many source pages already link vs. new opportunities found. */
  targets: { path: string; title: string; alreadyLinking: number; opportunities: number }[];
  /** Flat, ranked list of opportunities across every target. */
  opportunities: SweepOpportunity[];
  notes: string[];
  startedAt: string;
  finishedAt: string;
}

// ── Programmatic Page Quality (#11) ──────────────────────────────────────────────
export type PageQualityVerdict = "publish" | "noindex" | "hold";
export type LlmQuality = "good" | "weak" | "bad";

export interface PageQualityResult {
  url: string;
  path: string;
  template: string;
  httpStatus: number;
  words: number;
  /** 0..1 uniqueness vs template siblings in this run (1 = fully unique). */
  uniqueness: number;
  /** Nearest sibling path when this page is a near-duplicate. */
  duplicateOf?: string;
  /** Which template-completeness signals are present. */
  completeness: {
    title: boolean;
    metaDescription: boolean;
    h1: boolean;
    singleH1: boolean;
    jsonLd: boolean;
    /** 0..1 fraction of the five signals present. */
    score: number;
  };
  /** Content only materializes after JS (invisible to non-rendering crawlers). */
  jsGated: boolean;
  /** LLM read of visible text quality (localization / placeholder / filler). null = not checked. */
  llmQuality: LlmQuality | null;
  llmIssue?: string;
  /** Human-readable problems found. */
  flags: string[];
  verdict: PageQualityVerdict;
  reason: string;
  error?: string;
}

export interface PageQualityReport {
  domain: string;
  template?: string;
  crawled: number;
  counts: Record<PageQualityVerdict, number>;
  avgUniqueness: number;
  thin: number;
  duplicates: number;
  llmChecked: boolean;
  results: PageQualityResult[];
  notes: string[];
  startedAt: string;
  finishedAt: string;
}

// The AI answer engines we fan out to. Each measures brand/competitor presence + cited sources.
export type GeoEngineId = "perplexity" | "chatgpt" | "gemini" | "google_aio";

/** Hit-rate over the last N logged checks for one (prompt, engine) pair — turns a single noisy
 *  run into a trend, since engine availability (esp. Google AI Overview) is genuinely intermittent. */
export interface GeoHitRate {
  checked: number;
  answered: number;
}

export interface GeoPromptResult {
  prompt: string;
  /** Which engine produced this answer. */
  engine: GeoEngineId;
  /** For google_aio: which Google surface answered ("AI Overview" | "featured snippet" | "none"). */
  surface?: string;
  brandMentioned: boolean;
  competitorsMentioned: string[];
  citedDomains: string[];
  answerExcerpt: string;
  error?: string;
  /** This prompt+engine's hit-rate over recent history, including this run. Absent if no history yet. */
  recentHitRate?: GeoHitRate;
}

export interface GeoEngineStatus {
  id: GeoEngineId;
  label: string;
  /** Whether the engine's key/config is present so it actually ran. */
  available: boolean;
  /** Why it didn't run (e.g. "OPENAI_API_KEY not set") — only when unavailable. */
  reason?: string;
  /** Prompts this engine actually answered. */
  answered: number;
  /** Share of THIS engine's answered prompts where the brand appears (0..1). */
  brandShareOfVoice: number;
  competitorShareOfVoice: Record<string, number>;
  /** This engine's hit-rate over recent history across all checked prompts (this run included). */
  recentHitRate?: GeoHitRate;
}

export interface GeoReport {
  brand: string;
  competitors: string[];
  /** Kept for back-compat: the Perplexity model used. Prefer `engines` for what actually ran. */
  model: string;
  /** Per-engine availability + share of voice — honest record of what was and wasn't checked. */
  engines: GeoEngineStatus[];
  /** Labels of engines that returned at least one answer. */
  enginesUsed: string[];
  prompts: number;
  /** Total answers across all engines (prompts × engines that answered). */
  answered: number;
  /** Share of ALL answered results (across engines) where the brand appears (0..1). */
  brandShareOfVoice: number;
  competitorShareOfVoice: Record<string, number>;
  /** Domain -> how many answers cited it (across engines). */
  citedDomainLeaderboard: { domain: string; count: number }[];
  /** Domains competitors' answers cite that ours don't — content/PR targets. */
  sourceGaps: { domain: string; count: number }[];
  results: GeoPromptResult[];
  notes: string[];
  startedAt: string;
  finishedAt: string;
}
