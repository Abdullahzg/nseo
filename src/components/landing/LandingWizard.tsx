"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Loader2, ArrowLeft, Check, LayoutTemplate, Sparkles, ExternalLink,
  GitPullRequest, Eye, RefreshCw, X, ImagePlus, Link2, Wand2, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { LandingPage } from "@/lib/landing/stages";

interface TemplateOption {
  component: string;
  label: string;
  sections: string[];
  sectionLabels: string[];
  vibeCoded: boolean;
}

/**
 * One decision per screen.
 *
 * The version this replaces put every path on one screen at once: a 24-row template list, a campaign
 * form, a vibe-code button, a pasteable brief, and four paragraphs explaining the difference between
 * them — all visible before the operator had made a single choice. Every one of those paragraphs was
 * true and useful to whoever wrote it, and collectively they were the reason nobody could use the page.
 *
 * So: two big targets first, then only what that answer needs. Explanatory text is cut to one line per
 * card, because the point of a card is that its label carries the meaning. Anything an operator needs
 * only after committing (the URL trap, the claim rules) moves to the step where it applies, where it is
 * one warning instead of one of five.
 */
export function LandingWizard({ page, onChanged }: { page: LandingPage; onChanged: () => void }) {
  type Step = "choose" | "template" | "newpage" | "done";

  // Resume mid-flow rather than restarting: a page that already has a Strapi entry or a build is past
  // the choosing stage, and showing the fork again would invite creating a second one.
  const initial: Step = page.strapi_entry_id || page.template_pr_url ? "done"
    : page.template_source === "existing" ? "template"
      : page.template_source === "campaign" || page.template_source === "vibe_coded" ? "newpage"
        : "choose";

  const [step, setStep] = useState<Step>(initial);
  const [options, setOptions] = useState<TemplateOption[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // The instructions to actually run — the campaign and vibe_coded branches build nothing themselves,
  // they save the brief and hand it back for a person or a coding session to pick up. The API always
  // returned this; nothing displayed it, so "Build it" appeared to succeed into a dead end with no next
  // action visible anywhere. Session-only (not refetched on reload) — recomputing it needs the same
  // server-only Strapi-client import chain configure.ts uses, which is why it comes from the POST
  // response rather than a client-side call to skillHandoff/campaignHandoff directly.
  const [handoffText, setHandoffText] = useState<string | null>(null);

  const [template, setTemplate] = useState(page.strapi_template ?? "");
  const [category, setCategory] = useState(page.strapi_category ?? "");
  const [slug, setSlug] = useState((page.strapi_slug ?? page.target_path ?? "").replace(/^\//, ""));

  const [refUrl, setRefUrl] = useState(page.reference_url ?? "");
  const [destUrl, setDestUrl] = useState(page.destination_url ?? "");
  const [productName, setProductName] = useState(page.product_name ?? page.feature ?? "");

  // "Create a new one" is two genuinely different jobs, not one form: cloning a competitor's structure
  // (campaign, needs a reference) versus an original design from a prompt (vibe_coded, needs no reference
  // at all — the campaign fields were the ONLY thing this step ever offered, which is why a reference URL
  // read as required even when there was nothing to clone).
  const [newpageMode, setNewpageMode] = useState<"clone" | "original">(
    page.template_source === "campaign" ? "clone" : "original",
  );
  const [creativePrompt, setCreativePrompt] = useState(page.creative_prompt ?? "");
  const [images, setImages] = useState<string[]>(page.reference_image_urls ?? []);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/blog/upload", { method: "POST", body: form });
        const d = await res.json();
        if (!res.ok || !d.ok) { toast.error(d.error ?? `Could not upload ${file.name}.`); continue; }
        if (d.url) uploaded.push(d.url);
      }
      if (uploaded.length) setImages((prev) => [...prev, ...uploaded]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/landing/templates");
      const d = await res.json();
      setOptions(d.templates ?? []);
      setCategories(d.categories ?? []);
      if (d.error) toast.error(`Could not read templates from Strapi: ${d.error}`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (step === "template" && !options.length) void loadTemplates(); }, [step]);

  // The category a template's own name implies. Right most of the time; the one case it is wrong is
  // exactly what the API warns about, so it is a default and never a lock.
  useEffect(() => {
    if (!template || category) return;
    const hint = (template.split(".")[1] ?? "").replace(/-\d+$/, "").replace(/-templates?$/, "");
    if (categories.includes(hint)) setCategory(hint);
  }, [template, category, categories]);

  async function post(body: Record<string, unknown>, onOk: (d: any) => void) {
    setBusy(true);
    try {
      const res = await fetch(`/api/landing/${page.id}/configure`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { toast.error(d.error ?? "That did not work."); return; }
      (d.warnings ?? []).forEach((w: string) => toast.warning(w, { duration: 12_000 }));
      onOk(d);
      onChanged();
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const useTemplate = () => post({ source: "existing", template, category, slug }, (d) => {
    toast.success("Strapi entry ready. Write the copy.");
    if (d.adminUrl) window.open(d.adminUrl, "_blank", "noopener");
    setStep("done");
  });

  const buildNew = () => post({
    source: "campaign", reference_url: refUrl, destination_url: destUrl, product_name: productName,
  }, (d) => { setHandoffText(d.handoff ?? null); toast.success("Brief saved. Hand it to the campaign-landing-page skill."); setStep("done"); });

  const buildVibecode = () => post({
    source: "vibe_coded", creative_prompt: creativePrompt, reference_image_urls: images,
  }, (d) => { setHandoffText(d.handoff ?? null); toast.success("Brief saved. Hand it to the imagine-landing skill."); setStep("done"); });

  const back = (to: Step) => (
    <Button size="sm" variant="ghost" className="gap-1.5 -ml-2" onClick={() => setStep(to)}>
      <ArrowLeft className="h-4 w-4" /> Back
    </Button>
  );

  return (
    <div className="space-y-4">
      {/* ── Step 1: the only question that matters first ─────────────────────── */}
      {step === "choose" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <button type="button" onClick={() => setStep("template")}
            className="glass-panel group flex min-h-[180px] flex-col items-start gap-3 p-6 text-left transition-colors hover:bg-highlight-soft">
            <LayoutTemplate className="h-7 w-7 text-highlight-ink" />
            <span className="text-lg font-medium">Use a template</span>
            <span className="text-sm text-muted-foreground">Ready now. Pick one, write the copy.</span>
            <Badge variant="outline" className="mt-auto text-xs">24 available</Badge>
          </button>

          <button type="button" onClick={() => setStep("newpage")}
            className="glass-panel group flex min-h-[180px] flex-col items-start gap-3 p-6 text-left transition-colors hover:bg-highlight-soft">
            <Sparkles className="h-7 w-7 text-highlight-ink" />
            <span className="text-lg font-medium">Create a new one</span>
            <span className="text-sm text-muted-foreground">Built from a reference page, then a PR and a preview.</span>
            <Badge variant="outline" className="mt-auto text-xs">designed + deployed</Badge>
          </button>
        </div>
      )}

      {/* ── Step 2a: pick a template ─────────────────────────────────────────── */}
      {step === "template" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            {back("choose")}
            <Button size="sm" variant="ghost" className="ml-auto gap-1" onClick={() => void loadTemplates()} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </div>

          <div className="grid max-h-[420px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
            {options.map((o) => (
              <button key={o.component} type="button" onClick={() => setTemplate(o.component)}
                className={cn(
                  "flex min-h-[120px] flex-col items-start gap-2 rounded-2xl border p-5 text-left transition-colors",
                  template === o.component ? "border-highlight/60 bg-highlight-soft" : "border-border hover:bg-muted/40",
                )}>
                <div className="flex w-full items-center gap-2">
                  <span className="text-base font-medium">{o.label}</span>
                  {template === o.component && <Check className="h-4 w-4 text-success" />}
                  <span className="ml-auto text-xs text-muted-foreground">{o.sections.length}</span>
                </div>
                <span className="text-xs text-muted-foreground">{o.sectionLabels.slice(0, 4).join(" · ")}</span>
              </button>
            ))}
          </div>

          {template && (
            <div className="glass-panel space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="w-slug">URL</Label>
                  <Input id="w-slug" className="h-11" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="ai-headshot-generator" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="w-cat">Category</Label>
                  <select id="w-cat" value={category} onChange={(e) => setCategory(e.target.value)}
                    className="h-11 w-full rounded-lg border border-border bg-transparent px-3 text-sm">
                    <option value="">Select…</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <Button size="lg" className="w-full gap-2" disabled={busy || !category || !slug.trim()} onClick={useTemplate}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Create it and open Strapi
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Step 2b: build a new one — two different jobs, not one form ─────────── */}
      {step === "newpage" && (
        <div className="space-y-4">
          {back("choose")}

          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => setNewpageMode("original")}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border p-4 text-left transition-colors",
                newpageMode === "original" ? "border-highlight/60 bg-highlight-soft" : "border-border hover:bg-muted/40",
              )}>
              <Wand2 className="h-5 w-5 shrink-0 text-highlight-ink" />
              <span>
                <span className="block text-sm font-medium">Original design</span>
                <span className="block text-xs text-muted-foreground">A prompt, and optionally some reference images. No reference site.</span>
              </span>
            </button>
            <button type="button" onClick={() => setNewpageMode("clone")}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border p-4 text-left transition-colors",
                newpageMode === "clone" ? "border-highlight/60 bg-highlight-soft" : "border-border hover:bg-muted/40",
              )}>
              <Link2 className="h-5 w-5 shrink-0 text-highlight-ink" />
              <span>
                <span className="block text-sm font-medium">Clone a reference</span>
                <span className="block text-xs text-muted-foreground">Match a competitor page's structure and palette for a paid campaign.</span>
              </span>
            </button>
          </div>

          {/* ── Original design: a prompt, optional images, no reference required ── */}
          {newpageMode === "original" && (
            <div className="glass-panel space-y-4 p-6">
              <div className="space-y-1.5">
                <Label htmlFor="w-prompt" className="text-base">Creative prompt</Label>
                <Textarea id="w-prompt" className="min-h-[120px] text-base" value={creativePrompt}
                  onChange={(e) => setCreativePrompt(e.target.value)}
                  placeholder="Tone, the signature moment, what this page should NOT feel like…" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-base">Reference images (optional)</Label>
                <div className="flex flex-wrap gap-2">
                  {images.map((url) => (
                    <div key={url} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-border">
                      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary uploaded media, not a local asset */}
                      <img src={url} alt="" className="h-full w-full object-cover" />
                      <button type="button" onClick={() => setImages((prev) => prev.filter((u) => u !== url))}
                        className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                    className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground hover:bg-muted/40 disabled:opacity-50">
                    {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                    <span className="text-[10px]">Add</span>
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => void addImages(e.target.files)} />
                </div>
              </div>

              <Button size="lg" className="w-full gap-2" disabled={busy} onClick={buildVibecode}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Vibecode it
              </Button>
            </div>
          )}

          {/* ── Clone a reference: the campaign path, unchanged ──────────────────── */}
          {newpageMode === "clone" && (
            <div className="glass-panel space-y-4 p-6">
              <div className="space-y-1.5">
                <Label htmlFor="w-ref" className="text-base">Reference page</Label>
                <Input id="w-ref" className="h-12 text-base" value={refUrl} onChange={(e) => setRefUrl(e.target.value)}
                  placeholder="https://rows.com/ai" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="w-dest" className="text-base">Where the buttons go</Label>
                <Input id="w-dest" className="h-12 text-base" value={destUrl} onChange={(e) => setDestUrl(e.target.value)}
                  placeholder="https://www.imagine.art/computer/agent/sheets" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="w-prod" className="text-base">Product name</Label>
                <Input id="w-prod" className="h-12 text-base" value={productName} onChange={(e) => setProductName(e.target.value)}
                  placeholder="Sheets" />
              </div>

              {/* The one warning that earns its place here: it has already cost a full research cycle. */}
              <p className="flex items-start gap-2 text-xs text-warning">
                <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Open that destination and look at it. A link that loads is not proof the surface exists.
              </p>

              <Button size="lg" className="w-full gap-2"
                disabled={busy || !refUrl.trim() || !destUrl.trim() || !productName.trim()} onClick={buildNew}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Build it
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: what happened ────────────────────────────────────────────── */}
      {step === "done" && (
        <div className="glass-panel space-y-4 p-6">
          {page.strapi_entry_id ? (
            <>
              <p className="flex items-center gap-2 text-lg font-medium">
                <Check className="h-5 w-5 text-success" /> Ready for copy
              </p>
              <p className="text-sm text-muted-foreground">
                {page.strapi_template} · /{page.strapi_slug}
              </p>
              <Button size="lg" className="gap-2" onClick={useTemplate} disabled={busy}>
                <ExternalLink className="h-4 w-4" /> Open in Strapi
              </Button>
            </>
          ) : (
            <>
              <BuildStatus page={page} onChanged={onChanged} />
              {handoffText && <HandoffBrief text={handoffText} />}
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setStep("choose")}>Start over</Button>
        </div>
      )}
    </div>
  );
}

/**
 * The build's real state — a PR link and a preview URL, not a prompt to copy.
 *
 * Shows `queued` honestly while no runner has claimed the job. The previous version handed over a
 * pasteable brief and called that done, which made a manual step look like an automated one; a queue
 * depth of one with nothing consuming it is at least an accurate picture.
 */
function BuildStatus({ page, onChanged }: { page: LandingPage; onChanged: () => void }) {
  const pr = page.template_pr_url;
  // deployed_url is the campaign path's field; cdn_url is where a vibe-coded static export lands. Only
  // one is ever set for a given page, so this reads correctly regardless of which path it took.
  const preview = page.deployed_url || page.cdn_url;
  const state = pr && preview ? "built" : pr ? "in review" : "queued";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-lg font-medium">{page.repo_name ?? page.feature}</p>
        <Badge variant="outline" className="text-xs">{state}</Badge>
        <Button size="sm" variant="ghost" className="ml-auto gap-1" onClick={onChanged}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <a href={pr ?? "#"} target="_blank" rel="noreferrer"
          className={cn("flex min-h-[96px] flex-col justify-between rounded-2xl border p-5",
            pr ? "border-border hover:bg-muted/40" : "border-dashed border-border/60 opacity-60 pointer-events-none")}>
          <GitPullRequest className="h-5 w-5 text-highlight-ink" />
          <span className="text-sm font-medium">{pr ? "Open the pull request" : "No PR yet"}</span>
        </a>
        <a href={preview ?? "#"} target="_blank" rel="noreferrer"
          className={cn("flex min-h-[96px] flex-col justify-between rounded-2xl border p-5",
            preview ? "border-border hover:bg-muted/40" : "border-dashed border-border/60 opacity-60 pointer-events-none")}>
          <Eye className="h-5 w-5 text-highlight-ink" />
          <span className="text-sm font-medium">{preview ? "See the built page" : "No preview yet"}</span>
        </a>
      </div>

      {state === "queued" && (
        <p className="text-xs text-muted-foreground">
          Nothing builds this automatically yet — the brief below is what a person or a coding session
          runs next.
        </p>
      )}
    </div>
  );
}

/** The actual next action, made visible and copyable. See the comment on handoffText above for why
 *  this only appears for the session that just built the brief, not on a later page reload. */
function HandoffBrief({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Brief for the coding session</p>
        <Button size="sm" variant="ghost" className="gap-1.5"
          onClick={() => {
            void navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}>
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
        {text}
      </pre>
    </div>
  );
}
