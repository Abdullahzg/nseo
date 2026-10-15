// What has to be on a commercial email, and the headers a mailbox provider now expects.
//
// This is not decoration. The FTC's CAN-SPAM guide lists eight requirements for commercial email,
// including a valid physical postal address and a working opt-out honoured within ten business
// days, with penalties per message — and it says explicitly that the law makes no exception for
// business-to-business mail. Gmail and Yahoo both require one-click unsubscribe headers on bulk
// mail (RFC 8058), and Yahoo asks for opt-outs to be honoured within two days, which is the number
// this system uses.
//
// Sources (fetched 2026-10-15):
//   https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
//   https://support.google.com/a/answer/81126   (SPF/DKIM/DMARC, List-Unsubscribe, spam rate)
//   https://senders.yahooinc.com/best-practices/ (honour unsubscribes within 2 days)
//   https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/
//
// None of this applies to a demo, where nothing is sent.

import crypto from "crypto";

const SECRET = process.env.NEXTAUTH_SECRET || process.env.GUEST_SECRET || "nseo-dev-secret";

/** A token that identifies one recipient on one campaign, with no database lookup to unsubscribe. */
export function unsubscribeToken(email: string, campaignId: string): string {
  const payload = `${email.toLowerCase()}|${campaignId}`;
  const mac = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url").slice(0, 24);
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}

/** Undo the above, refusing anything that was not signed by us. */
export function readUnsubscribeToken(token: string): { email: string; campaignId: string } | null {
  const [body, mac] = (token ?? "").split(".");
  if (!body || !mac) return null;
  let payload: string;
  try { payload = Buffer.from(body, "base64url").toString("utf8"); } catch { return null; }
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url").slice(0, 24);
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  const [email, campaignId] = payload.split("|");
  return email && campaignId ? { email, campaignId } : null;
}

export interface SenderIdentity {
  /** The human sending it. */
  name: string;
  email: string;
  /** The business behind the email, if the owner gave one. */
  company?: string | null;
  /** A real postal address — required by CAN-SPAM for commercial mail. */
  postalAddress?: string | null;
}

export interface FooterResult {
  text: string;
  /** Empty when the owner has not given an address: the caller decides whether that blocks a send. */
  missing: string[];
}

/**
 * The footer for a first contact. Deliberately short: a wall of legal text on a one-to-one pitch
 * reads as bulk mail, which is exactly what we are trying not to be.
 */
export function outreachFooter(sender: SenderIdentity, unsubscribeUrl: string, context: string): FooterResult {
  const missing: string[] = [];
  if (!sender.postalAddress?.trim()) missing.push("postal address");
  const who = sender.company?.trim() ? `${sender.name} · ${sender.company.trim()}` : sender.name;
  const lines = [
    "--",
    `${who} · ${sender.email}`,
    sender.postalAddress?.trim() || null,
    context,
    `Don't want to hear from us again? ${unsubscribeUrl} — one click, and we stop.`,
  ].filter(Boolean) as string[];
  return { text: lines.join("\n"), missing };
}

/**
 * The headers Gmail and Yahoo look for. The POST variant is what makes the unsubscribe button
 * appear next to the sender's name rather than a link buried in the body.
 */
export function unsubscribeHeaders(url: string, mailto: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>, <mailto:${mailto}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** Why this person is being written to — the sentence that makes a cold email honest. */
export function contextLine(host: string, articleTitle: string | null): string {
  return articleTitle
    ? `You're receiving this because you wrote "${articleTitle.slice(0, 70)}" on ${host} and we're asking to be considered for a similar piece.`
    : `You're receiving this because you publish on ${host} and we're asking to be considered for a piece.`;
}
