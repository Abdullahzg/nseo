import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth/service";
import { getFunnel } from "@/lib/backlinks/pipeline";

// Auth lives in @/lib/auth/service so a person, a cron and the agent are recognised by one
// rule. The local copy this replaced also returned true when CRON_SECRET was unset.

// GET → the funnel (prospects + stage counts) for one backlink campaign.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const funnel = await getFunnel(id);
  if (!funnel) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ...funnel });
}
