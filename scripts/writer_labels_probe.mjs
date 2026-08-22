// Renders the writer's step labels for every tool call in the most recent real session.
//
// This is the thing the user actually complained about ("it sucks in terms of giving feedback on
// what is done"), and it is not something tsc can check: a label can compile fine and still be
// empty, or still say "submit_section". So run the real describer over real persisted blocks and
// print what a person would see.
//
//   npx tsx scripts/writer_labels_probe.mjs
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
// Dynamic imports, matching the other probes: a static `.ts` import from an .mjs entrypoint is
// resolved by Node's own loader before tsx's transform hooks see it, and the named exports come
// back empty.
const { describeToolCall } = await import("../src/lib/writer/steps.ts");
const { stripDirectives } = await import("../src/lib/writer/prompt.ts");

const { supabaseAdmin } = await import("../src/lib/db/supabase.ts");

const { data: recent } = await supabaseAdmin
  .from("writer_messages").select("session_id").order("created_at", { ascending: false }).limit(1);
if (!recent?.length) { console.log("no writer messages yet"); process.exit(0); }
const { data: s } = await supabaseAdmin
  .from("writer_sessions").select("id, phase, outline, brief").eq("id", recent[0].session_id).single();
const outlineSections = s.outline?.sections ?? [];
console.log(`session ${s.id}  phase=${s.phase}  keyword=${s.brief?.primary_keyword ?? "-"}\n`);

const { data: msgs } = await supabaseAdmin
  .from("writer_messages").select("role, blocks").eq("session_id", s.id).order("seq");

// Pair results to calls by id, exactly as the route's projection does.
const failures = new Map();
for (const m of msgs) for (const b of m.blocks ?? []) {
  if (b?.type === "tool_result" && b.is_error) {
    const t = Array.isArray(b.content) ? b.content.map((x) => x.text ?? "").join("") : String(b.content ?? "");
    failures.set(String(b.tool_use_id), t);
  }
}

let steps = 0, unlabelled = 0, rawNames = 0, directiveLeaks = 0;
for (const m of msgs) {
  for (const b of m.blocks ?? []) {
    if (b?.type === "text") {
      const text = m.role === "user" ? stripDirectives(String(b.text ?? "")) : String(b.text ?? "");
      if (!text.trim()) continue;
      if (/<(phase|section_assignment|cluster|repair_request)>/.test(text)) {
        directiveLeaks++;
        console.log(`  ✗ DIRECTIVE LEAK in ${m.role} text: ${text.slice(0, 90)}`);
      }
      continue;
    }
    if (b?.type !== "tool_use") continue;
    steps++;
    const { label, detail } = describeToolCall(b.name, b.input ?? {}, outlineSections);
    const err = failures.get(String(b.id));
    if (!label || !label.trim()) { unlabelled++; console.log(`  ✗ NO LABEL for ${b.name}`); continue; }
    if (label === b.name) { rawNames++; console.log(`  ✗ RAW TOOL NAME shown to user: ${label}`); continue; }
    const mark = err ? "!" : "✓";
    console.log(`  ${mark} ${label}${detail ? `  ${String(detail).slice(0, 70)}` : ""}${err ? `   [failed] ${err.slice(0, 50)}` : ""}`);
  }
}

console.log(`\n${steps} steps rendered · ${unlabelled} unlabelled · ${rawNames} raw tool names · ${directiveLeaks} directive leaks`);
process.exit(unlabelled + rawNames + directiveLeaks === 0 ? 0 : 1);
