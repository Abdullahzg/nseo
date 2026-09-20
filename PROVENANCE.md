# PROVENANCE.md — who wrote what (inventory only; no legal conclusion)

Generated 2026-09-20 from `git log`, `git diff fb4e48f HEAD --name-status`, and content grep. The rule at stake (Official Rules §Submission): the submission must "(a) be your … original work product; (b) be solely owned by you … with no other person or entity having any right or interest in it; and (c) not violate the intellectual property rights … of any other person or entity."

## How the repo came to be
- Root commit **`fb4e48f` (2026-08-22, author `baseline <baseline@local>`)**: "Baseline: seo_email-main (GenAI Scout) as extracted from archive — pre-existing work, unmodified." 554 files, 91k lines. `docs/PREEXISTING_WORK.md` (written for the AWS hackathon) describes it as the "ImagineArt/Vyro SEO-outreach platform … used in production for real SEO outreach and negotiation against real publishers", delivered "as `seo_email-main.zip`".
- Then 7 commits by `agent <agent@local>` (Aug 22–23) and 41 by **Abdullah Zubair Ghouri** (Aug 23 – Sep 13) build the campaign layer, Python service, docs and UI moves on top.
- Vyro fingerprints in the baseline: default admin `abdullah.zubair@imagine.art` (`src/lib/auth/admin.ts`), `ALLOWED_DOMAINS=imagine.art`, digest recipient `zain@imagine.art`, GitHub Action deploys to Vyro's Vercel project as `web@vyro.ai`, Hermes docs reference "forge's Hermes … the ads team depends on", brand-voice guides for imagine.art.
- `LICENSE` (MIT, "SEO Workforce Contributors") was added on **2026-09-04** by Abdullah — i.e. a licence was attached to the baseline code *after* import. Whether the author of that commit had the right to license the baseline is exactly the question to escalate.

## File classes (working tree, 2026-09-20)

| Class | Count | Meaning |
|---|---|---|
| **A. BASELINE, unchanged** | **521** | Byte-identical to the Vyro archive. |
| **B. BASELINE, modified** | 33 tracked + ~31 moved into `src/app/(app)/` (of which ~26 are byte-identical moves, ~5 edited) | Vyro code with edits layered on. |
| **C. NEW since baseline** | 100 tracked + 15 untracked | Written in this repo Aug 22 → Sep 20. |
| Total | ≈ 700 | |

Full per-file list: run `git diff --name-status fb4e48f HEAD` and `git show --name-only fb4e48f`. Summary by module:

### A — Baseline (Vyro-era), unchanged — **this is ~75 % of the codebase and ~100 % of the "proven engine"**
| Area | Files | Notes |
|---|---|---|
| `src/lib/db/queries.ts`, `src/lib/db/*` | core DB layer | every new module imports it |
| `src/lib/enrich/*` (cascade, hunter, blitz, enrichso, reoon, patterns, personFilter…) | 17 | contact-finding engine |
| `src/lib/email/*` (smtp, imap, deliver, followup, schedule, autopilot…) | 13 | send/receive engine |
| `src/lib/extract/*`, `src/lib/harvesters/*`, `src/lib/pipeline/*`, `src/lib/search/tavilyUsage.ts` | ~30 | discovery engine |
| `src/lib/negotiation/{agent,pricing,run,settings}.ts` | 4 (3 later modified) | negotiation engine |
| `src/lib/{backlinks,writer,blog,strapi,indexing,linkaudit,seo-agents,media,landing,calendar,digest,adoption,learn,sitemap,health,hermes,util}/*` | ~90 | unrelated Vyro product surfaces |
| `src/app/api/**` except `/api/agent/*`, `/api/campaigns/*`, `/api/cron/tick`, `/api/agent-runs/*`, `/api/settings/ai` | ~170 route handlers | |
| `src/components/**` except `campaigns/ProspectTable.tsx`, `layout/{GlobalLoader,LoadingProvider,SearchDialog}.tsx` | ~50 | UI kit, blog editor, prospects drawer… |
| `src/app/globals.css` (modified), `src/app/layout.tsx` (modified), `src/proxy.ts` (modified), `auth.ts` (modified) | | |
| `migrations/001_initial.sql`, `scripts/004_…` → `scripts/061_…` (58 migration scripts), `scripts/probes/*`, `scripts/*_probe.mjs` | ~75 | schema history of Vyro's production DB |
| `hermes/*` (SOUL.md, summit_tools.py, agent_loop.py, server.py, Caddyfile) | 12 | Vyro's Hermes service |
| `docs/seo-department/**` (brand voice, imagineart-landscape, ahrefs-playbook, notion-database, templates) | 15 | **Company internal documents, not code** |
| `docs/{BLOG_COMPOSER_HANDOVER,PAGE_HEALTH_HANDOVER,HERMES_TOOL_SURFACE,GSC_SETUP,CRON_SETUP,CWV_DATA_SOURCE,QA_TEST_REPORT,SEO_AGENTS_V2_ROADMAP,V3_PRD,V4_PRD,AGENT_HONESTY_FIXES}.md`, `DOCUMENTATION.md` (566 KB), `DEPLOY.md`, `DEPLOYMENT.md`, `CHANGES.md`, `CLAUDE.md`, `AGENTS.md` (modified) | | Vyro-era docs |
| `config/seeds.ts` | 1 | competitor/topic seed list |
| `.github/workflows/{prod,droplet}.yaml`, `Dockerfile`, `vercel.json`, `next.config.ts`, `tsconfig.json`, `components.json`, `eslint.config.mjs`, `postcss.config.mjs`, `package.json` (modified) | | |
| `seo_email-main.zip` (untracked, 1.7 MB) | 1 | the original archive itself |

### B — Baseline files modified after import
`.gitignore`, `AGENTS.md`, `README.md` (rewritten), `auth.ts` (demo bypass), `package.json`/`package-lock.json`, `src/app/api/campaigns/route.ts`, `src/app/api/campaigns/[id]/route.ts`, `src/app/{campaigns,email-finder,emails,handbook,indexing,link-audit,login,negotiation,payments,settings,workflows}/page.tsx`, `src/app/page.tsx` (new marketing page), `src/app/layout.tsx`, `src/app/globals.css`, `src/components/layout/{Sidebar,TopNav}.tsx`, `src/lib/auth/service.ts`, `src/lib/db/supabase.ts` (lazy init), `src/lib/email/deliver.ts`, `src/lib/negotiation/{agent,run,settings}.ts`, `src/lib/score/qualify.ts`, `src/lib/search/webSearch.ts`, `src/proxy.ts`; plus the untracked moves into `src/app/(app)/` (inbox: 101 lines changed, sending: 76, settings: 4; backlinks/blog/writer etc.: 0).

### C — New in this repo (Aug 22 – Sep 20)
| Area | Files |
|---|---|
| Campaign layer | `src/lib/campaign/{types,queries,tools,outreach,fallbackOrchestrator,demo,sendProcessor}.ts`, `src/lib/agent/gateway.ts`, `src/lib/ai/gemini.ts` |
| Routes | `src/app/api/agent/**` (10), `src/app/api/campaigns/[id]/{start,tick,discover,template}`, `src/app/api/cron/tick`, `src/app/api/agent-runs/*`, `src/app/api/settings/ai`, `src/app/api/admin/tavily-key` |
| UI | `src/app/(app)/campaigns/{autonomous,new,[id]}/page.tsx`, `agent-runs/page.tsx`, `(app)/layout.tsx`, `error/loading/not-found.tsx`, `src/components/campaigns/ProspectTable.tsx`, `src/components/layout/{GlobalLoader,LoadingProvider,SearchDialog,RouteProgress?}.tsx`, `public/icon.svg`, `src/app/icon.svg`, `SummitMark.tsx` (modified) |
| Python service | `agents/**` (8 files), `agents/Dockerfile`, `agents/requirements.txt` |
| Schema | `scripts/000_core_bootstrap.mjs`, `scripts/062–064_*.mjs`, `scripts/run-migrations.mjs`, `supabase/migrations/002_campaign_layer.sql`, `supabase/config.toml` |
| Tooling/tests | `scripts/{start-local,stop-local,test-local}.ps1`, `scripts/{dev-rest-proxy,pgrst-proxy,demo-arc,edge-case-test,agent-verbose-test,user-flow-test}.mjs`, `scripts/{e2e-campaign-test,groq-strands-smoke,tick-background,test-failure-scenarios}.py`, `tests/*.test.ts`, `e2e/*.spec.ts`, `playwright.config.ts`, `vitest.config.ts`, `evaluation/*` |
| Docs | `docs/{ARCHITECTURE,AGENT_DESIGN,DEMO,DEPLOYMENT,HACKATHON_REQUIREMENTS,LEGACY_EDGE_CASES,PREEXISTING_WORK}.md`, `README.md`, `HOW_TO_USE.md`, `PROJECT_HANDOFF.md`, `AGENT_REPLY_DOCUMENT.md`, `GESEO_*.md`, `GSEO_DOCUMENTATION.md`, `STRANDS_MIGRATION_REPORT.md`, `LOCAL_VALIDATION_REPORT.md`, `Migrate GenAI Scout….md`, `Fix Local Supabase Startup.md`, `CODEBASE_GUIDE.md`, `LICENSE`, `deploy/deploy.sh` |

## What is ambiguous (the questions only you can answer)
1. **Who authored the baseline, and under what agreement?** The commit says "pre-existing work"; the archive name and defaults say Vyro/imagine.art. If you wrote it as a Vyro employee/contractor, ownership is governed by that contract, not by who typed it. If someone else at Vyro wrote parts, those parts are theirs/Vyro's regardless.
2. **Was the archive given to you with permission to reuse and relicense?** `docs/PREEXISTING_WORK.md` says it was "distributed to us" — by whom, for what purpose?
3. **Company documents inside the repo** (`docs/seo-department/**`: brand voice, competitive landscape, Notion database schema, Ahrefs playbook; `hermes/SOUL.md`; `DOCUMENTATION.md`; `config/seeds.ts` competitor list). These are not needed by the product and look like confidential internal material regardless of code ownership.
4. **Operational identities**: Vyro's Vercel project + `web@vyro.ai` deploy identity in `.github/workflows/prod.yaml`, the Hermes droplet, `zain@imagine.art` digest recipient.

## What the new code cannot live without
The campaign layer (class C) imports the baseline engine everywhere (`@/lib/db` 8×, `@/lib/enrich` 7×, `@/lib/negotiation` 6×, `@/lib/email` 3×, `@/lib/extract` 3×, plus `search`, `score`, `pipeline`). **There is no configuration of this repo that is "only my work" without a rewrite of discovery, enrichment, email and negotiation.** That is the fact to weigh when you decide.

## Vyro / imagine.art reference strip list (for after the decision)
~100 files contain `vyro`, `imagine.art`, `ImagineArt` or `imagine art` (31 hits in `DOCUMENTATION.md` alone). Heaviest: `scripts/044_writer_voices.mjs` (57), `src/app/api/blog/selfcheck/route.ts` (23), `docs/seo-department/SKILL.md` (15), `src/lib/linkaudit/run.ts` (8), `scripts/probes/campaign_brief.mts` (7), `src/app/api/slack/test/route.ts` (6), `src/lib/linkaudit/slack.ts` (5), `src/lib/backlinks/pipeline.ts` (5). Code-level defaults to change: `ALLOWED_DOMAINS` default in `auth.ts` and `.env.example`; admin default in `src/lib/auth/admin.ts`; digest default in `src/lib/digest/daily.ts`; `config/seeds.ts`; `.github/workflows/*`; the `hermes/` folder. Full list: `grep -rniE 'vyro|imagine\.art|imagineart' --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git .`

**I have not deleted or edited any of these.** Stopping here per the brief.
