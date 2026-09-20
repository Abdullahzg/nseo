"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useLoading } from "./LoadingProvider";

/**
 * Global loading indicator: top progress bar + status text.
 * Shows on route changes AND during fetch requests.
 */
export function GlobalLoader() {
  const pathname = usePathname();
  const { state, setNavigating } = useLoading();
  const [routeVisible, setRouteVisible] = useState(false);
  const first = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Route change indicator
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    timers.current.forEach(clearTimeout);
    setNavigating(true);
    setRouteVisible(true);
    timers.current = [
      setTimeout(() => setNavigating(false), 800),
      setTimeout(() => setRouteVisible(false), 1200),
    ];
    return () => timers.current.forEach(clearTimeout);
  }, [pathname, setNavigating]);

  const showBar = routeVisible || state.fetchCount > 0;
  const showText = state.statusText || state.navigating || state.fetchCount > 0;
  const text = state.statusText
    ?? (state.navigating ? "Navigating…" : null)
    ?? (state.fetchCount > 0 ? `Loading data…${state.fetchCount > 1 ? ` (${state.fetchCount} requests)` : ""}` : null);

  return (
    <div aria-hidden className="fixed top-0 left-0 right-0 z-[60]">
      {/* Progress bar */}
      <div className={`h-0.5 transition-opacity duration-300 ${showBar ? "opacity-100" : "opacity-0"}`}>
        <div className={`h-full bg-primary ${showBar ? "animate-[route-bar_1.5s_ease-out_infinite]" : ""}`} />
      </div>

      {/* Status pill */}
      {showText && text && (
        <div className="fixed top-2 right-4 z-[61]">
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 shadow-lg">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground tabular-nums">{text}</span>
          </div>
        </div>
      )}

      <style>{`@keyframes route-bar{0%{width:0%}20%{width:30%}50%{width:65%}80%{width:85%}100%{width:100%}}`}</style>
    </div>
  );
}
