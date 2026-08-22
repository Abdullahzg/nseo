# SEO Workforce agent service (Google ADK) — Cloud Run image.
FROM python:3.12-slim AS base
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY seo_workforce ./seo_workforce

ENV PORT=8080
EXPOSE 8080
# Cloud Run injects $PORT; GEMINI_API_KEY / AGENT_BASE_URL / AGENT_SERVICE_TOKEN /
# DATABASE_URL arrive via Secret Manager-bound env vars at deploy time.
CMD ["sh", "-c", "uvicorn seo_workforce.main:app --host 0.0.0.0 --port ${PORT}"]
