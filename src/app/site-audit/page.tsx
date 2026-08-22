"use client";

import { useRef, useState, useEffect } from "react";
import { ScanSearch, Play, Loader2, FileText, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { BrokenLinksPanel, type BrokenLinksHandle, type BrokenLinksSummary } from "@/components/site-audit/BrokenLinksPanel";
import { SitemapQaPanel } from "@/components/site-audit/SitemapQaPanel";
import {
  usePageHealth, PageHealthOptions, PastChecks, IndexabilitySection, SpeedSection, PageTypesSection, ShareHealth, Stat,
} from "@/components/site-audit/pageHealth";

// Site Audit — one place to scan the site and see everything that's wrong, grouped by category.
// Composes the two existing subsystems (Link Audit + Page Health) via their existing APIs; no
// backend changes. "Run audit" fires both; each category fills independently as its data lands.
export default function SiteAuditPage() {
  const ph = usePageHealth();
  const blRef = useRef<BrokenLinksHandle>(null);
  const [bl, setBl] = useState<BrokenLinksSummary>({ running: false, brokenCount: 0, progressPct: null });
  const [showOptions, setShowOptions] = useState(false);

  const busy = ph.running || bl.running;
  function runAudit() {
    ph.run();
    blRef.current?.run();
  }

  // Populate the detail tabs from the most recent saved run on arrival, so Indexability/Speed/
  // Page-types aren't empty while the overview tiles already show last-run numbers. Runs once.
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (!autoLoaded.current && !ph.report && !ph.running && ph.history.length > 0) {
      autoLoaded.current = true;
      ph.openHistoryRun(ph.history[0].id);
    }
  }, [ph]);

  // Overview numbers — from the current in-session report if present, else the latest saved run.
  const latest = ph.history[0];
  const v = ph.report?.counts.verdicts;
  const needsAttention = v ? v.flag + v.block : latest?.issues_count ?? null;
  const hiddenFromSearch = ph.report?.counts.jsGated ?? latest?.js_gated_count ?? null;
  const pagesChecked = ph.report?.analyzed ?? latest?.analyzed ?? null;
  const slowTemplates = ph.report ? ph.report.cwv.filter((c) => c.hasField && (c.evaluation.lcp.rating === "poor" || c.evaluation.inp.rating === "poor" || c.evaluation.cls.rating === "poor")).length : null;
  const show = (n: number | null) => (n == null ? "—" : n);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-light flex items-center gap-2 tracking-tight"><ScanSearch className="h-6 w-6 text-highlight-ink" /> Site Audit</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            One scan for everything wrong with your site — broken links, pages Google &amp; AI search can&apos;t see,
            and slow pages. Nothing is changed on your site; you choose what to send to the team.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button variant="outline" size="sm" onClick={() => setShowOptions((s) => !s)}>Options</Button>
          <Button variant="outline" size="sm" onClick={() => ph.run()} disabled={ph.running} className="gap-1.5" title="Page health only (Indexability, Speed, Page types) — quick, no site-wide link crawl">
            {ph.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Pages only
          </Button>
          <Button variant="outline" size="sm" onClick={() => blRef.current?.run()} disabled={bl.running} className="gap-1.5" title="Broken-link crawl only (background, ~1,500 pages)">
            {bl.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />} Links only
          </Button>
          <Button onClick={runAudit} disabled={busy} size="lg" className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {busy ? "Auditing…" : "Run audit"}
          </Button>
        </div>
      </div>

      {showOptions && <PageHealthOptions ph={ph} />}

      {/* Overview strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Broken links" value={bl.progressPct != null ? <span className="text-base font-normal text-muted-foreground">crawling {bl.progressPct}%</span> : show(bl.brokenCount)} tone={bl.brokenCount ? "text-destructive" : undefined} />
        <Stat label="Need attention" value={show(needsAttention)} tone={needsAttention ? "text-warning" : undefined} />
        <Stat label="Hidden from search" value={show(hiddenFromSearch)} tone={hiddenFromSearch ? "text-destructive" : undefined} />
        <Stat label="Pages checked" value={show(pagesChecked)} />
      </div>

      {/* Category tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="broken" className="gap-1.5">
            Broken links{bl.brokenCount > 0 && <Badge variant="outline" className="text-xs text-destructive border-destructive/30">{bl.brokenCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="index" className="gap-1.5">
            Indexability{ph.report && ph.report.routing.length > 0 && <Badge variant="outline" className="text-xs text-warning border-warning/30">{ph.report.routing.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="speed">Speed{slowTemplates ? <span className="ml-1 text-xs text-destructive">({slowTemplates})</span> : null}</TabsTrigger>
          <TabsTrigger value="types">Page types</TabsTrigger>
          <TabsTrigger value="prepublish">Pre-publish</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            Hit <b className="text-foreground">Run audit</b> to scan the whole site. Broken-link crawling runs in the
            background (watch the <b className="text-foreground">Broken links</b> tab); page checks fill in
            Indexability, Speed, and Page types. Results below are your most recent audit.
          </div>
          <PastChecks ph={ph} />
          <ShareHealth ph={ph} />
        </TabsContent>

        <TabsContent value="broken" className="mt-4">
          <BrokenLinksPanel ref={blRef} onSummary={setBl} />
        </TabsContent>

        <TabsContent value="index" className="mt-4">
          <IndexabilitySection ph={ph} />
        </TabsContent>

        <TabsContent value="speed" className="mt-4">
          <SpeedSection ph={ph} />
        </TabsContent>

        <TabsContent value="types" className="mt-4">
          <PageTypesSection ph={ph} />
        </TabsContent>

        <TabsContent value="prepublish" className="mt-4">
          <SitemapQaPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
