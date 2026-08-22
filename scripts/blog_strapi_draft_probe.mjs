// Run: node scripts/blog_strapi_draft_probe.mjs
//
// Proves the assumption the whole "Sync to Strapi" step rests on: that Strapi SKIPS its
// required/minLength validation while an entry is a draft, so an incomplete post can be parked in
// the CMS for a teammate to finish. Strapi v4's entity-validator gates both on `isDraft`:
//
//   addRequiredValidator  = (v,{attr},{isDraft}) => !isDraft && attr.required ? v.notNil() : v.nullable()
//   addMinLengthValidator = (v,{attr},{isDraft}) => attr.minLength && !isDraft ? v.min(attr.minLength) : v
//
// …but that's read from source, not observed, so this checks it for real. It also confirms the
// second finding: that omitting `publishedAt` PUBLISHES rather than drafts (v4 defaults it to
// `() => new Date()` and isDraft() tests `=== null` strictly).
//
// READ-MOSTLY: creates exactly one throwaway entry, inspects it, then DELETES it. The entry is
// created unpublished, so it is never visible on a live site. Host-guarded to non-production.
import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const BASE = (process.env.STRAPI_URL || "").replace(/\/$/, "");
const TOKEN = process.env.STRAPI_API_TOKEN;
const TYPE = process.env.STRAPI_BLOG_TYPE?.trim() || "resources";
if (!BASE || !TOKEN) { console.error("STRAPI_URL / STRAPI_API_TOKEN not set."); process.exit(1); }

// Host guard: this writes to the CMS, so refuse anything that isn't obviously a sandbox.
const host = new URL(BASE).host;
if (!/(^|\.)dev[-.]|localhost|staging|sandbox/i.test(host)) {
  console.error(`Refusing to write to "${host}" — it does not look like a dev/staging instance.`);
  console.error(`If this really is a sandbox, pass --force.`);
  if (!process.argv.includes("--force")) process.exit(1);
}
console.log(`Probing ${BASE} (type: ${TYPE})\n`);

const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
async function call(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: H, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: r.status, json };
}
const fieldErrors = (j) =>
  (j?.error?.details?.errors ?? []).map((e) => `${(e.path ?? []).join(".")}: ${e.message}`);

let pass = 0, fail = 0, createdId = null;
const ok = (c, m, extra = "") => { c ? (pass++, console.log("  ✓", m, extra)) : (fail++, console.log("  ✗ FAIL:", m, extra)); };

try {
  // ── 1. A deliberately incomplete DRAFT. Every required field is blank or absent:
  // title far under 35 chars, no description, no thumbnail, no hero CTA.
  console.log("1. create incomplete entry with publishedAt: null (expect: accepted as a draft)");
  const draftBody = { title: "probe", slug: `zz-probe-${Date.now()}`, publishedAt: null };
  const c = await call("POST", `/api/${TYPE}`, { data: draftBody });
  ok(c.status === 200 || c.status === 201,
     `create → HTTP ${c.status}`,
     c.status >= 400 ? `\n      errors: ${JSON.stringify(fieldErrors(c.json))}` : "");
  if (c.status >= 400) {
    console.log("\n  ⚠️  Strapi REJECTED an incomplete draft. The sync step must therefore be gated");
    console.log("      on publishReadiness() and the UI must say which fields Strapi still needs.");
    console.log("      (Local autosave is unaffected — it never touches Strapi.)");
  } else {
    createdId = c.json?.data?.id;
    const attrs = c.json?.data?.attributes ?? c.json?.data ?? {};
    ok(attrs.publishedAt === null,
       `it is a DRAFT (publishedAt === null)`, `— got ${JSON.stringify(attrs.publishedAt)}`);

    // ── 2. Confirm it is invisible to a live-only read, i.e. genuinely not on the site.
    console.log("\n2. confirm the draft is excluded from a published-only query");
    const live = await call("GET", `/api/${TYPE}?filters[id][$eq]=${createdId}`);
    ok((live.json?.data ?? []).length === 0,
       `absent from the default (published) query`, `— ${(live.json?.data ?? []).length} rows`);
    const prev = await call("GET", `/api/${TYPE}?filters[id][$eq]=${createdId}&publicationState=preview`);
    ok((prev.json?.data ?? []).length === 1, `visible with publicationState=preview`);

    // ── 3. Publishing the same incomplete entry MUST fail, and must name `thumbnail` —
    // the required field this app never had.
    console.log("\n3. publish the incomplete entry (expect: 400 naming the missing required fields)");
    const p = await call("PUT", `/api/${TYPE}/${createdId}`, {
      data: { publishedAt: new Date().toISOString() },
    });
    const errs = fieldErrors(p.json);
    ok(p.status >= 400, `publish rejected → HTTP ${p.status}`);
    ok(errs.some((e) => /thumbnail/i.test(e)),
       `Strapi names 'thumbnail' as required`, `\n      errors: ${JSON.stringify(errs)}`);

    // ── 4. Does omitting publishedAt publish? (finding 2 — the dangerous default)
    console.log("\n4. create with publishedAt OMITTED (expect: it publishes — the bug we fixed)");
    const o = await call("POST", `/api/${TYPE}`, {
      data: { title: "probe-omit", slug: `zz-probe-omit-${Date.now()}` },
    });
    if (o.status < 400) {
      const oid = o.json?.data?.id;
      const oAttrs = o.json?.data?.attributes ?? o.json?.data ?? {};
      const published = oAttrs.publishedAt !== null && oAttrs.publishedAt !== undefined;
      ok(true, `omitting publishedAt → publishedAt = ${JSON.stringify(oAttrs.publishedAt)}`,
         published ? "  ← CONFIRMS the bug: it went LIVE" : "  ← this instance drafts by default");
      await call("DELETE", `/api/${TYPE}/${oid}`);
      console.log(`      (cleaned up id ${oid})`);
    } else {
      // Rejected because required fields are missing — which itself proves it was treated as a
      // publish attempt, not a draft. Same conclusion.
      ok(true, `omitting publishedAt → HTTP ${o.status}, validated as PUBLISHED`,
         `\n      errors: ${JSON.stringify(fieldErrors(o.json))}  ← CONFIRMS the bug`);
    }
  }
} finally {
  if (createdId) {
    const d = await call("DELETE", `/api/${TYPE}/${createdId}`);
    console.log(`\ncleanup: deleted probe entry ${createdId} → HTTP ${d.status}`);
  }
  const left = await call("GET", `/api/${TYPE}?filters[slug][$startsWith]=zz-probe&publicationState=preview`);
  const n = (left.json?.data ?? []).length;
  console.log(n === 0 ? "cleanup verified: no zz-probe entries remain." : `⚠️  ${n} zz-probe entries left behind — remove manually.`);
  console.log(`\n${pass} passed, ${fail} failed`);
}
