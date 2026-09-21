"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Todo } from "@/lib/campaign/todos";

// What you, the human, need to do now — derived from what the agents concluded. A deal means a blurb
// to send and, once live, a payment; a call you agreed to means a calendar invite; an agreement means
// a signature. Tick things off; the list is rebuilt from the campaigns every time.

const WHEN_ORDER: Todo["when"][] = ["now", "this_week", "on_reply", "when_live"];
const WHEN_TITLE: Record<Todo["when"], string> = { now: "Now", this_week: "This week", on_reply: "When they reply", when_live: "Once the placement is live" };

export default function NextStepsPage() {
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const load = useCallback(async () => { const r = await fetch("/api/todos", { cache: "no-store" }); if (r.ok) setTodos((await r.json()).todos ?? []); }, []);
  useEffect(() => { load(); const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 20_000); return () => clearInterval(t); }, [load]);

  async function tick(t: Todo, done: boolean) {
    setTodos((prev) => (prev ?? []).map((x) => (x.key === t.key && x.campaign_id === t.campaign_id ? { ...x, done_at: done ? new Date().toISOString() : null } : x)));
    await fetch("/api/todos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaign_id: t.campaign_id, key: t.key, done }) });
  }

  if (!todos) return <div className="space-y-3" aria-busy="true"><div className="skeleton h-8 w-1/3" /><div className="skeleton h-24" /><div className="skeleton h-24" /></div>;
  const open = todos.filter((t) => !t.done_at), done = todos.filter((t) => t.done_at);
  return (
    <div className="max-w-3xl">
      <h1 className="serif text-3xl font-semibold tracking-tight">Next steps</h1>
      <p className="text-ink-2 mt-2">What the campaigns concluded that only you can do: send a blurb, pay for a live placement, put a call on your calendar, sign an agreement. Every item comes from a deal or a card you answered, never from a model.</p>
      {open.length === 0 && <div className="card p-8 text-center mt-6"><div className="serif text-2xl">Nothing to do.</div><div className="text-ink-2 mt-1">Items appear here the moment a deal is agreed or you answer a card that leads to a real-world step.</div></div>}
      {WHEN_ORDER.map((w) => {
        const list = open.filter((t) => t.when === w);
        if (!list.length) return null;
        return (
          <section key={w} className="mt-8">
            <h2 className="label mb-3">{WHEN_TITLE[w]} <span className="font-normal normal-case text-ink-3">({list.length})</span></h2>
            <ul className="card divide-y divide-rule">
              {list.map((t) => (
                <li key={`${t.campaign_id}:${t.key}`} className="p-4 flex items-start gap-3">
                  <input type="checkbox" className="mt-1.5" checked={false} onChange={() => tick(t, true)} aria-label={`Done: ${t.what}`} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{t.what}</div>
                    <div className="text-sm text-ink-2 mt-0.5">{t.why}</div>
                    <div className="text-xs text-ink-3 mt-1.5 flex flex-wrap gap-x-3 gap-y-1"><span>{t.who}</span><span>·</span><span>{t.campaign_name}</span><span>·</span><Link href={t.href} className="text-model underline">open</Link></div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {done.length > 0 && (
        <section className="mt-8">
          <h2 className="label mb-3">Done <span className="font-normal normal-case text-ink-3">({done.length})</span></h2>
          <ul className="card divide-y divide-rule opacity-70">
            {done.map((t) => (
              <li key={`${t.campaign_id}:${t.key}`} className="p-4 flex items-start gap-3">
                <input type="checkbox" className="mt-1.5" checked onChange={() => tick(t, false)} aria-label={`Undo: ${t.what}`} />
                <div className="min-w-0 flex-1"><div className="font-medium line-through">{t.what}</div><div className="text-xs text-ink-3 mt-1">{t.who} · {t.campaign_name}</div></div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
