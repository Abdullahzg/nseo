import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { runGeoScan } from "@/lib/seo-agents/geo";
import type { GeoEngineId } from "@/lib/seo-agents/types";

const ENGINE_IDS: GeoEngineId[] = ["perplexity", "chatgpt", "gemini", "google_aio"];

export const maxDuration = 300;

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  const session = await auth().catch(() => null);
  return !!session;
}

// Report-only: queries AI engines and measures brand/competitor citation share. No writes.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const prompts = Array.isArray(body.prompts) ? (body.prompts as string[]).filter((p) => typeof p === "string" && p.trim()).slice(0, 10) : undefined;
  const competitors = Array.isArray(body.competitors) ? (body.competitors as string[]).filter((c) => typeof c === "string" && c.trim()) : undefined;
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
  const engines = Array.isArray(body.engines)
    ? (body.engines as unknown[]).filter((e): e is GeoEngineId => typeof e === "string" && (ENGINE_IDS as string[]).includes(e))
    : undefined;
  try {
    const report = await runGeoScan({ prompts, competitors, model, engines: engines?.length ? engines : undefined });
    return NextResponse.json({ ok: true, report });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "GEO scan failed" }, { status: 500 });
  }
}
