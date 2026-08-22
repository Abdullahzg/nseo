import { NextRequest, NextResponse } from "next/server";
import { identifyCaller, actorFor } from "@/lib/auth/service";
import {
  falQueue, falEnabled, buildPayload, modelForRole, resolutionForRole, resolveModel,
  MODELS, FalError, refIsReachable, MAX_REFS,
} from "@/lib/media/fal";
import { buildImagePrompt } from "@/lib/media/prompt";
import { planAssets, SIZE_PRESETS, type AssetRole } from "@/lib/media/plan";
import { createMediaAsset, logGeneration } from "@/lib/media/store";
import { renderOne } from "@/lib/media/render";
import { getBlogDraft } from "@/lib/db/queries";
import { parseBlocks } from "@/lib/blog/markdown";

// A single 4K render can take minutes; a batch of four takes longer. This route has to outlive that.
export const maxDuration = 300;

/**
 * POST — generate one or more images.
 *
 * Two modes:
 *   { draft_id }              → plan the whole page's assets from the draft and render them
 *   { role, subject, topic }  → render one asset directly, for the gallery page
 *
 * Everything is logged, including refusals, because a content-policy block is information about the
 * prompt rather than a transient fault.
 */
export async function POST(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!falEnabled()) {
    // Degrade with an explanation, the same way writerEnabled() gates the writer. The gallery, the
    // planner and the picker all work without a key; only rendering needs one.
    return NextResponse.json(
      { ok: false, error: "FAL_KEY is not set, so images cannot be generated yet. Everything else in the gallery works." },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  // Machine callers get a synthetic actor so created_by is never null — the adoption report
  // counts by owner, and a null would silently under-count generated assets.
  const actor = actorFor(caller);

  // References the model may condition on. fal cannot reach localhost, and a data URL over a few
  // hundred KB makes it reject its own input — so anything large should be a public URL.
  const refs = (Array.isArray(body?.image_urls) ? body.image_urls : [])
    .map((u: unknown) => String(u))
    .filter(refIsReachable)
    .slice(0, MAX_REFS);

  try {
    // ── Mode 1: plan a whole draft's assets ────────────────────────────────────────────────────
    if (typeof body?.draft_id === "string" && body.draft_id) {
      const draft = await getBlogDraft(body.draft_id);
      if (!draft) return NextResponse.json({ ok: false, error: "Draft not found." }, { status: 404 });

      const words = (draft.body ?? "").trim().split(/\s+/).filter(Boolean).length;
      const headings = parseBlocks(draft.body ?? "")
        .filter((b) => b.t === "h" && (b as { level?: number }).level === 2)
        .map((b, i) => ({ index: i, heading: (b as { text: string }).text, level: "h2" }));

      const keyword = String(body?.keyword ?? draft.seo_keywords?.split(",")[0] ?? draft.title ?? "").trim();
      const { assets: planned, notes } = planAssets({
        title: draft.title || "Untitled", keyword, words, headings,
        kind: body?.kind === "landing" ? "landing" : "blog",
      });

      // Only the roles asked for, so "just the hero" does not cost a whole page of renders.
      const wanted: string[] = Array.isArray(body?.roles) && body.roles.length
        ? body.roles.map(String)
        : planned.map((a) => a.role);
      const todo = planned.filter((a) => wanted.includes(a.role));

      const results = [];
      for (const [slot, asset] of todo.entries()) {
        results.push(await renderOne({ asset, topic: keyword || draft.title, title: draft.title, slot, refs, actor, draftId: draft.id, direction: body?.direction }));
      }
      return NextResponse.json({ ok: true, assets: results.filter((r) => r.asset).map((r) => r.asset), results, notes });
    }

    // ── Mode 2: one asset, straight from the gallery page ──────────────────────────────────────
    const role = (["og", "hero", "inline", "thumbnail"] as const).includes(body?.role) ? (body.role as AssetRole) : "inline";
    const subject = String(body?.subject ?? "").trim();
    const topic = String(body?.topic ?? subject).trim();
    if (!subject) return NextResponse.json({ ok: false, error: "Describe what the image should show." }, { status: 400 });

    const count = Math.max(1, Math.min(Number(body?.count) || 1, 4));
    const preset = SIZE_PRESETS[role];
    // Blog is the safe default: an over-restrained landing image is a milder failure than a salesy
    // blog image, so an unknown value lands on the conservative side.
    const surface = body?.surface === "landing" ? "landing" as const : "blog" as const;
    const results = [];
    for (let slot = 0; slot < count; slot++) {
      results.push(await renderOne({
        asset: {
          role, ...preset, filename: "", subject,
          alt: String(body?.alt ?? subject),
          priority: role === "hero",
          allow_text: role === "og" || role === "thumbnail",
          why: preset.why,
        },
        topic, title: String(body?.title ?? subject), slot, refs, actor, surface,
        draftId: typeof body?.draft_id === "string" ? body.draft_id : null,
        direction: body?.direction,
      }));
    }
    return NextResponse.json({ ok: true, assets: results.filter((r) => r.asset).map((r) => r.asset), results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "generation failed" }, { status: 500 });
  }
}

export { MODELS, resolveModel };
