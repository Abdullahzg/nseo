import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import {
  createWriterCluster, listWriterClusters, getWriterVoice, getDefaultWriterVoice,
} from "@/lib/db/queries";
import { keywordOpportunities, planCluster, estimateClusterCost } from "@/lib/writer/cluster";
import { writerEnabled } from "@/lib/writer/anthropic";

export const maxDuration = 120;

// GET ?seed=... — real striking-distance keyword opportunities from Search Console, so the picker
// shows measured demand rather than a text box the user has to guess into.
// GET (no seed)   — existing clusters.
export async function GET(req: NextRequest) {
  const s = await auth().catch(() => null);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const seed = req.nextUrl.searchParams.get("seed");
  try {
    if (seed !== null) {
      const d = await keywordOpportunities(seed || undefined, 40);
      return NextResponse.json({ ok: true, ...d });
    }
    return NextResponse.json({ ok: true, clusters: await listWriterClusters() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "load failed" }, { status: 500 });
  }
}

// POST { seed_keyword, size, voice_id? } — plan a cluster. Produces a plan for review; writes
// nothing and creates no drafts until it is approved.
export async function POST(req: NextRequest) {
  const s = await auth().catch(() => null);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!writerEnabled()) {
    return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY is not set." }, { status: 503 });
  }
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const seed = String((body as any)?.seed_keyword ?? "").trim();
  if (!seed) return NextResponse.json({ ok: false, error: "seed_keyword is required" }, { status: 400 });
  // Cap the size: one click starting a 30-article run is a large spend with no way to intervene.
  const size = Math.max(2, Math.min(Number((body as any)?.size) || 5, 12));

  try {
    const voice = (body as any)?.voice_id
      ? await getWriterVoice(String((body as any).voice_id))
      : await getDefaultWriterVoice();
    if (!voice) return NextResponse.json({ ok: false, error: "No voice available." }, { status: 400 });

    const { plan, error } = await planCluster(seed, voice, size);
    if (!plan) return NextResponse.json({ ok: false, error: error ?? "Planning failed." }, { status: 400 });

    const cluster = await createWriterCluster({
      voice_id: voice.id,
      pillar_keyword: plan.pillar.keyword,
      title: plan.pillar.title,
      keyword_source: { evidence: plan.evidence },
      plan,
      status: "plan_pending",
      total: 1 + plan.supporting.length,
      created_by: s.user?.email ?? undefined,
    });

    return NextResponse.json({ ok: true, cluster, estimate: estimateClusterCost(plan) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "planning failed" }, { status: 500 });
  }
}
