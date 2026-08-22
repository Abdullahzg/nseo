// Landing-page stages, types, and the copy describing them.
//
// A client-safe LEAF module: no database, no Google auth, no server imports of any kind. The UI needs
// these constants, and importing them from ./store pulled `supabaseAdmin` and google-auth-library into
// the browser bundle — which fails the build with "Can't resolve 'child_process'". Same reason
// src/lib/blog/markdown.ts is split out from markdownPreview.tsx.

export const STAGES = ["brief", "vibe_coded", "templatised", "drafted", "published"] as const;
export type LandingStage = (typeof STAGES)[number];

/** What each stage means and, critically, WHO does it — two of these five are not this app. */
export const STAGE_META: Record<LandingStage, { label: string; owner: string; next: string }> = {
  brief: {
    label: "Brief",
    owner: "Here — captured and grounded in real search data.",
    next: "Run the imagine-landing skill with this brief to vibe-code the page.",
  },
  vibe_coded: {
    label: "Vibe-coded",
    owner: "The imagine-landing skill, in a coding session. Ships a static page to the R2 CDN.",
    next: "Run the vibe-coded-template skill on the CDN URL to turn it into a Strapi template.",
  },
  templatised: {
    label: "Templatised",
    owner: "The vibe-coded-template skill. Creates the Strapi components and the imagine-web template.",
    next: "Write the copy — the AI writer fills the template's fields like any other draft.",
  },
  drafted: {
    label: "Drafted",
    owner: "The AI writer, into a normal blog_drafts row.",
    next: "Review and publish from the Blog page. Landing pages publish through the same path.",
  },
  published: {
    label: "Published",
    owner: "Live.",
    next: "Nothing — it is done.",
  },
};

export interface LandingPage {
  id: string;
  feature: string;
  primary_keyword: string | null;
  target_path: string | null;
  brief: Record<string, unknown>;
  research: Record<string, unknown>;
  stage: LandingStage;
  cdn_url: string | null;
  strapi_component: string | null;
  draft_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;

  // ── The template decision (migration 056) ──────────────────────────────────────
  /** "existing" reuses one of the templates already registered in Strapi — nothing to build, so
   *  `vibe_coded` and `templatised` are skipped rather than pending. "vibe_coded" means a new template
   *  has to be designed and ported first. Null = not decided yet, which is a real state. */
  template_source: "existing" | "vibe_coded" | "campaign" | null;
  /** The Strapi dynamiczone component string, e.g. "templates.template-1". */
  strapi_template: string | null;
  /** The `category` enum value. NOT interchangeable with the template — the dedicated route folders gate
   *  on this equalling the value THAT route checks for, which is often not the template's own category.
   *  Getting it wrong is the most common cause of a correctly-wired template still 404ing. */
  strapi_category: string | null;
  strapi_entry_id: number | null;
  strapi_slug: string | null;
  configured_at: string | null;
  /** The PR adding a newly vibe-coded template to the codebase. */
  template_pr_url: string | null;
  template_pr_repo: string | null;
  /** How this page started: "writer" (seeded from an AI writer session) or "manual". */
  origin: string | null;

  // ── The campaign path (migration 057) ──────────────────────────────────────────
  /** The competitor page whose structure and palette are being cloned. */
  reference_url: string | null;
  /** The one live imagine.art surface every CTA links to. Bare — no query string, ever. */
  destination_url: string | null;
  /** Set when a PERSON rendered the destination and looked at it. Not an automated probe: imagine.art
   *  returns HTTP 200 for every path under /computer/agent/* including invented ones, so a status check
   *  proves nothing — a page was already built for a surface that had not shipped. */
  destination_verified_at: string | null;
  /** The nav sub-wordmark beside "ImagineArt", e.g. "Sheets". */
  product_name: string | null;
  /** Repo and Vercel project share this name: ai-<product>-<reference>. */
  repo_name: string | null;
  deployed_url: string | null;
  /** Marketing sign-off on the claim-safety TODOs. Separates "built" from "cleared to spend against". */
  marketing_cleared_at: string | null;
  marketing_cleared_by: string | null;

  // ── The vibe-coded (original design) path's own creative input (migration 061) ────────────────
  /** Free-text creative direction for imagine-landing — tone, signature moment, what to avoid.
   *  Only meaningful when template_source is "vibe_coded"; the campaign path has no equivalent
   *  because its direction comes from the reference it is cloning, not a prompt. */
  creative_prompt: string | null;
  /** Already-uploaded reference images (via /api/blog/upload) the vibe-coding session should look
   *  at before picking a direction. Empty array, not null, when none were attached. */
  reference_image_urls: string[];
}
