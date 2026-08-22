// enrich.so must be INERT with no key: a missing provider is normal, and it must never break the cascade.
import * as dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.local"), quiet: true });

const m = await import("../../src/lib/enrich/enrichso.ts");
const hasKey = !!process.env.ENRICHSO_API_KEY?.trim();
console.log(`key present: ${hasKey}`);
console.log(`  enrichSoEnabled():        ${m.enrichSoEnabled()}   (expected ${hasKey})`);
console.log(`  lookup, 2-part name:      ${JSON.stringify(await m.findEmailEnrichSo("Jane Doe", "figma.com"))}`);
console.log(`  lookup, single name:      ${JSON.stringify(await m.findEmailEnrichSo("Cher", "figma.com"))}   (expected null — no surname to disambiguate)`);
console.log(`  credits:                  ${JSON.stringify(await m.enrichSoCredits())}`);
