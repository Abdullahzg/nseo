"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, Sparkles, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface AIInfo {
  provider: string;
  gemini_key_masked: string | null;
  gemini_model: string | null;
  groq_key_masked: string | null;
  groq_model: string | null;
  default_gemini_model: string;
  default_groq_model: string;
}

export function AIProviderCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<AIInfo | null>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [groqModel, setGroqModel] = useState("");

  async function load() {
    try {
      const r = await fetch("/api/settings/ai", { cache: "no-store" });
      if (r.ok) setInfo(await r.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (geminiKey.trim()) body.gemini_api_key = geminiKey.trim();
      if (geminiModel.trim()) body.gemini_model = geminiModel.trim();
      if (groqKey.trim()) body.groq_api_key = groqKey.trim();
      if (groqModel.trim()) body.groq_model = groqModel.trim();
      if (Object.keys(body).length === 0) { toast.info("Nothing to save"); return; }
      const res = await fetch("/api/settings/ai", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast.success("AI settings saved. Agents pick it up within ~30s.");
      setGeminiKey(""); setGeminiModel(""); setGroqKey(""); setGroqModel("");
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function clearKey(provider: "gemini" | "groq") {
    setSaving(true);
    try {
      await fetch("/api/settings/ai", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [`clear_${provider}_key`]: true }),
      });
      toast.success(`${provider} key cleared — falling back to environment.`);
      load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> AI providers</CardTitle>
          {info && <Badge variant="default">active: {info.provider}</Badge>}
        </div>
        <CardDescription>
          Configure API keys for Gemini (primary) and Groq (fallback). No redeploy needed — agents pick up changes within ~30s.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            {/* Gemini */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-400" />
                <h3 className="text-sm font-medium">Gemini (primary)</h3>
                {info?.gemini_key_masked && <Badge variant="outline" className="text-xs">{info.gemini_key_masked}</Badge>}
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Input type="password" placeholder="AIza… or AQ…" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} />
                <Input placeholder={info?.default_gemini_model ?? "gemini-flash-latest"} value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} className="w-48" />
              </div>
              {info?.gemini_key_masked && (
                <Button size="sm" variant="outline" onClick={() => clearKey("gemini")} disabled={saving}>Clear Gemini key</Button>
              )}
            </div>

            <div className="border-t" />

            {/* Groq */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-orange-400" />
                <h3 className="text-sm font-medium">Groq (last fallback)</h3>
                {info?.groq_key_masked && <Badge variant="outline" className="text-xs">{info.groq_key_masked}</Badge>}
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr auto]">
                <Input type="password" placeholder="gsk_…" value={groqKey} onChange={(e) => setGroqKey(e.target.value)} />
                <Input placeholder={info?.default_groq_model ?? "openai/gpt-oss-20b"} value={groqModel} onChange={(e) => setGroqModel(e.target.value)} className="w-48" />
              </div>
              {info?.groq_key_masked && (
                <Button size="sm" variant="outline" onClick={() => clearKey("groq")} disabled={saving}>Clear Groq key</Button>
              )}
            </div>

            <Button size="sm" onClick={save} disabled={saving || (!geminiKey.trim() && !groqKey.trim() && !geminiModel.trim() && !groqModel.trim())}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Save settings
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
