// Probe: what the create-time prefill WOULD generate, and whether the prompts obey the forge rules.
// render:false so it costs nothing — planning is pure, rendering is billable.
import * as dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.local"), quiet: true });

const { prefillAssets } = await import("../../src/lib/media/prefill.ts");
const { planAssets } = await import("../../src/lib/media/plan.ts");
const { buildImagePrompt } = await import("../../src/lib/media/prompt.ts");
const { modelForRole, modelForPrefill } = await import("../../src/lib/media/fal.ts");

for (const kind of ["blog", "landing"] as const) {
  const r = await prefillAssets({ title: "AI Video Upscaler", keyword: "ai video upscaler", kind, render: false });
  console.log(`${kind.padEnd(8)} planned=${r.planned}  ${r.notes.join(" | ")}`);
}

console.log("\n── sizes match the OG/LCP specs ──");
const { assets } = planAssets({ title: "AI Video Upscaler", keyword: "ai video upscaler", words: 1800,
  headings: [{ heading: "How it works", index: 1 }, { heading: "Introduction", index: 0 }] as any, kind: "blog" });
const EXPECT: Record<string, string> = { og: "1200x630", hero: "1600x900", thumbnail: "1200x630", inline: "1200x675" };
for (const a of assets) {
  const got = `${a.width}x${a.height}`;
  const want = EXPECT[a.role];
  console.log(`  ${a.role.padEnd(10)} ${got.padEnd(10)} ${want && got === want ? "ok" : `EXPECTED ${want}`}  text=${a.allow_text}  priority=${a.priority}`);
}

console.log("\n── forge prompt rules for gpt-image-2 ──");
const hero = assets.find((a) => a.role === "hero")!;
// The prefill pins one family; the gallery keeps the per-role split. Both are checked.
const model = modelForPrefill("hero", false);
console.log("  gallery would use:", modelForRole("hero", false));
const prompt = buildImagePrompt(model, { asset: hero, topic: "ai video upscaler", title: "AI Video Upscaler", slot: 0, surface: "blog" } as any);
console.log("  model:", model);
// Negatives are honoured strongly by GPT Image 2 — a hero with no text needs an explicit negatives clause.
for (const [label, ok] of [
  ["names a negatives/avoid clause", /\b(no|avoid|without|never)\b/i.test(prompt)],
  ["forbids on-image text (hero is allow_text=false)", /\b(no text|without text|no lettering|no words|no typography)\b/i.test(prompt)],
  ["forbids internal vocabulary leaking as text", /(HOOK|CTA|STEP|variation|badge|watermark)/i.test(prompt)],
  ["no seed / negative_prompt param leaked into prose", !/negative_prompt|seed:/i.test(prompt)],
]) console.log(`  ${ok ? "ok  " : "MISS"} ${label}`);
console.log("\n  prompt head:", prompt.slice(0, 260).replace(/\s+/g, " "));
