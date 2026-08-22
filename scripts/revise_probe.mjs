// Shorten and rewrite, against the real model, on real draft prose.
//
// The two things that can silently go wrong here are not compile errors: the model returning a
// preamble ("Here's the shortened version:") instead of just the replacement, and it dropping the
// links or the markdown structure. Both would land straight in the user's body text. So assert on
// real output rather than trusting the prompt.
//
//   npx tsx scripts/revise_probe.mjs
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const { supabaseAdmin } = await import("../src/lib/db/supabase.ts");
const { listWriterVoices } = await import("../src/lib/db/queries.ts");
const { reviseText, defaultShortenTarget, wordsIn } = await import("../src/lib/writer/revise.ts");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const voice = (await listWriterVoices()).find((v) => v.is_default) ?? null;
ok("a default voice exists", !!voice);

// Real prose from a real draft, so this exercises what the button will actually be pointed at.
const { data: drafts } = await supabaseAdmin
  .from("blog_drafts").select("title, body").not("body", "eq", "").limit(1);
if (!drafts?.length) { console.log("no draft with a body to test against"); process.exit(0); }

// Take one section: find an H2 and the prose under it.
const body = String(drafts[0].body);
const sections = body.split(/\n(?=## )/);
const section = sections.find((s) => wordsIn(s) > 120 && /\[.+\]\(https?:/.test(s)) ?? sections[1] ?? sections[0];
const words = wordsIn(section);
const linksBefore = [...section.matchAll(/\]\((https?:[^)\s]+)/g)].map((m) => m[1]);

console.log(`\nsource: "${drafts[0].title}"`);
console.log(`section: ${words} words, ${linksBefore.length} link(s), starts "${section.slice(0, 60).replace(/\n/g, " ")}…"\n`);

// ── shorten ──
const target = defaultShortenTarget(words);
console.log(`shortening ${words} → ~${target} words…`);
const short = await reviseText({ mode: "shorten", text: section, target_words: target, voice });
ok("shorten succeeded", short.ok, short.error);
if (short.ok) {
  const got = short.words_after;
  console.log(`    got ${got} words`);
  ok("shorten actually shortened", got < words, `${words} → ${got}`);
  ok("shorten landed within 25% of the target", Math.abs(got - target) / target <= 0.25,
    `target ${target}, got ${got}`);
  ok("shorten returned no preamble",
    !/^(here'?s|sure|certainly|i'?ve|below is|shortened)/i.test(short.text.trim()),
    short.text.slice(0, 70));
  ok("shorten returned no code fence", !short.text.trim().startsWith("```"));
  ok("shorten kept the heading shape",
    section.startsWith("## ") ? short.text.trim().startsWith("## ") : true,
    short.text.slice(0, 40));
  const linksAfter = [...short.text.matchAll(/\]\((https?:[^)\s]+)/g)].map((m) => m[1]);
  ok("shorten invented no new links", linksAfter.every((l) => linksBefore.includes(l)),
    linksAfter.filter((l) => !linksBefore.includes(l)).join(", "));
  ok("shorten introduced no em dash", !/[—–]/.test(short.text.replace(/\d[—–]\d/g, "")));
  ok("shorten reports token usage", !!short.usage?.output_tokens);
}

// ── rewrite ──
const para = section.split("\n\n").find((p) => wordsIn(p) > 25 && !p.startsWith("#")) ?? section;
console.log(`\nrewriting one ${wordsIn(para)}-word paragraph…`);
const rew = await reviseText({
  mode: "rewrite", text: para, voice,
  instruction: "Make the first sentence more concrete and cut any hedging.",
});
ok("rewrite succeeded", rew.ok, rew.error);
if (rew.ok) {
  console.log(`    ${rew.words_before} → ${rew.words_after} words`);
  ok("rewrite changed the text", rew.text.trim() !== para.trim());
  ok("rewrite stayed near the original length",
    Math.abs(rew.words_after - rew.words_before) / rew.words_before < 0.5,
    `${rew.words_before} → ${rew.words_after}`);
  ok("rewrite returned no preamble",
    !/^(here'?s|sure|certainly|i'?ve|below is)/i.test(rew.text.trim()), rew.text.slice(0, 70));
  ok("rewrite introduced no em dash", !/[—–]/.test(rew.text.replace(/\d[—–]\d/g, "")));
}

// ── guard rails ──
const empty = await reviseText({ mode: "shorten", text: "   ", voice });
ok("empty selection is refused", !empty.ok && /nothing/i.test(empty.error ?? ""));
const tooBig = await reviseText({ mode: "shorten", text: "one two three", target_words: 99, voice });
ok("a target above the current length is refused", !tooBig.ok, tooBig.error);
const noInstr = await reviseText({ mode: "rewrite", text: "some real words here", instruction: "  ", voice });
ok("rewrite with no instruction is refused", !noInstr.ok && /say what/i.test(noInstr.error ?? ""));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
