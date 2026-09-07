"use client";

import { useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  Settings,
  Rocket,
  ChevronLeft,
  ChevronRight,
  Menu,
  Loader2,
  Bell,
  ScanSearch,
  Bot,
  LayoutTemplate,
  Image as ImageIcon,
  Link2,
  Newspaper,
  Mic2,
  PenLine,
  Layers,
  BookOpen,
  Activity,
  Inbox,
  Cpu,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SummitMark } from "@/components/brand/SummitMark";

/**
 * Grouped by the job you came here to do, not by when the feature was built.
 *
 * Outreach used to be nine flat items — Prospects, Campaigns, Workflows, Email Finder, Emails,
 * Sending, Inbox, Negotiation, Payments — because the funnel used to BE nine separate pages.
 *
 * It is three now, and three rather than one on purpose. Collapsing everything into a single page
 * traded sprawl for a different problem: running a campaign, watching it, and answering a person are
 * three different jobs with three different rhythms, and a page that does all three does none of them
 * well. So the split is by JOB, not by feature:
 *
 *   Backlink Outreach — start a campaign and drive one target page's pipeline
 *   Status            — vigilance: everything queued, sent, replied and won, with manual overrides
 *   Inbox             — read and answer an actual human
 *
 * The other six pages still exist and still work by URL (see Outreach_inventory.md); they are just
 * not competing for attention in the nav.
 *
 * `exact` marks a href that would otherwise match as a prefix of its own children: /blog is the parent
 * of /blog/writer, so without it both light up at once.
 */
const NAV_GROUPS: Array<{
  label: string;
  items: Array<{ name: string; href: string; icon: LucideIcon; exact?: boolean }>;
}> = [
  {
    label: "Geseo",
    items: [
      { name: "Campaigns", href: "/campaigns/autonomous", icon: Bot },
      { name: "Decisions", href: "/sending", icon: Activity },
      { name: "Inbox", href: "/inbox", icon: Inbox },
      { name: "Agent Runs", href: "/agent-runs", icon: Cpu },
      { name: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

/** Does `pathname` sit inside this nav entry? */
function isActive(pathname: string, item: { href: string; exact?: boolean }): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

// Swaps the nav icon for a spinner while THIS link's navigation is in flight — instant
// feedback on click. Must be rendered inside its <Link> (useLinkStatus reads that context).
function NavIcon({ Icon, collapsed }: { Icon: LucideIcon; collapsed: boolean }) {
  const { pending } = useLinkStatus();
  // Larger in the collapsed rail: there is no label beside it, so the glyph carries all the meaning.
  const cls = cn("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4 mr-3");
  return pending ? <Loader2 className={cn(cls, "animate-spin")} /> : <Icon className={cls} />;
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  /** Explicit open/closed per group. Absent means "follow whether the current page is inside it", so
   *  landing on /blog/writer opens Content without the user having to. */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  return (
    <>
      <button
        className="lg:hidden fixed top-3 left-4 z-50 grid size-9 place-items-center rounded-xl border border-border bg-card shadow-sm"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/50"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* The rail is a floating pane, not a flush column: an outer gutter holds it off the screen
          edge, and the card itself is frosted glass with a bright rim and a deep shadow. The gap on
          the right is wider than the outer gutter so the card and the page never read as touching. */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex transition-all duration-300 ease-in-out lg:static lg:z-auto",
          "p-3",
          collapsed ? "w-[104px]" : "w-[280px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
      <div className="flex min-h-0 w-full flex-col rounded-2xl border border-border bg-card">
        {/* Brand */}
        <div className={cn("flex h-14 items-center border-b border-border px-4 shrink-0", collapsed && "justify-center px-2")}>
          {!collapsed && (
            <Link href="/" className="flex min-w-0 items-center gap-2.5">
              <SummitMark className="size-7 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold tracking-tight">Geseo</span>
                <span className="block truncate text-[10px] text-muted-foreground">AI Outreach Platform</span>
              </span>
            </Link>
          )}
          {collapsed && (
            <Link href="/" aria-label="Geseo">
              <SummitMark className="size-7" />
            </Link>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={cn("ml-auto h-10 w-10 p-0 shrink-0", collapsed && "ml-0 mt-0")}
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </Button>
        </div>

        {/* Nav */}
        <nav className={cn("flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-2")}>
          {NAV_GROUPS.map((group, gi) => {
            const groupActive = group.items.some((it) => isActive(pathname, it));
            // A single-item group (Outreach, now that it's just Backlink Outreach) has nothing to
            // collapse. Without this, `open` fell back to `groupActive` — false on every page except
            // /backlinks itself — so the one nav entry for the whole outreach workspace was hidden
            // behind a click everywhere else in the app. There's nothing to hide, so it's always open.
            const soleItem = group.items.length <= 1;
            const open = collapsed || soleItem || (openGroups[group.label] ?? groupActive);
            return (
              <div key={group.label} className={cn(collapsed ? "mb-0" : "mb-1")}>
                {collapsed ? (
                  // A rule between groups, so twenty icons read as four short runs rather than one
                  // undifferentiated column. Skipped above the first group.
                  gi > 0 && <div className="mx-3 my-2 border-t border-sidebar-border/70" aria-hidden="true" />
                ) : soleItem ? (
                  // Plain heading, not a toggle: a chevron that expands to reveal exactly one row is
                  // a wasted click, not an affordance.
                  <div className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpenGroups((g) => ({ ...g, [group.label]: !open }))}
                    className={cn(
                      "w-full flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold uppercase tracking-wide transition-colors",
                      groupActive ? "text-foreground" : "text-muted-foreground",
                      "hover:text-foreground hover:bg-sidebar-accent",
                    )}
                    aria-expanded={open}
                  >
                    <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
                    {group.label}
                    {!open && groupActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
                  </button>
                )}
                {open && (
                  <div className={cn(collapsed ? "space-y-1" : "space-y-0.5")}>
                    {group.items.map((item) => {
                      const active = isActive(pathname, item);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          // Native title is the tooltip in the rail. It is the only label available
                          // once the text is gone, so it is not optional here.
                          title={collapsed ? item.name : undefined}
                          aria-label={collapsed ? item.name : undefined}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "relative flex items-center rounded-lg font-medium transition-colors",
                            // py-2.5: these are the most-clicked targets in the app and were
                            // noticeably thin next to the raised button scale.
                            collapsed ? "h-11 w-11 mx-auto justify-center" : "ml-2 px-3 py-2.5 text-sm",
                            active
                              // Collapsed, a faint tinted box was hard to spot among twenty icons, so
                              // the active item gets the accent colour outright.
                              ? collapsed
                                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-[var(--primary-shadow)]"
                                : "bg-sidebar-primary text-sidebar-primary-foreground shadow-[var(--primary-shadow)]"
                              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                          )}
                          onClick={() => setMobileOpen(false)}
                        >
                          <NavIcon Icon={item.icon} collapsed={collapsed} />
                          {!collapsed && <span className="truncate">{item.name}</span>}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>
      </div>
    </>
  );
}
