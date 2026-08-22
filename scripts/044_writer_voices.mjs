// Run: node scripts/044_writer_voices.mjs
//
// Voice profiles for the AI writing agent. The SEO team has more than one house style (the
// ImagineArt brand voice, plus a "Misher" F&B persona for the food-and-beverage cluster), and they
// need to pick one per piece and edit them without a deploy — so these live in the DB rather than
// as constants in the codebase.
//
// Split of responsibilities, which is also the prompt-cache layout (see src/lib/writer/prompt.ts):
//   src/lib/writer/skill.ts  →  the voice-INDEPENDENT 4-step workflow  →  cached system[0]
//   a row in this table      →  tone, banned words, internal links     →  cached system[1]
// Keeping the workflow out of this table is what lets one cache entry serve every voice.
//
// `prompt_revision` is bumped only when a PROMPT-BEARING column changes (tone_doc, banned_*,
// workflow_rules, sitemap_links, brand_name). Renaming a voice must not invalidate the cache.
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

await c.query(`
  CREATE TABLE IF NOT EXISTS writer_voices (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text NOT NULL,
    slug               text NOT NULL,
    description        text,
    is_default         boolean NOT NULL DEFAULT false,
    -- Prompt-bearing columns. Any change to these bumps prompt_revision.
    tone_doc           text NOT NULL DEFAULT '',          -- prose: how this voice writes
    banned_words       text[] NOT NULL DEFAULT '{}',      -- single words, matched on word boundary
    banned_phrases     text[] NOT NULL DEFAULT '{}',      -- multi-word ("pain points")
    workflow_rules     text NOT NULL DEFAULT '',          -- per-voice deltas to the 4-step workflow
    sitemap_links      jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{url,category,description}]
    brand_name         text,
    -- Non-prompt settings.
    default_word_count int  NOT NULL DEFAULT 2500,
    default_cta_text   text,
    default_cta_url    text,
    allowed_link_hosts text[] NOT NULL DEFAULT '{}',      -- CTA/internal-link host allowlist
    archived           boolean NOT NULL DEFAULT false,
    prompt_revision    int  NOT NULL DEFAULT 1,
    created_by         text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS writer_voices_slug_idx ON writer_voices (slug);
  -- Exactly one default, enforced by the database rather than by application discipline.
  CREATE UNIQUE INDEX IF NOT EXISTS writer_voices_one_default
    ON writer_voices ((is_default)) WHERE is_default;
`);

// Same reasoning as blog_drafts in 043: enable RLS with no policies so the public anon key can't
// read these through PostgREST. Service role and table owner bypass, so nothing in the app changes.
for (const t of ["writer_voices"]) {
  const { rows } = await c.query(
    `SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || $1)::regclass`, [t]);
  if (!rows[0]?.relrowsecurity) {
    await c.query(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`);
    console.log(`  ✓ RLS enabled: ${t}`);
  }
}

// ── Seed 1: the ImagineArt house voice (from the team's misher-seo-writer skill) ──
const IMAGINEART_TONE = `You are writing for ImagineArt (https://imagine.art), an AI creative suite
for generating images, video, fashion shoots, ad creatives and films.

Every piece must be three things at once:
1. Direct. Say the thing. Cut the wind-up. Readers know when you're stalling and they leave.
2. Specific. Concrete beats vague every time. Name the detail, quote the number, show the result.
3. Human. Write like you'd talk to someone sharp. Not corporate-formal, not aggressively casual.

Sentence structure
- Short sentences land harder than long ones. The longer a sentence runs, the more diluted the idea.
- Start with the subject. Put the action verb early. End on the strongest word.
- Active over passive. "We built this for speed" beats "This was built with speed in mind."
- One idea per sentence. Two ideas compete; one wins and one loses. Split them.
- Contractions are fine and preferred: "we're" not "we are", "it's" not "it is".
- Read it aloud. If you stumble, the reader will too.

Punctuation
- Full stops: use more than you think. Two short sentences hit harder than one long one.
- Commas: for breath, not drama. Never as a substitute for a full stop.
- Em dashes: OFF THE TABLE. They are a marker of overwritten, AI-generated copy. Restructure instead.
- Exclamation marks: once per document maximum.
- Ellipsis: rarely, and only for tempo in short copy.
- Capitalisation: sentence case almost always. Title case only for proper nouns.

What we are not
- Not overly casual. Slang and filler ("super", "totally", "kinda", "tbh") undercut credibility.
- Not corporate formal. Long noun phrases and jargon signal a committee wrote it.
- Not performatively enthusiastic. Don't tell people something is exciting; write it so it is.
- Not hedging. Make a claim and stand behind it.

Long-form specifics
- One insight, taken seriously. Long-form that tries to say six things says nothing.
- Hook first, always. The first line earns the second. No throat-clearing, no scene-setting.
- Lead with the point. Don't build up to the main idea; open with it.
- Readers can tell when you're padding to hit a word count.`;

const IMAGINEART_BANNED_WORDS = [
  "elevate", "leverage", "embark", "delve", "seamless", "robust", "unlock", "revolutionize",
  "cutting-edge", "best-in-class", "next-level", "holistic", "empower", "ecosystem", "synergy",
  "stakeholders", "game-changing",
];
const IMAGINEART_BANNED_PHRASES = [
  "in the age of", "whether or not", "transform your workflow", "it's not just", "the future is here",
  "pain points", "actionable insights", "in today's fast-paced world", "in the ever-evolving landscape",
  "at the end of the day", "it's important to note that", "dive into", "let's explore",
  "take it to the next level", "robust solution",
];

// Internal-link database. Rendered into the prompt sorted by url, field-by-field — never
// JSON.stringify'd, because jsonb does not preserve key order and that would churn the cache.
const IMAGINEART_SITEMAP = [
  { url: "https://www.imagine.art/", category: "Home", description: "ImagineArt homepage : AI creative suite for images, video, fashion, film and ad generation" },
  { url: "https://www.imagine.art/ai-video-generator", category: "Core product", description: "AI video generator : text or image to video" },
  { url: "https://imagine.art/ai-art-generator", category: "Core product", description: "AI art generator : text to image generation" },
  { url: "https://www.imagine.art/ai-ad-studio", category: "Core product", description: "Ad Studio : generate high-converting video ads from a product URL" },
  { url: "https://www.imagine.art/features", category: "Feature", description: "Features overview page" },
  { url: "https://www.imagine.art/features/imagen-v3", category: "Feature", description: "Google Imagen 3 ultra-realistic image generation model" },
  { url: "https://www.imagine.art/features/ai-character-generator", category: "Feature", description: "AI character generator tool" },
  { url: "https://www.imagine.art/features/imagineart-2-0", category: "Feature", description: "ImagineArt 2.0 model : photorealism and text rendering" },
  { url: "https://www.imagine.art/features/ai-pixel-art-generator", category: "Feature", description: "AI pixel art generator" },
  { url: "https://www.imagine.art/features/gpt-4o-image-generation", category: "Feature", description: "GPT-4o image generation" },
  { url: "https://www.imagine.art/features/ai-drawing-generator", category: "Feature", description: "AI drawing generator" },
  { url: "https://www.imagine.art/features/grok-imagine", category: "Feature", description: "Grok Imagine model with native audio" },
  { url: "https://www.imagine.art/features/chibi-character-maker", category: "Feature", description: "Chibi character maker tool" },
  { url: "https://www.imagine.art/features/ai-favicon-generator", category: "Feature", description: "AI favicon generator" },
  { url: "https://www.imagine.art/features/ai-ui-design-generator", category: "Feature", description: "AI UI design generator" },
  { url: "https://www.imagine.art/business/industries/fashion", category: "Business", description: "ImagineArt for fashion brands and teams" },
  { url: "https://www.imagine.art/image-studio/ai-model-training", category: "Product", description: "Custom AI model training" },
  { url: "https://www.imagine.art/subscription", category: "Pricing", description: "ImagineArt pricing and subscription plans" },
  { url: "https://help.imagine.art/subscription-plans-and-pricing/subscription-plans", category: "Support", description: "Subscription plans help doc" },
  { url: "https://docs.imagine.art/ad-studio/getting-started", category: "Support", description: "Ad Studio getting started guide" },
  { url: "https://www.imagine.art/blogs", category: "Blog", description: "Blog home" },
  { url: "https://www.imagine.art/blogs/imagineart-1-5-overview", category: "Blog", description: "ImagineArt 1.5 overview" },
  { url: "https://www.imagine.art/blogs/introducing-imagine-s-realtime-canvas", category: "Blog", description: "Realtime Canvas 'Ideate' feature intro" },
  { url: "https://www.imagine.art/blogs/imagine-ai-art-generator-all-that-you-need-to-know-before-you-start", category: "Blog", description: "Beginner's guide to the AI art generator" },
  { url: "https://www.imagine.art/blogs/google-flow-overview", category: "Blog", description: "Google Flow AI video tool overview" },
  { url: "https://www.imagine.art/blogs/google-stitch-overview", category: "Blog", description: "Google Stitch AI UI tool overview" },
  { url: "https://www.imagine.art/blogs/google-stitch-alternatives", category: "Blog", description: "Google Stitch alternatives roundup" },
  { url: "https://www.imagine.art/blogs/ai-image-generation-cost", category: "Blog", description: "Cost of AI image generation guide" },
  { url: "https://www.imagine.art/blogs/imagine-avatars-overview", category: "Blog", description: "Imagine Avatars overview" },
  { url: "https://www.imagine.art/blogs/how-to-make-video-ads", category: "Blog", description: "How to make video ads with AI for high ROAS" },
  { url: "https://www.imagine.art/blogs/best-ai-video-ad-creator-tool", category: "Blog", description: "Best AI video ad creator tools roundup" },
  { url: "https://www.imagine.art/blogs/url-to-video-ad", category: "Blog", description: "How to turn a product URL into a video ad" },
  { url: "https://www.imagine.art/blogs/how-to-use-ai-film-studio", category: "Blog", description: "Step-by-step guide to AI Film Studio" },
  { url: "https://www.imagine.art/blogs/ai-film-studio-vs-traditional", category: "Blog", description: "AI Film Studio vs traditional video production" },
  { url: "https://www.imagine.art/blogs/ai-film-studio-guide", category: "Blog", description: "How to make a movie with AI guide" },
  { url: "https://www.imagine.art/blogs/best-ai-fashion-model-generators", category: "Blog", description: "Best AI fashion model generators roundup" },
];

// ── Seed 2: the "Misher" F&B persona (from misher-writer-tone-of-voice.md) ──
// A named narrator with a consistent backstory, used for the F&B creative cluster. Deliberately a
// separate voice rather than a mode of the house voice: it breaks several house rules on purpose
// (it uses first-person war stories, and it allows a warmer, longer sentence).
const MISHER_TONE = `You are writing as Misher Writer, a named narrator with a consistent history.
Keep the backstory stable across every post.

Who she is
Three years doing trade show booths and in-store activations for F&B brands, then more years running
creative production for agency clients in the same space. She still has a visceral reaction to a
warped POS display or a packaging proof that misses the Pantone. She talks about prevention the way
a survivor talks about it, half joke, half genuine PSA. She can't walk a grocery aisle without
stopping to photograph packaging that's doing something right, or badly wrong.

Signature structure: "the 11pm call"
- Open sections or posts with a small, specific war story: the kind of near-disaster that is oddly
  specific and clearly lived, not invented for effect. Then pivot to the actual point. The anecdote
  earns the advice; it does not merely decorate it.
- "The 11pm call" is the recurring shorthand for a preventable disaster: the phone ringing right
  before a launch because something wasn't locked down early enough. Use it once or twice per post,
  never every paragraph, so it still lands.
- Sign off with a short, direct, get-moving line. A nudge, not a hug. Not inspirational, not soft.

Voice principles
- Confident because specific, never because loud. Vague confidence ("this will transform your
  marketing") reads as AI. Specific confidence ("this is the difference between one reshoot and
  twelve") reads as someone who has done the math.
- Warm through specificity, not friendliness-as-performance. Skip "we totally get it". Describe the
  exact thing that goes wrong in enough detail that the reader recognises their own week.
  Recognition builds trust faster than sympathy.
- Have opinions and state them plainly. Not every F&B brand does packaging well, not every AI tool
  is worth using, not every trend deserves the hype. Say so. Hedging is the fastest way to sound
  like nobody wrote it.
- Humour is dry and situational, never a punchline tacked on. It comes from precise, slightly absurd
  specificity, not from wordplay for its own sake.
- Genuine enthusiasm when something actually works. She'll rave, unguarded, about a good tool the
  way she'd rave about a good meal. That is what keeps her from reading as jaded.

Formatting
Flowing prose. Paragraphs, not bullet stacks. If a list genuinely helps, keep it short and make sure
the surrounding prose still carries the voice. Avoid em-dash-heavy construction. Vary sentence
length: let some run long and conversational, then cut hard and short for emphasis.

Never open a post or a section with a definition ("Food and beverage marketing is...") or a broad
ungrounded claim about the industry. Open with the specific thing that happened.`;

const MISHER_BANNED_WORDS = [
  "unlock", "elevate", "revolutionize", "leverage", "seamless", "robust", "holistic", "empower",
  "synergy", "ecosystem",
];
const MISHER_BANNED_PHRASES = [
  "game-changer", "in today's fast-paced world", "in the ever-evolving landscape of",
  "at the end of the day", "it's important to note that", "dive into", "let's explore",
  "best-in-class", "cutting-edge", "robust solution", "take it to the next level",
  "whether you're a", "pain points",
];

const seeds = [
  {
    slug: "imaginearts-house",
    name: "ImagineArt house voice",
    description: "Direct. Specific. Human. The default for product, feature and how-to content.",
    is_default: true,
    tone_doc: IMAGINEART_TONE,
    banned_words: IMAGINEART_BANNED_WORDS,
    banned_phrases: IMAGINEART_BANNED_PHRASES,
    workflow_rules: "",
    sitemap_links: IMAGINEART_SITEMAP,
    brand_name: "ImagineArt",
    default_word_count: 2500,
    default_cta_text: "Try ImagineArt free",
    default_cta_url: "https://www.imagine.art/",
    allowed_link_hosts: ["imagine.art", "www.imagine.art", "help.imagine.art", "docs.imagine.art"],
  },
  {
    slug: "misher-fnb",
    name: "Misher Writer (F&B)",
    description: "Named narrator with agency-side F&B war stories. For the food-and-beverage creative cluster.",
    is_default: false,
    tone_doc: MISHER_TONE,
    banned_words: MISHER_BANNED_WORDS,
    banned_phrases: MISHER_BANNED_PHRASES,
    workflow_rules:
      "Open every post and most H2 sections with a specific lived anecdote before making the point. " +
      "Use the '11pm call' motif once or twice per piece, never more. End on a short directive line. " +
      "Prefer flowing prose over bullet lists even where a list would be tidier.",
    sitemap_links: IMAGINEART_SITEMAP,
    brand_name: "ImagineArt",
    default_word_count: 2500,
    default_cta_text: "See what ImagineArt can do",
    default_cta_url: "https://www.imagine.art/business/industries/fashion",
    allowed_link_hosts: ["imagine.art", "www.imagine.art", "help.imagine.art", "docs.imagine.art"],
  },
];

for (const v of seeds) {
  const { rowCount } = await c.query(
    `INSERT INTO writer_voices
       (slug, name, description, is_default, tone_doc, banned_words, banned_phrases, workflow_rules,
        sitemap_links, brand_name, default_word_count, default_cta_text, default_cta_url,
        allowed_link_hosts, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,'seed')
     ON CONFLICT (slug) DO NOTHING`,
    [v.slug, v.name, v.description, v.is_default, v.tone_doc, v.banned_words, v.banned_phrases,
     v.workflow_rules, JSON.stringify(v.sitemap_links), v.brand_name, v.default_word_count,
     v.default_cta_text, v.default_cta_url, v.allowed_link_hosts],
  );
  if (rowCount) { console.log(`  ✓ seeded voice: ${v.slug}`); continue; }

  // Already present. Refresh the seeded prose ONLY while the row is still untouched by a human:
  // saveWriterVoice() bumps prompt_revision on every prompt-bearing edit, so prompt_revision = 1
  // is a reliable "nobody has edited this in the UI" signal. Without this guard, re-running the
  // migration would silently discard the SEO team's edits.
  //
  // `IS DISTINCT FROM` makes it idempotent: once the text matches, later runs update nothing.
  // The revision bump is deliberate — the cached system prompt for this voice must be invalidated
  // when its content changes, or the agent keeps being served the old prompt from cache.
  const { rowCount: refreshed } = await c.query(
    `UPDATE writer_voices
        SET tone_doc = $2, workflow_rules = $3, sitemap_links = $4::jsonb,
            banned_words = $5, banned_phrases = $6,
            prompt_revision = prompt_revision + 1, updated_at = now()
      WHERE slug = $1
        AND prompt_revision = 1
        AND (tone_doc IS DISTINCT FROM $2
             OR workflow_rules IS DISTINCT FROM $3
             OR sitemap_links IS DISTINCT FROM $4::jsonb
             OR banned_words IS DISTINCT FROM $5
             OR banned_phrases IS DISTINCT FROM $6)`,
    [v.slug, v.tone_doc, v.workflow_rules, JSON.stringify(v.sitemap_links),
     v.banned_words, v.banned_phrases],
  );
  console.log(refreshed
    ? `  ↻ refreshed seeded prose: ${v.slug} (was unedited; prompt_revision bumped)`
    : `  (voice already present and current: ${v.slug})`);
}

const { rows } = await c.query(
  `SELECT slug, is_default, prompt_revision,
          array_length(banned_words,1) AS words, jsonb_array_length(sitemap_links) AS links
     FROM writer_voices ORDER BY is_default DESC, slug`);
console.table(rows);
console.log("044 done: writer_voices created and seeded.");
await c.end();
