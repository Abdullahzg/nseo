import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { after } from "next/server";
import { getWriterCluster, updateWriterCluster } from "@/lib/db/queries";
import { materialiseCluster, runCluster, clusterProgress } from "@/lib/writer/clusterRun";
import { estimateClusterCost, sanitizeClusterPlanEdit } from "@/lib/writer/cluster";
import type { ClusterPlan } from "@/lib/writer/cluster";

export const maxDuration = 300;

// GET — the cluster and its per-article progress. Polled by the UI: an SSE stream would go silent at
// a QStash invocation boundary and look like a hang, and all the durable state is in Postgres anyway.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await auth().catch(() => null);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const cluster = await getWriterCluster(id);
    if (!cluster) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({
      ok: true,
      cluster,
      progress: await clusterProgress(id),
      estimate: cluster.plan ? estimateClusterCost(cluster.plan as unknown as ClusterPlan) : null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "load failed" }, { status: 500 });
  }
}

// POST { action: "approve" } — the human gate for a whole cluster.
//
// Session-only, no CRON_SECRET path: this one action authorises N articles to be written and it is
// the reason each member's outline can be auto-approved later. It mints every slug up front so the
// interlink map is known before the first word, then kicks the run off via after() so the response
// returns immediately and the run survives the tab closing.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await auth().catch(() => null);
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = (body as any)?.action;

  try {
    if (action === "approve") {
      const res = await materialiseCluster(id, s.user?.email ?? null);
      if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
      after(async () => { await runCluster(id).catch(() => {}); });
      return NextResponse.json({ ok: true, cluster: res.cluster, started: true });
    }

    if (action === "update_plan") {
      // Editing the plan is only meaningful BEFORE approval. After approval the draft rows exist,
      // slugs are reserved and the interlink map is computed from them, so changing the plan then
      // would describe something that is no longer what is being written.
      const cluster = await getWriterCluster(id);
      if (!cluster) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
      if (cluster.status !== "plan_pending") {
        return NextResponse.json(
          { ok: false, error: `This plan is "${cluster.status}" and can no longer be edited. Plan a new cluster instead.` },
          { status: 400 },
        );
      }
      if (!cluster.plan) return NextResponse.json({ ok: false, error: "This cluster has no plan." }, { status: 400 });

      const { plan, error, notes } = sanitizeClusterPlanEdit(
        cluster.plan as unknown as ClusterPlan,
        (body as any)?.plan,
      );
      if (!plan) return NextResponse.json({ ok: false, error, notes }, { status: 400 });

      const updated = await updateWriterCluster(id, {
        plan: plan as never,
        // The pillar keyword is denormalised onto the row for the list view, so it has to follow.
        pillar_keyword: plan.pillar.keyword,
        title: plan.pillar.title,
        total: 1 + plan.supporting.length,
      });
      return NextResponse.json({
        ok: true,
        cluster: updated,
        notes,
        estimate: estimateClusterCost(plan),
      });
    }

    if (action === "resume") {
      // For a run that stopped as `partial` (no QStash configured, or a failure mid-way).
      const cluster = await getWriterCluster(id);
      if (!cluster) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
      if (cluster.status === "running") {
        return NextResponse.json({ ok: false, error: "Already running." }, { status: 400 });
      }
      after(async () => { await runCluster(id).catch(() => {}); });
      return NextResponse.json({ ok: true, started: true });
    }

    return NextResponse.json({ ok: false, error: 'unknown action (expected "approve", "resume" or "update_plan")' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "action failed" }, { status: 500 });
  }
}
