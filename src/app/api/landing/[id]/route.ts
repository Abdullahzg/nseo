import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import {
  getLandingPage, updateLandingPage, deleteLandingPage, skillBrief, researchLanding, STAGES,
} from "@/lib/landing/store";

export const maxDuration = 120;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await auth().catch(() => null);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const page = await getLandingPage(id);
  if (!page) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  // The skill brief is derived, never stored — it must always reflect the current brief and research.
  return NextResponse.json({ ok: true, page, skill_brief: skillBrief(page) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await auth().catch(() => null);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if (body?.stage && !STAGES.includes(body.stage)) {
    return NextResponse.json({ ok: false, error: `Unknown stage "${body.stage}".` }, { status: 400 });
  }

  try {
    // Re-running research is explicit: rankings move, and a brief captured three weeks ago may now be
    // advising against a page that has since become worth building (or vice versa).
    if (body?.action === "reresearch") {
      const page = await getLandingPage(id);
      if (!page) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
      if (!page.primary_keyword) {
        return NextResponse.json({ ok: false, error: "This page has no keyword to research." }, { status: 400 });
      }
      const research = await researchLanding(page.primary_keyword, page.target_path ?? undefined);
      const updated = await updateLandingPage(id, { research: research as unknown as Record<string, unknown> });
      return NextResponse.json({ ok: true, page: updated, skill_brief: skillBrief(updated) });
    }

    const updated = await updateLandingPage(id, body);
    return NextResponse.json({ ok: true, page: updated, skill_brief: skillBrief(updated) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "update failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await auth().catch(() => null);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    await deleteLandingPage(id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "delete failed" }, { status: 500 });
  }
}
