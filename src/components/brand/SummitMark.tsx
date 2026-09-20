/**
 * Geseo brand mark — a styled "G" in a rounded square.
 *
 * Matches the favicon at public/icon.svg. Uses CSS variables for
 * light/dark theming. Works at 16px (tab) through 32px (sidebar).
 */
export function SummitMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Geseo">
      <rect x="4" y="4" width="56" height="56" rx="14" fill="var(--foreground)" opacity="0.08" />
      <text
        x="32"
        y="44"
        textAnchor="middle"
        fontFamily="Poppins, Inter, system-ui, sans-serif"
        fontSize="32"
        fontWeight="700"
        letterSpacing="-1"
        fill="var(--foreground)"
      >
        G
      </text>
    </svg>
  );
}
