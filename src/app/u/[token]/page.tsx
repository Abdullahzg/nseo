import { readUnsubscribeToken } from "@/lib/compliance/footer";
import { addSuppression } from "@/lib/db/queries";
import { supabaseAdmin } from "@/lib/db/supabase";
import { Wordmark } from "@/components/layout/Logo";

export const dynamic = "force-dynamic";

/**
 * One click and we stop. No sign-in, no "manage preferences", no confirmation step that quietly
 * loses the request: arriving here IS the unsubscribe, and the address is suppressed for every
 * campaign on this deployment, not just the one that wrote.
 *
 * Yahoo asks for opt-outs within two days and CAN-SPAM allows ten business days. This takes effect
 * before the page renders.
 */
export default async function Unsubscribe({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = readUnsubscribeToken(token);
  let done = false;
  if (parsed) {
    await addSuppression("email", parsed.email, "unsubscribed via one-click link").catch(() => {});
    const domain = parsed.email.split("@")[1];
    if (domain) await addSuppression("domain", domain, "unsubscribed via one-click link").catch(() => {});
    try {
    await supabaseAdmin.from("agent_events").insert({
      campaign_id: parsed.campaignId, agent: "outreach", action: "unsubscribed", engine: "system", level: "warn",
      human: `${parsed.email} used the unsubscribe link — suppressed everywhere, no campaign will contact them again`,
      detail: { email: parsed.email },
      });
  } catch { /* the suppression is what matters; the feed line is a nicety */ }
    done = true;
  }
  return (
    <div className="min-h-svh flex flex-col">
      <header className="border-b border-rule"><div className="mx-auto max-w-2xl px-4 sm:px-6 h-14 flex items-center"><Wordmark className="text-lg" /></div></header>
      <main className="flex-1 flex items-center">
        <div className="mx-auto max-w-2xl px-4 sm:px-6 py-16">
          {done ? (
            <>
              <h1 className="serif text-3xl font-semibold tracking-tight">You won&apos;t hear from us again.</h1>
              <p className="text-ink-2 mt-3 max-w-[60ch]">
                <span className="mono text-sm">{parsed!.email}</span> has been added to the never-contact list. That applies to every
                campaign on this deployment, not only the one that wrote to you, and it takes effect immediately —
                nothing further is queued or scheduled.
              </p>
              <p className="text-sm text-ink-3 mt-4">Sorry for the interruption.</p>
            </>
          ) : (
            <>
              <h1 className="serif text-3xl font-semibold tracking-tight">That link isn&apos;t valid.</h1>
              <p className="text-ink-2 mt-3 max-w-[60ch]">
                It may have been truncated by an email client. Reply to the message with the word
                &ldquo;unsubscribe&rdquo; and the agent will stop and suppress the address on its next pass.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
