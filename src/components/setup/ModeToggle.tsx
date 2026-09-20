"use client";

interface Me { kind: "owner" | "guest" | "none"; can_send_real?: boolean; missing?: string[]; has_search?: boolean }

export function ModeToggle({ demo, onChange, realAllowed, me }: { demo: boolean; onChange: (demo: boolean) => void; realAllowed: boolean; me: Me | null }) {
  const reason = me?.kind === "guest" || me?.kind === "none" ? "Sign in with Google to run real campaigns on your own keys." : me?.kind === "owner" && !me.can_send_real ? `Add ${(me.missing ?? ["a Gmail app password"]).join(" and ")} in Settings first.` : null;
  return (
    <>
    <div className="card p-1.5 inline-flex gap-1" role="radiogroup" aria-label="Mode">
      <button type="button" role="radio" aria-checked={demo} onClick={() => onChange(true)} className={`rounded-lg px-4 h-10 text-sm font-medium transition-colors ${demo ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}>
        Demo <span className="opacity-70 font-normal hidden sm:inline">· simulated, 3 minutes</span>
      </button>
      <button type="button" role="radio" aria-checked={!demo} disabled={!realAllowed} title={reason ?? undefined} onClick={() => realAllowed && onChange(false)} className={`rounded-lg px-4 h-10 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${!demo ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}>
        Real <span className="opacity-70 font-normal hidden sm:inline">· sends actual email</span>
      </button>
    </div>
    {reason && <div className="text-xs text-ink-3 mt-2">{reason}</div>}
    </>
  );
}
