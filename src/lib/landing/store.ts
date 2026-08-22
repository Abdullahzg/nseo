// The landing-page pipeline.
//
// Read the migration comment for why the middle of this flow lives outside the app. In short: the
// vibe-code and templatise steps are Claude skills run against imagine-web and imagine-blogs-backend,
// so this module tracks and grounds them rather than executing them.
import { supabaseAdmin } from "@/lib/db/supabase";
import { adviseCanonical, type CanonicalAdvice } from "@/lib/seo/canonical";
import { internalLinkCandidates } from "@/lib/sitemap/store";
import { keywordOpportunities } from "@/lib/writer/cluster";

export { STAGES, STAGE_META, type LandingStage, type LandingPage } from "./stages";
import type { LandingPage } from "./stages";

export async function listLandingPages(): Promise<LandingPage[]> {
  const { data, error } = await supabaseAdmin
    .from("landing_pages").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as LandingPage[];
}

export async function getLandingPage(id: string): Promise<LandingPage | null> {
  const { data, error } = await supabaseAdmin.from("landing_pages").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as LandingPage | null;
}

export interface LandingResearch {
  /** Measured demand for the keyword, if Search Console has any. */
  opportunity: { keyword: string; impressions: number; position: number } | null;
  /** Should this page exist, or does one already own the query? */
  canonical: CanonicalAdvice | null;
  /** Real pages it should link to. */
  internal_links: Array<{ path: string; section: string }>;
  notes: string[];
}

/**
 * Ground a landing-page brief in real data before anyone writes code for it.
 *
 * This is the step that stops us building a page for a term we already rank for — the same
 * cannibalisation check the blog writer gets, applied earlier, where it is cheaper to act on.
 */
export async function researchLanding(keyword: string, targetPath?: string): Promise<LandingResearch> {
  const notes: string[] = [];
  const kw = keyword.trim();
  if (!kw) return { opportunity: null, canonical: null, internal_links: [], notes: ["No keyword given, so nothing could be checked."] };

  const [oppResult, canonical, links] = await Promise.all([
    keywordOpportunities(kw, 40).catch(() => null),
    adviseCanonical({ keyword: kw, excludePath: targetPath }).catch(() => null),
    internalLinkCandidates(kw, { limit: 8 }).catch(() => []),
  ]);

  // keywordOpportunities filters to striking distance, so a miss here is informative rather than an
  // error: it means we either have no impressions for this yet, or we already rank well.
  const match = oppResult?.opportunities.find((o) => o.keyword.toLowerCase() === kw.toLowerCase()) ?? null;
  if (!match) {
    notes.push(
      `"${kw}" is not in the striking-distance set. Either we get no impressions for it yet (a genuinely ` +
      `new page, which is fine) or we already rank well for it (check the canonical verdict below).`,
    );
  }
  for (const n of oppResult?.notes ?? []) notes.push(n);

  return {
    opportunity: match ? { keyword: match.keyword, impressions: match.impressions, position: match.position } : null,
    canonical,
    internal_links: links.map((l) => ({ path: l.path, section: l.section })),
    notes,
  };
}

export async function createLandingPage(row: {
  feature: string;
  primary_keyword?: string | null;
  target_path?: string | null;
  brief?: Record<string, unknown>;
  research?: Record<string, unknown>;
  created_by?: string | null;
}): Promise<LandingPage> {
  const { data, error } = await supabaseAdmin.from("landing_pages").insert({
    feature: row.feature,
    primary_keyword: row.primary_keyword ?? null,
    target_path: row.target_path ?? null,
    brief: row.brief ?? {},
    research: row.research ?? {},
    created_by: row.created_by ?? null,
  }).select().single();
  if (error) throw error;
  return data as LandingPage;
}

/** Fields a caller may change. Stage transitions are allowed in either direction: a templatisation can
 *  fail and need redoing, and forcing a linear-only machine would just mean deleting and re-creating. */
const EDITABLE = new Set([
  "feature", "primary_keyword", "target_path", "brief", "stage",
  "cdn_url", "strapi_component", "draft_id", "notes",
  // Server-derived, but writable through this path because researchLanding() is the only producer and
  // it runs server-side. A client cannot forge it: the route computes it and passes it straight in.
  "research",
  // The template decision and the Strapi entry it produced (migration 056). These MUST be listed here:
  // this function silently discards any key it does not recognise, so an unlisted field means the
  // configure route returns a success containing a real Strapi entry id that was never persisted — the
  // page would look unconfigured forever while a live draft sat orphaned in the CMS.
  "template_source", "strapi_template", "strapi_category", "strapi_entry_id", "strapi_slug",
  "configured_at", "template_pr_url", "template_pr_repo", "origin",
  // The campaign path (migration 057). Same silent-discard hazard as the fields above.
  "reference_url", "destination_url", "destination_verified_at", "product_name", "repo_name",
  "deployed_url", "marketing_cleared_at", "marketing_cleared_by",
  // The vibe-coded path's own creative input (migration 061). Same silent-discard hazard as above.
  "creative_prompt", "reference_image_urls",
]);

export async function updateLandingPage(id: string, patch: Record<string, unknown>): Promise<LandingPage> {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (EDITABLE.has(k)) safe[k] = v;
  const { data, error } = await supabaseAdmin
    .from("landing_pages").update({ ...safe, updated_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) throw error;
  return data as LandingPage;
}

export async function deleteLandingPage(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from("landing_pages").delete().eq("id", id);
  if (error) throw error;
}

/**
 * The brief to paste into a Claude session running the imagine-landing skill.
 *
 * Generated rather than hand-written so the grounding travels with it — the whole point of researching
 * first is that the page gets built against real demand and real internal links, and that only helps if
 * those facts reach whoever writes the code.
 */
export function skillBrief(page: LandingPage): string {
  const r = (page.research ?? {}) as unknown as LandingResearch;
  const b = (page.brief ?? {}) as Record<string, unknown>;
  const lines: string[] = [
    `Build an Imagine.art feature landing page for: ${page.feature}`,
    "",
  ];
  if (page.primary_keyword) lines.push(`Primary keyword: ${page.primary_keyword}`);
  if (page.target_path) lines.push(`Intended URL path: ${page.target_path}`);
  if (typeof b.audience === "string" && b.audience) lines.push(`Audience: ${b.audience}`);
  if (typeof b.angle === "string" && b.angle) lines.push(`Angle: ${b.angle}`);
  if (Array.isArray(b.sections) && b.sections.length) {
    lines.push("", "Sections wanted:");
    for (const s of b.sections) lines.push(`  - ${String(s)}`);
  }

  lines.push("", "## Grounding (measured, not estimated)");
  if (r?.opportunity) {
    lines.push(
      `Search Console: "${r.opportunity.keyword}" currently gets ${r.opportunity.impressions.toLocaleString()} ` +
      `impressions at average position ${r.opportunity.position.toFixed(1)}. Real demand, badly served.`,
    );
  } else {
    lines.push("Search Console has no striking-distance data for this keyword. Treat demand as unproven.");
  }
  if (r?.canonical?.verdict) {
    const v = r.canonical.verdict;
    lines.push(
      v.kind === "rebuild"
        ? `♻️ THIS IS A REBUILD, NOT A NEW PAGE: ${v.note}`
        : v.kind === "cannibalisation"
          ? `CANNIBALISATION RISK: ${v.note}`
          : v.kind === "canonical_to"
            ? `NEAR-DUPLICATE: ${v.note}`
            : `No existing page owns this query — building it is the right call.`,
    );
  }
  if (r?.internal_links?.length) {
    lines.push("", "Real internal pages this should link to (these exist; do not invent paths):");
    for (const l of r.internal_links) lines.push(`  ${l.path}`);
  }
  if (typeof b.direction === "string" && b.direction) {
    lines.push("", `Extra direction: ${b.direction}`);
  }

  lines.push(
    "",
    "## After the page exists",
    "1. Note the R2 CDN URL it ships to, and record it against this landing page.",
    "2. Then run the vibe-coded-template skill on that URL to create the Strapi template.",
  );
  return lines.join("\n");
}
