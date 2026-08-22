// Strapi REST client (v4). Talks to the CMS that holds imagine.art's blog content ("resources"
// content type, confirmed via scripts/strapi_probe.mjs against the live dev instance) so the
// app can list/create/edit/publish posts and upload images without anyone leaving for the
// Strapi admin. Env-driven, same convention as src/lib/indexing/repo.ts / linear.ts.
//
// Confirmed v4 semantics on this instance (NOT v5 — verify before ever bumping this client):
//  - entries are addressed by the numeric `id`, not a `documentId`
//  - raw responses nest fields under `.attributes` ({data:{id,attributes:{...}}}); this
//    client FLATTENS them to {id, ...fields} so callers never touch `.attributes` directly
//  - draft/published is the `publishedAt` timestamp (null = draft); there is no `status` query
//    param or `/actions/publish` route — GET needs `publicationState=preview` to see drafts,
//    and publish/unpublish is just an update setting/clearing `publishedAt`
//  - relations are set by plain numeric id in the `data` payload (e.g. `{ author: 3 }`)
//  - media upload is multipart to POST /api/upload (field name "files"), provider is
//    Cloudflare R2 but that's transparent to the API

export interface StrapiEntry {
  id: number;
  publishedAt?: string | null;
  [key: string]: unknown;
}
export interface StrapiMedia {
  id: number;
  name: string;
  url: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  alternativeText?: string | null;
}
export interface ListResult<T = StrapiEntry> {
  data: T[];
  meta: { pagination?: { page: number; pageSize: number; pageCount: number; total: number } };
}

export function strapiConfigured(): boolean {
  return !!process.env.STRAPI_URL && !!process.env.STRAPI_API_TOKEN;
}
export function blogType(): string {
  return process.env.STRAPI_BLOG_TYPE?.trim() || "resources";
}
export function categoryType(): string {
  return process.env.STRAPI_CATEGORY_TYPE?.trim() || "resource-categories";
}
/** Full model uid, needed for admin deep-links and for uploadFile's `ref`. Kept env-driven so it
 *  can't silently disagree with blogType() the way the hardcoded literal in the publish route did. */
export function blogUid(): string {
  return process.env.STRAPI_BLOG_UID?.trim() || "api::resource.resource";
}
/** The locale a new entry is created in. The `resources` type has i18n enabled (en/id/es); we
 *  author in one locale and leave translations to the Strapi admin, because v4 has no "change an
 *  entry's locale" update — localizations are a separate create-then-link flow. */
export function strapiLocale(): string {
  return process.env.STRAPI_LOCALE?.trim() || "en";
}
/** Deep-link to an entry in the Strapi admin. */
export function adminEntryUrl(id: number | string): string {
  return adminUrlFor(blogUid(), id);
}
/** Deep-link to an entry of ANY content type. Landing pages live on `api::cluster-page.cluster-page`,
 *  not the blog type, and handing an editor a link into the wrong collection is worse than handing them
 *  no link — they would edit the wrong record and believe they had done the job. */
export function adminUrlFor(uid: string, id: number | string): string {
  return `${base()}/admin/content-manager/collection-types/${uid}/${id}`;
}
function base(): string {
  const u = process.env.STRAPI_URL?.trim();
  if (!u) throw new Error("STRAPI_URL not set in .env.local");
  return u.replace(/\/$/, "");
}
function token(): string {
  const t = process.env.STRAPI_API_TOKEN?.trim();
  if (!t) throw new Error("STRAPI_API_TOKEN not set in .env.local");
  return t;
}
function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${token()}` };
}

// v4 → flat: {id, attributes:{...}} → {id, ...attributes}, recursing into populated
// relations/media (each of which is itself {data: null | {id,attributes} | [{id,attributes}]}).
function flatten(raw: any): any {
  if (raw === null || raw === undefined) return raw;
  if (Array.isArray(raw)) return raw.map(flatten);
  if (typeof raw !== "object") return raw;
  if ("data" in raw && Object.keys(raw).length === 1) return flatten(raw.data); // relation wrapper
  if ("id" in raw && "attributes" in raw) {
    const { id, attributes, ...rest } = raw;
    const flat: Record<string, unknown> = { id, ...rest };
    for (const [k, v] of Object.entries(attributes as Record<string, unknown>)) flat[k] = flatten(v);
    return flat;
  }
  return raw;
}

// Shared JSON request wrapper. Surfaces Strapi's structured error message instead of a bare status.
async function req<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    // Strapi validation errors collapse to "N errors occurred" — pull the per-field messages
    // out of error.details.errors so callers (and the composer's UI) see e.g. "title must be
    // at least 35 characters" instead of a useless count.
    const fieldErrors: string[] = (json?.error?.details?.errors ?? []).map(
      (e: any) => `${(e.path ?? []).join(".")}: ${e.message}`,
    );
    const msg = fieldErrors.length ? fieldErrors.join("; ") : json?.error?.message || json?.raw || `HTTP ${res.status}`;
    throw new Error(`Strapi ${res.status}: ${msg}`);
  }
  return json as T;
}

export interface ListOptions {
  /** "draft" only returns unpublished entries; "published" only live ones; omit = both (needs preview perm). */
  status?: "draft" | "published";
  page?: number;
  pageSize?: number;
  populate?: string;       // e.g. "*" or "cover"
  sort?: string;           // e.g. "updatedAt:desc"
  filters?: Record<string, string>; // {slug: "my-post"} → filters[slug][$eq]=my-post
  search?: string;         // convenience: filters title/$containsi
  searchField?: string;    // field to search (default "title")
}

function listQuery(o: ListOptions): string {
  const p = new URLSearchParams();
  // publicationState=preview surfaces BOTH draft and published; we filter client-side by
  // publishedAt when o.status narrows to one or the other (v4 has no direct query for that).
  p.set("publicationState", "preview");
  p.set("pagination[page]", String(o.page ?? 1));
  p.set("pagination[pageSize]", String(o.pageSize ?? 25));
  p.set("populate", o.populate ?? "*");
  if (o.sort) p.set("sort", o.sort);
  for (const [k, v] of Object.entries(o.filters ?? {})) p.set(`filters[${k}][$eq]`, v);
  if (o.search) p.set(`filters[${o.searchField ?? "title"}][$containsi]`, o.search);
  return p.toString();
}

export async function listEntries<T extends StrapiEntry = StrapiEntry>(type: string, opts: ListOptions = {}): Promise<ListResult<T>> {
  const res = await req<{ data: any[]; meta: ListResult["meta"] }>(`/api/${type}?${listQuery(opts)}`);
  let data = res.data.map(flatten) as T[];
  if (opts.status === "draft") data = data.filter((d) => !d.publishedAt);
  if (opts.status === "published") data = data.filter((d) => !!d.publishedAt);
  return { data, meta: res.meta };
}

export async function getEntry<T extends StrapiEntry = StrapiEntry>(type: string, id: number | string, opts: { populate?: string } = {}): Promise<T> {
  const p = new URLSearchParams();
  p.set("publicationState", "preview");
  p.set("populate", opts.populate ?? "*");
  const { data } = await req<{ data: any }>(`/api/${type}/${id}?${p.toString()}`);
  return flatten(data) as T;
}

export async function findOneBySlug<T extends StrapiEntry = StrapiEntry>(type: string, slug: string, slugField = "slug"): Promise<T | null> {
  const { data } = await listEntries<T>(type, { filters: { [slugField]: slug }, pageSize: 1 });
  return data[0] ?? null;
}

// Create an entry. Draft by default — a human publishes after review.
//
// ⚠️ `publishedAt` is ALWAYS sent explicitly, never omitted. This used to omit the key for drafts,
// which is not the same thing: on a Draft & Publish content type Strapi v4 defaults publishedAt to
// `() => new Date()`, and its isDraft() check tests `publishedAt === null` STRICTLY — `undefined`
// is not `null`. So omitting the key created a PUBLISHED entry, i.e. it silently went live. Being
// explicit is correct whichever way that default behaves, so don't "simplify" this back.
export async function createEntry<T extends StrapiEntry = StrapiEntry>(type: string, data: Record<string, unknown>, opts: { publish?: boolean } = {}): Promise<T> {
  const body = { ...data, publishedAt: opts.publish ? new Date().toISOString() : null };
  const res = await req<{ data: any }>(`/api/${type}`, { method: "POST", body: JSON.stringify({ data: body }) });
  return flatten(res.data) as T;
}

// Update an entry's fields. Does NOT touch publishedAt unless you pass publish/unpublish —
// editing a published post's fields leaves it published; use publishEntry/unpublishEntry for
// deliberate state changes.
export async function updateEntry<T extends StrapiEntry = StrapiEntry>(type: string, id: number | string, data: Record<string, unknown>): Promise<T> {
  const res = await req<{ data: any }>(`/api/${type}/${id}`, { method: "PUT", body: JSON.stringify({ data }) });
  return flatten(res.data) as T;
}

export async function publishEntry<T extends StrapiEntry = StrapiEntry>(type: string, id: number | string): Promise<T> {
  return updateEntry<T>(type, id, { publishedAt: new Date().toISOString() });
}
export async function unpublishEntry<T extends StrapiEntry = StrapiEntry>(type: string, id: number | string): Promise<T> {
  return updateEntry<T>(type, id, { publishedAt: null });
}

export async function deleteEntry(type: string, id: number | string): Promise<void> {
  await req(`/api/${type}/${id}`, { method: "DELETE" });
}

// ── Media upload ────────────────────────────────────────────────────────────
// Upload bytes to the media library. Optionally attach to an entry field in the same request
// (ref = full model uid e.g. "api::resource.resource", refId = the entry's numeric id, field =
// the media field name). Returns the uploaded media record(s). Uses global FormData/Blob.
export async function uploadFile(
  file: { bytes: Uint8Array | Buffer; filename: string; mime: string },
  attach?: { ref: string; refId: number | string; field: string },
  fileInfo?: { name?: string; alternativeText?: string; caption?: string },
): Promise<StrapiMedia[]> {
  const form = new FormData();
  const blob = new Blob([file.bytes as BlobPart], { type: file.mime });
  form.append("files", blob, file.filename);
  if (fileInfo) form.append("fileInfo", JSON.stringify(fileInfo));
  if (attach) {
    form.append("ref", attach.ref);
    form.append("refId", String(attach.refId));
    form.append("field", attach.field);
  }
  const res = await fetch(`${base()}/api/upload`, {
    method: "POST",
    headers: authHeaders(), // no Content-Type — let fetch set the multipart boundary
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : []; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`Strapi upload ${res.status}: ${json?.error?.message || json?.raw || "failed"}`);
  return Array.isArray(json) ? json : [json];
}

// Absolute URL for a media path (this instance's provider already returns absolute R2 URLs,
// but guard for local-provider instances that return root-relative paths).
export function mediaUrl(url: string): string {
  if (!url) return url;
  return url.startsWith("http") ? url : `${base()}${url}`;
}
