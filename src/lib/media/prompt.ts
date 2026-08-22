// Building the image prompt.
//
// The single most transferable lesson from forge, and it is counterintuitive:
//
//   **Negatives for GPT Image 2. Positives for Nano Banana.**
//
// forge's own comment, from the avatar prompt it had to rewrite:
//
//   "Nano Banana / Gemini image models read negatives weakly and tend to *draw* whatever you name, so
//    the old prompt's 'no phone, no recording timer, no record button, no app icons' was producing
//    exactly a phone-selfie-recording frame (status bar, 00:00 timer, capture button). A rich positive
//    description of a professional headshot leaves no room for a device or UI."
//
// Whereas its GPT Image 2 director states plainly: "Negatives are honoured strongly."
//
// So the same unwanted outcome needs two opposite prompt strategies. Getting this backwards actively
// summons the thing you are trying to avoid, which is why it is the first thing in this file.
//
// The second lesson: a batch does not diverge on its own. forge found that "the director's own
// 'randomly select' never diverges across near-identical calls on the same prompt" — so variety has to
// be locked per slot, in code. See STYLE_AXES.
import { isGptImage } from "./fal";
import type { PlannedAsset } from "./plan";

/**
 * Locked style axes. One is assigned per batch slot so N images genuinely differ.
 *
 * Kept deliberately editorial rather than photographic: these images sit next to prose on a
 * publisher-style page, and a stock-photo look reads as filler.
 */
export const STYLE_AXES = {
  worlds: [
    "clean light studio — near-white background, soft even light, a lot of air",
    "dark premium — deep charcoal ground, one warm rim light, high contrast",
    "brand saturated — a confident teal field, flat and modern",
    "editorial paper — warm off-white, subtle paper grain, print-like restraint",
    "gradient wash — a smooth two-tone gradient, no hard edges",
  ],
  compositions: [
    "one subject centred with generous negative space around it",
    "subject weighted to the left third, empty space right",
    "subject weighted to the right third, empty space left",
    "a tight close crop on the single most telling detail",
    "a wide establishing view with the subject small and deliberate",
  ],
  treatments: [
    "photographic realism, shallow depth of field",
    "clean 3D render, soft studio lighting, matte materials",
    "flat vector illustration, limited palette, confident shapes",
    "isometric technical illustration, precise and diagrammatic",
    "macro photographic detail, crisp texture",
  ],
} as const;

/** Assign axes by slot so a batch diverges. The composition index is offset so it does not track the
 *  world one-to-one, which is what makes variations feel like different executions rather than one
 *  dial being turned. */
export function axesForSlot(slot: number): { world: string; composition: string; treatment: string } {
  return {
    world: STYLE_AXES.worlds[slot % STYLE_AXES.worlds.length],
    composition: STYLE_AXES.compositions[(slot * 2) % STYLE_AXES.compositions.length],
    treatment: STYLE_AXES.treatments[slot % STYLE_AXES.treatments.length],
  };
}

/**
 * Where the image will live. This is the single highest-leverage input, which is why it exists as its
 * own field rather than something you have to describe in prose every time.
 *
 * A blog hero and a landing-page hero are not the same job. A blog image sits next to 2,000 words of
 * editorial and its job is to look considered and not interrupt reading — restraint reads as quality
 * there, and a glossy product shot reads as an ad someone dropped into an article. A landing-page image
 * IS the pitch: it has to look expensive, lead the eye to one thing, and hold up beside a Buy button.
 * The same "clean 3D render" direction produces the right image for one and the wrong image for the
 * other, so the surface has to change the art direction, not just the caption.
 *
 * Defaults to blog: it is the more conservative of the two, and an over-restrained landing image is a
 * milder failure than a salesy blog image.
 */
export type AssetSurface = "blog" | "landing";

interface SurfacePreset {
  /** One line naming the register, prepended so it frames everything after it. */
  register: string;
  /** Which STYLE_AXES worlds suit this surface. Indices into STYLE_AXES.worlds. */
  worlds: number[];
  /** Which treatments suit it. Indices into STYLE_AXES.treatments. */
  treatments: number[];
  /** Extra art direction, surface-specific. */
  direction: string[];
}

/**
 * Hand-tuned per surface. These are the presets that make a two-word prompt sufficient: the operator
 * says "seedance 2.5 launch" and the surface supplies the register, the palette range, the composition
 * discipline and the things to avoid.
 */
const SURFACE_PRESETS: Record<AssetSurface, SurfacePreset> = {
  blog: {
    // Positive phrasing for the same intent. "not stock, must not look like an advertisement" named
    // exactly the two things we least want Nano Banana to draw.
    register:
      "This is an editorial illustration commissioned for one specific long-form article on a " +
      "publisher-style page. It has the restraint and specificity of a piece made for this article alone.",
    // Light studio, editorial paper, gradient wash — the quiet grounds. Skips "brand saturated".
    worlds: [0, 3, 4],
    // Illustration and diagram before photography: an article image explains, it does not sell.
    treatments: [2, 3, 1, 0],
    // POSITIVE-ONLY, and this is not a style preference. This text goes to BOTH models, and Nano
    // Banana reads negatives weakly while tending to DRAW whatever you name — the header comment on
    // this file exists because of it. An earlier version of this list said "no lens flare, no dramatic
    // rim light" and the selfcheck rejected it: to Nano Banana that is a request for lens flare.
    // Describe the light you WANT instead.
    direction: [
      "Calm and considered. One idea per image, held simply.",
      "Generous negative space — at least a third of the frame is quiet.",
      "Soft, even, diffuse light. Matte surfaces and a muted, restrained palette.",
      "Bold simple shapes that stay legible at 640px wide in a body column.",
    ],
  },
  landing: {
    register:
      "This is the hero visual for a product landing page. It carries the pitch: it should look " +
      "expensive and confident, and lead the eye to one focal subject.",
    // Dark premium, brand saturated, gradient wash — the grounds with presence.
    worlds: [1, 2, 4],
    // Render and photography first: a landing image sells a made thing.
    treatments: [1, 0, 4, 2],
    direction: [
      "Premium and deliberate. Strong single focal subject, clear depth, confident lighting.",
      "Leave one uncluttered region where headline copy and a button will sit on top.",
      "Higher contrast and richer saturation than an editorial image, held within a controlled palette.",
      "It must hold up as the largest element on the page at full desktop width.",
    ],
  },
};

/** Pick axes for a slot, constrained to the ones that suit this surface. Divergence still comes from
 *  the slot index — it just diverges within the range that is right for where the image will live. */
function surfaceAxes(surface: AssetSurface, slot: number): { world: string; composition: string; treatment: string } {
  const preset = SURFACE_PRESETS[surface];
  const w = preset.worlds[slot % preset.worlds.length];
  const t = preset.treatments[slot % preset.treatments.length];
  return {
    world: STYLE_AXES.worlds[w],
    // Composition is surface-agnostic; offset by 2 so it does not track the world one-to-one.
    composition: STYLE_AXES.compositions[(slot * 2) % STYLE_AXES.compositions.length],
    treatment: STYLE_AXES.treatments[t],
  };
}

/**
 * The negatives clause. GPT Image 2 only — naming these to Nano Banana would draw them.
 *
 * Every entry is a failure forge actually shipped and then had to forbid.
 */
const GPT_NEGATIVES = [
  "no borders, frames, gutters, seams, dividing lines or rounded canvas corners",
  "no watermarks, badges, page numbers, or 'N of M' counters",
  // Every internal planning word eventually gets rendered as visible text unless it is forbidden by
  // name. These are OUR vocabulary for describing an image, not copy that belongs on one — forge had to
  // forbid each of them after seeing it painted onto a canvas.
  "no words 'hero', 'thumbnail', 'social card', 'inline', 'HOOK', 'CTA', 'BENEFIT', 'STEP', 'SLIDE', "
  + "'variation' or 'draft' appearing as text in the image",
  "no gibberish, misspelled or lorem-ipsum text",
  "no invented company names, logos, wordmarks or app icons of any kind",
  "no stock-photo clichés: no handshakes, no people pointing at charts, no lightbulb-as-idea",
  "no more than three type layers",
  "nothing at equal focal weight competing with the subject",
].join("; ");

/** Text is allowed on a social card and nowhere else — see plan.ts for why. */
const NO_TEXT_POSITIVE =
  "The image is purely visual with no lettering, captions, labels, UI copy or numbers anywhere in the frame.";
const NO_TEXT_NEGATIVE =
  "no text, lettering, captions, labels, callouts, numbers, UI copy or typography anywhere in the image";

export interface PromptInput {
  asset: PlannedAsset;
  /** What the article is about. */
  topic: string;
  /** The article's own title, used verbatim on a card. */
  title?: string;
  /** Which batch slot this is, for axis locking. */
  slot?: number;
  /** Extra direction from the user, applied within the rules rather than overriding them. */
  direction?: string;
  /** Brand name, only ever rendered as a plain wordmark and never as a drawn logo. */
  brand?: string;
  /** Where this image will live. Changes the art direction, not just the caption — see AssetSurface. */
  surface?: AssetSurface;
}

/**
 * Build a prompt for one planned asset, adapted to the model that will render it.
 *
 * The `model` argument is not cosmetic — it switches the whole avoidance strategy.
 */
export function buildImagePrompt(model: string, input: PromptInput): string {
  const { asset, topic } = input;
  const surface: AssetSurface = input.surface ?? "blog";
  const preset = SURFACE_PRESETS[surface];
  // Axes constrained to the surface, so variants diverge WITHIN the right register rather than
  // wandering between editorial and advertising across a single batch.
  const axes = surfaceAxes(surface, input.slot ?? 0);
  const gpt = isGptImage(model);
  const parts: string[] = [];

  // The register goes first: it frames every instruction after it, and it is the reason a two-word
  // subject is enough input to get a usable image.
  parts.push(preset.register);

  if (asset.role === "og" || asset.role === "thumbnail") {
    // The one asset where text is the point: it is never rendered in the page, it exists to be a
    // legible thumbnail in a feed.
    parts.push(
      `Design a social share card, ${asset.width}x${asset.height}, for an article titled "${input.title ?? topic}".`,
      `Set the headline in clean modern sans-serif type, large and immediately legible at thumbnail size. ` +
      `Two type layers at most: the headline, and optionally one short kicker.`,
      `Background: ${axes.world}. Composition: ${axes.composition}.`,
      "At least 40% of the frame is quiet negative space. One dominant focal element, nothing competing with it.",
    );
    if (input.brand) {
      // Never let the model draw a logo — it invents distorted marks. A wordmark in plain type only,
      // and the real logo gets composited afterwards if one is needed.
      parts.push(
        `Include the word "${input.brand}" once, small, as plain correctly-spelled type in a quiet corner. ` +
        "Do not design a graphical logo, icon or symbol for it.",
      );
    }
  } else if (asset.role === "hero") {
    parts.push(
      `A wide editorial opening image, ${asset.width}x${asset.height}, for an article about ${topic}.`,
      `Subject: ${asset.subject}.`,
      `Style: ${axes.treatment}. Setting: ${axes.world}. Composition: ${axes.composition}.`,
      // Surface-dependent, because the two registers want opposite things here. Hardcoding the
      // editorial line fired it on landing too, directly contradicting that surface's own register
      // ("carries the pitch, should look expensive") within the same prompt.
      surface === "landing"
        ? "It should read as a premium product visual — the kind of image a company puts at the top of its own page."
        : "It should read as a considered editorial illustration for a publisher, not a stock photograph.",
      gpt ? NO_TEXT_NEGATIVE.replace(/^no/, "Avoid: no") : NO_TEXT_POSITIVE,
    );
  } else {
    parts.push(
      `An editorial image, ${asset.width}x${asset.height}, illustrating "${asset.heading ?? asset.subject}" ` +
      `in an article about ${topic}.`,
      `Show: ${asset.subject}.`,
      `Style: ${axes.treatment}. Setting: ${axes.world}. Composition: ${axes.composition}.`,
      gpt ? NO_TEXT_NEGATIVE.replace(/^no/, "Avoid: no") : NO_TEXT_POSITIVE,
    );
  }

  // Surface art direction. Before the operator's own note, so a specific request can still override
  // the preset's defaults rather than being buried under them.
  parts.push(preset.direction.join(" "));

  if (input.direction?.trim()) {
    parts.push(`Additional direction, applied within the rules above: ${input.direction.trim()}`);
  }

  // The avoidance strategy, and it is model-specific. For Nano Banana we add MORE positive
  // specificity instead, because naming what we don't want is how forge summoned it.
  if (gpt) {
    const negatives = asset.allow_text ? GPT_NEGATIVES : `${GPT_NEGATIVES}; ${NO_TEXT_NEGATIVE}`;
    parts.push(`NEGATIVES: ${negatives}.`);
  } else {
    parts.push(
      "Render this as a single clean, finished, intentional image: one clear subject, a calm uncluttered " +
      "ground, and generous empty space. Every surface in frame is plain and deliberate.",
    );
  }

  return parts.filter(Boolean).join("\n\n");
}
