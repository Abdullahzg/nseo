// The pure parts of scheduling: slot matching and inert-without-credential behaviour.
import * as dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.local"), quiet: true });

const s = await import("../../src/lib/calendar/schedule.ts");
const g = await import("../../src/lib/calendar/google.ts");

console.log("calendarEnabled():", g.calendarEnabled(), "(GSC_SA_JSON is set, so delegation may still be missing)");
const offer = await s.buildSchedulingOffer({ mailbox: "raamiz.niazi@imagine.art" });
console.log("offer.ok:", offer.ok, "| reason:", offer.reason ?? "(offered)");

console.log("\n── which interventions this handles ──");
for (const t of ["scheduling", "sync_contact", "asset_request", "legal_contract", null]) {
  console.log(`  ${String(t).padEnd(16)} ${s.isSchedulingIntervention(t as string)}`);
}

console.log("\n── slot matching (never free-text date parsing) ──");
const offered = [
  { start: "2026-08-04T10:00:00.000Z", end: "2026-08-04T10:30:00.000Z" }, // Tuesday
  { start: "2026-08-06T14:00:00.000Z", end: "2026-08-06T14:30:00.000Z" }, // Thursday
];
for (const [reply, expect] of [
  ["Tuesday at 10 works for me", "Tue"],
  ["thursday the 6th please", "Thu"],
  ["Thursday 14:00 is good", "Thu"],
  ["how about next week sometime?", "no match"],
  ["Monday would be better", "no match"],
] as const) {
  const m = s.matchOfferedSlot(reply, offered, "UTC");
  const got = m ? new Date(m.start).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }) : "no match";
  console.log(`  ${got === expect ? "ok  " : "FAIL"} "${reply}" -> ${got} (want ${expect})`);
}
