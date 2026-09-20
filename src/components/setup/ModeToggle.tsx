"use client";

interface Me { kind: "owner" | "guest" | "none"; can_send_real?: boolean }

export function ModeToggle({ demo, onChange, realAllowed, me }: { demo: boolean; onChange: (demo: boolean) => void; realAllowed: boolean; me: Me | null }) {
  const reason = me?.kind === "guest" || me?.kind === "none" ? "Sign in as the owner to send real email." : me?.kind === "owner" && !me.can_send_real ? "Add a Gmail app password in Settings first." : null;
  return (
    <div className="card p-1.5 inline-flex gap-1" role="radiogroup" aria-label="Mode">
      <button type="button" role="radio" aria-checked={demo} onClick={() => onChange(true)} className={`rounded-lg px-4 h-10 text-sm font-medium transition-colors ${demo ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}>
        Demo <span className="opacity-70 font-normal">· simulated, 3 minutes</span>
      </button>
      <button type="button" role="radio" aria-checked={!demo} disabled={!realAllowed} title={reason ?? undefined} onClick={() => realAllowed && onChange(false)} className={`rounded-lg px-4 h-10 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${!demo ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"}`}>
        Real <span className="opacity-70 font-normal">· sends actual email</span>
      </button>
      {reason && <span className="self-center pl-2 pr-1 text-xs text-ink-3 hidden sm:inline">{reason}</span>}
    </div>
  );
}
