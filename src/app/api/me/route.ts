import { NextRequest, NextResponse } from "next/server";
import { identifyCaller } from "@/lib/auth/service";
import { getUserEmailConfig } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

/** Who am I — drives the nav (Settings for owners) and the Real-mode toggle. */
export async function GET(req: NextRequest) {
  const caller = await identifyCaller(req);
  const google = !!process.env.GOOGLE_CLIENT_ID?.trim();
  if (!caller) return NextResponse.json({ kind: "none", google_configured: google });
  if (caller.kind === "owner") {
    const cfg = await getUserEmailConfig(caller.email);
    return NextResponse.json({ kind: "owner", email: caller.email, can_send_real: cfg.hasPassword, google_configured: google });
  }
  return NextResponse.json({ kind: caller.kind, google_configured: google });
}
