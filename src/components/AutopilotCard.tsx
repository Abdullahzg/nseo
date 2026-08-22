"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Gauge, Loader2, Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Global "send N emails/day" control. Setting a number + turning this on lets the daily cron keep
// the outreach queue topped up to that ceiling automatically; manual sends still work as usual.
export function AutopilotCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [cap, setCap] = useState(25);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    fetch("/api/emails/autopilot").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) { setEnabled(!!d.enabled); setCap(d.cap ?? 25); }
    }).catch(() => setEnabled(false));
  }, []);

  async function save(next: { enabled?: boolean; cap?: number; run?: boolean }) {
    setSaving(true);
    try {
      const d = await fetch("/api/emails/autopilot", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
      }).then((r) => r.json());
      if (d?.ok) { setEnabled(!!d.enabled); setCap(d.cap ?? cap); }
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  async function topUpNow() {
    setRunning(true);
    try {
      const d = await fetch("/api/emails/autopilot?force=1", { method: "POST" }).then((r) => r.json());
      if (d?.ok) toast.success(`Queued ${d.result.scheduled} email(s) toward today's target (${d.result.alreadyQueued} already queued).`);
      else toast.error(d?.error ?? "Failed.");
    } catch (e: any) { toast.error(e?.message ?? "Failed."); }
    finally { setRunning(false); }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className={cn("mt-0.5 rounded-md p-2", enabled ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
            <Gauge className="h-5 w-5" />
          </div>
          <div>
            <div className="font-medium flex items-center gap-2">
              Daily send autopilot
              {enabled === null ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                : <Switch checked={enabled} disabled={saving} onCheckedChange={(v) => save({ enabled: v })} />}
            </div>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              When on, up to <b>{cap}</b> outreach emails are queued and sent automatically each day, at each
              recipient's local time — across all campaigns. Overflow rolls to the next day; nothing is dropped.
              You can still pick and send prospects manually from the Sending page.
            </p>
          </div>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Emails / day</label>
            <Input type="number" min={1} max={500} value={cap} disabled={saving}
              onChange={(e) => setCap(Number(e.target.value))}
              onBlur={() => save({ cap })}
              className="w-24" />
          </div>
          <Button size="sm" variant="outline" disabled={running} onClick={topUpNow}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Top up now
          </Button>
        </div>
      </div>
    </div>
  );
}
