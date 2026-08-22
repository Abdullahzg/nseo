// Probe: does the landing-page template catalogue resolve against the live Strapi?
//
// Kept as a script rather than a one-off because the catalogue is read from ANOTHER team's repos (the
// vibe-coded-template skill ships components in imagine-blogs-backend). When a picker suddenly shows
// fewer templates, this is the fastest way to tell "Strapi changed" from "our code broke".
import * as dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.local"), quiet: true });

const { getTemplateCatalogue, humanizeSection } = await import("../../src/lib/landing/templates.ts");

const c = await getTemplateCatalogue();
if (c.error) { console.log("ERROR:", c.error); process.exit(1); }

console.log(`templates: ${c.templates.length}`);
console.log(`categories: ${c.categories.join(", ")}`);
console.log(`vibe-coded: ${c.templates.filter((t) => t.vibeCoded).map((t) => t.label).join(", ") || "(none)"}`);
console.log();
for (const t of c.templates.slice(0, 5)) {
  console.log(`${t.label.padEnd(28)} ${String(t.sections.length).padStart(2)} sections`);
  console.log(`   ${t.sections.slice(0, 6).map(humanizeSection).join(" · ")}`);
}
const unresolved = c.templates.filter((t) => t.label === t.component);
console.log(`\nunresolved labels: ${unresolved.length}${unresolved.length ? ` — ${unresolved.map((u) => u.component).join(", ")}` : ""}`);
