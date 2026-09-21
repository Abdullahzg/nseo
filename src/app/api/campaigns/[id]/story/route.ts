import { NextRequest, NextResponse } from "next/server";
import { canSee } from "@/lib/campaign/access";
import { getOrWriteStory, ensureShareToken, storyFacts } from "@/lib/campaign/story";
import { NebiusError } from "@/lib/ai/nebius";

export const maxDuration = 90;

/** GET — the story (written once per tick count; ?refresh=1 rewrites). POST {share:true} — mint the read-only link. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { camp, ok } = await canSee(req, id);
  if (!camp || !ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (req.nextUrl.searchParams.get("facts") === "1") return NextResponse.json({ facts: await storyFacts(camp) });
  if (camp.tick_count < 2) return NextResponse.json({ story: null, facts: await storyFacts(camp), reason: "The story is written once the campaign has done something." });
  try {
    const { story, facts } = await getOrWriteStory(camp, { force: req.nextUrl.searchParams.get("refresh") === "1" });
    return NextResponse.json({ story, facts, share_token: (camp as any).share_token ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e instanceof NebiusError ? `Nebius (${e.kind}): ${e.message}` : e?.message ?? "failed" }, { status: 503 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { caller, camp, ok } = await canSee(req, id);
  if (!camp || !ok || caller?.kind === "cron") return NextResponse.json({ error: "not found" }, { status: 404 });
  const token = await ensureShareToken(camp);
  const base = (process.env.APP_URL || process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin).replace(/\/$/, "");
  return NextResponse.json({ ok: true, token, url: `${base}/story/${token}` });
}
