# ImagineArt studio/product landscape (living reference)

This file exists so each run of the skill doesn't have to rediscover ImagineArt's own product surface from
scratch. **Update it whenever you learn something new** — a studio launches, a competitor comparison page
goes live, a URL pattern changes. Treat it as a cache, not a permanent truth; re-verify against
`site-explorer-crawled-pages` if something here looks stale.

## Studios / pillars live on imagine.art today

| Studio / pillar | Example live URLs (confirmed via Ahrefs crawl) | Notion `Relevance` bucket |
|---|---|---|
| Ad Studio | `/ad-studio`, `/ai-ad-studio` | Video |
| Audio Studio | `/audio-studio`, `/audio-studio/ai-music-generator`, `/audio-studio/ai-text-to-speech`, `/audio-studio/ai-voice-cloning` | Video |
| Music Studio | `/music-studio/*` — 100+ dedicated long-tail generator pages already exist (genres, occasions, moods, tools like stem-splitter/lyrics/remixer). Check here FIRST before proposing any music-generator page idea; it's almost certainly taken. | Video |
| Film Studio | `/film-studio`, `/ai-film-studio`, several `/blogs/ai-film-studio-*` posts | Video |
| Fashion Studio | `/fashion-studio`, `/ai-fashion-studio` | Image |
| Image Studio | `/image-studio`, `/image-studio/ai-model-training` | Image |
| Lipsync (part of Video Studio) | `/lipsync-studio` | Video |
| Imagine Computer | Agentic/computer-use product; cluster pages already researched include "Imagine Computer: AI Computer-Use Agent," pricing, onboarding, integrations, security | Computer |

## Named competitors already used for "ImagineArt [Studio] vs [Competitor]" comparison pages

These pages intentionally target low-standalone-volume branded modifiers for competitive/bottom-funnel
intent — that's expected, don't reject them for low volume the way you would a feature page.

- **Ad Studio:** AdCreative.ai, Arcads, Creatify
- **Audio Studio:** ElevenLabs, Suno
- **Film Studio:** LTX Studio *(added — this was the gap: Ad Studio and Audio Studio both had named-competitor
  comparisons, Film Studio didn't. LTX Studio is the highest-volume directly-comparable competitor:
  ~16,000 monthly searches at KD 25, per Ahrefs.)*
- **General image generation:** Adobe Firefly, Canva, ChatGPT image generation, Freepik AI, Ideogram,
  Leonardo AI, Midjourney, Photoroom, Remini
- **General video generation:** CapCut AI, HeyGen, Higgsfield, Kling AI, Luma AI, Pika Labs, Runway, Sora,
  Synthesia
- **Agentic/Computer:** Jasper AI, Zapier (workflow comparison, not a strict "vs" competitor)

When a studio is missing a "vs [Competitor]" row that a sibling studio already has, that asymmetry is
itself a signal worth flagging — it's usually a real gap, not an intentional choice.

## Sanity-check queries that are cheap and useful before a research session

- `site-explorer-crawled-pages` with `where: url isubstring "<studio-slug>"` to refresh the URL list above.
- Notion: `SELECT "Page Title ", Relevance FROM ... WHERE Relevance = '<bucket>'` to see what's already
  been proposed for that bucket.
