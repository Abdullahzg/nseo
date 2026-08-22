# Image T7

Feature/landing-page template for an image-generation tool or use case. Section order matters — follow it
exactly. Note this differs from Video T1 in two structural ways: the interlinking block sits right after
the H1 (not near the end), and it closes with an explicit CTA block. *(Word counts below were bumped +15
per section from the original spec on 2026-07-29 — treat these as the current targets.)*

1. **H1** — heading + 35-word subtext
2. **Interlinking block** — 5 to 10 relevant internal pages
3. **H2** — heading + 75 words content
4. **H2** — heading + 75 words content
5. **H2** — heading + 75 words content
6. **H2** — heading + 75 words content
7. **H2** — "how it works" style heading + 3 H3s, 55 words each. Pattern: step 1 (e.g. enter prompt),
   step 2 (e.g. generate), step 3 (e.g. hit download) — adapt the 3 steps to the actual product flow, but
   keep it to exactly 3 steps.
8. **H2** — heading + 115 words content, **in bullet format** (see below)
9. **H2** — heading + 115 words content, **in bullet format**
10. **H2** — heading + 115 words content, **in bullet format**
11. **Testimonials** — 5, 45 words each
12. **FAQs** — 6, with answers, 65 words each
13. **CTA** — heading + 35 words content

## The bullet format for sections 8-10

These three 115-word H2 sections must render as bullets, each bullet a short bold label followed by a
colon and a one-sentence description — not a plain paragraph. Example from the source spec:

> **Fast Anime Creation:** Generate anime-style images in seconds using text prompts, without manual
> drawing or complex tools.

Aim for enough bullets to naturally fill ~115 words per section (usually 4-6 bullets now that there's a
bit more room per section), each following that same "**Bold label:** one-sentence description" shape.

## Notes for filling this in

- H1 subtext is short here (35 words) compared to Video T1's 65 — keep it tight.
- Interlinking comes early (right after the H1), which is the opposite placement from Video T1.
- The four 75-word H2s are benefit/value-prop and use-case sections, ahead of "how it works."
- The three bulleted 115-word H2s are typically feature-list style sections (capabilities, styles/options
  supported, etc.) — this is the section type most likely to get written as a plain paragraph by mistake,
  so double check it's actually bulleted before calling a draft done.
- Closes with testimonials → FAQs → CTA, in that order.
