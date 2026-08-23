"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Runtime-editable AI provider config: paste a Gemini API key (and optionally a model id)
// without redeploying. Stored in app_settings; env vars remain the fallback.
export function AIProviderCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<{ provider: string; runtime_key_masked: string | null; runtime_model: string | null; default_model: string } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [modelInput, setModelInput] = useState("");

  async function load() {
    try {
      const r = await fetch("/api/settings/ai", { cache: "no-store" });
      if (r.ok) setInfo(await r.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function save(clearKey = false) {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (!clearKey && keyInput.trim()) body.gemini_api_key = keyInput.trim();
      if (clearKey) body.clear_key = true;
      if (modelInput.trim() || info?.runtime_model) body.gemini_model = modelInput.trim();
      const res = await fetch("/api/settings/ai", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success(clearKey ? "Runtime key cleared — falling back to environment." : "AI settings saved. Agents pick it up within ~30s.");
      setKeyInput("");
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> AI provider</CardTitle>
          {info && <Badge variant={info.provider === "gemini" ? "default" : "secondary"}>active: {info.provider}</Badge>}
        </div>
        <CardDescription>
          The agent workforce runs on Gemini. Paste your key here to rotate it without a redeploy;
          the .env key is used when no runtime key is set. Fallback chain: OpenRouter → Groq.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Gemini API key {info?.runtime_key_masked ? `(saved: ${info.runtime_key_masked})` : "(not saved)"}</label>
                <Input type="password" placeholder="AIza… or AQ…" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Model (blank = {info?.default_model ?? "default"})</label>
                <Input placeholder="gemini-flash-latest" value={modelInput} onChange={(e) => setModelInput(e.target.value)} className="w-56" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => save(false)} disabled={saving || !keyInput.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Save
              </Button>
              {info?.runtime_key_masked && (
                <Button size="sm" variant="outline" onClick={() => save(true)} disabled={saving}>Clear saved key</Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
