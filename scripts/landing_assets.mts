// Generate a landing page's images with gpt-image-2 and write them into its public/ folder.
//
// This is the missing half of the landing pipeline. `imagine-landing` scaffolds a page that REFERENCES
// its images (`/frames/soft-key.webp`) and ships none, so a freshly generated page renders broken <img>
// boxes showing alt text — which is what a reviewer sees and judges. The Summit-side prefill already does
// this for blog drafts and landing rows via Strapi; this does it for a standalone static export, where
// there is no CMS and the bytes have to land on disk.
//
// gpt-image-2, not Nano Banana, and the reason matters: buildImagePrompt branches on model family and
// writes a NEGATIVES-heavy prompt for GPT (which honours them strongly) versus a positives-heavy one for
// Nano (which draws whatever you name). A landing-page image must contain no text, no logos and no
// watermarks, and that is a negative instruction — so the model choice pins the prompt strategy to the one
// where "no text anywhere" is actually obeyed.
//
//   npx tsx scripts/landing_assets.mts <repo-dir> [--dry]
//
// Idempotent: an image already on disk is skipped, so a re-run after adding one section costs one render
// rather than the whole set.

import * as dotenv from "dotenv";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { readdirSync, statSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });

const repo = process.argv[2];
const dry = process.argv.includes("--dry");
if (!repo) { console.error("usage: npx tsx scripts/landing_assets.mts <repo-dir> [--dry]"); process.exit(1); }

const { falQueue, buildPayload, MODELS } = await import("../src/lib/media/fal.ts");

// sharp comes from the TARGET repo, not this one — the landing scaffold has it (transitively, via Next's
// optional dependency) and Summit does not need it. Encoding is not optional: gpt-image-2 returns a
// multi-megabyte PNG, and the skill's asset budget is ≤200KB per still with a ≤2048px long edge. Writing
// provider bytes straight to a .webp filename produced a 3.4MB PNG mislabelled as WebP — oversized AND the
// wrong format, which is an LCP problem on the one image above the fold.
const requireFromRepo = createRequire(join(repo, "package.json"));
let sharp: any = null;
try { sharp = requireFromRepo("sharp"); } catch { /* fall back to raw bytes with a warning */ }

/**
 * Encode to the format the destination filename claims, under the byte budget.
 *
 * Keyed off the extension rather than always WebP, because the share card is a .jpg (some scrapers still
 * do not take WebP for og:image) and an earlier version only encoded when the path ended `.webp` — so a
 * .jpg slot silently received a multi-megabyte provider PNG under a .jpg name. Wrong format, ~17× the
 * budget, and only discovered downstream in `npm run check`.
 */
async function encodeImage(bytes: Uint8Array, ext: string, maxBytes: number, maxEdge = 2048): Promise<Uint8Array> {
  if (!sharp) return bytes;
  const base = sharp(bytes).resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true });
  const write = (q: number) =>
    ext === ".png" ? base.clone().png({ quality: q, compressionLevel: 9 }).toBuffer()
    : ext === ".jpg" || ext === ".jpeg" ? base.clone().jpeg({ quality: q, mozjpeg: true }).toBuffer()
    : base.clone().webp({ quality: q }).toBuffer();
  // Quality ladder rather than one guess: a busy photograph and a flat one need different quality to hit
  // the same size, and overshooting on quality is what puts a 400KB hero above the fold.
  for (const quality of [82, 74, 66, 58, 50]) {
    const out = await write(quality);
    if (out.length <= maxBytes) return new Uint8Array(out);
  }
  return new Uint8Array(await write(44));
}

// ── Roles ───────────────────────────────────────────────────────────────────────────────────────────
// Geometry per slot, keyed off the directory the page files the image under. This exists because one
// aspect ratio for every slot is a visible defect, not a simplification: a 3:2 render dropped into the
// 4:5 portrait frame of a stack card gets centre-cropped to about half its width, and a 2K render for a
// 420×270 marquee tile is four times the pixels the slot can show — paid for, downloaded, then thrown away
// by the encoder. Directory, not filename, because the page author picks the directory when they compose
// the section and the slot's shape is a property of that section.

interface Role {
  aspect: string;
  resolution: "1K" | "2K";
  /** Byte ceiling. check.mjs allows 300KB for an og or hero filename, 200KB for everything else. */
  maxBytes: number;
  /** Appended to the prompt: what this slot has to survive being displayed at. */
  framing: string;
}

const ROLES: Record<string, Role> = {
  // Scroll-marquee tiles: rendered at 420×270, lazy, eight of them on screen at once.
  frames: { aspect: "3:2", resolution: "1K", maxBytes: 200_000, framing: "Composed to read at postcard size in a moving row: subject clearly separated from the background, no fine detail that would disappear when scaled down." },
  // Zig-zag feature media: sections.md fixes .media at aspect-ratio 4/3.
  features: { aspect: "4:3", resolution: "1K", maxBytes: 200_000, framing: "Sits beside a paragraph of copy at roughly half the page width, so the subject holds one side of the frame and the other side stays quiet." },
  // Sticky stack cards: a 4/5 portrait well next to the card's copy.
  looks: { aspect: "4:5", resolution: "1K", maxBytes: 200_000, framing: "Upright portrait crop with the eye line about a third down and room above the head, so a square or circular avatar crop still lands correctly." },
  // The one parallax image on the page — the still that earns extra attention.
  lighting: { aspect: "3:2", resolution: "2K", maxBytes: 200_000, framing: "Shown large and full width with the lighting itself as the subject, so the shape of the shadow is the thing the eye lands on." },
  // Open Graph / Twitter card. Never rendered in the page, only in a share preview.
  og: { aspect: "1.91:1", resolution: "2K", maxBytes: 300_000, framing: "A share-preview card: one clear subject placed off-centre with calm space beside it, still legible as a thumbnail in a chat window." },
};

const DEFAULT_ROLE: Role = { aspect: "3:2", resolution: "1K", maxBytes: 200_000, framing: "Composed so the frame reads clearly at a small size." };

function roleFor(path: string): { key: string; role: Role } {
  // "/og.jpg" and "/og/card.webp" are both the social card.
  const file = path.split("/").pop() ?? "";
  if (/^og\./i.test(file)) return { key: "og", role: ROLES.og };
  const dir = path.replace(/^\//, "").split("/")[0];
  const role = ROLES[dir];
  return role ? { key: dir, role } : { key: "default", role: DEFAULT_ROLE };
}

// ── Engineered divergence ───────────────────────────────────────────────────────────────────────────
// The imagine-image-assets skill's hardest-won rule: asking one prompt for variety does not produce it.
// "The director's own 'randomly select' never diverges across near-identical calls on the same prompt."
// The previous version of this script proved it from the other direction — every slot got the same prompt
// body including a hardcoded "Amber tungsten warmth in the highlights", so every render came back a warm
// amber portrait and the finished page looked like one photo repeated.
//
// So the axis is locked per slot IN CODE. Each list is walked at a different stride and each has a
// different length, which is the detail that makes it read as a cast of people rather than one dial being
// turned: with stride 1 on a 7-list and stride 3 on a 4-list, slot 2 and slot 9 never pair the same way.

const SUBJECTS = [
  "a woman in her late twenties with dark curly hair",
  "a man in his forties with short greying hair and a trimmed beard",
  "a woman in her fifties with straight silver-grey hair",
  "a man in his early thirties with black hair and light brown skin",
  "a woman in her thirties with shoulder-length auburn hair and freckled fair skin",
  "a man in his late twenties with deep brown skin and a close fade",
  "a woman in her forties with black hair worn in a low bun and olive skin",
];

const DISTANCES = [
  "a tight head-and-shoulders crop",
  "a head-and-shoulders crop with a little air above the head",
  "a three-quarter turn from the chest up",
  "a waist-up frame with the shoulders angled away from camera",
  "a straight-on chest-up frame, shoulders square",
];

// Optics ONLY — focal length and how much the background blurs. Never a claim about WHAT is back
// there (a room, a studio, foliage): that is the alt text's job alone. One of these used to say "a
// little of the room visible behind", and on the one slot where it landed next to an alt text that
// specified a seamless studio backdrop, the model rendered a living room — the lens axis and the alt
// text became two disagreeing sources of truth about the environment, and the more vivid one won.
const LENSES = [
  "shot on an 85mm lens at f/2, background softly out of focus",
  "shot on a 105mm lens at f/2.8, background compressed and quiet",
  "shot on a 50mm lens at f/2.8, a touch of background blur",
  "shot on a 135mm lens at f/2.5, background reduced to smooth tone",
];

const WARDROBE = [
  "wearing a plain fine-knit crew-neck jumper",
  "wearing an open-collar cotton shirt",
  "wearing a soft unstructured blazer over a plain t-shirt",
  "wearing a merino turtleneck",
  "wearing a button-down shirt with the sleeves rolled",
  "wearing a lightweight jacket over a collarless top",
];

const PALETTES = [
  "cool neutral grade, grey-blue background tone",
  "warm neutral grade, sand and putty background tone",
  "muted olive grade with a deep green-grey background",
  "soft slate grade, near-monochrome background",
  "warm amber grade with tungsten falling off into shadow",
];

/** Walk each axis at its own stride so the combinations do not track each other. */
function axesFor(i: number): string[] {
  return [
    SUBJECTS[i % SUBJECTS.length],
    DISTANCES[(i * 2) % DISTANCES.length],
    LENSES[(i * 3) % LENSES.length],
    WARDROBE[i % WARDROBE.length],
    PALETTES[(i * 2) % PALETTES.length],
  ];
}

/** Every image path the page references, with the alt text it was given. */
interface Wanted { path: string; alt: string }

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next" || e === ".git" || e === "out") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|ts)$/.test(e)) out.push(p);
  }
  return out;
}

/**
 * Find the images the page wants, pairing each with its alt text.
 *
 * Alt text is the whole point of scraping rather than hardcoding a list: it is the only description of
 * what the image is supposed to show, written when the section was composed. Generating from the filename
 * alone ("row-1") would produce something arbitrary.
 *
 * Sorted before returning, so slot indices — and therefore the locked axes above — are stable. Without
 * that, adding one section would reshuffle every other slot's prompt, and a re-run to fill a single
 * missing image would generate something unrelated to what the rest of the page was built around.
 */
async function findWanted(): Promise<Wanted[]> {
  const byPath = new Map<string, string>();
  for (const file of walk(repo).sort()) {
    const src = await readFile(file, "utf8");
    // { src: '/frames/soft-key.webp', alt: 'A headshot lit by a single soft key…' }
    for (const m of src.matchAll(/src:\s*'(\/[^']+\.(?:webp|jpg|png))'\s*,\s*alt:\s*'([^']*)'/g)) {
      byPath.set(m[1], m[2]);
    }
    // <img src={asset('/looks/cv.webp')} alt="…" />  and plain src="/x.webp" alt="…"
    for (const m of src.matchAll(/src=\{?\s*(?:asset\()?['"](\/[^'"]+\.(?:webp|jpg|png))['"]\)?\s*\}?\s+alt=['"]([^'"]*)['"]/g)) {
      byPath.set(m[1], m[2]);
    }
    // Any remaining reference with no alt nearby — still needs an image, described by its own path.
    for (const m of src.matchAll(/['"](\/[a-z0-9/._-]+\.(?:webp|jpg|png))['"]/g)) {
      if (!byPath.has(m[1]) && !m[1].includes("/logo/")) byPath.set(m[1], "");
    }
  }
  await addShareCard(byPath);
  return [...byPath].map(([path, alt]) => ({ path, alt })).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The share card has to be added by hand, because it is the one image on the page that is never written as
 * a local path.
 *
 * `og:image` must be an absolute URL for a crawler to resolve it, so the scaffold hardcodes the CDN address
 * (`https://cdn-imagine.vyro.ai/imagine-static-pages/<slug>/og.jpg`) and the scraper above — which only
 * matches paths starting `/` — cannot see it. The result was a page that passed `npm run check` (the OG
 * metadata is present) while the file behind it did not exist, so every share preview rendered blank. Every
 * page needs one of these, so it is derived rather than discovered.
 */
async function addShareCard(byPath: Map<string, string>): Promise<void> {
  let layout: string;
  try { layout = await readFile(join(repo, "app/layout.tsx"), "utf8"); } catch { return; }
  const file = layout.match(/OG_IMAGE\s*=\s*[`'"][^`'"]*\/(og\.(?:jpe?g|png|webp))[`'"]/i)?.[1];
  if (!file) return;
  const title = layout.match(/^const TITLE = '([^']*)'/m)?.[1] ?? "";
  const desc = layout.match(/^const DESCRIPTION = '((?:[^'\\]|\\.)*)'/m)?.[1]?.replace(/\\'/g, "'") ?? "";
  byPath.set(`/${file}`, `A share preview image for a page titled "${title}". ${desc}`.trim());
}

/**
 * The prompt for one image.
 *
 * Three inputs, in decreasing order of authority: the alt text (what this specific frame shows, written by
 * whoever composed the section), the role (what the slot's geometry has to survive), and the locked axes
 * (everything the alt text leaves open, varied deliberately so the set is a set).
 *
 * The negatives clause is long and explicit on purpose — GPT Image 2 honours negatives strongly, and every
 * entry here is a defect that would otherwise ship: baked-in text (illegible on mobile, invisible to
 * Google, untranslatable), invented logos, and the stock-photo clichés that make a page look bought.
 */
function promptFor(w: Wanted, slug: string, role: Role, i: number): string {
  const subject = w.alt || w.path.split("/").pop()!.replace(/[-_]/g, " ").replace(/\.\w+$/, "");
  return [
    `Editorial photograph for a product page about ${slug.replace(/-/g, " ")}.`,
    `Subject, and the ONLY authority on setting, backdrop and environment: ${subject}.`,
    `Cast and camera for this frame — these vary the PERSON and the OPTICS only, and must not ` +
      `contradict or add to the subject's own environment: ${axesFor(i).join("; ")}.`,
    role.framing,
    "Real photography, natural skin texture with visible pores and fine detail, catchlights in both eyes,",
    "believable fabric weave, generous empty space around the subject, calm and premium.",
    "",
    "NEGATIVES: no text, lettering, captions, labels, numbers, watermarks or typography anywhere in the",
    "image; no logos, wordmarks, brand marks or app icons of any kind; no invented company names; no UI",
    "chrome, browser frames or device bezels; no borders, frames or rounded canvas corners; no collage,",
    "split panels, before-and-after halves or multiple frames in one image; no stock-photo clichés (no",
    "handshakes, no thumbs up, no people pointing at screens); no distorted hands, ears or teeth; no",
    "plastic retouched skin, no airbrushed poreless faces; nothing at equal visual weight competing with",
    "the subject.",
  ].join(" ");
}

const publicDir = join(repo, "public");
const wanted = await findWanted();
const slug = repo.replace(/\/+$/, "").split("/").pop()!;

console.log(`${wanted.length} image(s) referenced by ${slug}:\n`);
wanted.forEach((w, i) => {
  const { key, role } = roleFor(w.path);
  console.log(`  ${String(i).padStart(2)}  ${w.path.padEnd(34)} ${key.padEnd(9)} ${role.aspect.padEnd(7)} ${role.resolution}  ${w.alt || "(no alt — described from path)"}`);
});
if (dry) { console.log("\n--dry, nothing rendered."); process.exit(0); }
if (!process.env.FAL_KEY) { console.error("\nFAL_KEY is not set."); process.exit(1); }

let made = 0, skipped = 0, failed = 0;
for (const [i, w] of wanted.entries()) {
  const dest = join(publicDir, w.path.replace(/^\//, ""));
  try { await access(dest); console.log(`\nskip  ${w.path} (already on disk)`); skipped++; continue; } catch { /* render it */ }

  const { role } = roleFor(w.path);
  await mkdir(dirname(dest), { recursive: true });
  const prompt = promptFor(w, slug, role, i);
  process.stdout.write(`\nmake  ${w.path} (${role.aspect} ${role.resolution}) … `);
  try {
    const payload = buildPayload(MODELS.gptImage, { prompt, aspect: role.aspect, resolution: role.resolution });
    const images = await falQueue(MODELS.gptImage, payload);
    const url = images[0]?.url;
    // A content-policy block arrives as HTTP 200 with an empty images array, not an error status.
    if (!url) { console.log("no image returned (moderation refusal?)"); failed++; continue; }
    const raw = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const ext = (dest.match(/\.[a-z]+$/i)?.[0] ?? ".webp").toLowerCase();
    const bytes = await encodeImage(raw, ext, role.maxBytes);
    await writeFile(dest, bytes);
    const note = sharp ? "" : "  (sharp missing in the target repo — wrote provider bytes unencoded)";
    console.log(`${(raw.length / 1024).toFixed(0)}KB -> ${(bytes.length / 1024).toFixed(0)}KB${note}`);
    made++;
  } catch (e) {
    console.log(`failed: ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

console.log(`\nmade ${made}, skipped ${skipped}, failed ${failed}.`);
if (made) console.log("Run `npm run check` — the asset budget is enforced there, not here.");
