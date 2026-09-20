// Who is calling an API route.
//   owner  — signed in with Google. Any Google account is an owner unless OWNER_EMAILS / ALLOWED_DOMAINS
//            restricts it (a private deployment). Owners bring their own keys (Settings).
//   guest  — a signed guest cookie; may only create demo campaigns (DB-enforced)
//   cron   — Bearer CRON_SECRET (GitHub Actions scheduler)
//   null   — nobody
import type { NextRequest } from "next/server";
import { GUEST_COOKIE, verifyGuestToken } from "./guest";

export type Caller = { kind: "owner"; email: string } | { kind: "guest"; id: string } | { kind: "cron" } | null;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function ownerAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  const owners = (process.env.OWNER_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const domains = (process.env.ALLOWED_DOMAINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (owners.length === 0 && domains.length === 0) return true; // open sign-up: bring your own keys
  return owners.includes(e) || domains.includes(e.split("@")[1] ?? "");
}

/** Who the local developer is when Google is not configured (DEV_OWNER_EMAIL, else dev@local). */
export function devOwnerEmail(): string { return (process.env.DEV_OWNER_EMAIL?.trim() || "dev@local").toLowerCase(); }

/** Local dev without Google OAuth: the developer is the owner. Never in production. */
export function devOwnerBypass(): boolean {
  return !process.env.GOOGLE_CLIENT_ID?.trim() && process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1";
}

export async function identifyCaller(req: NextRequest): Promise<Caller> {
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const cron = process.env.CRON_SECRET?.trim();
  if (cron && bearer && safeEqual(bearer, cron)) return { kind: "cron" };
  if (devOwnerBypass()) return { kind: "owner", email: devOwnerEmail() };
  try {
    const { auth } = await import("@auth");
    const session = await auth().catch(() => null);
    const email = session?.user?.email;
    if (email && ownerAllowed(email)) return { kind: "owner", email };
  } catch { /* auth not configured */ }
  const gid = verifyGuestToken(req.cookies.get(GUEST_COOKIE)?.value);
  if (gid) return { kind: "guest", id: gid };
  return null;
}

/** Scope for data queries: owner sees their campaigns; guest sees theirs; cron sees everything. */
export function scopeOf(c: Caller): { owner_email?: string; guest_id?: string } {
  if (!c) return { guest_id: "nobody" };
  if (c.kind === "owner") return { owner_email: c.email };
  if (c.kind === "guest") return { guest_id: c.id };
  return {};
}

export function actorFor(c: Caller): string {
  if (!c) return "anonymous";
  return c.kind === "owner" ? c.email : c.kind === "guest" ? `guest:${c.id}` : "cron";
}
