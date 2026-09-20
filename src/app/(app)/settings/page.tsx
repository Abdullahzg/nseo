"use client";

import { useEffect, useState } from "react";

interface Cfg { user_email: string; from_name?: string; timezone: string; hasPassword: boolean }

export default function SettingsPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [fromName, setFromName] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { fetch("/api/settings").then(async (r) => { if (r.status === 403) { setForbidden(true); return; } const d = await r.json(); setCfg(d); setFromName(d.from_name ?? ""); }); }, []);

  async function save() {
    setBusy("save"); setMsg(null);
    const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from_name: fromName, app_password: pass || undefined }) });
    const d = await r.json(); setBusy(null);
    if (r.ok) { setCfg(d); setPass(""); setMsg({ ok: true, text: "Saved. The app password is encrypted at rest." }); } else setMsg({ ok: false, text: d.error ?? "Could not save." });
  }
  async function test() {
    setBusy("test"); setMsg(null);
    const r = await fetch("/api/settings?test=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const d = await r.json(); setBusy(null);
    setMsg(r.ok ? { ok: true, text: "Gmail accepted the login. Real mode is available on Setup." } : { ok: false, text: d.error ?? "Login failed." });
  }

  if (forbidden) return <div className="card p-6 max-w-xl"><div className="label mb-2">Owner only</div><p>Settings hold the sending identity for real campaigns. Guests run demos, which need none of this.</p></div>;
  if (!cfg) return <div className="space-y-3" aria-busy="true"><div className="skeleton h-8 w-1/3" /><div className="skeleton h-40" /></div>;
  return (
    <div className="max-w-xl">
      <h1 className="serif text-3xl font-semibold tracking-tight">Settings</h1>
      <p className="text-ink-2 mt-2">Real campaigns send from your own Gmail, so replies land in your inbox and the agent can read them.</p>
      <div className="card p-5 mt-6 space-y-4">
        <div><div className="label">Sending from</div><div className="mono mt-1">{cfg.user_email}</div></div>
        <label className="block"><span className="label">Your name (signs the emails)</span><input className="field mt-1.5" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Jane Doe" /></label>
        <label className="block"><span className="label">Gmail app password {cfg.hasPassword && <span className="chip chip-accent ml-2">saved</span>}</span>
          <input className="field mt-1.5" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={cfg.hasPassword ? "•••• •••• •••• •••• (leave blank to keep)" : "xxxx xxxx xxxx xxxx"} autoComplete="off" />
          <span className="text-xs text-ink-3">Google Account → Security → 2-Step Verification → App passwords. Encrypted with AUTH_SECRET; never shown again.</span>
        </label>
        {msg && <div className={`text-sm ${msg.ok ? "text-accent" : "text-danger"}`}>{msg.text}</div>}
        <div className="flex gap-2"><button className="btn" onClick={save} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save"}</button><button className="btn btn-ghost" onClick={test} disabled={!!busy || !cfg.hasPassword}>{busy === "test" ? "Testing…" : "Test login"}</button></div>
      </div>
    </div>
  );
}
