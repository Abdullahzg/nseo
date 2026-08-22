FROM python:3.12-slim

WORKDIR /app
# Requirements first so a code edit does not reinstall the dependency layer.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# The browser is not optional in this image — reading bot-protected pages is Hermes's whole edge over
# Summit's own fetch, and that is disproportionately the high-authority publishers worth a link from.
# --with-deps pulls the OS libraries Chromium needs; python:3.12-slim has none of them, and a plain
# `playwright install chromium` fails at launch with a missing .so, not at build time.
RUN playwright install --with-deps chromium
COPY . .

# 8103, not forge's 8003. If both ever land on one host, muscle memory is what points a Summit
# deploy at the ads agent.
ENV PORT=8103
EXPOSE 8103

# 0.0.0.0 here is correct and is NOT the same as exposing the agent publicly: a container-local
# 127.0.0.1 would be unreachable even from the host, so the isolation has to happen at the publish step
# instead. docker-compose.yml publishes this as "127.0.0.1:8103:8103" so only the host's loopback — and
# therefore only Caddy — can reach it. Publishing it as "8103:8103" would bypass the password gate.
#
# On bare metal there is no container boundary, so bind loopback directly: see
# deploy/summit-hermes.service, which mirrors how forge runs this in production.
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT}"]
