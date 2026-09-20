"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PlanPreview } from "./PlanPreview";
import { ModeToggle } from "./ModeToggle";

const DEMO_DEFAULTS = {
  website_url: "https://restoria.app",
  what_you_sell: "an AI photo restoration tool that repairs old and damaged photos",
  keywords: ["AI photo editor", "photo restoration", "restore old photos"],
  desired_deals: 3,
  budget_total: 800,
  max_per_deal: 250,
};

interface Me { kind: "owner" | "guest" | "none"; can_send_real?: boolean; missing?: string[]; has_search?: boolean }
interface Seed { url: string; email: string }

export function SetupForm() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [demo, setDemo] = useState(true);
  const [f, setF] = useState({ ...DEMO_DEFAULTS });
  const [kw, setKw] = useState("");
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [searchWeb, setSearchWeb] = useState(true);
  const [plan, setPlan] = useState<{ text: string; model: string; tokens: number; latency_ms: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetch("/api/me").then((r) => r.json()).then(setMe).catch(() => setMe({ kind: "none" })); }, []);

  // The demo is pre-filled, so the plan is generated on arrival: a visitor reads it and launches with
  // one click. Cached per browser session so reloads don't spend a model call.
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem("nseo.plan.default");
      if (cached) { setPlan(JSON.parse(cached)); return; }
    } catch { /* no storage */ }
    preview(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const body = { ...f, demo_mode: demo, seed_contacts: demo ? [] : seeds.filter((s) => s.url.trim()), search_web: demo ? true : searchWeb };
  const addKw = () => { const k = kw.trim(); if (k && !f.keywords.includes(k) && f.keywords.length < 5) setF({ ...f, keywords: [...f.keywords, k] }); setKw(""); };
  const set = (k: keyof typeof f, v: any) => { setF({ ...f, [k]: v }); setPlan(null); };

  async function preview(isDefault = false) {
    setError(null); setPreviewing(true);
    try {
      const r = await fetch("/api/campaigns?preview=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isDefault ? { ...DEMO_DEFAULTS, demo_mode: true } : body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not build the plan.");
      const p = { text: d.plan, model: d.model, tokens: d.tokens, latency_ms: d.latency_ms };
      setPlan(p);
      if (isDefault) { try { sessionStorage.setItem("nseo.plan.default", JSON.stringify(p)); } catch { /* ignore */ } }
    } catch (e: any) { setError(e.message); } finally { setPreviewing(false); }
  }

  async function launch() {
    setError(null); setLaunching(true);
    try {
      const r = await fetch("/api/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, plan: plan?.text ?? null }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not launch.");
      router.push(`/campaigns/${d.id}?fresh=1`);
    } catch (e: any) { setError(e.message); setLaunching(false); }
  }

  const realAllowed = me?.kind === "owner" && !!me.can_send_real;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); plan ? launch() : preview(); }}>
        <ModeToggle demo={demo} onChange={(v) => { setDemo(v); setPlan(null); }} realAllowed={realAllowed} me={me} />

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="label">Your website</span>
            <input className="field mt-1.5" value={f.website_url} onChange={(e) => set("website_url", e.target.value)} placeholder="https://yourproduct.com" required />
          </label>
          <label className="block sm:col-span-2">
            <span className="label">What you sell, in one line</span>
            <input className="field mt-1.5" value={f.what_you_sell} onChange={(e) => set("what_you_sell", e.target.value)} placeholder="an AI photo restoration tool that repairs old photos" required />
          </label>
          <div className="sm:col-span-2">
            <span className="label">3–5 keywords editors would write about</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {f.keywords.map((k) => (
                <button type="button" key={k} onClick={() => set("keywords", f.keywords.filter((x) => x !== k))} className="chip hover:bg-danger-soft hover:text-danger" title="Remove">{k} ×</button>
              ))}
              {f.keywords.length < 5 && (
                <input className="field !h-8 !w-56 !text-sm" value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addKw(); } }} onBlur={addKw} placeholder="add a keyword, press Enter" />
              )}
            </div>
          </div>
          <label className="block">
            <span className="label">How many placements</span>
            <input className="field mt-1.5" type="number" min={1} max={20} value={f.desired_deals} onChange={(e) => set("desired_deals", Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="label">Max total budget (USD)</span>
            <input className="field mt-1.5" type="number" min={50} step={10} value={f.budget_total} onChange={(e) => set("budget_total", Number(e.target.value))} />
          </label>
          <label className="block">
            <span className="label">Max per placement (USD)</span>
            <input className="field mt-1.5" type="number" min={10} step={10} value={f.max_per_deal} onChange={(e) => set("max_per_deal", Number(e.target.value))} />
          </label>
        </div>

        {!demo && (
          <div className="card p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="label">Publications you already know <span className="font-normal normal-case text-ink-3">(optional)</span></span>
              <button type="button" className="text-sm text-accent" onClick={() => { setSeeds([...seeds, { url: "", email: "" }]); setPlan(null); }}>+ Add one</button>
            </div>
            <p className="text-xs text-ink-3">A URL each, and the editor's address if you have it. These are evaluated like any other publication and contacted first — no search credit spent on them.</p>
            {seeds.map((s, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input className="field !h-9 !text-sm" value={s.url} onChange={(e) => { const n = [...seeds]; n[i] = { ...s, url: e.target.value }; setSeeds(n); setPlan(null); }} placeholder="https://publication.com/article" aria-label="Publication URL" />
                <input className="field !h-9 !text-sm" value={s.email} onChange={(e) => { const n = [...seeds]; n[i] = { ...s, email: e.target.value }; setSeeds(n); }} placeholder="editor@publication.com (optional)" aria-label="Editor email" />
                <button type="button" className="btn btn-ghost !h-9" onClick={() => { setSeeds(seeds.filter((_, j) => j !== i)); setPlan(null); }} aria-label="Remove">×</button>
              </div>
            ))}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={searchWeb && !!me?.has_search} onChange={(e) => { setSearchWeb(e.target.checked); setPlan(null); }} disabled={!me?.has_search} />
              <span>Also search the web for more publications{!me?.has_search && <span className="text-ink-3"> — needs a Tavily key in Settings</span>}{me?.has_search && !searchWeb && <span className="text-ink-3"> — off: only the publications listed above will be contacted</span>}</span>
            </label>
          </div>
        )}

        {error && <div className="card border-danger-soft bg-danger-soft/40 p-4 text-sm"><span className="font-semibold text-danger">Could not continue.</span> {error}</div>}

        <div className="flex flex-wrap items-center gap-3">
          {!plan ? (
            <button type="submit" className="btn" disabled={previewing || f.keywords.length < 3}>{previewing ? "Asking the agent for its plan…" : "See the plan"}</button>
          ) : (
            <>
              <button type="submit" className="btn" disabled={launching}>{launching ? "Launching…" : demo ? "Launch demo" : "Launch — sends real email"}</button>
              <button type="button" className="btn btn-ghost" onClick={() => preview()} disabled={previewing}>{previewing ? "Re-planning…" : "Re-plan"}</button>
            </>
          )}
          <span className="text-xs text-ink-3">{demo ? "About 3 minutes, simulated publishers, real decisions." : "Runs over days. You will only be pulled back when it needs you."}</span>
        </div>
      </form>

      <aside className="order-first lg:order-none lg:sticky lg:top-20 self-start">
        <PlanPreview plan={plan} previewing={previewing} demo={demo} />
      </aside>
    </div>
  );
}
