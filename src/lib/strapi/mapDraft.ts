// Maps a local BlogDraft row (src/lib/db/queries.ts) to the Strapi "resources" field shape.
// Kept separate from client.ts (which is content-type-agnostic) and queries.ts (which is
// Strapi-agnostic) — this is the one place that knows both schemas.
//
// The field list and every constraint below came from the live content-type schema
// (GET /api/content-type-builder/content-types/api::resource.resource), not from inference:
//   title        string   REQUIRED  minLength 35
//   description  text     REQUIRED  minLength 120
//   slug         uid      REQUIRED  (targetField title) → globally UNIQUE, incl. across drafts
//   thumbnail    media    REQUIRED  ← was missing from this file entirely; publish always failed
//   cover        media    optional
//   isFeatured   boolean  REQUIRED
//   resourceHeroCTA   component REQUIRED (inner text + url both required)
//   resourceMetaData  component optional (but inner title/description/keywords all required)
//   body richtext (plain markdown) · tags text · author/category manyToOne relations
// draftAndPublish: true, i18n localized (en default, id, es).
// No import from ./client on purpose: publishReadiness() is imported by the editor, and this file
// must stay safe to pull into the browser bundle. The caller passes `locale` instead.
import type { BlogDraft } from "@/lib/db/queries";

export interface MapOptions {
  /** "draft" omits what Strapi relaxes for drafts and allows clearing required media.
   *  "publish" synthesises every required field, because validation is enforced on publish. */
  mode?: "draft" | "publish";
  /** Set to include `locale` in the payload. Only valid on create — v4 has no locale-changing
   *  update. Pass strapiLocale() from ./client at the call site. */
  locale?: string;
}

export function mapDraftToStrapi(d: Partial<BlogDraft>, opts: MapOptions = {}): Record<string, unknown> {
  const mode = opts.mode ?? "draft";
  const out: Record<string, unknown> = {};

  // Uniform rule for every field: emit the key iff the caller supplied it, and pass `null`
  // through as `null`. Relations and media used to be gated on truthiness (`if (d.cover_media_id)`)
  // while scalars used `!== undefined`, which meant clearing an author or a cover locally simply
  // omitted the key — so the live entry kept the old relation forever with no way to unset it.
  const has = (k: keyof BlogDraft) => k in d;

  if (has("title")) out.title = d.title;
  if (has("slug")) out.slug = d.slug;
  if (has("body")) out.body = d.body;
  if (has("description")) out.description = d.description;
  if (has("tags")) out.tags = d.tags;
  if (has("is_featured")) out.isFeatured = d.is_featured ?? false;
  if (has("should_index")) out.shouldIndex = d.should_index ?? true;
  if (has("canonical_tag")) out.canonicalTag = d.canonical_tag ?? null;
  if (has("youtube_video_id")) out.youtubeVideoId = d.youtube_video_id ?? null;

  if (has("cover_media_id")) out.cover = d.cover_media_id ?? null;
  if (has("author_id")) out.author = d.author_id ?? null;
  if (has("category_id")) out.category = d.category_id ?? null;

  // thumbnail is REQUIRED, so `null` is only ever legal while the entry is a draft. Sending
  // thumbnail:null in publish mode would turn a passing publish into a 400.
  if (has("thumbnail_media_id")) {
    const t = d.thumbnail_media_id ?? null;
    if (t !== null || mode === "draft") out.thumbnail = t;
  }

  // Required component. Only synthesise the empty shape when publishing (where its absence is a
  // hard failure); on a draft, omit it entirely rather than writing {text:"",url:""} — Strapi's
  // required check is notNil(), so empty strings would satisfy it and mask a missing CTA.
  const hasCta = !!d.hero_cta_text?.trim() || !!d.hero_cta_url?.trim();
  if (hasCta || mode === "publish") {
    out.resourceHeroCTA = { text: d.hero_cta_text ?? "", url: d.hero_cta_url ?? "" };
  }

  // Optional component whose inner fields are all required. A full Supabase row always contains
  // these keys (as null), so the old `!== undefined` test fired on every single draft and wrote an
  // empty component. Only emit when there's real content, or when publishing.
  const hasSeo = !!d.seo_title?.trim() || !!d.seo_description?.trim() || !!d.seo_keywords?.trim();
  if (hasSeo || mode === "publish") {
    out.resourceMetaData = {
      title: d.seo_title || d.title || "",
      description: d.seo_description || d.description || "",
      keywords: d.seo_keywords || "",
    };
  }

  if (opts.locale) out.locale = d.locale || opts.locale;

  return out;
}

/** Blocks a *sync* (push as an unpublished Strapi draft). Strapi relaxes `required` and
 *  `minLength` for drafts, but NOT uid uniqueness — so slug is the only hard gate here. */
export function syncReadiness(d: Partial<BlogDraft>): string[] {
  const problems: string[] = [];
  if (!d.slug?.trim()) problems.push("Slug is required (Strapi uses it as a unique id).");
  return problems;
}

/**
 * Blocks a *publish*.
 *
 * ⚠️ This is not a convenience mirror of Strapi's validation — it is the ONLY gate. Probed against
 * the live instance (scripts/blog_strapi_draft_probe.mjs): a `PUT` that sets `publishedAt` does
 * **not** re-run validation. An entry with title "x", no description and no hero CTA published with
 * HTTP 200 and zero errors. Strapi only validates on *create*, so our two-step publish
 * (updateEntry → publishEntry) bypasses its validation entirely.
 *
 * Consequences, both load-bearing:
 *   - The publish route must call this BEFORE touching Strapi (it does). Never make it advisory.
 *   - Never "simplify" publishing into a single create-with-publishedAt call to get Strapi's
 *     validation back: that loses the ordering guarantee that stops stale content going live.
 */
export function publishReadiness(d: Partial<BlogDraft>): string[] {
  const problems: string[] = [];
  if (!d.title || d.title.length < 35) problems.push(`Title needs ≥35 characters (currently ${d.title?.length ?? 0}).`);
  if (!d.description || d.description.length < 120) problems.push(`Description needs ≥120 characters (currently ${d.description?.length ?? 0}).`);
  // Declared `required: true` on the content type, but the REST API does NOT enforce it — a publish
  // with every other field present and no thumbnail returns 200 (probed). We block on it anyway,
  // deliberately: it's the social/preview card image for an SEO page, the Strapi admin does enforce
  // it, and "Use cover" makes satisfying it one click. This is our rule, not Strapi's.
  if (!d.thumbnail_media_id) problems.push("Thumbnail image is required (social/preview card).");
  if (!d.hero_cta_text?.trim() || !d.hero_cta_url?.trim()) problems.push("Hero CTA (text + URL) is required.");
  if (!d.slug?.trim()) problems.push("Slug is required.");
  return problems;
}
