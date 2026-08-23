import { auth } from "@auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(req: NextRequest) {
  const { nextUrl } = req;
  const isApiAuth = nextUrl.pathname.startsWith("/api/auth");
  const isHealth = nextUrl.pathname === "/api/health";
  const isLoginPage = nextUrl.pathname === "/login";

  // When GOOGLE_CLIENT_ID is not configured, auth is fully bypassed (demo mode).
  // This lets the system run without any OAuth setup — no login screen, no session needed.
  const authConfigured = !!process.env.GOOGLE_CLIENT_ID?.trim();
  if (!authConfigured) return NextResponse.next();

  // Automated callers (Vercel cron + Upstash QStash) hit the send-processor with a
  // CRON_SECRET Bearer / ?key= instead of a session cookie. Let them past the login
  // redirect — the route still validates the secret itself.
  const secret = process.env.CRON_SECRET;
  const isCron = !!secret && (
    req.headers.get("authorization") === `Bearer ${secret}` ||
    nextUrl.searchParams.get("key") === secret
  );

  // The Hermes agent, same idea, separate credential. This has to be here as well as in the routes:
  // the proxy runs FIRST and redirects anything without a session to /login, so a token it does not
  // recognise never reaches the route that would have accepted it — the agent would just get login
  // HTML back with a 200 and no explanation.
  //
  // Header only, no ?key= fallback: query strings land in access logs and this credential can drive
  // sends and spend. Kept distinct from CRON_SECRET so revoking the agent cannot take the nightly
  // crons down with it. The route still validates it — see src/lib/auth/service.ts.
  const hermes = process.env.HERMES_TOKEN?.trim();
  const isAgent = !!hermes && req.headers.get("authorization") === `Bearer ${hermes}`;

  if (isApiAuth || isHealth || isCron || isAgent) return NextResponse.next();

  const session = await auth();
  const isLoggedIn = !!session;

  if (isLoginPage && isLoggedIn) return NextResponse.redirect(new URL("/", req.url));
  if (!isLoggedIn && !isLoginPage) return NextResponse.redirect(new URL("/login", req.url));

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.png$|.*\\.svg$).*)"],
};
