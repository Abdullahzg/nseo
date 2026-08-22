import { NextRequest, NextResponse } from "next/server";
import { isAuthorized, identifyCaller, actorFor } from "@/lib/auth/service";
import { listLandingPages, createLandingPage, researchLanding } from "@/lib/landing/store";

// Research hits Search Console and the sitemap inventory, so give it room.
export const maxDuration = 120;

// Takes `req` so a machine caller can be identified — the previous signature took no arguments,
// so a Bearer token was invisible to it and Hermes could never list pages to launch.
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, pages: await listLandingPages() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "load failed" }, { status: 500 });
  }
}

// POST — capture a brief and ground it in one step.
//
// Research runs BEFORE the page is created rather than as a later action, because its most valuable
// output is "do not build this, we already rank for it" — and that is only useful before anyone spends
// a session writing code.
export async function POST(req: NextRequest) {
  // Was session-only, so the GET accepted a machine caller and the POST silently did not — an agent or a
  // scheduled job could list landing pages but never create one. Same gate on both, and the actor is
  // captured so `created_by` records who (or what) started the page.
  const caller = await identifyCaller(req);
  const actor = actorFor(caller);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const feature = String(body?.feature ?? "").trim();
  if (!feature) return NextResponse.json({ ok: false, error: "What feature is the page for?" }, { status: 400 });

  const keyword = String(body?.primary_keyword ?? "").trim();
  const targetPath = String(body?.target_path ?? "").trim() || null;

  try {
    const research = keyword ? await researchLanding(keyword, targetPath ?? undefined) : null;
    const page = await createLandingPage({
      feature,
      primary_keyword: keyword || null,
      target_path: targetPath,
      brief: {
        audience: String(body?.audience ?? "").trim() || undefined,
        angle: String(body?.angle ?? "").trim() || undefined,
        direction: String(body?.direction ?? "").trim() || undefined,
        sections: Array.isArray(body?.sections) ? body.sections.map(String).filter(Boolean) : undefined,
      },
      research: (research ?? {}) as unknown as Record<string, unknown>,
      created_by: actor,
    });

    // Starter imagery, not awaited — same reasoning as the blog path: a provider outage must not stop
    // someone capturing a brief. A landing page has no blog_draft yet, so nothing is attached; the hero
    // and social card land in the gallery ready to be placed once the page is templatized or drafted.
    void import("@/lib/media/prefill")
      .then(({ prefillAssets }) => prefillAssets({
        draftId: null,
        title: feature,
        keyword: keyword || feature,
        kind: "landing",
        actor,
      }))
      .catch(() => { /* best-effort — the brief is captured either way */ });
    return NextResponse.json({ ok: true, page });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "create failed" }, { status: 500 });
  }
}
