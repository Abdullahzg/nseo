// Probe: validate the configure path WITHOUT writing to Strapi.
//
// STRAPI_URL points at production (imagine-blog.vyro.ai), so a happy-path test would create a real
// cluster-page entry in the live CMS. validateChoice() is deliberately separate from the write for exactly
// this reason: every failure mode can be exercised without side effects.
import * as dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.local"), quiet: true });

const { validateChoice, skillHandoff } = await import("../../src/lib/landing/configure.ts");

const cases: Array<[string, any, boolean]> = [
  ["a real template + real category",      { template: "templates.template-1", category: "feature", slug: "ai-video-upscaler" }, true],
  ["the vibe-coded reference template",    { template: "vibe-coded-templates.ai-ad-studio-template", category: "ai-ad-studio", slug: "ai-ad-studio-x" }, true],
  ["template that does not exist",         { template: "templates.template-99", category: "feature", slug: "x" }, false],
  ["category not in the enum",             { template: "templates.template-1", category: "not-a-category", slug: "x" }, false],
  ["empty slug",                           { template: "templates.template-1", category: "feature", slug: "  " }, false],
  ["mismatched template/category (warns)", { template: "vibe-coded-templates.ai-ad-studio-template", category: "feature", slug: "y" }, true],
];

let pass = 0, fail = 0;
for (const [label, input, shouldPass] of cases) {
  const r: any = await validateChoice(input);
  const ok = r.ok === shouldPass;
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label.padEnd(40)} ok=${r.ok}`);
  if (r.ok && r.warnings?.length) console.log(`         warn: ${r.warnings[0].slice(0, 110)}`);
  if (!r.ok) console.log(`         err : ${String(r.error).slice(0, 110)}`);
}
console.log(`\n${pass} passed, ${fail} failed`);

console.log("\n── skillHandoff for a vibe-coded page ──");
console.log(skillHandoff({ feature: "AI Ad Studio", primary_keyword: "ai ad generator", target_path: "/ai-ad-studio", brief: { audience: "marketers" } }).split("\n").slice(0, 14).join("\n"));
