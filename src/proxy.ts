// Request gate. Everyone gets in — owners with a Google session, everyone else as a guest with a
// signed cookie (issued here). What a guest can DO is restricted structurally in the database.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { GUEST_COOKIE, issueGuestToken, verifyGuestToken } from "@/lib/auth/guest";

export async function proxy(req: NextRequest) {
  const res = NextResponse.next();
  const path = req.nextUrl.pathname;
  if (path.startsWith("/api/auth") || path.startsWith("/api/cron") || path === "/api/health" || path.startsWith("/api/emails/process")) return res;
  if (!verifyGuestToken(req.cookies.get(GUEST_COOKIE)?.value)) {
    const { token } = issueGuestToken();
    res.cookies.set(GUEST_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\.png$|.*\.svg$).*)"] };
