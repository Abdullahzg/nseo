import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import {
  getBlogDraft, markBlogDraftPublished, markBlogDraftSyncFailed,
  createBlogDraftRevision, blogSlugTaken,
} from "@/lib/db/queries";
import {
  createEntry, updateEntry, publishEntry, blogType, strapiConfigured, adminEntryUrl, strapiLocale,
} from "@/lib/strapi/client";
import { mapDraftToStrapi, publishReadiness } from "@/lib/strapi/mapDraft";
import { editableSnapshot } from "@/lib/blog/fields";
import { deriveSyncState } from "@/lib/blog/state";

export const maxDuration = 60;

/** Publishing writes to whatever host STRAPI_URL points at. That is currently a sandbox, but a
 *  config change is all that stands between here and a live site, so the host is echoed back to the
 *  caller on every publish and can be gated outright with STRAPI_ALLOW_PUBLISH. */
function publishGate(): { ok: true; host: string } | { ok: false; error: string } {
  const host = (process.env.STRAPI_URL ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const allow = process.env.STRAPI_ALLOW_PUBLISH?.trim();
  if (allow && allow !== "1" && allow !== "true" && allow !== host) {
    return { ok: false, error: `Publishing is disabled for ${host} (STRAPI_ALLOW_PUBLISH=${allow}).` };
  }
  return { ok: true, host };
}

// POST — make this post LIVE in Strapi. The one action that publishes; never a side effect of a
// save or a sync.
//
// Two calls in a fixed order: push the current fields, THEN set publishedAt. That way we can never
// publish stale content, and a failure at step 2 leaves a correct, still-unpublished draft rather
// than a half-updated live post. If the draft has never been synced, this syncs it first so the
// user doesn't have to sequence two buttons.
//
// ⚠️ The publishReadiness() call below is not a nicety — it is the only validation that runs.
// Probed on the live instance: a PUT setting publishedAt does NOT re-validate, so Strapi will
// happily publish an entry with a one-character title and no description (HTTP 200, no errors).
// Strapi validates on create only, and our two-step deliberately avoids create-with-publishedAt.
// If this guard is ever moved after the Strapi calls, or downgraded to a warning, invalid content
// goes live silently. See scripts/blog_strapi_draft_probe.mjs.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Session-only: publishing is a deliberate human act, so no CRON_SECRET path here. That's also
  // what stops the unattended cluster writer from ever reaching it.
  const s = await auth().catch(() => null);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!strapiConfigured()) {
    return NextResponse.json({ ok: false, error: "Strapi not configured" }, { status: 503 });
  }
  const gate = publishGate();
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

  const { id } = await params;
  try {
    const draft = await getBlogDraft(id);
    if (!draft) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    const problems = publishReadiness(draft);
    if (problems.length) {
      return NextResponse.json(
        { ok: false, error: problems.join(" "), problems, host: gate.host },
        { status: 400 },
      );
    }
    if (await blogSlugTaken(draft.slug, draft.id)) {
      return NextResponse.json(
        { ok: false, error: `The slug "${draft.slug}" is already used by another draft.` },
        { status: 400 },
      );
    }

    await createBlogDraftRevision(id, draft.rev, "pre_publish", editableSnapshot(draft), s.user?.email)
      .catch(() => {});

    let strapiId = draft.strapi_id ?? null;
    try {
      const fields = mapDraftToStrapi(draft, { mode: "publish" });
      if (strapiId) {
        await updateEntry(blogType(), strapiId, fields);
      } else {
        // Created as a draft, then published below — same two-step, so the ordering guarantee
        // holds even for a never-synced post.
        const created = await createEntry(
          blogType(),
          mapDraftToStrapi(draft, { mode: "publish", locale: strapiLocale() }),
          { publish: false },
        );
        strapiId = created.id;
      }
      await publishEntry(blogType(), strapiId!);
    } catch (e: any) {
      const message = e?.message ?? "Strapi publish failed";
      const failed = await markBlogDraftSyncFailed(id, message);
      return NextResponse.json(
        { ok: false, error: message, draft: failed, syncState: deriveSyncState(failed), host: gate.host },
        { status: 502 },
      );
    }

    const updated = await markBlogDraftPublished(id, strapiId!, draft.rev, adminEntryUrl(strapiId!));
    return NextResponse.json({
      ok: true,
      draft: updated,
      syncState: deriveSyncState(updated),
      adminUrl: adminEntryUrl(strapiId!),
      host: gate.host,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "publish failed" }, { status: 500 });
  }
}
