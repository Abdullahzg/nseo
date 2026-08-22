"use client";

/**
 * Backlink Outreach — the single workspace for link building.
 *
 * This page is deliberately the whole job in one place: pick the page you want links to, watch the bot
 * find and qualify prospects, see what it is doing, and deal with the few things only a person can
 * decide. Everything it shows is scoped to ONE campaign at a time, because "which target page is this
 * about" is the question every other number depends on.
 *
 * Design constraints this is built to, in priority order:
 *
 *   1. A non-technical teammate must be able to run it. Plain words over jargon ("Has a real email",
 *      not "sourced contact"), big targets, and no control whose effect isn't stated next to it.
 *   2. Nothing important lives on another page. The funnel used to hand off to /sending, /inbox,
 *      /negotiation and /payments; those are still reachable, but the counts and the things needing a
 *      human are surfaced here so the workspace is never a dead end.
 *   3. Ranking is explained, not hidden. Score, Domain Rating and email quality are three separate
 *      columns you can sort on, because a blended number nobody can argue with is a number nobody
 *      trusts. See EMAIL_TRUST_LABEL.
 *
 * See Outreach_inventory.md for the capability register this must not regress.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Link2, Play, Loader2, Search, Mail, PenLine, Send, CheckCircle2, ExternalLink,
  ShieldCheck, Inbox, Plus, TriangleAlert, ArrowUpDown, CreditCard, Phone, HandCoins,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { PathCombobox } from "@/components/ui/path-combobox";
import { cn } from "@/lib/utils";
import { AutopilotCard } from "@/components/AutopilotCard";
import { useKnownPages } from "@/lib/hooks/useKnownPages";
import { PitchDialog, type PitchTarget } from "@/components/backlinks/PitchDialog";

type EmailTrust = "sourced" | "verified" | "guess" | "none";

interface Prospect {
  id: string; domain: string; prospectUrl: string; angle: string | null; score: number | null;
  stage: string; author: string | null; hasEmail: boolean; email: string | null; linkLiveAt: string | null;
  dr: number | null; emailSource: string | null; emailConfidence: number | null; emailTrust: EmailTrust;
  emailOwner: string | null; emailOwnerPosition: string | null;
  pitch: {
    id: string; subject: string | null; body: string | null; status: string | null;
    sentAt: string | null; scheduledAt: string | null; editedAt: string | null;
    editedBy: string | null; editable: boolean;
  } | null;
}
interface Campaign { id: string; target_path: string; target_url: string; topic: string | null; workflow_id: string; campaign_id: string; }
interface CampaignRow extends Campaign { stageCounts: Record<string, number>; total: number; }
interface Attention {
  interventions: Array<{ id: string; type: string; ask: string | null; who: string | null }>;
  awaitingPayment: number;
  aiPaused: number;
}

const STAGE_UI: Record<string, { label: string; cls: string }> = {
  found: { label: "Found", cls: "text-muted-foreground bg-muted border-border" },
  emailing: { label: "Finding email", cls: "text-highlight-ink bg-highlight-soft border-highlight/30" },
  ready: { label: "Pitch ready", cls: "text-highlight-ink bg-highlight-soft border-highlight/40" },
  sent: { label: "Sent", cls: "text-warning bg-warning/10 border-warning/30" },
  replied: { label: "Replied", cls: "text-highlight-ink bg-highlight-soft border-highlight/40" },
  won: { label: "Link live", cls: "text-success bg-success/15 border-success/40" },
  lost: { label: "Lost", cls: "text-destructive bg-destructive/10 border-destructive/30" },
};

/** Email quality in words a person can act on. The tier comes from HOW the address was obtained —
 *  see emailTrust() in src/lib/backlinks/pipeline.ts. Guessed addresses are what bounce, so they are
 *  labelled as a risk rather than shown as an equal. */
const EMAIL_TRUST_LABEL: Record<EmailTrust, { label: string; hint: string; cls: string }> = {
  sourced: { label: "Real", hint: "Found on their site, a social profile, or via LinkedIn.", cls: "text-success bg-success/12 border-success/30" },
  verified: { label: "Verified", hint: "Built from the domain pattern, then confirmed the mailbox accepts mail.", cls: "text-success bg-success/12 border-success/30" },
  guess: { label: "Guessed", hint: "Built from a domain pattern and never confirmed. These are what bounce.", cls: "text-warning bg-warning/12 border-warning/30" },
  none: { label: "None yet", hint: "No address found. Run “Find emails”.", cls: "text-muted-foreground bg-muted border-border" },
};

/** Why a thread is parked, in the recipient's words rather than ours. Mirrors INTERVENTION_REASON in
 *  src/lib/negotiation/run.ts — kept short here because this is a queue, not a report. */
const INTERVENTION_LABEL: Record<string, { label: string; icon: typeof Phone }> = {
  sync_contact: { label: "Wants a call", icon: Phone },
  scheduling: { label: "Wants your availability", icon: Phone },
  other_channel: { label: "Wants to move to another channel", icon: Phone },
  payment_details: { label: "Wants invoice / bank details", icon: CreditCard },
  legal_contract: { label: "Wants a contract signed", icon: CreditCard },
  asset_request: { label: "Wants a document from us", icon: HandCoins },
  identity_verification: { label: "Wants proof of who we are", icon: ShieldCheck },
  redirect: { label: "Pointed us to someone else", icon: Mail },
  process_portal: { label: "Wants us to use their form", icon: Mail },
  factual_question: { label: "Asked something we must not guess", icon: TriangleAlert },
  over_policy: { label: "Wants more than our ceiling", icon: HandCoins },
  inbound_attachment: { label: "Sent us a file to read", icon: HandCoins },
  other: { label: "Needs a person", icon: TriangleAlert },
};

type SortKey = "score" | "dr" | "email";

export default function BacklinksPage() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<{ campaign: Campaign; prospects: Prospect[]; attention: Attention } | null>(null);
  const [target, setTarget] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string>("");
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  // The prospect whose pitch is open. Holding the whole row rather than just an id keeps the dialog a
  // pure function of what the table already loaded, so opening it needs no second fetch.
  const [pitchFor, setPitchFor] = useState<Prospect | null>(null);
  const knownPages = useKnownPages();

  const loadCampaigns = useCallback(async () => {
    const d = await fetch("/api/backlinks").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d?.ok) setCampaigns(d.campaigns);
  }, []);
  const loadFunnel = useCallback(async (id: string) => {
    const d = await fetch(`/api/backlinks/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d?.ok) setFunnel({ campaign: d.campaign, prospects: d.prospects, attention: d.attention ?? { interventions: [], awaitingPayment: 0, aiPaused: 0 } });
  }, []);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);
  useEffect(() => { if (selected) loadFunnel(selected); }, [selected, loadFunnel]);
  // Land on the most recent campaign so the page is never an empty shell when work exists.
  useEffect(() => { if (!selected && campaigns.length) setSelected(campaigns[0].id); }, [selected, campaigns]);

  async function createCampaign() {
    if (!target.trim()) { toast.error("Pick the page you want links to first."); return; }
    setCreating(true);
    try {
      const d = await fetch("/api/backlinks", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target, maxProspects: 15 }),
      }).then((r) => r.json());
      if (d?.ok) { toast.success(`Found ${d.discovery.saved} prospects for ${d.campaign.target_path}.`); await loadCampaigns(); setSelected(d.campaign.id); setTarget(""); }
      else toast.error(d?.error ?? "Failed.");
    } catch (e: any) { toast.error(e?.message ?? "Failed."); }
    finally { setCreating(false); }
  }

  async function action(act: string) {
    if (!selected) return;
    setBusy(act);
    try {
      const d = await fetch(`/api/backlinks/${selected}/action`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: act }),
      }).then((r) => r.json());
      if (d?.ok) {
        if (act === "discover") toast.success(`Found ${d.discovery.saved} new prospects.`);
        else if (act === "draft") toast.success(`Drafted ${d.draft.drafted} pitches${d.draft.skippedNoEmail ? ` — ${d.draft.skippedNoEmail} skipped because they have no email yet` : ""}.`);
        else if (act === "verify") toast.success(`Checked ${d.verify.checked} pages — ${d.verify.live} live link(s).`);
        else if (act === "enrich") toast.success("Looking for emails. This runs in the background — the list will fill in.");
        await loadFunnel(selected); await loadCampaigns();
      } else toast.error(d?.error ?? "Failed.");
    } catch (e: any) { toast.error(e?.message ?? "Failed."); }
    finally { setBusy(""); }
  }

  const prospects = funnel?.prospects ?? [];
  const attention = funnel?.attention;
  const count = (pred: (p: Prospect) => boolean) => prospects.filter(pred).length;
  const reached = (stages: string[]) => count((p) => stages.includes(p.stage));

  /** The funnel, as clickable filters. Each step says what it means in plain words, because "ready"
   *  and "sent" are our words, not a marketer's. */
  const steps = useMemo(() => [
    { key: null as string | null, label: "Found", sub: "prospects discovered", icon: Search, n: prospects.length },
    { key: "has-email", label: "Contactable", sub: "have a real address", icon: Mail, n: count((p) => p.emailTrust === "sourced" || p.emailTrust === "verified") },
    { key: "ready", label: "Pitch written", sub: "waiting to send", icon: PenLine, n: reached(["ready", "sent", "replied", "won"]) },
    { key: "sent", label: "Emailed", sub: "pitch has gone out", icon: Send, n: reached(["sent", "replied", "won"]) },
    { key: "replied", label: "Replied", sub: "they wrote back", icon: Inbox, n: reached(["replied", "won"]) },
    { key: "won", label: "Link live", sub: "confirmed on their page", icon: CheckCircle2, n: reached(["won"]) },
  ], [prospects]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    let list = prospects;
    if (stageFilter === "has-email") list = list.filter((p) => p.emailTrust === "sourced" || p.emailTrust === "verified");
    else if (stageFilter === "ready") list = list.filter((p) => ["ready", "sent", "replied", "won"].includes(p.stage));
    else if (stageFilter === "sent") list = list.filter((p) => ["sent", "replied", "won"].includes(p.stage));
    else if (stageFilter === "replied") list = list.filter((p) => ["replied", "won"].includes(p.stage));
    else if (stageFilter === "won") list = list.filter((p) => p.stage === "won");

    const rank: Record<EmailTrust, number> = { sourced: 3, verified: 2, guess: 1, none: 0 };
    return [...list].sort((a, b) => {
      if (sortKey === "dr") return (b.dr ?? -1) - (a.dr ?? -1);
      if (sortKey === "email") return rank[b.emailTrust] - rank[a.emailTrust] || (b.score ?? 0) - (a.score ?? 0);
      return (b.score ?? 0) - (a.score ?? 0);
    });
  }, [prospects, stageFilter, sortKey]);

  const needsYou = (attention?.interventions.length ?? 0) + (attention?.awaitingPayment ?? 0) + (attention?.aiPaused ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-light flex items-center gap-2.5 tracking-tight">
          <Link2 className="h-7 w-7 text-highlight-ink" /> Backlink Outreach
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-3xl leading-relaxed">
          Choose a page you want links to. The bot finds articles that could link to it, works out who wrote
          them, finds a real email address, writes a pitch, sends it on a schedule, and handles the reply.
          It only stops for the few things a person has to decide.
        </p>
      </div>

      {/* ── Which page are we building links to ─────────────────────────────── */}
      <section className="rounded-2xl border border-[var(--glass-border)] bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-2 flex-1 min-w-[300px]">
            <Label htmlFor="t" className="text-sm">Start a new campaign for a page</Label>
            <PathCombobox id="t" value={target} onChange={setTarget} options={knownPages} />
          </div>
          <Button size="lg" onClick={createCampaign} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {creating ? "Finding prospects…" : "Start campaign"}
          </Button>
        </div>

        {campaigns.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your campaigns</div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {campaigns.map((c) => {
                const live = c.stageCounts.won ?? 0;
                const on = selected === c.id;
                return (
                  <button key={c.id} onClick={() => { setSelected(c.id); setStageFilter(null); }}
                    className={cn(
                      "rounded-xl border p-4 text-left transition-colors",
                      on ? "border-highlight bg-highlight-soft" : "border-border hover:bg-accent",
                    )}>
                    <div className="font-medium truncate">{c.target_path}</div>
                    <div className="mt-1 text-sm text-muted-foreground tabular-nums">
                      {c.total} prospect{c.total === 1 ? "" : "s"}
                      {live > 0 && <span className="text-success"> · {live} live</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {funnel && (
        <>
          {/* ── Needs you. Shown only when true, so its presence always means something. ────── */}
          {needsYou > 0 && (
            <section className="rounded-2xl border border-warning/40 bg-warning/[0.07] p-5">
              <h2 className="flex items-center gap-2 text-base font-medium">
                <TriangleAlert className="h-5 w-5 text-warning" />
                {needsYou} thing{needsYou === 1 ? "" : "s"} need you
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The bot handles everything else on its own. These it can&apos;t decide.
              </p>
              <div className="mt-4 space-y-2">
                {attention!.awaitingPayment > 0 && (
                  <Link href="/payments" className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:bg-accent transition-colors">
                    <CreditCard className="h-5 w-5 shrink-0 text-warning" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{attention!.awaitingPayment} deal{attention!.awaitingPayment === 1 ? "" : "s"} agreed, waiting on payment</span>
                      <span className="block text-sm text-muted-foreground">Approve and mark paid to close them out.</span>
                    </span>
                  </Link>
                )}
                {attention!.aiPaused > 0 && (
                  <Link href="/inbox" className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:bg-accent transition-colors">
                    <Inbox className="h-5 w-5 shrink-0 text-warning" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{attention!.aiPaused} repl{attention!.aiPaused === 1 ? "y" : "ies"} nobody is answering</span>
                      <span className="block text-sm text-muted-foreground">These threads aren&apos;t AI-managed, so they wait for a person.</span>
                    </span>
                  </Link>
                )}
                {attention!.interventions.map((iv) => {
                  const meta = INTERVENTION_LABEL[iv.type] ?? INTERVENTION_LABEL.other;
                  return (
                    <Link key={iv.id} href="/negotiation" className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:bg-accent transition-colors">
                      <meta.icon className="h-5 w-5 shrink-0 text-warning" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{meta.label}{iv.who ? ` — ${iv.who}` : ""}</span>
                        {iv.ask && <span className="block truncate text-sm text-muted-foreground">&ldquo;{iv.ask}&rdquo;</span>}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── The funnel, as filters ──────────────────────────────────────────── */}
          <section className="rounded-2xl border border-[var(--glass-border)] bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Progress for {funnel.campaign.target_path}</h2>
              {stageFilter && (
                <Button size="sm" variant="ghost" onClick={() => setStageFilter(null)}>Show all</Button>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {steps.map((s) => {
                const on = stageFilter === s.key || (s.key === null && stageFilter === null);
                return (
                  <button key={s.label} onClick={() => setStageFilter(s.key)}
                    className={cn(
                      "rounded-xl border p-4 text-left transition-colors",
                      on ? "border-highlight bg-highlight-soft" : "border-border hover:bg-accent",
                    )}>
                    <s.icon className={cn("h-4 w-4", s.label === "Link live" && s.n > 0 ? "text-success" : "text-muted-foreground")} />
                    <div className={cn("mt-2 text-3xl font-light tabular-nums", s.label === "Link live" && s.n > 0 && "text-success")}>{s.n}</div>
                    <div className="mt-0.5 text-sm font-medium">{s.label}</div>
                    <div className="text-xs text-muted-foreground">{s.sub}</div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Automation. The two settings that decide whether this runs itself. ─────────── */}
          <AutopilotCard />

          {/* ── Manual steps, for when you don't want to wait for the schedule ────────────── */}
          <section className="rounded-2xl border border-[var(--glass-border)] bg-card p-5">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Run a step now</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Each of these happens on its own once automation is on. Use them to push this campaign along immediately.
            </p>
            <div className="mt-4 flex flex-wrap gap-2.5">
              <Button size="lg" variant="outline" disabled={!!busy} onClick={() => action("discover")}>
                {busy === "discover" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Find more prospects
              </Button>
              <Button size="lg" variant="outline" disabled={!!busy} onClick={() => action("enrich")}>
                {busy === "enrich" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Find emails
              </Button>
              <Button size="lg" variant="outline" disabled={!!busy} onClick={() => action("draft")}>
                {busy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />} Write pitches
              </Button>
              <Button size="lg" variant="outline" disabled={!!busy} onClick={() => action("verify")}>
                {busy === "verify" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Check for live links
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4 text-sm">
              <span className="text-muted-foreground">Open elsewhere:</span>
              <Link href={`/sending?workflow_id=${funnel.campaign.workflow_id}&label=${encodeURIComponent(funnel.campaign.target_path)}`}
                className="flex items-center gap-1.5 text-highlight-ink hover:underline">
                <Send className="h-4 w-4" /> The send queue for this campaign
              </Link>
              <Link href="/inbox" className="flex items-center gap-1.5 text-highlight-ink hover:underline">
                <Inbox className="h-4 w-4" /> Replies
              </Link>
              <Link href="/negotiation" className="flex items-center gap-1.5 text-highlight-ink hover:underline">
                <HandCoins className="h-4 w-4" /> Negotiations
              </Link>
            </div>
          </section>

          {/* ── Prospects ───────────────────────────────────────────────────────── */}
          <section className="rounded-2xl border border-[var(--glass-border)] bg-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
              <div>
                <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Prospects{stageFilter ? ` — ${steps.find((s) => s.key === stageFilter)?.label ?? "filtered"}` : ""}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                  Showing {visible.length} of {prospects.length}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Best first by</span>
                {([["score", "Overall fit"], ["dr", "Domain Rating"], ["email", "Email quality"]] as Array<[SortKey, string]>).map(([k, lbl]) => (
                  <Button key={k} size="sm" variant={sortKey === k ? "default" : "outline"} onClick={() => setSortKey(k)}>
                    {sortKey === k && <ArrowUpDown className="h-3.5 w-3.5" />}{lbl}
                  </Button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground [&>th]:px-5 [&>th]:py-3 [&>th]:text-left [&>th]:font-medium">
                    <th>Site &amp; author</th>
                    <th className="text-right!">Fit</th>
                    <th className="text-right!">DR</th>
                    <th>Email</th>
                    <th>Pitch</th>
                    <th>Stage</th>
                    <th>Why them</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr><td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">
                      {prospects.length === 0 ? "No prospects yet — use “Find more prospects” above." : "Nothing matches this filter."}
                    </td></tr>
                  )}
                  {visible.map((p) => {
                    const trust = EMAIL_TRUST_LABEL[p.emailTrust];
                    return (
                      <tr key={p.id} className="border-b border-border/60 last:border-0 align-top [&>td]:px-5 [&>td]:py-4">
                        <td className="max-w-[260px]">
                          <a href={p.prospectUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-medium hover:underline">
                            <span className="truncate">{p.domain}</span><ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          </a>
                          {p.author && <div className="mt-0.5 truncate text-muted-foreground">{p.author}</div>}
                        </td>
                        <td className="text-right tabular-nums">{p.score ?? "—"}</td>
                        <td className="text-right tabular-nums">{p.dr ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="max-w-[230px]">
                          <Badge variant="outline" className={cn("text-xs", trust.cls)} title={trust.hint}>{trust.label}</Badge>
                          {p.email && <div className="mt-1 truncate text-xs text-muted-foreground">{p.email}</div>}
                        </td>
                        <td>
                          {p.pitch ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setPitchFor(p)}
                              // The unreviewed state is what an operator is scanning for, so it reads as a
                              // prompt rather than a neutral label. 106 pitches had been drafted and none
                              // opened, precisely because nothing pointed at them.
                              className={cn("gap-1.5", !p.pitch.editedAt && p.pitch.editable && "border-primary/40 text-primary")}
                            >
                              <PenLine className="h-3.5 w-3.5" />
                              {p.pitch.editedAt ? "Reviewed" : p.pitch.editable ? "Review" : "View"}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {p.emailTrust === "none" ? "needs an email first" : "not drafted yet"}
                            </span>
                          )}
                        </td>
                        <td>
                          <Badge variant="outline" className={cn("text-xs", STAGE_UI[p.stage]?.cls)}>{STAGE_UI[p.stage]?.label ?? p.stage}</Badge>
                        </td>
                        <td className="max-w-md text-muted-foreground">{p.angle ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <PitchDialog
        open={!!pitchFor}
        onOpenChange={(v) => { if (!v) setPitchFor(null); }}
        target={pitchFor && pitchFor.pitch ? ({
          domain: pitchFor.domain,
          author: pitchFor.author,
          email: pitchFor.email,
          emailOwner: pitchFor.emailOwner,
          emailOwnerPosition: pitchFor.emailOwnerPosition,
          prospectUrl: pitchFor.prospectUrl,
          pitch: pitchFor.pitch,
        } satisfies PitchTarget) : null}
        // Reload so the row's button flips to "Reviewed" straight away. Re-reading the funnel rather than
        // patching local state keeps one source of truth for what the database actually holds.
        onSaved={() => { if (selected) void loadFunnel(selected); }}
      />
    </div>
  );
}
