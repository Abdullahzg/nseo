"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, PenLine, Lock, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export interface PitchInfo {
  id: string;
  subject: string | null;
  body: string | null;
  status: string | null;
  sentAt: string | null;
  scheduledAt: string | null;
  editedAt: string | null;
  editedBy: string | null;
  editable: boolean;
}

export interface PitchTarget {
  domain: string;
  /** The article byline. */
  author: string | null;
  email: string | null;
  /** Set when the address belongs to someone OTHER than the byline (a Hunter alt contact). */
  emailOwner: string | null;
  emailOwnerPosition: string | null;
  prospectUrl: string;
  pitch: PitchInfo;
}

/**
 * Read and edit one AI-drafted pitch, in place on the Backlinks page.
 *
 * The gap this closes was reported verbatim: "I cannot find the option to see / edit the pitches written
 * by AI." It was accurate — the nightly cron writes them as `ready` outreach_emails and there was no
 * surface anywhere. 106 were queued and none had ever been opened. A queue of unreviewed AI drafts nobody
 * can read is worse than no drafts, because it looks like progress while being unauditable.
 *
 * Two things this deliberately makes impossible to miss:
 *
 *   - **Who it actually goes to.** When Hunter's domain-search found an editor rather than the byline, the
 *     recipient is a different person from the author. That is usually the better contact for a link, but
 *     an operator skimming a pitch would otherwise assume it is addressed to the writer.
 *   - **Whether it can still be changed.** A sent pitch is a record of a live conversation. Editing it
 *     would make the archive lie about what the recipient is replying to, so the form locks instead of
 *     silently failing on save.
 */
export function PitchDialog({
  target,
  open,
  onOpenChange,
  onSaved,
}: {
  target: PitchTarget | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset from the target every time it changes, so reopening on a different prospect never shows the
  // previous one's text — the failure mode that makes someone edit the wrong pitch.
  useEffect(() => {
    setSubject(target?.pitch.subject ?? "");
    setBody(target?.pitch.body ?? "");
  }, [target]);

  if (!target) return null;
  const { pitch } = target;
  const dirty = subject !== (pitch.subject ?? "") || body !== (pitch.body ?? "");

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/backlinks/pitch/${pitch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not save the pitch.");
        return;
      }
      toast.success("Pitch saved. It will send with your wording.");
      onSaved?.();
      onOpenChange(false);
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  };

  const recipientLine = target.emailOwner
    ? `${target.emailOwner}${target.emailOwnerPosition ? ` · ${target.emailOwnerPosition}` : ""}`
    : target.author;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[min(60vw,900px)] max-w-none overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Pitch to {target.domain}
          </DialogTitle>
          <DialogDescription>
            Written by AI. Read it, change anything, and it sends with your wording.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Who this reaches. Spelled out rather than implied, because the address is not always the
              byline's and a pitch addressed to the wrong person cannot be taken back. */}
          <div className="glass-inset space-y-1 p-3 text-sm">
            <div className="flex items-center gap-2">
              <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Goes to</span>
              <span className="font-medium">{recipientLine ?? "unknown"}</span>
              {target.email && <span className="text-muted-foreground">· {target.email}</span>}
            </div>
            {target.emailOwner && (
              <p className="text-xs text-warning">
                This address belongs to {target.emailOwner}, not to {target.author ?? "the byline"} who wrote
                the article. Often the better contact for a link, but the pitch is addressed to them, not the
                writer.
              </p>
            )}
            <div className="text-xs text-muted-foreground">
              About{" "}
              <a href={target.prospectUrl} target="_blank" rel="noreferrer" className="underline">
                {target.prospectUrl.replace(/^https?:\/\//, "").slice(0, 70)}
              </a>
            </div>
          </div>

          {!pitch.editable && (
            <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>
                Already sent{pitch.sentAt ? ` on ${new Date(pitch.sentAt).toLocaleDateString()}` : ""}, so it
                cannot be edited — this is the record of a live conversation. To follow up, reply on the
                thread from the Inbox.
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="pitch-subject">Subject</Label>
            <Input
              id="pitch-subject"
              value={subject}
              disabled={!pitch.editable || saving}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pitch-body">Message</Label>
            <Textarea
              id="pitch-body"
              value={body}
              disabled={!pitch.editable || saving}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[280px] font-mono text-[0.8125rem] leading-relaxed"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-xs">{pitch.status ?? "draft"}</Badge>
            {pitch.editedAt ? (
              <span className="flex items-center gap-1">
                <PenLine className="h-3 w-3" />
                Edited by {pitch.editedBy ?? "someone"} on {new Date(pitch.editedAt).toLocaleDateString()}
              </span>
            ) : (
              <span>Not yet reviewed by a person.</span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {pitch.editable ? "Cancel" : "Close"}
          </Button>
          {pitch.editable && (
            <Button onClick={save} disabled={saving || !dirty}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {dirty ? "Save pitch" : "No changes"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
