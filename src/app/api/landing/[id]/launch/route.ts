import { NextRequest, NextResponse } from "next/server";
import { identifyCaller, actorFor } from "@/lib/auth/service";
import { getLandingPage, updateLandingPage, skillBrief } from "@/lib/landing/store";
import { createBlogDraft, getBlogDraft } from "@/lib/db/queries";
import { placeholderSlug } from "@/lib/blog/fields";

export const maxDuration = 30;

/**
 * Turn a templatised landing page into a real draft the writer can fill.
 *
 * This is the step that was missing. `/landing` tracked five stages and
 * `STAGE_META.templatised.next` said "the AI writer fills the template's fields like any other
 * draft" — but nothing did it. The only control on the page wrote `{ stage }` directly, so a person
 * marked a page "drafted" by hand and then went to find the writer themselves. The status board
 * described a pipeline it could not move.
 *
 * What this does, in one action: create a `blog_drafts` row seeded from the landing brief, point the
 * landing row at it via `draft_id`, and advance the stage. From there a landing page IS a blog draft —
 * same writer, same Strapi publish path — which is the whole reason there is no separate publishing
 * surface for landing pages.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = actorFor(await identifyCaller(req));
  if (!actor) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const page = await getLandingPage(id);
  if (!page) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  // Idempotent: if a draft already exists, hand back the same one rather than making a second.
  // Double-clicking "Write the copy" must not fork the page into two competing drafts.
  if (page.draft_id) {
    const existing = await getBlogDraft(page.draft_id).catch(() => null);
    if (existing) {
      return NextResponse.json({ ok: true, draft_id: existing.id, reused: true });
    }
    // The draft was deleted out from under us — fall through and make a fresh one.
  }

  // Templatised is the earliest stage where a draft makes sense: before that there is no template for
  // the copy to fill, so a draft would have nowhere to go. Not a hard block though — the operator may
  // know something the stage field does not, so this is a warning carried in the response.
  const premature = page.stage === "brief" || page.stage === "vibe_coded";

  const title = `${page.feature}`.trim();
  const draft = await createBlogDraft({
    // The slug is a Strapi `uid` and therefore globally unique even across drafts, so it gets a
    // placeholder now and the real value at metadata time — same rule as any other draft.
    slug: page.target_path?.replace(/^\//, "") || placeholderSlug(),
    title,
    // The brief is the writer's starting context. skillBrief() already renders it grounded in the
    // research that was captured with the page, so the writer does not re-derive what we know.
    description: "",
    body: `<!-- Landing page brief — the AI writer should replace this with the page copy.\n\n${skillBrief(page)}\n-->\n`,
    status: "draft",
    created_by: actor,
    last_edited_by: actor,
  });

  await updateLandingPage(id, {
    draft_id: draft.id,
    // Only advance if this is genuinely the next step. Re-launching a published page must not drag it
    // backwards to "drafted".
    ...(page.stage === "templatised" ? { stage: "drafted" } : {}),
  });

  return NextResponse.json({
    ok: true,
    draft_id: draft.id,
    reused: false,
    ...(premature
      ? { warning: `This page is still at "${page.stage}" — there may be no Strapi template for the copy to fill yet.` }
      : {}),
  });
}
