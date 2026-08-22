// Unattended generation of an approved cluster.
//
// Each article still runs the full research → outline → write → validate flow, so its FAQ headings
// come from ITS OWN real People Also Ask data and its citations from its own retrievals. What the
// cluster approval buys is skipping the per-article human gate: the reviewer approved the plan, so
// each member's outline is auto-approved when it arrives. Nothing else is skipped, because skipping
// the research is what would make the output generic.
//
// Resumability has two levels, both necessary. Article index (`cursor`) survives an invocation
// boundary; section index (`section_cursor`, inside the session) survives one within an article.
// A single Anthropic generation cannot be resumed once it is streaming, so the resumable unit has to
// be smaller than one invocation. Pattern copied from src/lib/enrich/run.ts.
import {
  getWriterCluster, updateWriterCluster, createWriterSession, updateWriterSession,
  getWriterSession, createBlogDraft, updateBlogDraft, getWriterVoice,
  type WriterCluster, type WriterSession,
} from "@/lib/db/queries";
import { isServerless, qstashPublish } from "@/lib/qstash";
import { runTurn } from "./agent";
import { finalizeSession } from "./finalize";
import { resolveClusterSlugs, planItems, type ClusterPlan, type ClusterPlanItem } from "./cluster";

/** Leave room to hand off before the 300s function ceiling, same budget as enrich/run.ts. */
const CHUNK_BUDGET_MS = isServerless() ? 200_000 : Infinity;
/** Writing turns per article before giving up on it and moving to the next. Generous because the
 *  first one or two go on research and the outline, not on sections. */
const MAX_WRITE_TURNS = 8;
/** Automatic repair rounds per unattended article. Matches the interactive cap. */
const MAX_REPAIR_ROUNDS = 2;

function siteBase(): string {
  return (process.env.APP_PUBLIC_SITE_URL || "https://www.imagine.art").replace(/\/$/, "");
}

/** A cluster sibling's public URL. Blog posts live under /blogs/<slug> on the live site. */
export function siblingUrl(slug: string): string {
  return `${siteBase()}/blogs/${slug}`;
}

/**
 * Turn an approved plan into real draft rows and member sessions.
 *
 * Done in one pass at approval time so every slug exists before generation starts. That is what
 * makes the interlink map safe: each article is handed the exact sibling URLs to link to, and the
 * validator will reject anything else.
 */
export async function materialiseCluster(
  clusterId: string,
  approvedBy: string | null,
): Promise<{ ok: boolean; error?: string; cluster?: WriterCluster }> {
  const cluster = await getWriterCluster(clusterId);
  if (!cluster) return { ok: false, error: "Cluster not found." };
  if (!cluster.plan) return { ok: false, error: "This cluster has no plan to approve." };
  if (cluster.status === "running" || cluster.status === "done") {
    return { ok: false, error: `Cluster is already ${cluster.status}.` };
  }
  if (!cluster.voice_id) return { ok: false, error: "Cluster has no voice attached." };
  const voice = await getWriterVoice(cluster.voice_id);
  if (!voice) return { ok: false, error: "The cluster's voice no longer exists." };

  // Mint and collision-check every slug now, then compute the link graph deterministically.
  const plan = await resolveClusterSlugs(cluster.plan as ClusterPlan);
  const items = planItems(plan);

  for (const item of items) {
    const draft = await createBlogDraft({
      title: item.title,
      slug: item.slug!,
      body: "",
      description: "",
      created_by: approvedBy ?? undefined,
    });
    await updateBlogDraft(draft.id, { cluster_id: clusterId } as never);

    await createWriterSession({
      voice_id: voice.id,
      voice_revision: voice.prompt_revision,
      kind: "cluster_member",
      cluster_id: clusterId,
      draft_id: draft.id,
      created_by: approvedBy ?? undefined,
      // Pre-filled brief: the reviewer already agreed all of this, so the member session has nothing
      // to ask a human and starts straight into research.
      phase: "researching",
      brief: {
        primary_keyword: item.keyword,
        topic: item.angle,
        angle: item.angle,
        page_type: "blog",
        word_count: item.word_count,
        negative_keywords: [],
        cta_text: voice.default_cta_text ?? null,
        cta_url: voice.default_cta_url ?? null,
        cluster_siblings: (item.links_to ?? []).map(siblingUrl),
      },
    });
  }

  const updated = await updateWriterCluster(clusterId, {
    plan,
    status: "approved",
    approved_at: new Date().toISOString(),
    approved_by: approvedBy,
    total: items.length,
    done: 0,
    failed: 0,
    cursor: 0,
  });
  return { ok: true, cluster: updated };
}

async function memberSessions(clusterId: string): Promise<WriterSession[]> {
  const { listWriterSessions } = await import("@/lib/db/queries");
  const all = await listWriterSessions(clusterId);
  // Oldest first, so the pillar (created first) is written first and later posts can link to a page
  // that already exists if a run is interrupted partway.
  return all.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * Drive one member article from wherever it is to done or failed.
 *
 * The auto-approve check sits INSIDE the loop, not before it. An article often needs two turns to
 * produce an outline (research, then propose), and a single pre-loop check ran while the phase was
 * still `researching` — so the outline arrived afterwards, was never approved, and the article looped
 * six times writing nothing and finished at 0 sections. Re-checking each iteration makes the loop
 * indifferent to how many turns the outline takes.
 */
async function writeOneArticle(sessionId: string): Promise<"done" | "flagged" | "failed"> {
  const noop = () => {};
  let session = await getWriterSession(sessionId);
  if (!session) return "failed";

  for (let i = 0; i < MAX_WRITE_TURNS; i++) {
    session = (await getWriterSession(sessionId)) ?? session;
    if (session.phase === "failed") return "failed";

    // Auto-approve: the human approved the cluster plan, and that IS the approval for every article
    // in it. This is the only legitimate auto-approval in the system, and it is why approving a
    // cluster is a deliberate separate action rather than a checkbox on the plan screen.
    if (session.phase === "outline_pending") {
      session = await updateWriterSession(sessionId, {
        phase: "approved",
        outline_approved_at: new Date().toISOString(),
        outline_approved_by: "cluster-plan-approval",
      });
    }

    const total = session.outline?.sections.length ?? 0;
    const written = Object.keys(session.sections ?? {}).length;
    if (total > 0 && written >= total) break;

    const nudge = session.phase === "researching" || session.phase === "gathering"
      ? "Research this and propose the outline."
      : undefined;
    session = await runTurn(sessionId, nudge, noop);
  }

  // Still no outline after every allowed turn: the article genuinely did not get made.
  const finalSession = (await getWriterSession(sessionId)) ?? session;
  if (Object.keys(finalSession.sections ?? {}).length === 0) {
    await updateWriterSession(sessionId, { phase: "failed", error: "no sections were written" });
    return "failed";
  }

  let fin = await finalizeSession(sessionId);
  if (!fin.ok) return "failed";

  // Unattended articles get the repair loop applied automatically. In the chat UI a human presses
  // "Ask it to fix these"; in a cluster there is nobody to press it, so a flagged article would
  // otherwise just stay flagged. Bounded by the same 2-round cap the interactive path uses.
  for (let round = 0; round < MAX_REPAIR_ROUNDS && fin.repair_prompt; round++) {
    await runTurn(sessionId, fin.repair_prompt, noop).catch(() => {});
    const next = await finalizeSession(sessionId);
    if (!next.ok) break;
    const before = (fin.violations ?? []).filter((v) => v.severity === "repair").length;
    const after = (next.violations ?? []).filter((v) => v.severity === "repair").length;
    fin = next;
    // No improvement means another round is unlikely to help and will just burn tokens.
    if (after >= before) break;
  }

  return fin.verdict === "failed" ? "failed" : fin.verdict === "ok" ? "done" : "flagged";
}

/**
 * Run (or resume) a cluster. Returns when the cluster is finished or when it has handed the
 * remainder off to another invocation via QStash.
 */
export async function runCluster(clusterId: string): Promise<{ ok: boolean; handedOff?: boolean; error?: string }> {
  const startedAt = Date.now();
  let cluster = await getWriterCluster(clusterId);
  if (!cluster) return { ok: false, error: "Cluster not found." };
  if (cluster.status !== "approved" && cluster.status !== "running" && cluster.status !== "partial") {
    return { ok: false, error: `Cluster is "${cluster.status}", not ready to run.` };
  }

  const sessions = await memberSessions(clusterId);
  if (!sessions.length) return { ok: false, error: "No member sessions to write." };

  cluster = await updateWriterCluster(clusterId, { status: "running", total: sessions.length });

  for (let i = cluster.cursor; i < sessions.length; i++) {
    // Out of time on this invocation: checkpoint and hand the rest to a fresh one. Never mid-article,
    // because the article's own section_cursor handles that finer granularity.
    if (Date.now() - startedAt > CHUNK_BUDGET_MS) {
      await updateWriterCluster(clusterId, { cursor: i });
      const handed = await qstashPublish("/api/blog/writer/cluster/run", { continue: true, cluster_id: clusterId });
      if (handed) return { ok: true, handedOff: true };
      // No QStash: stop cleanly as partial rather than risk being killed mid-article. A manual
      // re-run picks up at the same cursor.
      await updateWriterCluster(clusterId, { status: "partial" });
      return { ok: true, handedOff: false };
    }

    const s = sessions[i];
    let outcome: "done" | "flagged" | "failed";
    try {
      outcome = await writeOneArticle(s.id);
    } catch {
      outcome = "failed";
    }

    const fresh = await getWriterCluster(clusterId);
    await updateWriterCluster(clusterId, {
      cursor: i + 1,
      done: (fresh?.done ?? 0) + (outcome === "failed" ? 0 : 1),
      failed: (fresh?.failed ?? 0) + (outcome === "failed" ? 1 : 0),
    });
  }

  const final = await getWriterCluster(clusterId);
  await updateWriterCluster(clusterId, {
    status: (final?.failed ?? 0) > 0 ? "partial" : "done",
  });
  return { ok: true };
}

/** Progress for the UI to poll. Streaming would die at the QStash invocation boundary and look like
 *  a hang, and the durable state is already in Postgres, so polling is both simpler and correct. */
export async function clusterProgress(clusterId: string) {
  const cluster = await getWriterCluster(clusterId);
  if (!cluster) return null;
  const sessions = await memberSessions(clusterId);
  const { getBlogDraft } = await import("@/lib/db/queries");
  const articles = await Promise.all(sessions.map(async (s) => {
    const draft = s.draft_id ? await getBlogDraft(s.draft_id) : null;
    const total = s.outline?.sections.length ?? 0;
    const written = Object.keys(s.sections ?? {}).length;
    return {
      session_id: s.id,
      draft_id: s.draft_id,
      keyword: (s.brief as { primary_keyword?: string })?.primary_keyword ?? "",
      title: draft?.title ?? "",
      slug: draft?.slug ?? "",
      phase: s.phase,
      sections: `${written}/${total || "?"}`,
      words: draft?.body ? draft.body.trim().split(/\s+/).filter(Boolean).length : 0,
      writer_status: draft?.writer_status ?? null,
    };
  }));
  return {
    id: cluster.id,
    status: cluster.status,
    total: cluster.total,
    done: cluster.done,
    failed: cluster.failed,
    cursor: cluster.cursor,
    pillar_keyword: cluster.pillar_keyword,
    articles,
  };
}
