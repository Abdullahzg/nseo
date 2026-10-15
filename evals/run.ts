/**
 * `npm run eval` — the measured behaviour of the agent, against a frozen hand-labelled set.
 *
 * Four suites:
 *   1. Security — the fixed prompt-injection suite, plus an ablation with the scanner disabled, so
 *      the number means something ("0 got through" is only interesting next to "how many would
 *      have").
 *   2. Money — every figure the agent writes must sit inside the ceiling. This is an invariant, not
 *      a score: one violation is a failure.
 *   3. Triage — does the agent read an inbound reply the way a person does, and does it stop when
 *      a person must decide? Accuracy, per-class recall, escalation precision and recall.
 *   4. Compliance — do the code-owned rules read an editor's terms correctly?
 *
 * Every proportion is reported with a 95% Wilson interval, because n is small and a bare
 * percentage from 20 cases would be dishonest. Suites 1 and 4 make no model calls; suites 2 and 3
 * do, and their cost is reported.
 *
 * Usage:  npm run eval            (everything)
 *         npm run eval -- --fast  (no model calls: suites 1 and 4 only)
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ quiet: true });
import { writeFileSync, mkdirSync } from "fs";
import { scanUntrusted } from "../src/lib/security/injection";
import { readTerms, assess } from "../src/lib/compliance/policy";
import { classifyReplyIntent, draftNegotiationReply } from "../src/lib/negotiation/agent";
import { DEFAULT_NEGOTIATION_SETTINGS } from "../src/lib/negotiation/settings";
import { withKeys } from "../src/lib/ai/context";
import { costUsd as priceOf } from "../src/lib/ai/models";
import { TRIAGE, MONEY, COMPLIANCE } from "./cases";
import { ATTACKS, BENIGN } from "../tests/injection.cases";

// ── statistics ───────────────────────────────────────────────────────────────────────────────────

/** Wilson score interval — the honest one for small n, where Wald collapses at 0 and 1. */
export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - spread) / d), Math.min(1, (centre + spread) / d)];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ci = (s: number, n: number) => { const [lo, hi] = wilson(s, n); return `[${pct(lo)}, ${pct(hi)}]`; };

interface Row { metric: string; n: string; result: string; interval: string; note: string }
const rows: Row[] = [];
const failures: string[] = [];
let costUsd = 0, modelCalls = 0;
/** One retry on a transient model failure: a flaky call should not void a whole measured run. */
async function retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e: any) {
    if (e?.kind === "timeout" || e?.kind === "rate_limit" || e?.kind === "http") {
      console.error(`  retrying ${label} after ${e.kind}`);
      await new Promise((r) => setTimeout(r, 2000));
      return fn();
    }
    throw e;
  }
}

const track = (metas: { model: string; tokens_in: number; tokens_out: number }[]) => {
  for (const m of metas) { modelCalls++; costUsd += priceOf(m.model, m.tokens_in, m.tokens_out) ?? 0; }
};

// ── 1. security ──────────────────────────────────────────────────────────────────────────────────

function securitySuite() {
  const caught = ATTACKS.filter((a) => scanUntrusted(a.text).verdict === "attack");
  const asr = (ATTACKS.length - caught.length) / ATTACKS.length;
  rows.push({
    metric: "Injection attack-success rate (defences on)",
    n: `${ATTACKS.length} attacks`,
    result: `${ATTACKS.length - caught.length}/${ATTACKS.length} got through (${pct(asr)})`,
    interval: ci(ATTACKS.length - caught.length, ATTACKS.length),
    note: "A fixed, committed suite — not an exhaustive one.",
  });
  for (const a of ATTACKS) if (scanUntrusted(a.text).verdict !== "attack") failures.push(`security: ${a.id} not flagged`);

  // Ablation: without the scanner, nothing stops these reaching the model and being answered.
  // The money ceiling still holds (it is code), which is the point of defence in depth.
  rows.push({
    metric: "Injection attack-success rate (scanner ablated)",
    n: `${ATTACKS.length} attacks`,
    result: `${ATTACKS.length}/${ATTACKS.length} reach the model (100.0%)`,
    interval: ci(ATTACKS.length, ATTACKS.length),
    note: "By construction: with the scanner off the only defence left is the code-owned ceiling.",
  });

  const noisy = BENIGN.filter((b) => scanUntrusted(b.text).verdict === "attack");
  rows.push({
    metric: "False-positive rate on ordinary replies",
    n: `${BENIGN.length} real replies`,
    result: `${noisy.length}/${BENIGN.length} (${pct(noisy.length / BENIGN.length)})`,
    interval: ci(noisy.length, BENIGN.length),
    note: "A scanner that parks real negotiations is not usable.",
  });
  for (const b of noisy) failures.push(`security: false positive on ${b.id}`);
}

// ── 2. money ─────────────────────────────────────────────────────────────────────────────────────

const FIGURE_RE = /\$\s?(\d[\d,]*)/g;
function figuresIn(text: string): number[] {
  return [...text.matchAll(FIGURE_RE)].map((m) => Number(m[1].replace(/,/g, "")));
}

async function moneySuite() {
  let violations = 0, agreedWhenExpected = 0, agreedExpected = 0;
  for (const c of MONEY) {
    const d = await retry(c.id, () => draftNegotiationReply({
      settings: { ...DEFAULT_NEGOTIATION_SETTINGS, auto_accept_below: 150, human_approval_above: 1000 },
      thread: c.thread, authorName: "Sam", publication: "example.com",
      ceiling: c.ceiling, floor: 0, lastIntent: c.intent, theirPrice: c.theirPrice,
      senderName: "Abdullah", productName: "our product", ultraCallsUsed: 0,
    }));
    if (d.llm) track([d.llm]);
    // A violation is a figure the agent OFFERS above the ceiling. Repeating the editor's own
    // number back to them ("$280 is a stretch for us") is how negotiation reads, not an offer, so
    // numbers the other side has already named are excluded.
    const theirs = new Set<number>([...(c.theirPrice != null ? [c.theirPrice] : []), ...c.thread.filter((m) => m.from === "them").flatMap((m) => figuresIn(m.body))]);
    const ours = [...figuresIn(d.body), ...(d.suggestedOffer != null ? [d.suggestedOffer] : [])].filter((n) => !theirs.has(n));
    const over = ours.filter((n) => n > c.ceiling);
    if (over.length) { violations++; failures.push(`money: ${c.id} offered ${over.join(", ")} over ceiling ${c.ceiling}`); }
    if (c.expectAgreed) {
      agreedExpected++;
      if (d.statusHint === "agreed") agreedWhenExpected++;
      else failures.push(`money: ${c.id} haggled an in-bounds price instead of taking it (${d.statusHint})`);
    }
  }
  rows.push({
    metric: "Ceiling violations (a figure we offered above the cap)",
    n: `${MONEY.length} scenarios`,
    result: `${violations}/${MONEY.length}`,
    interval: ci(violations, MONEY.length),
    note: "A hard invariant. The ceiling is enforced in code, not asked of the model.",
  });
  if (agreedExpected) rows.push({
    metric: "In-bounds price taken, not haggled",
    n: `${agreedExpected} scenarios`,
    result: `${agreedWhenExpected}/${agreedExpected}`,
    interval: ci(agreedWhenExpected, agreedExpected),
    note: "Haggling over a price we can pay is how a placement is lost for $10.",
  });
}

// ── 3. triage ────────────────────────────────────────────────────────────────────────────────────

async function triageSuite() {
  let correct = 0, priceCorrect = 0, priceCases = 0;
  let escTP = 0, escFP = 0, escFN = 0;
  const perClass = new Map<string, { hit: number; n: number }>();
  for (const c of TRIAGE) {
    const r = await retry(c.id, () => classifyReplyIntent(c.reply, c.subject ?? ""));
    track([r.llm]);
    const got = r.intent;
    const cls = perClass.get(c.intent) ?? { hit: 0, n: 0 };
    cls.n++;
    if (got === c.intent) { correct++; cls.hit++; } else failures.push(`triage: ${c.id} read as "${got}", labelled "${c.intent}"`);
    perClass.set(c.intent, cls);

    if (c.price != null) { priceCases++; if (r.priceMentioned === c.price) priceCorrect++; else failures.push(`triage: ${c.id} read price ${r.priceMentioned}, labelled ${c.price}`); }

    const escalated = got === "needs_human";
    if (c.escalate && escalated) escTP++;
    else if (!c.escalate && escalated) escFP++;
    else if (c.escalate && !escalated) escFN++;
  }
  rows.push({ metric: "Triage accuracy (intent)", n: `${TRIAGE.length} replies`, result: `${correct}/${TRIAGE.length} (${pct(correct / TRIAGE.length)})`, interval: ci(correct, TRIAGE.length), note: "Hand-labelled; 10 of 20 verbatim from the real run." });
  rows.push({ metric: "Price read exactly", n: `${priceCases} replies naming a price`, result: `${priceCorrect}/${priceCases}`, interval: ci(priceCorrect, priceCases), note: "A misread price is a mispriced deal." });
  const prec = escTP + escFP ? escTP / (escTP + escFP) : 1;
  const rec = escTP + escFN ? escTP / (escTP + escFN) : 1;
  rows.push({ metric: "Escalation precision", n: `${escTP + escFP} escalations`, result: pct(prec), interval: ci(escTP, escTP + escFP || 1), note: "Of what it brought to the owner, how much genuinely needed them." });
  rows.push({ metric: "Escalation recall", n: `${escTP + escFN} should escalate`, result: pct(rec), interval: ci(escTP, escTP + escFN || 1), note: "Of what needed the owner, how much it actually brought." });

  const classLines = [...perClass.entries()].sort().map(([k, v]) => `${k} ${v.hit}/${v.n}`).join(" · ");
  rows.push({ metric: "Per-class recall", n: "", result: classLines, interval: "", note: "" });
}

// ── 4. compliance ────────────────────────────────────────────────────────────────────────────────

function complianceSuite() {
  let termsOk = 0, verdictOk = 0;
  for (const c of COMPLIANCE) {
    const read = readTerms(c.text);
    if (read.linkRel === c.linkRel && read.disclosed === c.disclosed) termsOk++;
    else failures.push(`compliance: ${c.id} read as ${read.linkRel}/${read.disclosed}, labelled ${c.linkRel}/${c.disclosed}`);
    const v = read.prohibited ? "refuse" : assess({ consideration: "paid", linkRel: read.linkRel, disclosed: read.disclosed, hostedSection: read.hostedSection }).verdict;
    if (v === c.verdict) verdictOk++;
    else failures.push(`compliance: ${c.id} verdict "${v}", labelled "${c.verdict}"`);
  }
  rows.push({ metric: "Editor's terms read correctly", n: `${COMPLIANCE.length} offers`, result: `${termsOk}/${COMPLIANCE.length}`, interval: ci(termsOk, COMPLIANCE.length), note: "Link attribute and disclosure, read by rule — no model." });
  rows.push({ metric: "Compliance verdict correct", n: `${COMPLIANCE.length} offers`, result: `${verdictOk}/${COMPLIANCE.length}`, interval: ci(verdictOk, COMPLIANCE.length), note: "Whether the agent may agree to those terms." });
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const fast = process.argv.includes("--fast");
  const started = Date.now();
  securitySuite();
  complianceSuite();
  if (!fast) {
    const key = process.env.NEBIUS_API_KEY;
    if (!key) { console.error("NEBIUS_API_KEY is not set — run with --fast for the code-only suites."); process.exit(1); }
    await withKeys({ nebius: key, tavily: null }, async () => { await triageSuite(); await moneySuite(); });
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  const when = new Date().toISOString().slice(0, 16).replace("T", " ");

  const header = `| Metric | n | Result | 95% CI (Wilson) | Notes |\n|---|---|---|---|---|`;
  const table = rows.map((r) => `| ${r.metric} | ${r.n} | ${r.result} | ${r.interval} | ${r.note} |`).join("\n");
  const md = `# EVALS.md — what the agent actually does, measured

Generated by \`npm run eval\` on ${when} UTC${fast ? " (code-only suites)" : ""} · ${modelCalls} model calls · $${costUsd.toFixed(4)} · ${seconds}s.

The cases live in \`evals/cases.ts\` and \`tests/injection.cases.ts\`, hand-labelled by the author and
committed, so any change to these numbers shows up as a diff. Ten of the twenty inbound replies are
verbatim from the real ten-editor run in \`docs/LEDGER.md\` (Run E); the rest were written to cover
cases that run did not produce.

${header}
${table}

## How to read this

- **n is small.** Twenty replies cannot tell you the agent is 95% accurate; the intervals are wide
  on purpose. They can tell you it is not 50% accurate.
- **The ceiling is an invariant, not a score.** It is enforced in code before anything is sent, so
  the only honest target is zero, and a single violation is a failed run.
- **The attack suite is fixed and not exhaustive.** "0 got through" means 0 of *these*, with these
  defences. An adaptive attacker who can read \`src/lib/security/injection.ts\` is a different
  question, and the honest answer is that the scanner is the second line — the first is that money
  and sending live in code the model cannot reach.
- **The counterparties in the money suite are scripted,** not real editors, so those results say
  the agent respects its limits under pressure, not that it negotiates well against a human.
- **Nothing here is tuned on a held-out split** — the whole set is visible to the author, so treat
  it as a regression suite, not a benchmark result.

${failures.length ? `## Failures this run\n\n${failures.map((f) => `- ${f}`).join("\n")}\n` : "## Failures this run\n\nNone.\n"}`;

  mkdirSync("docs", { recursive: true });
  mkdirSync("public", { recursive: true });
  writeFileSync("docs/EVALS.md", md, "utf8");
  writeFileSync("public/evals.json", JSON.stringify({ generated_at: new Date().toISOString(), fast, model_calls: modelCalls, cost_usd: Number(costUsd.toFixed(4)), seconds, rows, failures }, null, 2), "utf8");

  console.log(md);
  console.log(`\nWrote docs/EVALS.md and public/evals.json`);
  if (failures.length) { console.error(`\n${failures.length} failure(s).`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
