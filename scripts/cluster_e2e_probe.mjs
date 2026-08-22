// Run: npx tsx scripts/cluster_e2e_probe.mjs
//
// Drives a real 2-article cluster end to end: real Search Console opportunity data, a real planning
// call, real slug minting, real unattended writing, real validation. Deliberately the smallest
// cluster that still exercises interlinking (pillar + 1 supporting), because each article costs real
// tokens.
//
// Cleans up every row it creates.
import * as dotenv from "dotenv";
dotenv.config({ path: new URL("../.env.local", import.meta.url).pathname, quiet: true });

const q = await import("../src/lib/db/queries.ts");
const { keywordOpportunities, planCluster, resolveClusterSlugs, estimateClusterCost } =
  await import("../src/lib/writer/cluster.ts");
const { materialiseCluster, runCluster, clusterProgress, siblingUrl } =
  await import("../src/lib/writer/clusterRun.ts");
const { supabaseAdmin } = await import("../src/lib/db/supabase.ts");

let pass = 0, fail = 0;
const ok = (c, m, extra = "") => { c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗ FAIL:", m, extra)); };

const SEED = "ai video generator";
let clusterId = null;
const createdDraftIds = [];

try {
  // ── 1. Real opportunity data ──
  console.log(`=== 1. Search Console opportunities for "${SEED}" ===`);
  const { opportunities, property, window, notes } = await keywordOpportunities(SEED, 40);
  ok(opportunities.length > 0, `found ${opportunities.length} striking-distance queries (${property}, ${window})`);
  for (const o of opportunities.slice(0, 5)) {
    console.log(`    "${o.keyword}" — ${o.impressions.toLocaleString()} imp, pos ${o.position.toFixed(1)}, opp ${o.opportunity.toLocaleString()}`);
  }
  ok(opportunities.every((o) => o.position >= 5 && o.position <= 30),
    "every candidate is genuinely striking-distance (position 5-30)");
  ok(opportunities.every((o) => o.impressions >= 50), "every candidate has real measured demand (>=50 impressions)");
  for (const n of notes) console.log(`    note: ${n}`);

  // ── 2. Plan (2 articles: pillar + 1) ──
  console.log("\n=== 2. Planning a 2-article cluster ===");
  const voice = await q.getDefaultWriterVoice();
  const { plan, error } = await planCluster(SEED, voice, 2);
  ok(!!plan, `plan produced${error ? ` (${error})` : ""}`);
  if (!plan) throw new Error(error ?? "no plan");

  console.log(`    pillar: "${plan.pillar.keyword}" -> ${plan.pillar.title}`);
  for (const s of plan.supporting) console.log(`    support: "${s.keyword}" -> ${s.title}`);
  for (const n of plan.notes) console.log(`    note: ${n}`);

  // Every keyword must trace back to the real GSC data. A hallucinated keyword would mean a whole
  // article targeting a query nobody searches.
  const realKeywords = new Set(opportunities.map((o) => o.keyword.toLowerCase()));
  const planned = [plan.pillar, ...plan.supporting];
  ok(planned.every((p) => realKeywords.has(p.keyword.toLowerCase())),
    "every planned keyword came verbatim from real Search Console data",
    `offenders: ${JSON.stringify(planned.filter((p) => !realKeywords.has(p.keyword.toLowerCase())).map((p) => p.keyword))}`);
  ok(planned.every((p) => p.impressions > 0 && p.position > 0),
    "every planned post carries its measured impressions and position");
  const kws = planned.map((p) => p.keyword.toLowerCase());
  ok(new Set(kws).size === kws.length, "no two posts target the same query");
  ok(planned.every((p) => p.title.length >= 35),
    "every title clears Strapi's 35-char minimum",
    `short: ${JSON.stringify(planned.filter((p) => p.title.length < 35).map((p) => p.title))}`);

  const est = estimateClusterCost(plan);
  console.log(`    estimate: ${est.articles} articles, ~${est.est_output_tokens.toLocaleString()} output tokens, ~$${est.est_usd}`);

  // ── 3. Slug minting + interlink map, before any writing ──
  console.log("\n=== 3. Slugs and interlink map (computed before writing) ===");
  const resolved = await resolveClusterSlugs(plan);
  const rItems = [resolved.pillar, ...resolved.supporting];
  ok(rItems.every((i) => !!i.slug), `every post has a slug: ${rItems.map((i) => i.slug).join(", ")}`);
  ok(new Set(rItems.map((i) => i.slug)).size === rItems.length, "slugs are unique within the cluster");
  ok((resolved.pillar.links_to ?? []).length === resolved.supporting.length,
    "pillar links down to every supporting post");
  ok(resolved.supporting.every((s) => (s.links_to ?? []).includes(resolved.pillar.slug)),
    "every supporting post links up to the pillar");

  // ── 4. Materialise: real drafts + member sessions ──
  console.log("\n=== 4. Approving (creates drafts + member sessions) ===");
  const cluster = await q.createWriterCluster({
    voice_id: voice.id, pillar_keyword: plan.pillar.keyword, title: plan.pillar.title,
    keyword_source: { evidence: plan.evidence }, plan, status: "plan_pending",
    total: planned.length, created_by: "probe",
  });
  clusterId = cluster.id;
  const mat = await materialiseCluster(clusterId, "probe");
  ok(mat.ok, `materialise ok${mat.error ? ` (${mat.error})` : ""}`);

  const sessions = await q.listWriterSessions(clusterId);
  ok(sessions.length === planned.length, `${sessions.length} member sessions created`);
  for (const s of sessions) if (s.draft_id) createdDraftIds.push(s.draft_id);
  ok(sessions.every((s) => s.kind === "cluster_member"), "sessions are marked as cluster members");
  ok(sessions.every((s) => s.phase === "researching"),
    "members start at 'researching' (brief pre-filled, nothing to ask a human)");
  ok(sessions.every((s) => (s.brief?.cluster_siblings ?? []).length > 0),
    "every member was handed its sibling URLs up front");
  console.log(`    sibling URLs example: ${JSON.stringify(sessions[0].brief?.cluster_siblings)}`);

  // ── 5. Run it ──
  console.log("\n=== 5. Writing all articles unattended (this takes a few minutes) ===");
  const t0 = Date.now();
  const res = await runCluster(clusterId);
  ok(res.ok, `run completed${res.error ? ` (${res.error})` : ""}${res.handedOff ? " (handed off to QStash)" : ""}`);
  console.log(`    took ${Math.round((Date.now() - t0) / 1000)}s`);

  const prog = await clusterProgress(clusterId);
  console.log(`    status=${prog.status} done=${prog.done}/${prog.total} failed=${prog.failed}`);
  for (const a of prog.articles) {
    console.log(`    - "${a.keyword}" phase=${a.phase} sections=${a.sections} words=${a.words} qa=${a.writer_status ?? "-"} slug=${a.slug}`);
  }

  ok(prog.done > 0, `at least one article was written (${prog.done}/${prog.total})`);
  ok(["done", "partial"].includes(prog.status), `cluster reached a terminal status ("${prog.status}")`);
  // Every article must have produced a real body. An article FAILING on a caught fabrication is the
  // system working correctly, so that is asserted separately below rather than counted as an error
  // here — but an article that wrote nothing at all is a genuine defect.
  ok(prog.articles.every((a) => a.words > 500),
    `every article produced a real body (${prog.articles.map((a) => a.words).join(", ")} words)`,
    "an article that writes nothing is a bug, unlike one that fails a quality gate");

  // ── 6. The written output ──
  console.log("\n=== 6. Checking the written drafts ===");
  // Re-read the sessions: the copies from step 4 predate the run, so their research ledger is empty.
  // Checking links against a stale ledger reports every real citation as fabricated.
  const freshSessions = await q.listWriterSessions(clusterId);
  for (const a of prog.articles) {
    if (!a.draft_id) continue;
    const d = await q.getBlogDraft(a.draft_id);
    if (!d?.body?.trim()) { ok(false, `"${a.keyword}" has a body`); continue; }
    ok(d.body.length > 1500, `"${a.keyword}": substantial body (${d.body.length} chars)`);
    ok(!d.body.includes("—"), `"${a.keyword}": no em dashes`);

    // Metadata is deliberately skipped for an article that failed provenance (it is going to a human
    // regardless, so the call would be wasted), so only assert it where the article passed.
    const provenanceFailed = (d.writer_qa?.violations ?? []).some((v) => v.gate === "link_provenance");
    if (provenanceFailed) {
      ok(d.writer_status === "failed",
        `"${a.keyword}": a fabricated URL correctly FAILED the article (this is the gate working)`);
      console.log(`      (metadata intentionally skipped for a failed article)`);
    } else {
      ok(d.title.length >= 35 && d.description.length >= 120,
        `"${a.keyword}": metadata publishable (title ${d.title.length}, desc ${d.description.length})`);
    }

    // Interlinking is the whole point of a cluster.
    const links = [...d.body.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
    const session = freshSessions.find((s) => s.draft_id === a.draft_id);
    const expectedSiblings = session?.brief?.cluster_siblings ?? [];
    const linkedSiblings = expectedSiblings.filter((u) => links.includes(u));
    ok(linkedSiblings.length > 0,
      `"${a.keyword}": links to ${linkedSiblings.length}/${expectedSiblings.length} of its cluster siblings`,
      `expected any of ${JSON.stringify(expectedSiblings)}, body had ${JSON.stringify(links)}`);

    // No fabricated URLs: everything must trace to a retrieval, the voice sitemap, or a sibling.
    const { voiceSitemap } = await import("../src/lib/writer/voice.ts");
    const allowed = new Set([
      ...Object.keys(session?.research?.sources ?? {}),
      ...voiceSitemap(voice).map((l) => l.url),
      ...expectedSiblings,
    ]);
    const fabricated = links.filter((l) => !allowed.has(l));
    ok(fabricated.length === 0, `"${a.keyword}": no fabricated links`, JSON.stringify(fabricated));

    // Grounding: FAQ headings should trace to real retrieved questions.
    const paa = session?.research?.paa ?? [];
    const qHeadings = [...d.body.matchAll(/^##\s+(.+\?)\s*$/gm)].map((m) => m[1]);
    console.log(`      ${qHeadings.length} question headings, ${paa.length} real PAA questions retrieved`);
    const qa = d.writer_qa;
    if (qa?.violations?.length) {
      for (const v of qa.violations) console.log(`      [${v.severity}] ${v.gate}: ${v.detail.slice(0, 110)}`);
    }
    ok(!(qa?.violations ?? []).some((v) => v.gate === "link_provenance"),
      `"${a.keyword}": no provenance failure`);
  }

  // Every article must still need a human before it can go live.
  const { publishReadiness } = await import("../src/lib/strapi/mapDraft.ts");
  for (const a of prog.articles) {
    if (!a.draft_id) continue;
    const d = await q.getBlogDraft(a.draft_id);
    ok(publishReadiness(d).length > 0 && d.status === "draft",
      `"${a.keyword}": still a draft and still publish-blocked (a human must finish it)`);
  }
} catch (e) {
  fail++;
  console.log("\n  ✗ UNCAUGHT:", e.message);
  console.log(e.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  console.log("\n=== cleanup ===");

  // This runs against the SHARED database, where a teammate may have opened one of these drafts in
  // the editor while the probe was running. That happened: a run deleted a draft someone had just
  // inserted an image into, and because writer_sessions cascades from writer_clusters, the section
  // text went with it and there was nothing left to restore from.
  //
  // So cleanup is now conditional. A draft that someone has edited since the probe created it is
  // KEPT, and the cluster is only removed once every one of its drafts is gone (the cascade would
  // otherwise destroy the session text belonging to a draft we deliberately kept).
  //
  // KEEP_PROBE_DATA=1 skips cleanup entirely.
  if (process.env.KEEP_PROBE_DATA === "1") {
    console.log(`  KEEP_PROBE_DATA=1 — keeping cluster ${clusterId} and ${createdDraftIds.length} drafts`);
  } else {
    let removed = 0;
    const kept = [];
    for (const id of createdDraftIds) {
      const row = await q.getBlogDraft(id).catch(() => null);
      if (!row) continue;
      // The probe writes as the agent, which never stamps last_edited_by. Anything there is a human.
      const touchedByPerson = !!row.last_edited_by;
      if (touchedByPerson) {
        kept.push(`${row.slug} (edited by ${row.last_edited_by})`);
        continue;
      }
      await q.deleteBlogDraft(id).catch(() => {});
      removed++;
    }

    if (kept.length) {
      console.log(`  KEPT ${kept.length} draft(s) that a person edited:`);
      for (const k of kept) console.log(`    - ${k}`);
      console.log(`  keeping cluster ${clusterId} too, because deleting it cascades to their session text`);
    } else if (clusterId) {
      // writer_sessions cascade from the cluster; writer_messages cascade from the sessions.
      const { error: cErr } = await supabaseAdmin.from("writer_clusters").delete().eq("id", clusterId);
      if (cErr) console.log("  cluster cleanup failed:", cErr.message);
    }
    console.log(`  removed ${removed} draft(s)${kept.length ? "" : ` and cluster ${clusterId}`}`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
