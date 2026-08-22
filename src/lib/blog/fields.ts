// The single gate every blog-draft write passes through (POST, PATCH, PUT, flush).
//
// Before this existed, the routes did `updateBlogDraft(id, body)` with the raw request body, and
// the editor sent the ENTIRE selected draft back — including id, created_at, status, strapi_id
// and strapi_url. Two consequences: a stale form could silently overwrite `status`/`strapi_id`,
// and any unknown key surfaced as a raw Postgres error inside a 500. Autosave fires constantly,
// so both had to become impossible rather than unlikely.
//
// Rules: unknown keys are DROPPED and reported (never passed to Postgres), values are coerced to
// the column's type, and NOT NULL columns can never be set to null.
import type { BlogDraft } from "@/lib/db/queries";

/** Every field a human (or the writer agent) may edit. Anything absent here is server-owned. */
export const EDITABLE_FIELDS = [
  "title", "slug", "body", "description", "tags",
  "is_featured", "should_index", "canonical_tag", "youtube_video_id",
  "cover_media_id", "cover_media_url",
  "thumbnail_media_id", "thumbnail_media_url",
  "author_id", "category_id",
  "hero_cta_text", "hero_cta_url",
  "seo_title", "seo_description", "seo_keywords",
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Deliberately NOT editable, listed so the reason is discoverable rather than folklore:
 *  id/created_at/updated_at — identity and bookkeeping.
 *  status/strapi_id/strapi_url/strapi_published_at/published_at — owned by the publish path.
 *  sync_state/sync_error/sync_attempted_at/synced_at/synced_rev — owned by the sync path.
 *  rev/last_edited_by — stamped by the guarded update itself.
 *  locale — set once at Strapi create time; v4 has no "change an entry's locale" update.
 *  writer_status/writer_qa/writer_session_id/cluster_id — owned by the writer agent. */

/** Columns declared NOT NULL DEFAULT '' in scripts/035 — a null here is a 500, so coerce to "". */
const NON_NULL_TEXT = new Set<EditableField>(["title", "slug", "body", "description"]);
const NULLABLE_TEXT = new Set<EditableField>([
  "tags", "canonical_tag", "youtube_video_id", "cover_media_url", "thumbnail_media_url",
  "hero_cta_text", "hero_cta_url", "seo_title", "seo_description", "seo_keywords",
]);
const BOOLEANS = new Set<EditableField>(["is_featured", "should_index"]);
/** Strapi ids / media ids. Empty string and NaN both mean "cleared", not 0. */
const NULLABLE_INTS = new Set<EditableField>([
  "cover_media_id", "thumbnail_media_id", "author_id", "category_id",
]);

function coerce(key: EditableField, raw: unknown): unknown {
  if (BOOLEANS.has(key)) return raw === true || raw === "true";
  if (NULLABLE_INTS.has(key)) {
    if (raw === null || raw === undefined || raw === "") return null;
    const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : null;
  }
  if (NON_NULL_TEXT.has(key)) return raw === null || raw === undefined ? "" : String(raw);
  if (NULLABLE_TEXT.has(key)) return raw === null || raw === undefined ? null : String(raw);
  return raw;
}

const EDITABLE_SET = new Set<string>(EDITABLE_FIELDS);

export interface SanitizedPatch {
  patch: Partial<BlogDraft>;
  /** Keys the caller sent that we refused. Surfaced in dev to catch a drifting client. */
  rejected: string[];
}

/**
 * Reduce an arbitrary request body to the subset that may touch `blog_drafts`.
 * Absent keys stay absent (so a PATCH only writes what actually changed); present-but-unknown
 * keys are dropped into `rejected`.
 */
export function sanitizePatch(body: unknown): SanitizedPatch {
  const patch: Record<string, unknown> = {};
  const rejected: string[] = [];
  if (!body || typeof body !== "object") return { patch, rejected };
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    // base_rev rides along on PATCH as a concurrency token, not a column. Not a client bug.
    if (key === "base_rev" || key === "force" || key === "reason") continue;
    if (!EDITABLE_SET.has(key)) { rejected.push(key); continue; }
    patch[key] = coerce(key as EditableField, value);
  }
  return { patch: patch as Partial<BlogDraft>, rejected };
}

/**
 * Only the editable fields whose value actually differs from the last known server row.
 * Autosave calls this so editing the body doesn't resend 20 unrelated columns on every keystroke
 * batch — which also keeps a stale field in the form from clobbering someone else's change to it.
 */
export function changedFields(
  server: Partial<BlogDraft> | null | undefined,
  form: Partial<BlogDraft>,
): Partial<BlogDraft> {
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) {
    if (!(key in form)) continue;
    const next = coerce(key, form[key as keyof BlogDraft]);
    const prev = server ? coerce(key, server[key as keyof BlogDraft]) : undefined;
    // Treat null and "" as equal for nullable text: the form uses "" where the DB uses null,
    // and without this every draft would look permanently dirty.
    if (NULLABLE_TEXT.has(key) && (prev ?? "") === (next ?? "")) continue;
    if (prev !== next) out[key] = next;
  }
  return out as Partial<BlogDraft>;
}

/** Just the editable fields, for a revision snapshot or the localStorage journal. */
export function editableSnapshot(row: Partial<BlogDraft>): Partial<BlogDraft> {
  const out: Record<string, unknown> = {};
  for (const key of EDITABLE_FIELDS) if (key in row) out[key] = row[key as keyof BlogDraft];
  return out as Partial<BlogDraft>;
}

/** lowercase, strip non-alphanumerics, collapse dashes. Moved out of src/app/blog/page.tsx so
 *  the writer agent and the server-side slug reservation share one implementation. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

/** Strapi's `slug` is a REQUIRED unique `uid`, and uid uniqueness is not relaxed for drafts —
 *  so a brand-new draft needs a distinct placeholder, not "". Mirrors the backfill in 043. */
export function placeholderSlug(): string {
  return `untitled-${Math.random().toString(16).slice(2, 10)}`;
}
