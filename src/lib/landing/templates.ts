// The catalogue of landing-page templates that ACTUALLY exist in Strapi.
//
// Read live from Strapi's content-type-builder API rather than kept as a list in this repo, and that
// choice is the whole point of the module. Templates are added by the `vibe-coded-template` skill in two
// other repositories (imagine-blogs-backend for the components, imagine-web for the React template) — so
// a hardcoded list here would be a copy of someone else's source of truth, wrong the first time a
// template shipped and silently wrong forever after. Offering a template that no longer renders is worse
// than offering none: the operator writes a page of copy into a dead component.
//
// Two calls, both cached per process:
//   1. `api::cluster-page.cluster-page` → its `template` dynamiczone lists the registered component
//      strings, and its `category` enum lists the values a route guard can check for.
//   2. `content-type-builder/components` → each component's `displayName` and its section fields.
//
// The second matters for usability. "templates.template-1" tells an operator nothing; "Template 1 — hero,
// generation steps, use cases, FAQ" tells them whether it fits the page they have in mind.

import type { LandingStage } from "./stages";

export interface LandingTemplate {
  /** The Strapi dynamiczone component string, e.g. "vibe-coded-templates.ai-ad-studio-template". */
  component: string;
  /** Strapi's own displayName, e.g. "AI Ad Studio Template". */
  label: string;
  /** Section field names on the component, in schema order — what an editor will be filling in. */
  sections: string[];
  /** True for anything under `vibe-coded-templates.*`, i.e. built by the vibe-coded-template skill. */
  vibeCoded: boolean;
}

export interface TemplateCatalogue {
  templates: LandingTemplate[];
  /** The `category` enum on cluster-page. A route guard compares against one of these. */
  categories: string[];
  /** Null when Strapi is unreachable or unconfigured — callers must handle it, never fake a list. */
  error: string | null;
}

function strapiConfig(): { url: string; token: string } | null {
  const url = process.env.STRAPI_URL?.trim().replace(/\/$/, "");
  const token = process.env.STRAPI_API_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

/** Turn a section field name into something readable: `adStudioHeroSection` → "ad studio hero". */
export function humanizeSection(field: string): string {
  return field
    .replace(/Section$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
}

// Cached for the process. The catalogue changes only when someone ships a new template in another repo,
// which is a deploy-scale event, not a per-request one — and this costs two round trips to a CMS that is
// not on our critical path.
let cache: { at: number; value: TemplateCatalogue } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function getTemplateCatalogue(opts: { fresh?: boolean } = {}): Promise<TemplateCatalogue> {
  if (!opts.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const cfg = strapiConfig();
  if (!cfg) {
    return { templates: [], categories: [], error: "STRAPI_URL / STRAPI_API_TOKEN are not set." };
  }

  const get = async (path: string) => {
    const res = await fetch(`${cfg.url}/${path}`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`${path} returned ${res.status}`);
    return res.json();
  };

  try {
    const [ct, comps] = await Promise.all([
      get("api/content-type-builder/content-types/api::cluster-page.cluster-page"),
      get("api/content-type-builder/components"),
    ]);

    const attrs = ct?.data?.schema?.attributes ?? {};
    const registered: string[] = attrs.template?.components ?? [];
    const categories: string[] = attrs.category?.enum ?? [];

    // Index every component so a registered string can be resolved to its schema. Components the
    // dynamiczone does not reference are irrelevant here — there are 327 of them and only ~24 are
    // page templates.
    const byUid = new Map<string, any>();
    for (const c of comps?.data ?? []) if (c?.uid) byUid.set(c.uid, c.schema ?? {});

    const templates: LandingTemplate[] = registered.map((component) => {
      const schema = byUid.get(component);
      const fields = Object.keys(schema?.attributes ?? {});
      return {
        component,
        // Fall back to the component string rather than inventing a name: a template whose schema we
        // could not read should look unfamiliar, not confidently mislabelled.
        label: schema?.displayName ?? component,
        // `metadata` is SEO plumbing on nearly every template and is not a content section an editor
        // thinks of as part of the page, so it is not listed as one.
        sections: fields.filter((f) => f !== "metadata"),
        vibeCoded: component.startsWith("vibe-coded-templates."),
      };
    });

    const value: TemplateCatalogue = { templates, categories, error: null };
    cache = { at: Date.now(), value };
    return value;
  } catch (e) {
    // Never cache a failure — a transient Strapi blip should not blank the picker for ten minutes.
    return {
      templates: [],
      categories: [],
      error: e instanceof Error ? e.message : "could not reach Strapi",
    };
  }
}

/**
 * Which stage a page is at once a template decision has been made.
 *
 * This is where the two routes through the pipeline diverge, and the reason `template_source` exists at
 * all. Reusing an existing template skips `vibe_coded` and `templatised` entirely — there is nothing to
 * build, the component and the React template already ship — so the page goes straight to needing copy.
 * A new vibe-coded template has to be designed and ported first.
 *
 * Modelling that as a skip rather than as five stages everyone walks through is what keeps the status
 * board honest: a reused-template page sitting at "vibe_coded" would look like it were waiting on
 * engineering work that nobody needs to do.
 */
export function stageAfterTemplateChoice(source: "existing" | "vibe_coded"): LandingStage {
  return source === "existing" ? "templatised" : "brief";
}
