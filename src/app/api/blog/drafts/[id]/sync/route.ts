import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import {
  getBlogDraft, markBlogDraftSynced, markBlogDraftSyncFailed,
  createBlogDraftRevision, blogSlugTaken,
} from "@/lib/db/queries";
import {
  createEntry, updateEntry, blogType, strapiConfigured, adminEntryUrl, strapiLocale,
} from "@/lib/strapi/client";
import { mapDraftToStrapi, syncReadiness } from "@/lib/strapi/mapDraft";
import { editableSnapshot } from "@/lib/blog/fields";
import { deriveSyncState } from "@/lib/blog/state";

export const maxDuration = 60;

// POST — push this draft to Strapi as an UNPUBLISHED entry (publishedAt: null), so a teammate can
// open and edit it in the Strapi admin. Creates the entry the first time, updates it after that.
//
// Deliberately separate from saving. Autosave writes only to our Postgres and can never fail on a
// missing section; this is the explicit "put it in the CMS" step. Strapi relaxes required/minLength
// for drafts, so an incomplete post syncs fine — only slug uniqueness is enforced (it's a `uid`).
//
// On failure the local row is left completely untouched apart from the error bookkeeping. The old
// behaviour returned ok:true with a `warning` string, which let local and remote diverge silently
// with nothing persisted to record it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await auth().catch(() => null);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!strapiConfigured()) {
    return NextResponse.json({ ok: false, error: "Strapi not configured" }, { status: 503 });
  }
  const { id } = await params;
  try {
    const draft = await getBlogDraft(id);
    if (!draft) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    const problems = syncReadiness(draft);
    if (problems.length) {
      return NextResponse.json({ ok: false, error: problems.join(" ") }, { status: 400 });
    }
    // uid uniqueness is global and is NOT relaxed for drafts, so catch a local collision here
    // rather than letting Strapi answer with a less obvious 400.
    if (await blogSlugTaken(draft.slug, draft.id)) {
      return NextResponse.json(
        { ok: false, error: `The slug "${draft.slug}" is already used by another draft.` },
        { status: 400 },
      );
    }

    // Snapshot before pushing, so there's always a record of exactly what went to the CMS.
    await createBlogDraftRevision(id, draft.rev, "pre_sync", editableSnapshot(draft), s.user?.email)
      .catch(() => {});

    let strapiId = draft.strapi_id ?? null;
    try {
      if (strapiId) {
        // Never touches publishedAt — re-syncing a draft keeps it a draft, and re-syncing a live
        // post keeps it live (that's the "Push update" case).
        await updateEntry(blogType(), strapiId, mapDraftToStrapi(draft, { mode: "draft" }));
      } else {
        const created = await createEntry(
          blogType(),
          // locale is only settable at create time in v4.
          mapDraftToStrapi(draft, { mode: "draft", locale: strapiLocale() }),
          { publish: false },
        );
        strapiId = created.id;
      }
    } catch (e: any) {
      const message = e?.message ?? "Strapi sync failed";
      const failed = await markBlogDraftSyncFailed(id, message);
      return NextResponse.json(
        { ok: false, error: message, draft: failed, syncState: deriveSyncState(failed) },
        { status: 502 },
      );
    }

    const updated = await markBlogDraftSynced(id, strapiId!, draft.rev, adminEntryUrl(strapiId!));
    return NextResponse.json({
      ok: true,
      draft: updated,
      syncState: deriveSyncState(updated),
      adminUrl: adminEntryUrl(strapiId!),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "sync failed" }, { status: 500 });
  }
}
