// Guest identity: an HMAC-signed random id in a cookie. Guests can only ever create DEMO
// campaigns — enforced by a CHECK constraint in the database, not by this file.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GUEST_COOKIE = "geseo_guest";
const secret = () => process.env.AUTH_SECRET || "dev-only-guest-secret";

function sign(id: string): string {
  return createHmac("sha256", secret()).update(id).digest("base64url").slice(0, 24);
}

export function issueGuestToken(): { id: string; token: string } {
  const id = `g_${randomBytes(9).toString("base64url")}`;
  return { id, token: `${id}.${sign(id)}` };
}

export function verifyGuestToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const id = token.slice(0, i), sig = token.slice(i + 1);
  const expect = sign(id);
  if (sig.length !== expect.length) return null;
  try { return timingSafeEqual(Buffer.from(sig), Buffer.from(expect)) ? id : null; } catch { return null; }
}
