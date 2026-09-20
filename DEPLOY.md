# DEPLOY.md — free hosting that stays alive through judging (Dec 1–15, 2026)

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
2. Environment variables (Production): everything in `.env.example` under Database, Nebius and
   Secrets, plus `APP_URL`/`NEXT_PUBLIC_BASE_URL` = the deployment URL, `PLAYWRIGHT_ENABLED=false`.
   Real mode adds Google OAuth, `OWNER_EMAILS`, `TAVILY_API_KEY`.
3. Function duration: routes declare `maxDuration` ≤ 60 s except `/api/cron/tick` (300 s). With Fluid
   compute on (default for new projects) Hobby allows 300 s; a tick is bounded to 45 s regardless.
4. Cron: Hobby allows once-a-day crons only; the daily health ping is the only Vercel cron.

## 3. GitHub Actions (the scheduler)
Repository secrets: `APP_URL`, `CRON_SECRET` (same value as on Vercel).
- `tick.yml` — every 5 minutes → `POST /api/cron/tick`. Steps every due real campaign (demo campaigns
  are stepped by the page while it is open, and also picked up here if left running).
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
`GOOGLE_CLIENT_ID/SECRET`, `OWNER_EMAILS=you@example.com`, `AUTH_TRUST_HOST=true`. Sign in, open
Settings, save a Gmail app password, press **Test login**. Real mode then appears on Setup.
