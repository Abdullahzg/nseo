"use client";

// Landing pages.
//
// The honest shape of this screen: the two hard steps happen OUTSIDE this app. Vibe-coding a page and
// templatising it into Strapi are Claude skills run against imagine-web and imagine-blogs-backend in a
// coding session. A button here that claimed to do either would be lying.
//
// So this page owns the parts it genuinely can: capture the brief, ground it in real search data before
// anyone writes code, hand over a copy-pasteable brief, and track which stage each page is at. Once a
// page is templatised its copy is written by the same AI writer and published through the same Strapi
// path as a blog post — which is why there is no separate publishing surface here.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  LayoutTemplate, Loader2, Plus, Copy, AlertTriangle, CheckCircle2, RefreshCw, Trash2,
  ArrowRight, Search, ExternalLink, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STAGES, STAGE_META, type LandingStage, type LandingPage } from "@/lib/landing/stages";
import { LandingWizard } from "@/components/landing/LandingWizard";

export default function LandingPagesPage() {
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [brief, setBrief] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** Which page is mid-launch, so the button can disable just that row. */
  const [launching, setLaunching] = useState<string | null>(null);

  /** Create the draft for a templatised page and hand it to the writer. Idempotent server-side: if a
   *  draft already exists it comes back rather than forking into a second one. */
  async function launch(id: string) {
    setLaunching(id);
    try {
      const d = await fetch(`/api/landing/${id}/launch`, { method: "POST" }).then((r) => r.json());
      if (!d?.ok) { toast.error(d?.error ?? "Couldn't create the draft."); return; }
      if (d.warning) toast.warning(d.warning);
      toast.success(d.reused ? "This page already had a draft — opening it." : "Draft created from the brief.");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't create the draft.");
    } finally { setLaunching(null); }
  }

  // New-page form.
  const [feature, setFeature] = useState("");
  const [keyword, setKeyword] = useState("");
  const [targetPath, setTargetPath] = useState("");
  const [angle, setAngle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch("/api/landing").then((r) => r.json());
      if (d?.ok) setPages(d.pages);
    } catch { /* the form still works */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadOne = useCallback(async (id: string) => {
    const d = await fetch(`/api/landing/${id}`).then((r) => r.json()).catch(() => null);
    if (!d?.ok) return;
    setPages((p) => p.map((x) => (x.id === id ? d.page : x)));
    setBrief(d.skill_brief ?? "");
  }, []);

  useEffect(() => { if (selected) void loadOne(selected); }, [selected, loadOne]);

  async function create() {
    if (!feature.trim()) { toast.error("What feature is the page for?"); return; }
    setCreating(true);
    try {
      const d = await fetch("/api/landing", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feature: feature.trim(), primary_keyword: keyword.trim(),
          target_path: targetPath.trim(), angle: angle.trim(),
        }),
      }).then((r) => r.json());
      if (!d?.ok) { toast.error(d?.error ?? "Couldn't create it."); return; }
      setFeature(""); setKeyword(""); setTargetPath(""); setAngle("");
      await load();
      setSelected(d.page.id);
      toast.success("Brief captured and grounded.");
    } finally { setCreating(false); }
  }

  async function patch(id: string, body: Record<string, unknown>, label: string) {
    setBusy(label);
    try {
      const d = await fetch(`/api/landing/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then((r) => r.json());
      if (!d?.ok) { toast.error(d?.error ?? "Update failed."); return; }
      setPages((p) => p.map((x) => (x.id === id ? d.page : x)));
      setBrief(d.skill_brief ?? brief);
    } finally { setBusy(null); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this landing page record? The page itself, if it exists, is untouched.")) return;
    const d = await fetch(`/api/landing/${id}`, { method: "DELETE" }).then((r) => r.json()).catch(() => null);
    if (!d?.ok) { toast.error("Couldn't delete it."); return; }
    setPages((p) => p.filter((x) => x.id !== id));
    if (selected === id) setSelected(null);
  }

  const page = pages.find((p) => p.id === selected) ?? null;
  const research = (page?.research ?? {}) as {
    opportunity?: { keyword: string; impressions: number; position: number } | null;
    canonical?: { verdict?: { kind: string; note: string } } | null;
    internal_links?: Array<{ path: string; section: string }>;
    notes?: string[];
  };
  const verdict = research.canonical?.verdict;

  return (
    <div className="flex gap-6 h-full min-h-0">
      {/* New + list */}
      <div className="w-80 shrink-0 h-full min-h-0 flex flex-col overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[64px] backdrop-saturate-[1.65] shadow-[var(--glass-shadow)]">
        <div className="p-4 border-b border-border space-y-3">
          <div className="space-y-1">
            <h1 className="text-base font-light flex items-center gap-2 tracking-tight">
              <LayoutTemplate className="h-4 w-4 text-highlight-ink" /> Landing pages
            </h1>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Capture a brief, check it against real demand, then hand it to the skills that build it.
            </p>
          </div>

          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor="feature">Feature</Label>
              <Input id="feature" value={feature} onChange={(e) => setFeature(e.target.value)}
                placeholder="AI Headshot Generator" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="kw">Primary keyword</Label>
              <Input id="kw" value={keyword} onChange={(e) => setKeyword(e.target.value)}
                placeholder="ai headshot generator" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="path">Intended path</Label>
              <Input id="path" value={targetPath} onChange={(e) => setTargetPath(e.target.value)}
                placeholder="/ai-headshot-generator" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="angle">Angle <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input id="angle" value={angle} onChange={(e) => setAngle(e.target.value)}
                placeholder="for job seekers, not photographers" />
            </div>
            <Button className="w-full gap-1.5" disabled={creating || !feature.trim()} onClick={create}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {creating ? "Checking demand…" : "Capture brief"}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : pages.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground text-center">No landing pages yet.</p>
          ) : pages.map((p) => (
            <button key={p.id} onClick={() => setSelected(p.id)}
              className={cn("w-full text-left px-3 py-2.5 border-b border-border/60 hover:bg-muted/40",
                selected === p.id && "bg-highlight-soft")}>
              <p className="text-sm font-medium truncate">{p.feature}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {STAGE_META[p.stage as LandingStage]?.label ?? p.stage}
                {p.primary_keyword ? ` · ${p.primary_keyword}` : ""}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-y-auto pr-1">
        {!page ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center text-muted-foreground max-w-lg mx-auto">
            <LayoutTemplate className="h-8 w-8 opacity-40" />
            <p className="text-sm">Capture a brief on the left, or pick an existing page.</p>
          </div>
        ) : (
          <div className="max-w-4xl space-y-4 pb-10">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold">{page.feature}</h2>
                <p className="text-xs text-muted-foreground">
                  {page.primary_keyword ?? "no keyword"}
                  {page.target_path ? ` → ${page.target_path}` : ""}
                </p>
              </div>
              <Button size="xs" variant="ghost" className="text-destructive hover:text-destructive gap-1"
                onClick={() => remove(page.id)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>

            {/* The stage machine, with the owner of each step on screen. */}
            <div className="rounded-lg border border-border p-4 space-y-3">
              <p className="text-sm font-medium">Stage</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {STAGES.map((s, i) => {
                  const active = page.stage === s;
                  const done = STAGES.indexOf(page.stage as LandingStage) > i;
                  return (
                    <div key={s} className="flex items-center gap-1.5">
                      <button type="button" onClick={() => patch(page.id, { stage: s }, `stage-${s}`)}
                        disabled={busy !== null}
                        className={cn("rounded-full border px-3 h-8 text-xs font-medium transition-colors",
                          active ? "border-highlight/60 bg-primary text-primary-foreground"
                            : done ? "border-success/40 bg-success/15 text-success"
                              : "border-border text-muted-foreground hover:bg-muted/50")}>
                        {busy === `stage-${s}` ? <Loader2 className="h-3 w-3 animate-spin" /> : STAGE_META[s].label}
                      </button>
                      {i < STAGES.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/40" />}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* The fork: reuse a template that already ships, or commission a new one. Sits directly
                under the stage machine because it is what decides which stages even apply — reusing skips
                vibe_coded and templatised entirely. */}
            <LandingWizard page={page} onChanged={load} />

            {/* Grounding. The cannibalisation verdict is the most consequential thing here, so it is
                not buried below the brief. */}
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-highlight-ink" />
                <p className="text-sm font-medium">Should this page exist</p>
                <Button size="xs" variant="ghost" className="ml-auto gap-1"
                  disabled={busy !== null || !page.primary_keyword}
                  onClick={() => patch(page.id, { action: "reresearch" }, "research")}>
                  {busy === "research" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Re-check
                </Button>
              </div>

              {verdict && (
                <div className={cn("rounded-lg border p-3 flex items-start gap-2",
                  verdict.kind === "self" ? "border-success/40 bg-success/15"
                    : verdict.kind === "rebuild" ? "border-highlight/40 bg-highlight-soft"
                      : "border-warning/40 bg-warning/5")}>
                  {verdict.kind === "self"
                    ? <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                    : verdict.kind === "rebuild"
                      ? <RefreshCw className="h-4 w-4 text-highlight-ink shrink-0 mt-0.5" />
                      : <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />}
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      {verdict.kind === "self" ? "Nothing competes with it — build it"
                        : verdict.kind === "rebuild" ? "This is a rebuild of a page you already own"
                          : verdict.kind === "cannibalisation" ? "We already rank for this"
                            : "A near-duplicate exists"}
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{verdict.note}</p>
                  </div>
                </div>
              )}

              {research.opportunity ? (
                <p className="text-sm text-muted-foreground">
                  Search Console: <span className="text-foreground">{research.opportunity.impressions.toLocaleString()} impressions</span>
                  {" at average position "}<span className="text-foreground">{research.opportunity.position.toFixed(1)}</span>.
                  Measured demand, currently badly served.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">No striking-distance Search Console data for this keyword.</p>
              )}

              {(research.internal_links?.length ?? 0) > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    {research.internal_links!.length} pages to link to
                  </summary>
                  <ul className="mt-1 space-y-0.5 font-mono text-muted-foreground">
                    {research.internal_links!.slice(0, 6).map((l) => <li key={l.path}>{l.path}</li>)}
                  </ul>
                </details>
              )}
              {(research.notes?.length ?? 0) > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">
                    {research.notes!.length} note{research.notes!.length === 1 ? "" : "s"} on the data
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {research.notes!.map((n, i) => <li key={i}>• {n}</li>)}
                  </ul>
                </details>
              )}
            </div>


            {/* The step that used to be missing. STAGE_META said the writer fills the template's
                fields "like any other draft", but nothing created that draft — so a person marked the
                stage by hand and then went to find the writer. This makes the status board able to
                move its own pipeline: one click creates the draft, links it, and advances the stage. */}
            <div className="rounded-2xl border border-highlight/40 bg-highlight-soft p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {page.draft_id ? "Copy is being written" : "Ready to write the copy?"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {page.draft_id
                      ? "This page has a draft. Landing pages publish through the same Strapi path as posts."
                      : "Creates a draft seeded with this brief, then hand it to the AI writer. From here it is a normal draft."}
                  </p>
                </div>
                {page.draft_id ? (
                  <Link href="/blog" className="shrink-0">
                    <Button size="sm" variant="outline" className="gap-1.5">
                      <PenLine className="h-3.5 w-3.5" /> Open the draft
                    </Button>
                  </Link>
                ) : (
                  <Button size="sm" className="shrink-0 gap-1.5" disabled={launching === page.id}
                    onClick={() => void launch(page.id)}>
                    {launching === page.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <PenLine className="h-3.5 w-3.5" />}
                    Write the copy
                  </Button>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
