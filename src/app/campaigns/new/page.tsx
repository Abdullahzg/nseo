"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Bot, Shield, Zap, Target, Globe, DollarSign, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";

export default function NewCampaignPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    website_url: "",
    constraints_text: "",
    budget_total: "",
    autonomy_mode: "autonomous" as "autonomous" | "supervised",
    demo_mode: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Campaign name is required");
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
          website_url: form.website_url || null,
          constraints_text: form.constraints_text || null,
          budget_total: form.budget_total ? Number(form.budget_total) : null,
          autonomy_mode: form.autonomy_mode,
          demo_mode: form.demo_mode,
          keywords: [],
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create campaign");
      }
      const campaign = await res.json();
      router.push(`/campaigns/${campaign.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

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
            Create an autonomous outreach campaign. The AI agents handle the rest.
          </p>
        </div>
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
                placeholder="e.g. Tech Blog Outreach Q1"
                className="mt-1.5"
                autoFocus
              />
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
            </div>
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
                placeholder="e.g. Only English publications. No gambling or adult content. Max $100 per placement. Focus on tech/SaaS verticals."
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
              <div className="grid grid-cols-2 gap-3 mt-1.5">
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
