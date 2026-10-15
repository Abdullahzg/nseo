import Link from "next/link";
import { headers, cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/db/supabase";
import { GUEST_COOKIE, verifyGuestToken } from "@/lib/auth/guest";
import { devOwnerBypass, devOwnerEmail, ownerAllowed } from "@/lib/auth/service";
import { Wordmark } from "@/components/layout/Logo";
import { Face } from "@/components/ui/Face";
import { AGENTS } from "@/lib/campaign/agents";
import evals from "../../public/evals.json";

export const dynamic = "force-dynamic";

/**
 * The front door. Someone arriving here has five minutes and no account, so the page has one job:
 * say what this is, show that it can be checked, and get them into a running campaign in one click.
 * Anyone who already has a campaign gets a way back to it without losing the page.
 */
async function currentCampaign(): Promise<string | null> {
  const jar = await cookies();
  await headers();
  let scope: { owner_email?: string; guest_id?: string } | null = null;
  if (devOwnerBypass()) scope = { owner_email: devOwnerEmail() };
  else {
    try { const { auth } = await import("@auth"); const s = await auth(); if (ownerAllowed(s?.user?.email)) scope = { owner_email: s!.user!.email! }; } catch { /* no auth configured */ }
    if (!scope) { const gid = verifyGuestToken(jar.get(GUEST_COOKIE)?.value); if (gid) scope = { guest_id: gid }; }
  }
  if (!scope) return null;
  let q = supabaseAdmin.from("campaigns").select("id").order("created_at", { ascending: false }).limit(1);
  q = scope.guest_id ? q.eq("guest_id", scope.guest_id) : q.eq("owner_email", scope.owner_email!).is("guest_id", null);
  // Supabase's builder is thenable but has no .catch, so the guard has to be a try/catch.
  try {
    const { data } = await q;
    return (data?.[0] as any)?.id ?? null;
  } catch { return null; }
}

const PILLARS = [
  {
    title: "It knows what it is not allowed to buy",
    body: "Google lists “exchanging money for links” as link spam, and says paid links are fine when they carry rel=“sponsored”. So the agent negotiates for a qualified link and a visible label — and an editor who insists on selling a paid do-follow link does not get an agreement, they get a card explaining why.",
    foot: "Rules applied by code, each with its citation.",
  },
  {
    title: "Code owns the money, the model owns the words",
    body: "The ceiling, the budget commit, the send gate and every escalation are deterministic. Nemotron decides what an editor meant and writes the reply; it is never asked to approve a number. That is also why an email telling the agent its “budget has been lifted” changes nothing.",
    foot: "0 of 8 scenarios produced a figure above the cap.",
  },
  {
    title: "It is measured, not demonstrated",
    body: "A frozen, hand-labelled set in the repository — inbound replies, negotiation scenarios, compliance offers and 18 prompt-injection attacks — runs with one command and reports every proportion with a confidence interval, because twenty cases cannot prove a percentage.",
    foot: "npm run eval · the table is on the Evidence page.",
  },
];

export default async function Home() {
  const resume = await currentCampaign();
  const triage = (evals.rows as any[]).find((r) => r.metric.startsWith("Triage accuracy"));
  return (
    <div className="min-h-svh flex flex-col">
      <header className="border-b border-rule">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <Wordmark className="text-lg" />
          <nav className="flex items-center gap-3 text-sm">
            <Link href="/evidence" className="text-ink-2 hover:text-ink">Evidence</Link>
            {resume && <Link href={`/campaigns/${resume}`} className="text-ink-2 hover:text-ink hidden sm:inline">Your campaign</Link>}
            <Link href="/setup" className="btn btn-sm">Run the demo</Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <section className="pt-14 pb-12 sm:pt-20">
            <div className="label text-[#4f7d00]">Autonomous placement outreach</div>
            <h1 className="serif text-4xl sm:text-6xl font-semibold tracking-tight mt-3 text-balance max-w-[16ch] leading-[1.05]">
              Get your product written about, without doing the outreach.
            </h1>
            <p className="text-ink-2 mt-5 max-w-[62ch] text-[17px] leading-relaxed">
              Tell it what you sell and what you can spend. It finds publications that already write about your
              subject, reads each one, finds a human editor, writes to them, negotiates a price inside your
              ceiling, and comes back only when it genuinely needs you.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/setup" className="btn">Run the demo — no sign-up</Link>
              <Link href="/evidence" className="btn btn-ghost">See the evidence</Link>
              {resume && <Link href={`/campaigns/${resume}`} className="text-sm text-model underline">resume your campaign →</Link>}
            </div>
            <p className="text-sm text-ink-3 mt-4 max-w-[62ch]">
              The demo runs the{" "}<b className="text-ink-2 font-medium">real</b>{" "}pipeline: real web search, real pages,
              real decisions by NVIDIA Nemotron. The only simulated step is sending the email — and you can write
              the editor&apos;s replies yourself to prove nothing is scripted.
            </p>
          </section>

          <section className="grid gap-3 md:grid-cols-3 pb-14">
            {PILLARS.map((p) => (
              <div key={p.title} className="card p-5 flex flex-col">
                <h2 className="serif text-xl font-semibold leading-snug">{p.title}</h2>
                <p className="text-sm text-ink-2 mt-2 leading-relaxed flex-1">{p.body}</p>
                <p className="text-xs text-ink-3 mt-3 mono">{p.foot}</p>
              </div>
            ))}
          </section>

          <section className="pb-16">
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
              <h2 className="label">Eight agents, one hand-off each</h2>
              <span className="text-xs text-ink-3">Open any one mid-run to see every page, person and reason behind its work.</span>
            </div>
            <ol className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {AGENTS.map((a, i) => (
                <li key={a.key} className="card p-3 flex items-start gap-2.5">
                  <Face kind="agent" seed={a.key} size={34} className="rounded-lg shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{i + 1}. {a.name}</div>
                    <div className="text-xs text-ink-3 leading-snug mt-0.5">{a.engineShort}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="pb-20">
            <div className="card p-6 sm:p-8">
              <div className="grid gap-6 sm:grid-cols-[1fr_auto] items-center">
                <div>
                  <h2 className="serif text-2xl font-semibold tracking-tight">Nothing here asks to be taken on trust.</h2>
                  <p className="text-ink-2 mt-2 max-w-[58ch]">
                    Every line in the feed says which model decided it, what it cost and why. Every campaign can be
                    replayed moment by moment, and its story shared as a read-only page. The numbers behind the
                    claims — {triage ? `triage accuracy ${triage.result.replace(/^\d+\/\d+ /, "")}, ` : ""}0 of 18 injection attacks through,
                    0 ceiling violations — regenerate from the repository with one command.
                  </p>
                </div>
                <div className="flex sm:flex-col gap-2">
                  <Link href="/setup" className="btn">Run the demo</Link>
                  <Link href="/evidence" className="btn btn-ghost">Evidence</Link>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-3">
          <span>Decisions by NVIDIA Nemotron 3 on Nebius Token Factory</span>
          <span>Search, mapping and extraction by Tavily</span>
          <span>MIT licensed</span>
        </div>
      </footer>
    </div>
  );
}
