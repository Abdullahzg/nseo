"use client";

import { useEffect, useState } from "react";

interface Cfg {
  user_email: string; from_name?: string; timezone: string;
  hasPassword: boolean; hasNebiusKey: boolean; hasTavilyKey: boolean; nebiusKeyHint?: string; tavilyKeyHint?: string;
  platform_nebius: boolean; platform_tavily: boolean;
}
type Busy = "save" | "gmail" | "nebius" | "tavily" | null;

export default function SettingsPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [fromName, setFromName] = useState("");
  const [pass, setPass] = useState("");
  const [nebius, setNebius] = useState("");
  const [tavily, setTavily] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  useEffect(() => { fetch("/api/settings").then(async (r) => { if (r.status === 403) { setForbidden(true); return; } const d = await r.json(); setCfg(d); setFromName(d.from_name ?? ""); }); }, []);

  async function post(query: string, body: Record<string, unknown>) {
    const r = await fetch(`/api/settings${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { r, d: await r.json().catch(() => ({})) };
  }
  async function save(extra: Record<string, unknown> = {}) {
    setBusy("save"); setMsg(null);
    const body: Record<string, unknown> = { from_name: fromName, ...extra };
    if (pass) body.app_password = pass;
    if (nebius) body.nebius_api_key = nebius;
    if (tavily) body.tavily_api_key = tavily;
    const { r, d } = await post("", body); setBusy(null);
    if (r.ok) { setCfg(d); setPass(""); setNebius(""); setTavily(""); setMsg({ ok: true, text: "Saved. Secrets are encrypted at rest and never shown again." }); } else setMsg({ ok: false, text: d.error ?? "Could not save." });
  }
  async function test(which: "gmail" | "nebius" | "tavily") {
    setBusy(which); setMsg(null);
    const { r, d } = await post(`?test=${which}`, {}); setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: d.error ?? "Failed." });
    if (which === "gmail") setMsg({ ok: true, text: "Gmail accepted the login. Real mode is available on Setup." });
    if (which === "nebius") setMsg({ ok: true, text: `Token Factory answered: ${d.models} models on this key, all four routed Nemotron models present.` });
    if (which === "tavily") setMsg({ ok: true, text: `Tavily answered${d.limit ? ` — ${d.usage ?? "?"} of ${d.limit} credits used this cycle` : ""}.` });
  }

  if (forbidden) return <div className="card p-6 max-w-xl"><div className="label mb-2">Owner only</div><p>Settings hold your own keys and sending identity for real campaigns. Guests run demos, which need none of this.</p></div>;
  if (!cfg) return <div className="space-y-3" aria-busy="true"><div className="skeleton h-8 w-1/3" /><div className="skeleton h-40" /></div>;
  const nebiusReady = cfg.hasNebiusKey || cfg.platform_nebius;
  const tavilyReady = cfg.hasTavilyKey || cfg.platform_tavily;
  return (
    <div className="max-w-xl">
      <h1 className="serif text-3xl font-semibold tracking-tight">Settings</h1>
      <p className="text-ink-2 mt-2">Geseo runs on your own accounts: your Nebius key pays for the models, your Gmail sends the email, your Tavily key finds publications. Nothing here is shared with other users.</p>

      <div className="card p-5 mt-6 space-y-4">
        <div className="flex items-center justify-between"><div className="label">Nebius Token Factory</div><span className={`chip ${nebiusReady ? "chip-accent" : ""}`}>{cfg.hasNebiusKey ? `your key ${cfg.nebiusKeyHint ?? ""}` : cfg.platform_nebius ? "platform key" : "missing"}</span></div>
        <label className="block"><span className="label">API key</span>
          <input className="field mt-1.5" type="password" value={nebius} onChange={(e) => setNebius(e.target.value)} placeholder={cfg.hasNebiusKey ? "•••••••• (leave blank to keep)" : "v1.…"} autoComplete="off" />
          <span className="text-xs text-ink-3">tokenfactory.nebius.com → API keys. Every model decision in your campaigns is billed to this key.</span>
        </label>
        <div className="flex gap-2"><button className="btn btn-ghost" onClick={() => test("nebius")} disabled={!!busy || !nebiusReady}>{busy === "nebius" ? "Testing…" : "Test key"}</button>{cfg.hasNebiusKey && <button className="btn btn-ghost" onClick={() => save({ nebius_api_key: "" })} disabled={!!busy}>Remove</button>}</div>
      </div>

      <div className="card p-5 mt-4 space-y-4">
        <div className="flex items-center justify-between"><div className="label">Gmail (real campaigns send from here)</div><span className={`chip ${cfg.hasPassword ? "chip-accent" : ""}`}>{cfg.hasPassword ? "saved" : "missing"}</span></div>
        <div><div className="label">Sending from</div><div className="mono mt-1">{cfg.user_email}</div></div>
        <label className="block"><span className="label">Your name (signs the emails)</span><input className="field mt-1.5" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Jane Doe" /></label>
        <label className="block"><span className="label">Gmail app password</span>
          <input className="field mt-1.5" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={cfg.hasPassword ? "•••• •••• •••• •••• (leave blank to keep)" : "xxxx xxxx xxxx xxxx"} autoComplete="off" />
          <span className="text-xs text-ink-3">Google Account → Security → 2-Step Verification → App passwords. Replies land in your inbox; the agent reads them over IMAP.</span>
        </label>
        <div className="flex gap-2"><button className="btn btn-ghost" onClick={() => test("gmail")} disabled={!!busy || !cfg.hasPassword}>{busy === "gmail" ? "Testing…" : "Test login"}</button></div>
      </div>

      <div className="card p-5 mt-4 space-y-4">
        <div className="flex items-center justify-between"><div className="label">Tavily (web search, real mode)</div><span className={`chip ${tavilyReady ? "chip-accent" : ""}`}>{cfg.hasTavilyKey ? `your key ${cfg.tavilyKeyHint ?? ""}` : cfg.platform_tavily ? "platform key" : "optional"}</span></div>
        <label className="block"><span className="label">API key</span>
          <input className="field mt-1.5" type="password" value={tavily} onChange={(e) => setTavily(e.target.value)} placeholder={cfg.hasTavilyKey ? "•••••••• (leave blank to keep)" : "tvly-…"} autoComplete="off" />
          <span className="text-xs text-ink-3">app.tavily.com → API keys (1,000 free searches a month). Without it, real campaigns can still run on publications you list at Setup.</span>
        </label>
        <div className="flex gap-2"><button className="btn btn-ghost" onClick={() => test("tavily")} disabled={!!busy || !tavilyReady}>{busy === "tavily" ? "Testing…" : "Test key"}</button>{cfg.hasTavilyKey && <button className="btn btn-ghost" onClick={() => save({ tavily_api_key: "" })} disabled={!!busy}>Remove</button>}</div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button className="btn" onClick={() => save()} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save"}</button>
        {msg && <div className={`text-sm ${msg.ok ? "text-accent" : "text-danger"}`}>{msg.text}</div>}
      </div>
    </div>
  );
}
