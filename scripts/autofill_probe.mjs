// End-to-end check of "Fill the blanks" against the real DB, the real Strapi and the real model.
//
// The property that has to hold is narrow and easy to break: it fills blanks and NEVER touches a
// field a human typed. So this creates a draft with a body, some fields deliberately filled and the
// rest deliberately empty, runs the real route logic, and asserts field by field.
//
//   npx tsx scripts/autofill_probe.mjs
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const { supabaseAdmin } = await import("../src/lib/db/supabase.ts");
const { getBlogDraft, listWriterVoices } = await import("../src/lib/db/queries.ts");
const { planAutofill } = await import("../src/lib/blog/autofill.ts");
const { loadStrapiOptions } = await import("../src/lib/blog/autofillOptions.ts");
const { generateMeta } = await import("../src/lib/writer/meta.ts");
const { applyDraftPatch } = await import("../src/lib/blog/save.ts");
const { writerEnabled } = await import("../src/lib/writer/anthropic.ts");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

// A body long enough for generateMeta to have something real to read.
const BODY = `# Placeholder H1

AI video generators turn a text prompt into moving footage. This draft exists only to exercise the
autofill path, but it is long enough to be summarised, which is the point.

## How the pipeline works

A diffusion model predicts frames, a temporal layer keeps them coherent, and an upscaler finishes
the job. The interesting constraint is memory: every extra second of output multiplies the frames
being denoised at once, which is why most consumer tools cap clips at a handful of seconds.

## What people actually use it for

Short social cuts, product loops, and storyboard previews. Long-form remains hard because motion
consistency degrades across shot boundaries.

## Frequently asked questions about AI video generators

### How long can a generated clip be?

Most tools cap out between four and ten seconds per generation.
`.repeat(2);

const HUMAN_TITLE = "A title a human typed and does not want overwritten";
const HUMAN_TAGS = "my-own-tag";

console.log("creating a probe draft…");
const { data: created, error: createErr } = await supabaseAdmin
  .from("blog_drafts")
  .insert({
    title: HUMAN_TITLE,
    slug: `autofill-probe-${Math.random().toString(16).slice(2, 10)}`,
    body: BODY,
    description: "",                     // blank on purpose: autofill should write this
    tags: HUMAN_TAGS,                    // filled on purpose: autofill must not touch it
    cover_media_id: 999_001,             // so thumbnail-from-cover has something to copy
    cover_media_url: "https://example.invalid/cover.png",
  })
  .select()
  .single();
if (createErr) { console.error("could not create the probe draft:", createErr.message); process.exit(1); }
console.log(`draft ${created.id}\n`);

try {
  const draft = await getBlogDraft(created.id);
  const voice = (await listWriterVoices()).find((v) => v.is_default) ?? null;
  ok("a default voice exists", !!voice);

  let meta = null;
  if (writerEnabled() && voice) {
    console.log("generating metadata from the body (real model call)…");
    const r = await generateMeta(draft.body, voice, {});
    meta = r.meta;
    ok("generateMeta returned metadata", !!meta, r.problems.join("; "));
    if (r.problems.length) console.log(`    note: ${r.problems.join("; ")}`);
  } else {
    console.log("! ANTHROPIC_API_KEY not set — testing the no-model path only");
  }

  const { options, notes } = await loadStrapiOptions();
  ok("read authors and categories from Strapi", !!options, notes.join("; "));
  if (options) {
    console.log(`    ${options.authors.length} authors, ${options.categories.length} categories in Strapi`);
  }

  const plan = planAutofill({
    draft,
    meta,
    voice: voice ? { default_cta_text: voice.default_cta_text, default_cta_url: voice.default_cta_url } : null,
    strapi: options,
    topic: "ai video generator",
  });

  console.log("\nplan:");
  for (const f of plan.filled) console.log(`  + ${f.field} — ${f.source}${f.note ? ` (${f.note})` : ""}`);
  for (const s of plan.skipped) console.log(`  · ${s.field} left alone — ${s.why}`);
  console.log();

  // The invariant.
  ok("did not touch the human-typed title", !("title" in plan.patch),
    `patch.title = ${JSON.stringify(plan.patch.title)}`);
  ok("did not touch the human-typed tags", !("tags" in plan.patch),
    `patch.tags = ${JSON.stringify(plan.patch.tags)}`);
  ok("copied the cover to the thumbnail", plan.patch.thumbnail_media_id === 999_001);
  ok("never set canonical_tag", !("canonical_tag" in plan.patch));
  ok("left the NOT NULL booleans alone",
    !("is_featured" in plan.patch) && !("should_index" in plan.patch));
  if (meta) {
    ok("wrote a description", typeof plan.patch.description === "string" && plan.patch.description.length >= 120,
      `${(plan.patch.description ?? "").length} chars`);
    ok("wrote SEO fields", !!plan.patch.seo_title && !!plan.patch.seo_description);
  }

  // Apply it for real, through the save engine, and confirm the row + the revision.
  const saved = await applyDraftPatch(created.id, plan.patch, { reason: "autofill", editedBy: "probe" });
  ok("applyDraftPatch succeeded", !!saved?.ok, saved?.error);
  const after = await getBlogDraft(created.id);
  ok("the saved row kept the human title", after.title === HUMAN_TITLE, after.title);
  ok("the saved row kept the human tags", after.tags === HUMAN_TAGS, after.tags);
  ok("the saved row gained a thumbnail", after.thumbnail_media_id === 999_001);
  ok("rev advanced", after.rev > draft.rev, `${draft.rev} → ${after.rev}`);

  const { data: revs } = await supabaseAdmin
    .from("blog_draft_revisions").select("reason").eq("draft_id", created.id);
  ok("a revision was snapshotted so this is undoable",
    (revs ?? []).some((r) => r.reason === "autofill"),
    JSON.stringify(revs));

  // Idempotence against the real row: a second run must find nothing left to do.
  const again = planAutofill({
    draft: after, meta, strapi: options,
    voice: voice ? { default_cta_text: voice.default_cta_text, default_cta_url: voice.default_cta_url } : null,
    topic: "ai video generator",
  });
  const second = Object.keys(again.patch).filter((k) => k !== "slug");
  ok("a second run has nothing left to fill", second.length === 0, second.join(","));
} finally {
  const { error: delErr } = await supabaseAdmin.from("blog_drafts").delete().eq("id", created.id);
  console.log(delErr ? `\n! cleanup failed: ${delErr.message}` : "\ncleaned up the probe draft");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
