import { NextRequest, NextResponse } from "next/server";
import { readUnsubscribeToken } from "@/lib/compliance/footer";
import { addSuppression } from "@/lib/db/queries";
import { supabaseAdmin } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";

/**
 * The address in List-Unsubscribe. RFC 8058 says a mailbox provider POSTs here when the reader
 * presses the unsubscribe button next to the sender's name, with no human ever seeing a page —
 * so the POST must do the work and answer 200. A human who clicks the same link gets the page.
 */
async function suppress(token: string): Promise<boolean> {
  const parsed = readUnsubscribeToken(token);
  if (!parsed) return false;
  await addSuppression("email", parsed.email, "unsubscribed via one-click header").catch(() => {});
  const domain = parsed.email.split("@")[1];
  if (domain) await addSuppression("domain", domain, "unsubscribed via one-click header").catch(() => {});
  try {
    await supabaseAdmin.from("agent_events").insert({
    campaign_id: parsed.campaignId, agent: "outreach", action: "unsubscribed", engine: "system", level: "warn",
    human: `${parsed.email} unsubscribed with one click from their mail client — suppressed everywhere`,
    detail: { email: parsed.email, via: "RFC 8058 one-click" },
    });
  } catch { /* the suppression is what matters; the feed line is a nicety */ }
  return true;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ok = await suppress(token);
  // A provider doing one-click wants a 200 and nothing else; an invalid token is still "handled".
  return new NextResponse(ok ? "unsubscribed" : "invalid token", { status: ok ? 200 : 400 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return NextResponse.redirect(new URL(`/u/${token}`, req.nextUrl.origin));
}
