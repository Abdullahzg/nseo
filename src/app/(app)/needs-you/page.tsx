"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { InterventionCard, type Intervention } from "@/components/needs-you/InterventionCard";

export default function NeedsYouPage() {
  const [items, setItems] = useState<Intervention[] | null>(null);
  const [inProgress, setInProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/interventions?status=open", { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Could not load.");
      const d = await r.json();
      setItems(d.interventions); setInProgress(d.campaigns_in_progress ?? 0); setError(null);
    } catch (e: any) { setError(e.message); setItems([]); }
  }, []);

  useEffect(() => { load(); const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30_000); return () => clearInterval(t); }, [load]);

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="serif text-3xl font-semibold tracking-tight">Needs you</h1>
        <p className="text-ink-2 mt-2">The agent parks a conversation here only when it hits something it cannot decide by email: a call, a contract, a price above your limit, a fact about your business. Answer in a line and it resumes the same thread.</p>
      </div>
      {error && <div className="card border-danger-soft bg-danger-soft/40 p-4 text-sm mb-4"><b className="text-danger">Could not load.</b> {error}</div>}
      {items === null && <div className="space-y-3" aria-busy="true"><div className="skeleton h-40" /><div className="skeleton h-40" /></div>}
      {items && items.length === 0 && (
        <div className="card p-8 text-center">
          <div className="serif text-2xl">Nothing needs you.</div>
          <p className="text-ink-2 mt-2">{inProgress > 0 ? `${inProgress} ${inProgress === 1 ? "campaign is" : "campaigns are"} in progress. You will see a card here the moment one of them needs a decision.` : "No campaign is running."}</p>
          {inProgress === 0 && <Link href="/setup" className="btn mt-5">Start a campaign</Link>}
        </div>
      )}
      {items && items.length > 0 && <div className="space-y-4">{items.map((iv) => <InterventionCard key={iv.id} iv={iv} onDone={(id) => setItems((prev) => (prev ?? []).filter((x) => x.id !== id))} />)}</div>}
    </div>
  );
}
