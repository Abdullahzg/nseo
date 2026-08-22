// Probe: ONE real render end-to-end. Billable — it calls fal and uploads to Strapi. Creates a throwaway
// draft and prints the draft id so it can be deleted afterwards.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
import * as dotenv from "dotenv";
dotenv.config({ path: resolve(__dirname, "../../.env.local"), quiet: true });
const { createBlogDraft, getBlogDraft } = await import("../../src/lib/db/queries.ts");
const { prefillAssets } = await import("../../src/lib/media/prefill.ts");

const draft = await createBlogDraft({
  slug: `prefill-probe-${Date.now().toString(36)}`,
  title: "AI Video Upscaler", description: "", body: "", status: "draft",
  created_by: "probe@local", last_edited_by: "probe@local",
} as any);
console.log("draft:", draft.id);

const t0 = Date.now();
const r = await prefillAssets({
  draftId: draft.id, title: "AI Video Upscaler", keyword: "ai video upscaler",
  kind: "blog", actor: "probe@local",
});
console.log(`\nplanned=${r.planned} generated=${r.generated} failed=${r.failed} in ${((Date.now()-t0)/1000).toFixed(0)}s`);
console.log("thumbnailMediaId:", r.thumbnailMediaId);
for (const n of r.notes) console.log("  note:", n);

const after = await getBlogDraft(draft.id);
console.log("\n── the publishing blocker ──");
console.log("thumbnail_media_id on draft:", (after as any)?.thumbnail_media_id ?? null);
console.log("thumbnail_media_url:", ((after as any)?.thumbnail_media_url ?? "").slice(0, 80));
const { publishReadiness } = await import("../../src/lib/strapi/mapDraft.ts");
console.log("publishReadiness blockers:", publishReadiness(after as any));
console.log("\nDRAFT_ID=" + draft.id);
