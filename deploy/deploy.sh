#!/usr/bin/env bash
# Deploys the full stack to Google Cloud (Cloud Run + Artifact Registry + Secret Manager
# + Cloud Scheduler). Run from the repo root after `gcloud auth login`.
#
# Required env:
#   GCP_PROJECT, GCP_REGION        e.g. us-central1
#   SUPABASE_URL / ANON / SERVICE  existing Supabase project values
#   AUTH_SECRET                    stable app secret (also encrypts stored Gmail passwords)
#   GOOGLE_OAUTH_CLIENT_ID / _SECRET
#   GEMINI_API_KEY                 Google AI Studio key
#   CRON_SECRET, AGENT_SERVICE_TOKEN   shared ops/agent secrets (generate if absent)
set -euo pipefail

: "${GCP_PROJECT:?set GCP_PROJECT}"
: "${GCP_REGION:=us-central1}"

gcloud config set project "$GCP_PROJECT"

echo "▶ Enabling APIs"
for api in run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com cloudbuild.googleapis.com; do
  gcloud services enable "$api" --quiet
done

echo "▶ Artifact Registry"
gcloud artifacts repositories create seo-workforce --repository-format=docker --location="$GCP_REGION" --quiet 2>/dev/null || true

echo "▶ Secrets"
put_secret() { # name value
  printf '%s' "$2" | gcloud secrets create "$1" --data-file=- --quiet 2>/dev/null || \
    printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- --quiet
}
put_secret AUTH_SECRET            "${AUTH_SECRET:?}"
put_secret GEMINI_API_KEY         "${GEMINI_API_KEY:?}"
put_secret AGENT_SERVICE_TOKEN    "${AGENT_SERVICE_TOKEN:?}"
put_secret CRON_SECRET            "${CRON_SECRET:?}"
put_secret supabase-url           "${SUPABASE_URL:?}"
put_secret supabase-anon-key      "${SUPABASE_ANON:?}"
put_secret supabase-service-key   "${SUPABASE_SERVICE:?}"

ENV_WEB="NEXT_PUBLIC_SUPABASE_URL=secret:supabase-url:latest,NEXT_PUBLIC_SUPABASE_ANON_KEY=secret:supabase-anon-key:latest,SUPABASE_SERVICE_ROLE_KEY=secret:supabase-service-key:latest,AUTH_SECRET=REDACTED
ENV_AGENTS="AGENT_BASE_URL=https://web-$$-uc.a.run.app,AGENT_SERVICE_TOKEN=REDACTED

echo "▶ Build + deploy web (Next.js) to Cloud Run"
gcloud builds submit --tag "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/seo-workforce/web:latest" .
gcloud run deploy web --image "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/seo-workforce/web:latest" \
  --region "$GCP_REGION" --allow-unauthenticated --port 3000 --memory 1Gi \
  --set-env-vars "$ENV_WEB"

WEB_URL=$(gcloud run services describe web --region "$GCP_REGION" --format 'value(status.url)')
ENV_AGENTS="AGENT_BASE_URL=$WEB_URL,AGENT_SERVICE_TOKEN=REDACTED

echo "▶ Build + deploy agent service (ADK) to Cloud Run"
gcloud builds submit --tag "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/seo-workforce/agents:latest" ./agents
gcloud run deploy agents --image "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/seo-workforce/agents:latest" \
  --region "$GCP_REGION" --allow-unauthenticated --port 8080 --memory 1Gi --timeout 900 \
  --set-env-vars "$ENV_AGENTS"
AGENTS_URL=$(gcloud run services describe agents --region "$GCP_REGION" --format 'value(status.url)')
echo "  agents: $AGENTS_URL"

echo "▶ Wire AGENT_SERVICE_URL into the web service and redeploy config"
gcloud run deploy web --image "$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/seo-workforce/web:latest" \
  --region "$GCP_REGION" --allow-unauthenticated --port 3000 --memory 1Gi \
  --set-env-vars "$ENV_WEB,AGENT_SERVICE_URL=$AGENTS_URL" --quiet

echo "▶ Cloud Scheduler jobs (send/reply processor every 30 min)"
JOB_URL="$WEB_URL/api/emails/process?key=${CRON_SECRET:?}"
gcloud scheduler jobs create http emails-process --location "$GCP_REGION" \
  --schedule "*/30 * * * *" --uri "$JOB_URL" --http-method POST --quiet 2>/dev/null || true

echo "✅ Deployed. Web: $WEB_URL  Agents: $AGENTS_URL"
