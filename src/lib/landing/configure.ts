// Put a pre-wired Strapi entry in front of the person writing the copy.
//
// This is the step that was missing from the whole pipeline. `/landing` tracked five stages and told you
// what to do next in prose ("run the vibe-coded-template skill…"), but every stage transition was a human
// doing something in another tool and then coming back to tick a box. For the common case — reuse one of
// the 24 templates that already ship — none of that work exists: the Strapi component and the imagine-web
// React template are already deployed, so the only thing between a brief and a live page is copy.
//
// So this creates the cluster-page entry with the template already selected, the category already set to
// whatever the target route's guard checks for, and the slug already filled — then hands back a deep link
// straight into that entry in the Strapi admin. The editor lands on a form that is correct by construction
// and writes copy.
//
// It creates a DRAFT, always. `createEntry` sends `publishedAt: null` explicitly (see the warning in
// strapi/client.ts — omitting the key silently publishes), so nothing reaches the live site until a person
// publishes it deliberately.

import { createEntry, updateEntry, adminUrlFor } from "@/lib/strapi/client";
import { getTemplateCatalogue } from "./templates";

export const CLUSTER_PAGE_TYPE = "cluster-pages";
export const CLUSTER_PAGE_UID = "api::cluster-page.cluster-page";

export interface ConfigureInput {
  /** The Strapi dynamiczone component string, e.g. "templates.template-1". */
  template: string;
  /** The `category` enum value. See the warning below — this is not the same as the template. */
  category: string;
  /** URL slug for the page, without a leading slash. */
  slug: string;
  /** Shown as the page title in Strapi's list view, so an editor can find it. */
  title?: string | null;
  description?: string | null;
}

export interface ConfigureResult {
  entryId: number;
  adminUrl: string;
  slug: string;
  template: string;
  category: string;
  /** Non-fatal things the operator should know — surfaced, never swallowed. */
  warnings: string[];
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Validate a choice against what Strapi actually has, before writing anything.
 *
 * Deliberately a separate function from the write so the UI can check a selection while the operator is
 * still choosing. Every failure here would otherwise surface as a Strapi 400 whose message does not name
 * the real problem.
 */
export async function validateChoice(input: ConfigureInput): Promise<{ ok: true; warnings: string[] } | { ok: false; error: string }> {
  const cat = await getTemplateCatalogue();
  if (cat.error) return { ok: false, error: `Cannot read the template list from Strapi: ${cat.error}` };

  const known = cat.templates.find((t) => t.component === input.template);
  if (!known) {
    return {
      ok: false,
      error: `"${input.template}" is not registered in cluster-page's template list. ` +
        `Registered: ${cat.templates.map((t) => t.component).join(", ")}`,
    };
  }
  if (!cat.categories.includes(input.category)) {
    return {
      ok: false,
      error: `"${input.category}" is not one of cluster-page's category values (${cat.categories.join(", ")}).`,
    };
  }
  if (!slugify(input.slug)) return { ok: false, error: "A slug is required." };

  const warnings: string[] = [];
  // The trap from the vibe-coded-template skill, surfaced at the moment the choice is made rather than
  // discovered later as a 404. Several categories have their own dedicated route folder whose guard
  // compares `category` against ITS value, not the template's — so a template named after one category
  // but shipped on a route that checks for another needs the route's value here.
  //
  // The suffix stripping is load-bearing: the component's own name is `ai-ad-studio-template` while the
  // category is `ai-ad-studio`, so comparing the raw segment matches nothing and the warning would never
  // fire at all. Trailing `-template`, `-templates` and a numeric suffix (`-1`, `-2`) all appear across
  // the 24 registered components.
  const hint = (input.template.split(".")[1] ?? "")
    .replace(/-\d+$/, "")
    .replace(/-templates?$/, "");
  if (hint && cat.categories.includes(hint) && input.category !== hint) {
    warnings.push(
      `This template is named after the "${hint}" category but you selected "${input.category}". ` +
      "That is often correct — a dedicated route gates on its own category value, not the template's — " +
      "but if the page 404s, this is the first thing to check.",
    );
  }
  return { ok: true, warnings };
}

/**
 * Create the cluster-page draft with the template pre-selected.
 *
 * The dynamiczone payload is `[{ __component: "<component>" }]` with no section data: every section field
 * is optional by design (the vibe-coded-template skill makes them so deliberately, so a partial draft can
 * still be saved), and the imagine-web template renders a missing section as absent rather than crashing.
 * That is exactly what makes a content-free entry a useful starting point instead of an error.
 */
export async function configureLandingEntry(input: ConfigureInput): Promise<ConfigureResult> {
  const check = await validateChoice(input);
  if (!check.ok) throw new Error(check.error);

  const slug = slugify(input.slug);
  const entry = await createEntry<{ id: number }>(CLUSTER_PAGE_TYPE, {
    slug,
    category: input.category,
    clusterPageTitle: input.title?.trim() || slug.replace(/[-/]+/g, " "),
    ...(input.description?.trim() ? { clusterPageDescription: input.description.trim() } : {}),
    // Section data is deliberately empty — the editor fills it in. Sending an empty component still
    // selects it in the admin UI, which is the whole point: the form arrives correct.
    template: [{ __component: input.template }],
  });

  return {
    entryId: entry.id,
    adminUrl: adminUrlFor(CLUSTER_PAGE_UID, entry.id),
    slug,
    template: input.template,
    category: input.category,
    warnings: check.warnings,
  };
}

/** Re-point an existing entry at a different template. Used when someone picks the wrong one. */
export async function retemplateLandingEntry(entryId: number, template: string): Promise<void> {
  await updateEntry(CLUSTER_PAGE_TYPE, entryId, { template: [{ __component: template }] });
}

export interface CampaignInput {
  reference_url: string;
  destination_url: string;
  product_name: string;
  repo_name?: string | null;
}

/** `ai-<product>-<reference-host>` — the skill's naming convention for repo and Vercel project. */
export function suggestRepoName(input: { product_name: string; reference_url: string }): string {
  const product = slugify(input.product_name);
  let ref = "";
  try {
    ref = new URL(input.reference_url).hostname
      .replace(/^www\./, "")
      .split(".")[0];
  } catch { /* a malformed reference just yields no suffix */ }
  return ["ai", product, slugify(ref)].filter(Boolean).join("-");
}

/**
 * Check a campaign brief before anyone starts building.
 *
 * The destination check is the one that matters and it is deliberately NOT a fetch. imagine.art is an SPA
 * that returns HTTP 200 for every path under `/computer/agent/*`, including invented ones — so a status
 * code proves nothing, and a whole research cycle was already spent building for a surface that had not
 * shipped. The only valid confirmation is a person rendering it and looking, which is why this returns a
 * required-action rather than a verdict.
 */
export function validateCampaign(input: CampaignInput): { ok: false; error: string } | { ok: true; warnings: string[]; mustConfirm: string[] } {
  const warnings: string[] = [];

  for (const [field, value] of [["reference_url", input.reference_url], ["destination_url", input.destination_url]] as const) {
    if (!value?.trim()) return { ok: false, error: `${field} is required.` };
    try {
      const u = new URL(value);
      if (!/^https?:$/.test(u.protocol)) return { ok: false, error: `${field} must be an http(s) URL.` };
    } catch {
      return { ok: false, error: `${field} is not a valid URL.` };
    }
  }
  if (!input.product_name?.trim()) return { ok: false, error: "product_name is required — it is the nav sub-wordmark." };

  const dest = new URL(input.destination_url);
  if (!/(^|\.)imagine\.art$/i.test(dest.hostname)) {
    return { ok: false, error: `The destination must be an imagine.art surface, not ${dest.hostname}.` };
  }
  // Rule 1 of the skill: every CTA is a bare anchor to the destination. A query string in the destination
  // itself would end up on every CTA on the page.
  if (dest.search || dest.hash) {
    warnings.push(
      `The destination carries a query string or fragment (${dest.search}${dest.hash}). Every CTA links to it ` +
      "bare — no ?prompt=, no UTM — so strip it before building.",
    );
  }

  const ref = new URL(input.reference_url);
  if (/(^|\.)imagine\.art$/i.test(ref.hostname)) {
    warnings.push("The reference is an imagine.art page. This path is for cloning a COMPETITOR reference; " +
      "for our own design, use the vibe-code path instead.");
  }

  return {
    ok: true,
    warnings,
    // Named actions rather than prose, so they can be rendered as a checklist a person actually ticks.
    mustConfirm: [
      `Render ${input.destination_url} and look at it. It is an SPA that returns 200 for invented paths, so a status code proves nothing.`,
      `Confirm ${ref.hostname} is a multi-section MARKETING page, not an app screen, a dead route or a single-section splash.`,
    ],
  };
}

/**
 * The brief for the campaign-landing-page skill.
 *
 * The claim-safety list is reproduced here rather than left to the skill because this is the artifact a
 * marketer reads. Every line is something the reference page will have and the clone must not: the
 * consequence of missing one is a live ad making a claim about a competitor's software or a statistic
 * nobody can defend, which is a different class of problem from a layout bug.
 */
export function campaignHandoff(page: {
  feature: string;
  primary_keyword?: string | null;
}, input: CampaignInput): string {
  const repo = input.repo_name?.trim() || suggestRepoName(input);
  return [
    `# Campaign landing page: ${page.feature}`,
    "",
    "Run the `campaign-landing-page` skill with these inputs.",
    "",
    "```",
    `REFERENCE_URL   ${input.reference_url}`,
    `DESTINATION_URL ${input.destination_url}`,
    `PRODUCT_NAME    ${input.product_name}`,
    `REPO_NAME       ${repo}`,
    "```",
    "",
    `Primary keyword: ${page.primary_keyword || "(not set)"}`,
    "",
    "## Confirm before writing any code",
    "",
    `- [ ] Render ${input.destination_url} and look at it. imagine.art returns HTTP 200 for every path`,
    "      under /computer/agent/* including invented ones, so a status check proves nothing. A page was",
    "      already built for a surface that had not shipped.",
    "- [ ] Confirm the reference is a multi-section marketing page, not an app screen or a dead route.",
    "",
    "## What comes from where",
    "",
    "FROM THE REFERENCE: section order, per-section layout, the exact sampled palette, imagery placement",
    "and count. FROM THE KIT: typography, nav, footer, spacing, buttons.",
    "",
    "## Do not reproduce, whatever the reference does",
    "",
    "- Review badges and star ratings, user counts, performance multipliers (\"10x faster\", \"100+ templates\")",
    "- Testimonials with a name or headshot. Keep the band, put a product statement in it, never generate a portrait",
    "- Named third-party products, and invented product names of our own",
    "- Any pricing at all — no \"free\", no \"no credit card required\", no plan names, no pricing nav link",
    "- Infrastructure guarantees (\"99.99% uptime\"), legal disclaimers, integration logos",
    "",
    "Keep the layout in every case; repoint the content. Deleting a section changes the structural clone,",
    "inventing the thing is worse. Anything marketing must verify gets `// TODO(marketing):` at the point of",
    "use and a line in the README's pre-launch checklist.",
    "",
    "If the reference's whole argument is something we cannot say (\"a free alternative to X\"), strip it and",
    "say so explicitly — the page now argues a different case than the one it was cloned from, and that is a",
    "marketing decision, not a build decision.",
    "",
    "## CTAs",
    "",
    `Every CTA is a bare anchor to ${input.destination_url} with target=_blank and rel="noopener noreferrer".`,
    "No query string. Any prompt box the reference has is presentational: typing is allowed, submitting just",
    "opens the destination, and the text is never read or appended.",
    "",
    "## Assets",
    "",
    "Capture the real surface first. All /computer/* surfaces are a DARK chat-first workspace on #0f0f0f,",
    "not a light standalone tool — getting this wrong is the most common asset defect. Spreadsheets and",
    "documents appear as light artifacts INSIDE the dark shell. Artifact shots (a finished site, doc or",
    "title card) depict output, so render those standalone with no shell.",
  ].join("\n");
}

/**
 * Everything the two skills need, generated from the brief.
 *
 * The vibe-coded path cannot be automated from inside this app — `imagine-landing` scaffolds a Next.js
 * repo and `vibe-coded-template` edits two other repositories, both in a coding session. What this app
 * CAN do is remove every ambiguity from the handoff, so the session starts with the decisions already
 * made rather than re-deriving them from a Slack message.
 *
 * The URL warning is first because it is the one irreversible mistake in the pipeline: a static page
 * proxied from `/ai-<product>` has that whole prefix intercepted by middleware before Next's router sees
 * it, so the templatized version can never reuse that URL. Deciding it up front costs a sentence;
 * discovering it after launch costs a redirect and a migration.
 */
export function skillHandoff(page: {
  feature: string;
  primary_keyword?: string | null;
  target_path?: string | null;
  brief?: Record<string, unknown> | null;
  creative_prompt?: string | null;
  reference_image_urls?: string[] | null;
}): string {
  const slug = slugify(page.target_path || page.feature);
  const images = page.reference_image_urls ?? [];
  const lines = [
    `# Vibe-code a new template for: ${page.feature}`,
    "",
    `Target URL:      /${slug}`,
    `Primary keyword: ${page.primary_keyword || "(not set)"}`,
    "",
    "## Settle this before you deploy anything",
    "",
    `This page is going to be templatized, so the URL is not a free choice. Do NOT ship the static page`,
    `behind an /ai-* proxy prefix: proxy.ts intercepts that whole prefix before Next's router sees it, and`,
    `the Strapi cluster-page route can then never live there. Pick the final URL now.`,
    "",
    "## Creative direction",
    "",
    // This is an ORIGINAL design, not a clone — there is no reference page dictating layout, so this
    // prompt is the only creative input the skill has. An empty prompt here is not a minor omission the
    // way a thin campaign brief is: imagine-landing's own guidance is "a signature moment, not a
    // template", and there is nothing left to derive one from.
    page.creative_prompt?.trim()
      ? page.creative_prompt.trim()
      : "(No creative prompt was given. Do not invent product claims — ask before proceeding, or ground " +
        "the direction in the primary keyword and feature name alone.)",
    "",
    images.length
      ? [
          "Reference images (look at these before picking a direction; they are inspiration for tone and",
          "composition, not a layout to reproduce — that is what the campaign path is for):",
          "",
          ...images.map((u, i) => `${i + 1}. ${u}`),
        ].join("\n")
      : "No reference images were attached.",
    "",
    "## Step 1 — build the page",
    "",
    "Run the `imagine-landing` skill with the creative direction above. It wants a signature moment, not",
    "a template: if you cannot name one from this brief, ask before building rather than defaulting to",
    "the worked example in the scaffold.",
    "",
    "## Step 2 — templatize it",
    "",
    "Run the `vibe-coded-template` skill. The source is an `imagine-landing` repo, so read",
    "`references/from-imagine-landing.md` and skip Steps 0-1 — the structure those steps exist to recover",
    "is already in the repo, and parsing the deployed HTML would be reverse-engineering output you have",
    "the input for.",
    "",
    "## Research brief",
    "",
    "```json",
    JSON.stringify(page.brief ?? {}, null, 2),
    "```",
  ];
  return lines.join("\n");
}
