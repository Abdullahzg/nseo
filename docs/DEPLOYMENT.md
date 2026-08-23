# Deployment

Two services deploy to Google Cloud Run. Everything is scripted; no console clicking required.

## Prerequisites

- `gcloud` CLI installed, authenticated (`gcloud auth login`), with a billing-enabled project
- A Supabase project (cloud) — run `node scripts/run-migrations.mjs` against its `DATABASE_URL`
  once before deploying (all migrations are idempotent)
- Google OAuth client (Web application) with redirect URI
  `https://<web-service-url>/api/auth/callback/google`

## One-command deploy

```bash
export GCP_PROJECT=my-project
export GCP_REGION=us-central1

# Secrets the script pushes to Secret Manager:
export SUPABASE_URL=... SUPABASE_ANON=... SUPABASE_SERVICE=...
export DATABASE_URL=...            # used by the ADK session service
export AUTH_SECRET=REDACTED rand -base64 32)   # keep byte-stable forever (encrypts Gmail app passwords)
export GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=...
export GEMINI_API_KEY=...
export CRON_SECRET=REDACTED rand -hex 24)
export AGENT_SERVICE_TOKEN=REDACTED rand -hex 24)

bash deploy/deploy.sh
```

The script:

1. Enables Cloud Run / Artifact Registry / Secret Manager / Cloud Scheduler / Cloud Build
2. Pushes secrets to Secret Manager
3. Builds + deploys **web** (Next.js) from the repo root Dockerfile
4. Builds + deploys **agents** (ADK service) from `agents/Dockerfile`
5. Wires `AGENT_SERVICE_URL` into web so ticks route to the ADK brain
6. Creates a Cloud Scheduler job → `/api/emails/process` every 30 min
   (burst sends + IMAP reply detection + follow-ups — the proven processor)

## Post-deploy checklist

- [ ] Add the deployed web URL as an authorized OAuth redirect URI in Google Cloud Console
- [ ] Set `ALLOWED_DOMAINS` (deploy.sh default keeps the repo value; adjust in Secret Manager)
- [ ] Visit `/api/health` on both services → `{"ok":true}`
- [ ] Create one campaign in demo mode first; watch `/campaigns/[id]`
- [ ] Capture proof for submission: Cloud Run services page, Scheduler job, a live campaign timeline

## Local parity stack (no cloud needed)

```bash
docker run -d --name seo-pg -e POSTGRES_PASSWORD=seo123 -e POSTGRES_DB=seo -p 5433:5432 postgres:latest
docker run -d --name seo-pgrst -p 5441:3000 \
  -e PGRST_DB_URI="postgres://postgres:seo123@host.docker.internal:5433/seo" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=postgres postgrest/postgrest:latest
node scripts/dev-rest-proxy.mjs &          # /rest/v1 prefix → :5441
cp .env.example .env.local                 # point at 127.0.0.1:5440 + postgresql://…:5433/seo
npx next dev -p 3100
```

`.env.local` values that make the local stack work end-to-end are exactly what CI uses;
swapping to a cloud Supabase later = changing two URLs + keys.

## What runs where

| Concern | Local | Cloud |
|---|---|---|
| Postgres | docker `seo-pg` :5433 | Supabase |
| PostgREST | docker `seo-pgrst` via `dev-rest-proxy` :5440 | Supabase |
| Web app | `next dev -p 3100` | Cloud Run **web** |
| ADK agents | `uvicorn seo_workforce.main:app --port 8104` (optional) | Cloud Run **agents** |
| Tick trigger | UI auto-tick every 25s / "Tick now" | same + agent service loop |
| Send/reply processor | manual or scheduler | Cloud Scheduler → `/api/emails/process` |
