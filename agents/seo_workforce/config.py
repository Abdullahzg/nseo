"""Environment configuration for the SEO Workforce agent service."""
import os


def _setup_gemini_env() -> None:
    """ADK/google-genai reads GOOGLE_API_KEY; our canonical name is GEMINI_API_KEY."""
    if not os.environ.get("GOOGLE_API_KEY") and os.environ.get("GEMINI_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = os.environ["GEMINI_API_KEY"]


_setup_gemini_env()

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")

# Next.js tool-gateway base URL, e.g. http://localhost:3000 or the Cloud Run URL.
AGENT_BASE_URL = os.environ.get("AGENT_BASE_URL", os.environ.get("APP_URL", "http://localhost:3000")).rstrip("/")
# Shared secret presented to the gateway (must match AGENT_SERVICE_TOKEN on the app).
AGENT_SERVICE_TOKEN=REDACTED "")

# Postgres URL for durable ADK sessions/state. Falls back to in-memory when unset.
DATABASE_URL = os.environ.get("DATABASE_URL", "")

SERVICE_PORT = int(os.environ.get("PORT", os.environ.get("AGENT_SERVICE_PORT", "8104")))


def sqlalchemy_url() -> str | None:
    """Convert a Postgres URL to SQLAlchemy async format for ADK session storage."""
    if not DATABASE_URL:
        return None
    url = DATABASE_URL
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://") and "+asyncpg" not in url:
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url
