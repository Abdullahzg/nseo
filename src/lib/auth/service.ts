import type { NextRequest } from "next/server";

/**
 * Who is allowed to call an API route: a signed-in person, or a trusted machine.
 *
 * When GOOGLE_CLIENT_ID is not set (demo mode), returns a synthetic demo user —
 * no OAuth needed, no login screen, full access.
 */

/** Constant-time string compare. Returns false on any length mismatch without scanning further. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type Caller =
  | { kind: "user"; email: string }
  | { kind: "cron" }
  | { kind: "agent" }
  | null;

/**
 * Identify the caller, or null if unauthenticated.
 *
 * When GOOGLE_CLIENT_ID is not set (demo mode), returns a synthetic demo user —
 * no OAuth needed, no login screen, full access.
 *
 * Prefers the machine credentials because they are a cheap string compare, where `auth()` is a
 * round trip — an agent making forty tool calls should not pay for forty session lookups.
 */
export async function identifyCaller(req: NextRequest): Promise<Caller> {
  // Demo mode: no OAuth configured → everyone is a demo user
  if (!process.env.GOOGLE_CLIENT_ID?.trim()) return { kind: "user", email: "demo@local" };

  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";

  const hermes = process.env.HERMES_TOKEN?.trim();
  if (hermes && bearer && safeEqual(bearer, hermes)) return { kind: "agent" };

  const cron = process.env.CRON_SECRET?.trim();
  if (cron) {
    const viaQuery = req.nextUrl.searchParams.get("key") ?? "";
    if ((bearer && safeEqual(bearer, cron)) || (viaQuery && safeEqual(viaQuery, cron))) {
      return { kind: "cron" };
    }
  }

  try {
    const { auth } = await import("@auth");
    const session = await auth().catch(() => null);
    const email = session?.user?.email;
    return email ? { kind: "user", email } : null;
  } catch {
    return null;
  }
}

/** True when the caller is anyone we trust. The common case for a read or a routine action. */
export async function isAuthorized(req: NextRequest): Promise<boolean> {
  return (await identifyCaller(req)) !== null;
}

/**
 * True when the caller may read admin-only data — today that means the adoption report, which is
 * per-person activity for every named colleague.
 *
 * The agent is NOT admin by default, and that is a deliberate choice rather than an oversight. Hermes
 * answers whoever holds its inbound token, so granting it admin would quietly widen who can read how
 * much each teammate used the tool. Management information about real people should not become
 * readable as a side effect of deploying an agent.
 *
 * `HERMES_ALLOW_ADMIN=1` turns it on for whoever decides that trade is fine. Cron is never admin: no
 * scheduled job needs per-person data, and a report it could read is a report it could leak into a
 * log or a notification.
 */
export async function isAdminCaller(req: NextRequest): Promise<{ ok: true; caller: Caller } | { ok: false; status: 401 | 403; reason: string }> {
  const caller = await identifyCaller(req);
  if (!caller) return { ok: false, status: 401, reason: "unauthorized" };

  if (caller.kind === "agent") {
    return process.env.HERMES_ALLOW_ADMIN === "1"
      ? { ok: true, caller }
      : { ok: false, status: 403, reason: "The agent is not allowed to read per-person activity. Set HERMES_ALLOW_ADMIN=1 to permit it." };
  }
  if (caller.kind === "cron") return { ok: false, status: 403, reason: "forbidden" };

  const { isAdminEmail } = await import("@/lib/auth/admin");
  return isAdminEmail(caller.email)
    ? { ok: true, caller }
    : { ok: false, status: 403, reason: "forbidden" };
}

/**
 * The email to attribute an action to.
 *
 * Machine callers have no email, so they get a stable synthetic one. This matters: `created_by` and
 * `sent_by_email` feed the adoption report, and an agent's work showing up as a null owner would
 * silently under-count activity, while showing up as a real person's would over-count theirs.
 */
export function actorFor(caller: Caller): string | null {
  if (!caller) return null;
  if (caller.kind === "user") return caller.email;
  return caller.kind === "agent" ? "hermes@agent" : "cron";
}
