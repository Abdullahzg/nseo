"use client";

import { useEffect, useState } from "react";

// A pop-up or a link can point at one thing on a page — a thread, a card, a deal — with
// `?focus=<id>`. The element that owns that id (data-focus) opens, scrolls into view and glows
// for a moment. The same happens when a pop-up is clicked while already on the page: it
// dispatches `nseo:focus` with the id.

export function focusParam(): string | null {
  try { return new URLSearchParams(window.location.search).get("focus"); } catch { return null; }
}

/** True for a moment when this id is the one being pointed at; the caller opens and marks the element. */
export function useFocus(id: string | null | undefined): { focused: boolean; glow: boolean } {
  const [focused, setFocused] = useState(false);
  const [glow, setGlow] = useState(false);
  useEffect(() => {
    if (!id) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const hit = () => {
      setFocused(true); setGlow(true);
      // After the parent has rendered it open, bring it into view.
      scrollToFocus(id);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setGlow(false), 2600);
    };
    if (focusParam() === id) hit();
    const onEvent = (e: Event) => { if ((e as CustomEvent).detail === id) hit(); };
    window.addEventListener("nseo:focus", onEvent);
    return () => { window.removeEventListener("nseo:focus", onEvent); if (timer) clearTimeout(timer); };
  }, [id]);
  return { focused, glow };
}

/** Scroll the element that owns the id into view, retrying while its list is still loading. */
export function scrollToFocus(id: string, tries = 12) {
  const el = document.querySelector<HTMLElement>(`[data-focus="${CSS.escape(id)}"]`);
  if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
  if (tries > 0) setTimeout(() => scrollToFocus(id, tries - 1), 250);
}

/** Point at something from anywhere: navigates if needed, otherwise just fires the event. */
export function pointAt(href: string) {
  try {
    const u = new URL(href, window.location.origin);
    const samePage = u.pathname === window.location.pathname;
    const focus = u.searchParams.get("focus"), tab = u.searchParams.get("tab");
    if (samePage) {
      window.history.replaceState(null, "", u.pathname + u.search);
      if (tab) window.dispatchEvent(new CustomEvent("nseo:tab", { detail: tab }));
      if (focus) setTimeout(() => window.dispatchEvent(new CustomEvent("nseo:focus", { detail: focus })), tab ? 350 : 0);
      return true;
    }
  } catch { /* fall through to a normal navigation */ }
  return false;
}
