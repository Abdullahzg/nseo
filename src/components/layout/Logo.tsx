// The mark: an N whose diagonal is NVIDIA green. Original artwork; not the NVIDIA logo.
export function Logo({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="14" fill="#1d1a16" />
      <path d="M19 46 V18" stroke="#f7f3ec" strokeWidth="7" strokeLinecap="round" />
      <path d="M45 18 V46" stroke="#f7f3ec" strokeWidth="7" strokeLinecap="round" />
      <path d="M19 18 L45 46" stroke="#76b900" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}

/** Wordmark: the mark + "Nseo" with the N in the same green. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Logo />
      <span className="serif font-semibold tracking-tight"><span style={{ color: "#76b900" }}>N</span>seo</span>
    </span>
  );
}
