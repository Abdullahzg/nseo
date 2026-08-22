import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth/service";
import { getTemplateCatalogue, humanizeSection } from "@/lib/landing/templates";

export const maxDuration = 30;

/**
 * The landing-page templates that actually exist in Strapi right now.
 *
 * `?fresh=1` bypasses the ten-minute cache, for the case that matters: someone just shipped a new
 * template in the other repo and wants to use it immediately. Without that escape hatch the operator's
 * only recourse is to wait, or to restart the app.
 *
 * Returns `error` rather than an empty list when Strapi is unreachable, so the picker can say "cannot
 * reach the CMS" instead of "no templates exist" — those need completely different responses from a
 * person, and conflating them sends them looking in the wrong place.
 */
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  const cat = await getTemplateCatalogue({ fresh });

  return NextResponse.json({
    ok: !cat.error,
    error: cat.error,
    categories: cat.categories,
    templates: cat.templates.map((t) => ({
      ...t,
      // Pre-humanized so every surface renders section names the same way rather than each one
      // re-deriving it and drifting.
      sectionLabels: t.sections.map(humanizeSection),
    })),
  });
}
