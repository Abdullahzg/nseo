import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(req: NextRequest) {
  const { nextUrl } = req;
  const isApiAuth = nextUrl.pathname.startsWith("/api/auth");
  const isHealth = nextUrl.pathname === "/api/health";

  // When GOOGLE_CLIENT_ID is not configured, auth is fully bypassed (demo mode).
  // No login screen, no session needed, everything accessible.
  const authConfigured = !!process.env.GOOGLE_CLIENT_ID?.trim();
  if (!authConfigured) return NextResponse.next();

  const isLoginPage = nextUrl.pathname === "/login";

  // Automated callers (Vercel cron + Upstash QStash) hit the send-processor with a
  // CRON_SECRET Bearer / ?key= instead of a session cookie.
  const secret = process.env.CRON_SECRET;
  const isCron = !!secret && (
    req.headers.get("authorization") === `Bearer ${secret}` ||
    nextUrl.searchParams.get("key") === secret
  );

  const hermes = process.env.HERMES_TOKEN?.trim();
  const isAgent = !!hermes && req.headers.get("authorization") === `Bearer ${hermes}`;

  if (isApiAuth || isHealth || isCron || isAgent) return NextResponse.next();

  let session = null;
  try {
    const { auth } = await import("@auth");
    session = await auth();
  } catch { /* auth not configured */ }

  const isLoggedIn = !!session;

  if (isLoginPage && isLoggedIn) return NextResponse.redirect(new URL("/", req.url));
  if (!isLoggedIn && !isLoginPage) return NextResponse.redirect(new URL("/login", req.url));

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.png$|.*\\.svg$).*)"],
};
