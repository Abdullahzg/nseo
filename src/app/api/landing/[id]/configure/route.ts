import { NextRequest, NextResponse } from "next/server";
import { identifyCaller, actorFor } from "@/lib/auth/service";
import { getLandingPage, updateLandingPage } from "@/lib/landing/store";
import { configureLandingEntry, validateChoice, skillHandoff, validateCampaign, campaignHandoff, suggestRepoName } from "@/lib/landing/configure";

export const maxDuration = 60;

/**
 * Commit a template decision for a landing page — the fork in the pipeline.
 *
 * Two bodies, two very different amounts of work:
 *
 *   { source: "existing", template, category, slug }
 *     Creates the cluster-page DRAFT in Strapi with the template pre-selected and returns a deep link
 *     into it. Nothing else is needed: the component and the imagine-web template already ship, so the
 *     page goes straight to needing copy. This is the common case and it is fully automated.
 *
 *   { source: "vibe_coded" }
 *     Records the decision and returns the handoff brief for the two skills. Cannot be automated from
 *     here — `imagine-landing` scaffolds a repo and `vibe-coded-template` edits two others, both in a
 *     coding session. Pretending otherwise would leave the page sitting at a stage nothing advances.
 *
 * Idempotent for the existing path: a page that already has a Strapi entry gets the same link back rather
 * than a second entry. Two entries for one page would let two people write competing copy and each
 * believe they owned the page.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await identifyCaller(req);
  const actor = actorFor(caller);
  if (!actor) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const page = await getLandingPage(id);
  if (!page) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const SOURCES = ["existing", "vibe_coded", "campaign"] as const;
  const source = SOURCES.find((s) => s === body.source) ?? null;
  if (!source) {
    return NextResponse.json({ ok: false, error: `source must be one of ${SOURCES.join(", ")}` }, { status: 400 });
  }

  // ── The campaign branch: clone a competitor reference for a paid campaign ──
  //
  // Its own repo and its own Vercel deployment, so nothing is created in Strapi. The value this route
  // adds is refusing a brief that cannot be built safely, and emitting the claim-safety checklist a
  // marketer has to clear — a live ad making an unverifiable claim is a different class of problem from
  // a layout bug, and it is the failure this path is most prone to.
  if (source === "campaign") {
    const input = {
      reference_url: String(body.reference_url ?? "").trim(),
      destination_url: String(body.destination_url ?? "").trim(),
      product_name: String(body.product_name ?? "").trim(),
      repo_name: (body.repo_name as string | undefined)?.trim() || null,
    };
    const check = validateCampaign(input);
    if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 400 });

    const repo = input.repo_name || suggestRepoName(input);
    await updateLandingPage(id, {
      template_source: "campaign",
      reference_url: input.reference_url,
      destination_url: input.destination_url,
      product_name: input.product_name,
      repo_name: repo,
    });
    return NextResponse.json({
      ok: true, source, repo,
      warnings: check.warnings,
      mustConfirm: check.mustConfirm,
      handoff: campaignHandoff(page, { ...input, repo_name: repo }),
      next: "Confirm the destination by rendering it, then run the campaign-landing-page skill with this brief.",
    });
  }

  // ── The vibe-coded branch: record the decision, hand off to the skills ──
  //
  // Unlike the campaign path, this one's whole creative input is the prompt and any reference images —
  // there is no reference page dictating layout. Both are optional at the type level (an operator may
  // genuinely have nothing but a keyword), but skillHandoff() surfaces an empty prompt loudly rather than
  // silently building from nothing, because "the page is not designed yet" is imagine-landing's own
  // stated failure mode for exactly this case.
  if (source === "vibe_coded") {
    const creative_prompt = typeof body.creative_prompt === "string" ? body.creative_prompt.trim() : "";
    const reference_image_urls = Array.isArray(body.reference_image_urls)
      ? body.reference_image_urls.filter((u: unknown): u is string => typeof u === "string" && u.trim().length > 0)
      : [];

    const updated = await updateLandingPage(id, {
      template_source: "vibe_coded",
      creative_prompt: creative_prompt || null,
      reference_image_urls,
    });
    return NextResponse.json({
      ok: true,
      source,
      // Left at whatever stage it was: a new template genuinely has not been built yet, and advancing the
      // stage here would claim work nobody has done.
      handoff: skillHandoff(updated),
      next: "Run the imagine-landing skill with this brief, then vibe-coded-template to port it. " +
        "Settle the final URL first — an /ai-* proxy prefix can never host the templatized route.",
    });
  }

  // ── The existing-template branch: create the entry, hand back the link ──
  const anyPage = page as unknown as Record<string, unknown>;
  const existingEntry = anyPage.strapi_entry_id as number | null | undefined;
  if (existingEntry) {
    const { adminUrlFor, } = await import("@/lib/strapi/client");
    const { CLUSTER_PAGE_UID } = await import("@/lib/landing/configure");
    return NextResponse.json({
      ok: true, source, reused: true,
      entryId: existingEntry,
      adminUrl: adminUrlFor(CLUSTER_PAGE_UID, existingEntry),
      next: "The Strapi entry already exists — open it and write the copy.",
    });
  }

  const input = {
    template: String(body.template ?? "").trim(),
    category: String(body.category ?? "").trim(),
    slug: String(body.slug ?? page.target_path ?? page.feature ?? "").trim(),
    title: (body.title as string | undefined) ?? page.feature,
    description: body.description as string | undefined,
  };

  // Validate against the live catalogue first. Otherwise every mistake surfaces as a Strapi 400 whose
  // message does not name the actual problem.
  const check = await validateChoice(input);
  if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 400 });

  let result;
  try {
    result = await configureLandingEntry(input);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "could not create the Strapi entry" },
      { status: 502 },
    );
  }

  await updateLandingPage(id, {
    template_source: "existing",
    strapi_template: result.template,
    strapi_category: result.category,
    strapi_entry_id: result.entryId,
    strapi_slug: result.slug,
    configured_at: new Date().toISOString(),
    // Reusing a template means vibe-coding and templatizing are not pending, they are inapplicable — so
    // the page lands at `templatised`, which is exactly "the template exists, copy is next".
    stage: page.stage === "brief" ? "templatised" : page.stage,
  });

  return NextResponse.json({
    ok: true,
    source,
    reused: false,
    entryId: result.entryId,
    adminUrl: result.adminUrl,
    slug: result.slug,
    warnings: result.warnings,
    next: "Open the Strapi entry and write the copy. It is a draft until someone publishes it.",
  });
}
