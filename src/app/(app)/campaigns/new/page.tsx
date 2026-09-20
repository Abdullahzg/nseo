"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Loader2, Bot, Shield, Zap, Target, Globe, DollarSign, FileText, Plus, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function CampaignFormSkeleton() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-8 w-16" />
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-3"><Skeleton className="h-4 w-36" /></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5"><Skeleton className="h-4 w-28" /><Skeleton className="h-10 w-full" /></div>
            <div className="space-y-1.5"><Skeleton className="h-4 w-32" /><Skeleton className="h-24 w-full" /></div>
            <div className="space-y-1.5"><Skeleton className="h-4 w-40" /><Skeleton className="h-10 w-full" /></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><Skeleton className="h-4 w-40" /></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5"><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>
            <div className="space-y-1.5"><Skeleton className="h-4 w-40" /><Skeleton className="h-28 w-full" /></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><Skeleton className="h-4 w-28" /></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" />
            </div>
          </CardContent>
        </Card>
        <Skeleton className="h-10 w-36" />
      </div>
    </div>
  );
}

export default function NewCampaignPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    objective: "",
    website_url: "",
    keywords: [] as string[],
    seed_domains: [] as string[],
    constraints_text: "",
    budget_total: "",
    autonomy_mode: "autonomous" as "autonomous" | "supervised",
    demo_mode: true,
  });
  const [initializing, setInitializing] = useState(true);
  const [keywordInput, setKeywordInput] = useState("");
  const [domainInput, setDomainInput] = useState("");

  useEffect(() => {
    setInitializing(false);
  }, []);

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (kw && !form.keywords.includes(kw)) {
      setForm((f) => ({ ...f, keywords: [...f.keywords, kw] }));
      setKeywordInput("");
    }
  };

  const removeKeyword = (kw: string) => {
    setForm((f) => ({ ...f, keywords: f.keywords.filter((k) => k !== kw) }));
  };

  const addDomain = () => {
    let d = domainInput.trim().toLowerCase();
    if (d) {
      d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (d && !form.seed_domains.includes(d)) {
        setForm((f) => ({ ...f, seed_domains: [...f.seed_domains, d] }));
        setDomainInput("");
      }
    }
  };

  const removeDomain = (d: string) => {
    setForm((f) => ({ ...f, seed_domains: f.seed_domains.filter((x) => x !== d) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Campaign name is required");
      return;
    }
    if (form.keywords.length === 0 && form.seed_domains.length === 0 && !form.website_url.trim()) {
      setError("Add at least keywords, target websites, or your website URL");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          objective: form.objective || null,
          website_url: form.website_url || null,
          keywords: form.keywords,
          seed_domains: form.seed_domains,
          constraints_text: form.constraints_text || null,
          budget_total: form.budget_total ? Number(form.budget_total) : null,
          autonomy_mode: form.autonomy_mode,
          demo_mode: form.demo_mode,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create campaign");
      }
      const campaign = await res.json();
      // Auto-start the campaign immediately
      await fetch(`/api/campaigns/${campaign.id}/start`, { method: "POST" }).catch(() => {});
      router.push(`/campaigns/${campaign.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (initializing) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Initializing form…</span>
        </div>
        <CampaignFormSkeleton />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/campaigns/autonomous">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">New Campaign</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Define your SEO backlink targets. The AI agents handle the rest.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setForm({
              name: "AI Photo Editor Backlinks",
              objective: "Build 10 high-quality backlinks for AI photo editing tools",
              website_url: "https://example.com",
              keywords: ["AI photo editor", "photo restoration", "headshot generator"],
              seed_domains: [],
              constraints_text: "",
              budget_total: "",
              autonomy_mode: "autonomous",
              demo_mode: true,
            });
          }}
        >
          Try example
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Campaign Details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4" /> Campaign Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name" className="text-sm">Campaign Name *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Tech Blog Backlinks Q1"
                className="mt-1.5"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="objective" className="text-sm">SEO Objective</Label>
              <Textarea
                id="objective"
                value={form.objective}
                onChange={(e) => setForm((f) => ({ ...f, objective: e.target.value }))}
                placeholder="e.g. Build 20 high-DA backlinks for our SaaS product page to improve rankings for 'project management software'"
                className="mt-1.5 min-h-[80px]"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Describe your SEO goal — what page you want to rank and for which search terms.
              </p>
            </div>
            <div>
              <Label htmlFor="website_url" className="text-sm">Your Website URL</Label>
              <Input
                id="website_url"
                value={form.website_url}
                onChange={(e) => setForm((f) => ({ ...f, website_url: e.target.value }))}
                placeholder="https://yoursite.com"
                className="mt-1.5"
              />
              <p className="text-xs text-muted-foreground mt-1">
                The site you want backlinks pointing to.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Keywords */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Search className="h-4 w-4" /> Target Keywords
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Keywords agents use to find relevant publications and craft outreach. These define your niche.
            </p>
            <div className="flex gap-2">
              <Input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                placeholder="e.g. SaaS reviews, developer tools, tech blog"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
                className="flex-1"
              />
              <Button type="button" variant="outline" size="sm" onClick={addKeyword} disabled={!keywordInput.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {form.keywords.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {form.keywords.map((kw) => (
                  <span key={kw} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1 text-xs">
                    {kw}
                    <button type="button" onClick={() => removeKeyword(kw)} className="ml-0.5 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {form.keywords.length === 0 && (
              <p className="text-xs text-destructive">Add at least one keyword to help agents find the right publications.</p>
            )}
          </CardContent>
        </Card>

        {/* Target Websites */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4" /> Target Websites
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Specific publications or blogs you want backlinks from. Agents will prioritize these.
            </p>
            <div className="flex gap-2">
              <Input
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                placeholder="e.g. techcrunch.com, producthunt.com, dev.to"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDomain(); } }}
                className="flex-1"
              />
              <Button type="button" variant="outline" size="sm" onClick={addDomain} disabled={!domainInput.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {form.seed_domains.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {form.seed_domains.map((d) => (
                  <span key={d} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1 text-xs">
                    {d}
                    <button type="button" onClick={() => removeDomain(d)} className="ml-0.5 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Budget & Constraints */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> Budget & Constraints
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="budget" className="text-sm">Budget (USD)</Label>
              <Input
                id="budget"
                type="number"
                min={0}
                value={form.budget_total}
                onChange={(e) => setForm((f) => ({ ...f, budget_total: e.target.value }))}
                placeholder="e.g. 500"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="constraints" className="text-sm">Constraints & Guidelines</Label>
              <Textarea
                id="constraints"
                value={form.constraints_text}
                onChange={(e) => setForm((f) => ({ ...f, constraints_text: e.target.value }))}
                placeholder="e.g. Only English publications. No gambling or adult content. Max $50 per placement. Focus on DA 40+ sites."
                className="mt-1.5 min-h-[100px]"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Tell the AI what to avoid and your quality standards.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Agent Mode */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Bot className="h-4 w-4" /> Agent Mode
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm">Autonomy Level</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1.5">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, autonomy_mode: "autonomous" }))}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    form.autonomy_mode === "autonomous"
                      ? "border-foreground bg-muted"
                      : "border-border hover:border-foreground/40"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="h-4 w-4" />
                    <span className="text-sm font-medium">Fully Autonomous</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Agents run independently. Intervene only when needed.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, autonomy_mode: "supervised" }))}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    form.autonomy_mode === "supervised"
                      ? "border-foreground bg-muted"
                      : "border-border hover:border-foreground/40"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Shield className="h-4 w-4" />
                    <span className="text-sm font-medium">Supervised</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Requires approval before sending emails or making offers.
                  </p>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Label htmlFor="demo_mode" className="text-sm">Demo Mode</Label>
              <input
                type="checkbox"
                id="demo_mode"
                checked={form.demo_mode}
                onChange={(e) => setForm((f) => ({ ...f, demo_mode: e.target.checked }))}
                className="h-4 w-4"
              />
              <span className="text-xs text-muted-foreground">
                {form.demo_mode ? "Test with simulated publisher responses" : "Real outreach (requires email config)"}
              </span>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 px-4 py-2 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={loading || !form.name.trim()}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Bot className="h-4 w-4 mr-2" />
            )}
            Create Campaign
          </Button>
          <Link href="/campaigns/autonomous">
            <Button type="button" variant="ghost">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
