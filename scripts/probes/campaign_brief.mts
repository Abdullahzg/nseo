// Probe: the campaign-path guards. Pure functions, no network — the destination check is deliberately
// NOT a fetch (imagine.art returns 200 for invented /computer/agent/* paths, so a status proves nothing).
import * as dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.local"), quiet: true });

const { validateCampaign, campaignHandoff, suggestRepoName } = await import("../../src/lib/landing/configure.ts");

const cases: Array<[string, any, boolean]> = [
  ["valid brief",              { reference_url: "https://www.wix.com/ai-website-builder", destination_url: "https://www.imagine.art/computer/agent/sheets", product_name: "Sheets" }, true],
  ["destination not imagine",  { reference_url: "https://www.wix.com/x", destination_url: "https://example.com/x", product_name: "Sheets" }, false],
  ["destination has ?query",   { reference_url: "https://www.wix.com/x", destination_url: "https://www.imagine.art/computer/agent/sheets?prompt=hi", product_name: "Sheets" }, true],
  ["reference is imagine.art", { reference_url: "https://www.imagine.art/ai-video", destination_url: "https://www.imagine.art/computer/agent/docs", product_name: "Docs" }, true],
  ["missing product name",     { reference_url: "https://www.wix.com/x", destination_url: "https://www.imagine.art/x", product_name: "" }, false],
  ["malformed reference",      { reference_url: "not a url", destination_url: "https://www.imagine.art/x", product_name: "Sheets" }, false],
];

let pass = 0, fail = 0;
for (const [label, input, shouldPass] of cases) {
  const r: any = validateCampaign(input);
  const ok = r.ok === shouldPass;
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label.padEnd(26)} ok=${r.ok}`);
  if (!r.ok) console.log(`         err : ${r.error}`);
  for (const w of r.warnings ?? []) console.log(`         warn: ${w.slice(0, 100)}`);
}
console.log(`\n${pass} passed, ${fail} failed`);

console.log("\n── repo name convention ──");
for (const p of [
  { product_name: "Sheets", reference_url: "https://rows.com/ai" },
  { product_name: "Motion Design", reference_url: "https://www.wix.com/ai-website-builder" },
]) console.log(`  ${p.product_name.padEnd(14)} + ${new URL(p.reference_url).hostname.padEnd(18)} -> ${suggestRepoName(p)}`);

const h = campaignHandoff({ feature: "AI Sheets", primary_keyword: "ai spreadsheet generator" },
  { reference_url: "https://rows.com/ai", destination_url: "https://www.imagine.art/computer/agent/sheets", product_name: "Sheets" });
console.log("\n── handoff: does it carry the safety rules? ──");
for (const must of ["Review badges", "no plan names", "TODO(marketing)", "returns HTTP 200", "#0f0f0f", "bare anchor"]) {
  console.log(`  ${h.includes(must) ? "ok  " : "MISS"} ${must}`);
}
