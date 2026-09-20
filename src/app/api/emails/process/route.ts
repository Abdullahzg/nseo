import { NextRequest, NextResponse } from "next/server";
import { auth } from "@auth";
import { processDueEmails } from "@/lib/email/processor";

export const maxDuration = 300;

// Authorized if: no CRON_SECRET configured (local dev), OR the trigger's Bearer token /
// ?key= matches (the scheduler), OR a valid owner session (a manual "process now").
async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get("key") === secret) return true;
  const session = await auth().catch(() => null);
  return !!session;
}

/** Reads replies over IMAP, then sends every due real-mode email. The scheduler also runs this after each tick round. */
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await processDueEmails());
}

// Vercel cron / QStash may issue GET — support both.
export async function GET(req: NextRequest) {
  return POST(req);
}
