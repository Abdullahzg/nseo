import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { runCluster } from "@/lib/writer/clusterRun";

export const maxDuration = 300;

// POST { cluster_id, continue?: true } — the QStash continuation target.
//
// Unlike the other writer routes this one DOES accept CRON_SECRET, because QStash is the caller: when
// a run hits its time budget it hands the remainder here with the secret in the Authorization header
// (see qstashPublish). It only ever resumes a cluster a human already approved, so it cannot start
// unreviewed work.
async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
    if (req.nextUrl.searchParams.get("key") === secret) return true;
  }
  return !!(await auth().catch(() => null));
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const clusterId = String((body as any)?.cluster_id ?? "").trim();
  if (!clusterId) return NextResponse.json({ ok: false, error: "cluster_id is required" }, { status: 400 });
  try {
    const res = await runCluster(clusterId);
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "run failed" }, { status: 500 });
  }
}
