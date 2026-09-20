"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Routes that get the full viewport width instead of the 1280px reading measure.
 *
 * `max-w-7xl` is right for tables and forms: it keeps line lengths readable and the layout stable.
 * It is wrong for a two-pane writing surface, where capping the page at 1280px squeezes the markdown
 * and its live preview into two narrow columns and leaves the rest of a wide monitor empty, even with
 * the sidebar collapsed.
 *
 * Prefix match, so /blog/writer and /blog/clusters (also two-pane screens) are included.
 */
const FULL_WIDTH = ["/blog"];

export function PageContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const full = FULL_WIDTH.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  return (
    <div className={cn("h-full min-h-0", full ? "max-w-none" : "")}>
      {children}
    </div>
  );
}
