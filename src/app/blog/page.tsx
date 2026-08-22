"use client";

// Blog composer shell: the draft list on the left, the editor on the right.
// All editing, saving and Strapi syncing lives in src/components/blog/DraftEditor.tsx.
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Newspaper, Plus, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BlogDraft, BlogDraftSummary } from "@/lib/db/queries";
import { DraftEditor } from "@/components/blog/DraftEditor";
import { deriveSyncState, SYNC_STATE_META } from "@/lib/blog/state";
import * as journal from "@/lib/blog/journal";

interface MetaOption { id: number; name?: string; title?: string; slug?: string }

export default function BlogPage() {
  const [tab, setTab] = useState<"draft" | "published">("draft");
  const [drafts, setDrafts] = useState<BlogDraftSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selected, setSelected] = useState<BlogDraft | null>(null);
  const [authors, setAuthors] = useState<MetaOption[]>([]);
  const [categories, setCategories] = useState<MetaOption[]>([]);
  const [creating, setCreating] = useState(false);
  /** Drafts with unsaved work stranded on this device — surfaced so recovery doesn't depend on
   *  remembering which post the tab died in. */
  const [orphans, setOrphans] = useState<journal.Journal[]>([]);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const d = await fetch(`/api/blog/drafts?status=${tab}`).then((r) => r.json());
      if (d?.ok) setDrafts(d.drafts);
    } catch { /* the list is not load-bearing; the editor still works */ }
    finally { setLoadingList(false); }
  }, [tab]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    fetch("/api/blog/meta").then((r) => r.json()).then((d) => {
      if (d?.ok) { setAuthors(d.authors); setCategories(d.categories); }
    }).catch(() => {});
  }, []);

  // Recomputed after the list loads so the banner can count the affected posts. Kept in an effect
  // rather than a render-time useMemo because it reads localStorage — a browser side effect that
  // would risk a hydration mismatch during render.
  useEffect(() => {
    if (!journal.available()) return;
    const known = new Set(drafts.map((d) => d.id));
    setOrphans(journal.listOrphans().filter((j) => known.has(j.draftId) && j.draftId !== selected?.id));
  }, [drafts, selected?.id]);

  async function newPost() {
    setCreating(true);
    try {
      const d = await fetch("/api/blog/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "", body: "", description: "", is_featured: false, should_index: true }),
      }).then((r) => r.json());
      if (d?.ok) { setTab("draft"); await loadList(); setSelected(d.draft); }
      else toast.error(d?.error ?? "Failed to create draft.");
    } catch (e: any) { toast.error(e?.message ?? "Failed."); }
    finally { setCreating(false); }
  }

  /** Keep the list row in step with the editor without refetching on every autosave. */
  const onDraftChanged = useCallback((row: BlogDraft) => {
    setSelected((s) => (s?.id === row.id ? { ...s, ...row } : s));
    setDrafts((list) => list.map((d) => (d.id === row.id ? { ...d, ...row } : d)));
  }, []);

  async function remove(d: BlogDraft) {
    const live = !!d.strapi_published_at;
    const inStrapi = !!d.strapi_id;
    const note = live
      ? "It stays LIVE in Strapi — unpublish there first if you want it taken down."
      : inStrapi ? "The Strapi draft is not affected." : "";
    if (!confirm(`Delete "${d.title || "untitled"}"?\n\n${note}`)) return;
    await fetch(`/api/blog/drafts/${d.id}`, { method: "DELETE" }).catch(() => {});
    journal.clear(d.id);
    if (selected?.id === d.id) setSelected(null);
    await loadList();
  }

  /**
   * Load the full draft for the editor.
   *
   * The list only carries a summary now (title, slug, sync columns) — sending every draft's body to
   * render a sidebar was 79% of a 92KB response. So opening one fetches it. `?live=0` skips the Strapi
   * round-trip, which the editor does not need to start editing.
   */
  const [opening, setOpening] = useState<string | null>(null);
  async function openDraft(draftId: string) {
    if (selected?.id === draftId) return;
    setOpening(draftId);
    try {
      const d = await fetch(`/api/blog/drafts/${draftId}?live=0`).then((r) => r.json());
      if (!d?.ok || !d.draft) { toast.error(d?.error ?? "Couldn't open that draft."); return; }
      setSelected(d.draft);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't open that draft.");
    } finally { setOpening(null); }
  }

  return (
    <div className="flex gap-6 h-full min-h-0">
      {/* List */}
      <div className="w-80 shrink-0 h-full min-h-0 flex flex-col overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[64px] backdrop-saturate-[1.65] shadow-[var(--glass-shadow)]">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <Newspaper className="h-5 w-5 text-highlight-ink" />
            <h1 className="font-light tracking-tight">Blog</h1>
          </div>
          <Button size="sm" className="w-full gap-1.5" onClick={newPost} disabled={creating}>
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} New post
          </Button>
          <div className="flex gap-1 text-xs">
            {(["draft", "published"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={cn("flex-1 px-2 py-1 rounded-md capitalize",
                  tab === t ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50")}>
                {t}s
              </button>
            ))}
          </div>
        </div>

        {orphans.length > 0 && (
          <button
            onClick={() => { void openDraft(orphans[0].draftId); }}
            className="text-left px-3 py-2 bg-highlight-soft border-b border-highlight/40 text-xs flex items-start gap-1.5"
          >
            <AlertCircle className="h-3.5 w-3.5 text-highlight-ink shrink-0 mt-0.5" />
            <span>
              Unsaved changes kept on this device in {orphans.length} other{" "}
              {orphans.length === 1 ? "draft" : "drafts"}. Open to review.
            </span>
          </button>
        )}

        <div className="flex-1 overflow-y-auto">
          {loadingList ? (
            <div className="p-4 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" /></div>
          ) : drafts.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground text-center">No {tab} posts yet.</p>
          ) : (
            drafts.map((d) => {
              const meta = SYNC_STATE_META[deriveSyncState(d)];
              return (
                <button key={d.id} onClick={() => openDraft(d.id)}
                  className={cn("w-full text-left px-3 py-2.5 border-b border-border/60 hover:bg-muted/40",
                    selected?.id === d.id && "bg-highlight-soft")}>
                  {/* truncate has to sit on the TEXT node, not on the flex row: text-overflow does
                      not apply to a flex container, so putting them together clipped titles
                      mid-character instead of ellipsising them. */}
                  <p className="flex items-center gap-1.5 min-w-0">
                    {opening === d.id && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
                    <span className="text-sm font-medium truncate">{d.title || "Untitled"}</span>
                  </p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5 font-mono">{d.slug}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{meta.label}</p>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto pr-1">
        {!selected ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Pick a post on the left, or start a new one.
          </div>
        ) : (
          <DraftEditor
            key={selected.id}
            draft={selected}
            authors={authors}
            categories={categories}
            onDraftChanged={onDraftChanged}
            onDeleted={remove}
          />
        )}
      </div>
    </div>
  );
}
