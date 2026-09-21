"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "@/components/ui/motion";

// The first time someone opens a campaign, three coach marks: the live line, the agents, the tabs.
// Each highlights the real element (found by data-tour) and steps on. Dismissed once per browser.

const KEY = "nseo.tour.v1";
const STEPS: { target: string; title: string; body: string }[] = [
  { target: "status", title: "This is the campaign, live", body: "The headline is the truth right now, written by code. The line under it follows whichever agent is working, as it works. The numbers roll as they change." },
  { target: "agents", title: "Eight agents, one working at a time", body: "The one pulsing green is working; the last one lit is where it left off. Click any card for everything it did — every page, every person, every reason." },
  { target: "tabs", title: "Everything it looked at, said and decided", body: "Publications lists every page and why it passed or failed. Conversations shows each thread and who is waiting on whom. Tools shows what each tool did. Story & replay tells it back to you." },
];

export function Tour() {
  const [step, setStep] = useState(-1);
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number; page: number; vw: number } | null>(null);

  useEffect(() => {
    try { if (localStorage.getItem(KEY)) return; } catch { return; }
    const t = setTimeout(() => setStep(0), 1200);
    return () => clearTimeout(t);
  }, []);

  useLayoutEffect(() => {
    if (step < 0 || step >= STEPS.length) { setBox(null); return; }
    const el = document.querySelector<HTMLElement>(`[data-tour="${STEPS[step].target}"]`);
    if (!el) { setBox(null); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const measure = () => { const r = el.getBoundingClientRect(); setBox({ top: r.top + window.scrollY - 8, left: r.left + window.scrollX - 8, width: r.width + 16, height: r.height + 16, page: document.documentElement.scrollHeight, vw: window.innerWidth }); };
    const t = setTimeout(measure, 350); measure();
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, { passive: true });
    return () => { clearTimeout(t); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure); };
  }, [step]);

  const done = () => { try { localStorage.setItem(KEY, new Date().toISOString()); } catch { /* ignore */ } setStep(-1); };
  const open = step >= 0 && step < STEPS.length && !!box;
  const s = STEPS[Math.max(0, step)];
  const cardTop = box ? box.top + box.height + 12 : 0;
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && box && (
        <motion.div key="tour" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="z-40 pointer-events-none" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: box.page }} aria-live="polite">
          <motion.div layout transition={{ type: "spring", stiffness: 260, damping: 28 }} className="absolute rounded-xl ring-4 ring-[#76b900] shadow-[0_0_0_9999px_rgba(20,18,14,0.35)]" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />
          <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15 }} className="absolute pointer-events-auto card p-4 w-[min(360px,calc(100vw-32px))] shadow-lg" style={{ top: cardTop, left: Math.max(16, Math.min(box.left, box.vw - 376)) }} role="dialog" aria-label={s.title}>
            <div className="label mb-1 text-[#4f7d00]">{step + 1} of {STEPS.length}</div>
            <div className="font-semibold mb-1">{s.title}</div>
            <p className="text-sm text-ink-2 leading-snug">{s.body}</p>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" className="btn btn-sm" onClick={() => (step + 1 < STEPS.length ? setStep(step + 1) : done())}>{step + 1 < STEPS.length ? "Next" : "Got it"}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={done}>Skip</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
