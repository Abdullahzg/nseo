"use client";

import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, X, RefreshCw } from "lucide-react";

interface KeyHealth {
  service: string;
  label: string;
  configured: boolean;
  ok: boolean;
  message: string;
}

interface Warning { label: string; message: string }

// Polls key health and shows a banner when any configured API key is failing (red) or when
// something needs attention soon, e.g. Tavily search quota nearly/fully used (amber).
// Dismissible per-session.
export function KeyHealthBanner() {
  const [broken, setBroken] = useState<KeyHealth[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  const load = useCallback(async (force = false) => {
    try {
      const data = await fetch(`/api/health/keys${force ? "?force=1" : ""}`).then((r) => r.json());
      setBroken(data.broken ?? []);
      setWarnings(data.warnings ?? []);
      if ((data.broken ?? []).length > 0 || (data.warnings ?? []).length > 0) setDismissed(false);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 60_000); // poll every minute
    return () => clearInterval(t);
  }, [load]);

  async function recheck() {
    setRechecking(true);
    await load(true);
    setRechecking(false);
  }

  if (dismissed || (broken.length === 0 && warnings.length === 0)) return null;

  // Red for hard failures, otherwise amber for warnings (e.g. Tavily near quota).
  const isError = broken.length > 0;
  const tone = isError
    ? { bg: "bg-destructive/10 border-destructive/30", icon: "text-destructive", title: "text-destructive", body: "text-destructive/90", btn: "text-destructive hover:text-destructive", btn2: "text-destructive/70 hover:text-destructive" }
    : { bg: "bg-warning/10 border-warning/30", icon: "text-warning", title: "text-warning", body: "text-warning/90", btn: "text-warning hover:text-warning", btn2: "text-warning/70 hover:text-warning" };

  const title = isError
    ? (broken.length === 1 ? "An API key isn't working" : `${broken.length} API keys aren't working`)
    : "Heads up";
  const detail = isError
    ? broken.map((b) => `${b.label} — ${b.message}`).join(" · ")
    : warnings.map((w) => `${w.label} — ${w.message}`).join(" · ");

  // A rounded pane in the content gutter, not a full-bleed bar. It used to be `border-b` edge-to-edge
  // with its own `max-w-7xl` centring inside, which after the shell became a floating-pane layout read
  // as a square-cornered slab cutting across the page — the only hard edge left in the UI, sitting
  // right under a 28px-rounded header.
  return (
    <div className={`${tone.bg} mb-4 shrink-0 rounded-2xl border px-4 py-3`}>
      <div className="flex items-center gap-3 text-sm">
        <AlertTriangle className={`h-4 w-4 ${tone.icon} shrink-0`} />
        <div className="min-w-0 flex-1">
          <span className={`font-medium ${tone.title}`}>{title}:</span>{" "}
          <span className={tone.body}>{detail}</span>
        </div>
        <button onClick={recheck} disabled={rechecking} className={`shrink-0 ${tone.btn} flex items-center gap-1.5 text-xs`}>
          <RefreshCw className={`h-3.5 w-3.5 ${rechecking ? "animate-spin" : ""}`} />
          Recheck
        </button>
        <button onClick={() => setDismissed(true)} className={`shrink-0 ${tone.btn2}`} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
