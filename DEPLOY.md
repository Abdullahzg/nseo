# DEPLOY.md — free hosting that stays alive through judging (Dec 1–15, 2026)

## The morning checklist (in this order, ~40 minutes)

Everything below is prepared; these are the steps only the account owner can do.

1. **Rotate the keys that were pasted in chat or in old env files** — Nebius (tokenfactory.nebius.com →
   API keys), Tavily (app.tavily.com), the Gmail app password (Google Account → Security → App
   passwords). Put the new values in `.env.local` and, later, in Vercel. Nothing in the code references
   the old ones.
2. **Publish the repo.** Create an empty public repo on GitHub (MIT license is in the tree), then either
   push this repo as-is (`git remote add origin … && git push -u origin master:main`) — a full-history
   scan on 2026-09-21 found no credential patterns (Google, Tavily, Nebius, Groq, OpenRouter, AWS,
   GitHub, Slack, Hugging Face; the only JWTs are Supabase's public local demo keys) — or, to be
   certain, run `scripts/publish-clean.sh git@github.com:<you>/nseo.git`, which clones into a temp
   dir, scrubs any secret-shaped strings from every commit with git-filter-repo (dates and authorship
   kept), verifies, and pushes. Your local repo is never modified.
3. **Supabase** (§1): new free project → `npx supabase link` → `npx supabase db push`. Copy URL,
   anon key, service-role key.
4. **Vercel** (§2): import the public repo; paste the env block from §2; deploy; open
   `https://<app>/api/health?deep=1` — it must say `ok: true` and list the four Nemotron models.
5. **GitHub Actions** (§3): repository secrets `APP_URL` and `CRON_SECRET`; run `tick` once by hand
   from the Actions tab and confirm it returns JSON.
6. **Google OAuth** (§6) so real mode exists on the deployment; sign in, open Settings, save your
   keys, press the three tests. Set `DEV_OWNER_EMAIL` only locally, never on Vercel.
7. **Smoke test on the deployment:** open Setup as a guest (private window), Launch demo, watch it
   reach three deals; sign in, run a real campaign against one publication you list with your own
   address as the editor (Run D in `docs/LEDGER.md` is that test).
8. **Record the video** from `SUBMISSION.md` (3:00), upload unlisted/public to YouTube.
9. **Devpost:** description from `SUBMISSION.md`, the video, the repo, the deployment URL, the
   `UPDATES.md` disclosure, the `FEEDBACK.md` text.
10. **Calendar:** Nov 20 — push a trivial commit (GitHub disables schedules after 60 idle days);
    check the Supabase project has not paused; check `/api/health?deep=1`.

Stack: **Vercel Hobby** (app) · **Supabase Free** (Postgres) · **GitHub Actions** (scheduler + keepalive)
· **Nebius Token Factory** (models) · optional **Upstash Redis Free** (send-processor lock, real mode only).
Zero spend.

## 1. Supabase
1. Create a free project. Copy the URL, anon key, service-role key, and the Postgres connection string.
2. `npx supabase link --project-ref <ref>` then `npx supabase db push` — applies `supabase/migrations/0001_schema.sql`.
3. **Free projects pause after ~7 days without activity.** Two independent daily pings prevent that:
   the Vercel cron (`vercel.json` → `/api/health?deep=1`) and the GitHub `keepalive.yml` workflow.
   Verify after the first week in the Supabase dashboard that the project has not paused.

## 2. Vercel (Hobby, personal account, Git-connected)
1. Import the public repo (Hobby cannot connect to organisation repos).
2. Environment variables (Production) — the complete list:

   ```
   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
   NEBIUS_API_KEY                      platform key: pays for guest demos (and owners, unless PLATFORM_KEY_FOR_OWNERS=false)
   TAVILY_API_KEY                      platform key: guest demos search for real, capped by TAVILY_DAILY_BUDGET (150) and DEMO_SEARCH_QUERIES (3)
   AUTH_SECRET, CRON_SECRET            openssl rand -base64 32 each
   APP_URL, NEXT_PUBLIC_BASE_URL       https://<app>.vercel.app
   AUTH_TRUST_HOST=true
   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   (real mode; see §6)
   NEBIUS_DAILY_TOKEN_BUDGET=2000000, NEGOTIATION_ULTRA_CAP=20, TICKS_PER_CAMPAIGN_PER_DAY=120, GUEST_MAX_TICKS=60, GUEST_CONCURRENT=2, GUEST_PER_DAY=5, GUEST_GLOBAL_PER_DAY=20
   PLAYWRIGHT_ENABLED=false, DEMO_REPLY_DELAY_MS=0
   ```
   Leave `OWNER_EMAILS`/`ALLOWED_DOMAINS` empty for open sign-up (bring-your-own-keys), set them for
   a private deployment. Never set `DEV_OWNER_EMAIL` on Vercel.
   Real mode adds Google OAuth (and `OWNER_EMAILS` only for a private deployment; by default any Google
   account is an owner who brings their own keys). `TAVILY_API_KEY`/`NEBIUS_API_KEY` on the server are
   platform defaults; set `PLATFORM_KEY_FOR_OWNERS=false` to make owners use their own Nebius key.
3. Function duration: routes declare `maxDuration` ≤ 60 s except `/api/cron/tick` (300 s). With Fluid
   compute on (default for new projects) Hobby allows 300 s; a tick is bounded to 45 s regardless.
4. Cron: Hobby allows once-a-day crons only; the daily health ping is the only Vercel cron.

## 3. GitHub Actions (the scheduler)
Repository secrets: `APP_URL`, `CRON_SECRET` (same value as on Vercel).
- `tick.yml` — every 5 minutes → `POST /api/cron/tick`. Steps every due real campaign (demo campaigns
  are stepped by the page while it is open, and also picked up here if left running), then runs the
  real-mode transport: reads replies over IMAP from each owner's Gmail and sends every due email.
  Idle campaigns cost no model call; the sweep is an IMAP login per owner with outstanding mail.
- `keepalive.yml` — daily deep health check; a non-200 fails the job and emails you.
- **GitHub disables scheduled workflows after 60 days with no repository activity.** Oct 30 → Dec 15
  is 46 days. Add a calendar reminder: **push a trivial commit around Nov 20** (or open the Actions
  tab and re-enable) so the scheduler and keepalive keep running through judging.

## 4. Nebius credits
`NEBIUS_DAILY_TOKEN_BUDGET` (default 2,000,000 tokens ≈ $0.60/day at a Super/Nano mix) is a hard
stop: on breach every campaign pauses with a banner and resumes the next day. Check
`/api/health?deep=1` → `tokens_today`. A demo arc costs ≈ $0.005–0.02; 20 guest demos a day is well
under a dollar.

## 5. Monitoring
- **Uptime:** add the deployment URL to a free monitor (e.g. UptimeRobot, 5-min HTTP check on
  `/api/health`) with email alerts, through Dec 15.
- **Meters:** Vercel → Usage. The budget is Active CPU (4 h/month); a month of the demo running at
  the caps uses well under an hour. Runtime logs keep one hour; `agent_events` keeps everything.
- **Hobby terms:** non-commercial use only. This is a hackathon demo; do not attach payments or sell
  access on this deployment.

## 6. Owner sign-in (real mode)
Google Cloud → OAuth client (Web) → redirect URI `https://<app>/api/auth/callback/google`. Set
`GOOGLE_CLIENT_ID/SECRET`, `AUTH_TRUST_HOST=true` (and `OWNER_EMAILS` only if the deployment should
be private). Each owner signs in, opens Settings, saves their Nebius key, Gmail app password and
Tavily key, and presses the three **Test** buttons. Real mode then appears on Setup.
