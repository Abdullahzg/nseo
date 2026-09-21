"use client";

// Motion primitives used across the screens (Motion, formerly Framer Motion). Kept small and
// consistent: one easing, one duration scale, reduced-motion respected by the library.
import { motion, AnimatePresence, useMotionValue, useTransform, animate, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

export const ease = [0.22, 1, 0.36, 1] as const;

/** Fades and lifts a block into place. */
export function Rise({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  return <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease, delay }} className={className}>{children}</motion.div>;
}

/** Children enter one after another. */
export function Stagger({ children, className = "", step = 0.05 }: { children: ReactNode; className?: string; step?: number }) {
  return <motion.div className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: step } } }}>{children}</motion.div>;
}
export const item = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.3, ease } } };
export const Item = motion.div;

/** A number that rolls to its new value instead of jumping. */
export function CountUp({ value, format = (n: number) => String(Math.round(n)), className = "" }: { value: number; format?: (n: number) => string; className?: string }) {
  const mv = useMotionValue(value);
  const [text, setText] = useState(format(value));
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) { mv.set(value); setText(format(value)); return; }
    const controls = animate(mv, value, { duration: 0.7, ease });
    const unsub = mv.on("change", (v) => setText(format(v)));
    return () => { controls.stop(); unsub(); };
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span className={className}>{text}</span>;
}

/** Height-animated expand/collapse for rows that open. */
export function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div key="content" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease }} style={{ overflow: "hidden" }}>
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Crossfade between tab panels. */
export function Panel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22, ease }}>{children}</motion.div>
    </AnimatePresence>
  );
}

export { motion, AnimatePresence, useTransform };
