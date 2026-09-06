"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// New agentic campaign: objective + budget + constraints, then one meaningful action.
export default function NewCampaignPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({
    name: "",
    website_url: "",
    objective: "",
    keywords: "",
    budget_total: 2000,
    currency: "USD",
    desired_deals: 5,
    min_dr: 50,
    geos: "US, UK",
    max_per_deal: 300,
    excluded_domains: "",
    constraints_text: "",
    demo_mode: false,
    email_template_id: "",
  });

  useEffect(() => {
    fetch("/api/email-templates").then((r) => r.json()).then((d) => setTemplates(d ?? [])).catch(() => {});
  }, []);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function create() {
    if (!form.name.trim()) { toast.error("Give the campaign a name."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          keywords: form.keywords.split(",").map((s) => s.trim()).filter(Boolean),
          website_url: form.website_url || null,
          objective: form.objective || null,
          budget_total: Number(form.budget_total) || 0,
          currency: form.currency,
          desired_deals: Number(form.desired_deals) || null,
          min_dr: Number(form.min_dr) || null,
          geos: form.geos.split(",").map((s) => s.trim()).filter(Boolean),
          max_per_deal: Number(form.max_per_deal) || null,
          excluded_domains: form.excluded_domains.split(",").map((s) => s.trim()).filter(Boolean),
          constraints_text: form.constraints_text || null,
          demo_mode: form.demo_mode,
          email_template_id: form.email_template_id || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Failed to create campaign");
      toast.success("Campaign created. Press Start to launch the agents.");
      router.push(`/campaigns/${d.id}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New autonomous campaign</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Give the agents an objective, constraints and a budget. They research prospects, resolve contacts,
          run outreach, negotiate within your ceilings, and escalate only when a human is genuinely required.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Objective</CardTitle>
          <CardDescription>What should the workforce achieve?</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Campaign name</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Q3 backlinks for my product" />
            </div>
            <div className="space-y-1.5">
              <Label>Your website</Label>
              <Input value={form.website_url} onChange={(e) => set("website_url", e.target.value)} placeholder="https://example.com" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Goal</Label>
            <Textarea rows={2} value={form.objective} onChange={(e) => set("objective", e.target.value)}
              placeholder="Acquire high-quality backlinks and relevant editorial mentions." />
          </div>
          <div className="space-y-1.5">
            <Label>Keywords / topics</Label>
            <Input value={form.keywords} onChange={(e) => set("keywords", e.target.value)}
              placeholder="AI photo editor, photo restoration, AI image restoration" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Budget &amp; quality bar</CardTitle>
          <CardDescription>Deterministic policy the agents cannot override.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Total budget ({form.currency})</Label>
            <Input type="number" min={0} value={form.budget_total} onChange={(e) => set("budget_total", Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Input value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1.5">
            <Label>Desired placements</Label>
            <Input type="number" min={1} value={form.desired_deals} onChange={(e) => set("desired_deals", Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Min DR</Label>
            <Input type="number" min={0} max={100} value={form.min_dr} onChange={(e) => set("min_dr", Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Max per deal ({form.currency})</Label>
            <Input type="number" min={0} value={form.max_per_deal} onChange={(e) => set("max_per_deal", Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Target geographies</Label>
            <Input value={form.geos} onChange={(e) => set("geos", e.target.value)} placeholder="US, UK" />
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label>Excluded domains (comma-separated)</Label>
            <Input value={form.excluded_domains} onChange={(e) => set("excluded_domains", e.target.value)} placeholder="linkfarm.example, spammy.site" />
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label>Additional constraints</Label>
            <Textarea rows={2} value={form.constraints_text} onChange={(e) => set("constraints_text", e.target.value)}
              placeholder="Relevant editorial websites only. Avoid obvious link farms. Escalate unusual contractual or payment requests." />
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label>Email template (optional)</Label>
            <Select value={form.email_template_id} onValueChange={(v) => set("email_template_id", v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Default template" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Default template</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="sm:col-span-3 flex items-center gap-3 rounded-lg border border-dashed p-3 cursor-pointer">
            <Switch checked={form.demo_mode} onCheckedChange={(v) => set("demo_mode", v)} />
            <span className="text-sm">
              <span className="font-medium">Demo mode</span>{" "}
              <span className="text-muted-foreground">— simulated publishers through the real pipeline; nothing is sent externally.</span>
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={create} disabled={saving} size="lg">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Create campaign
        </Button>
      </div>
    </div>
  );
}
