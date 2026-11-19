# Flawtrace Cloud: the gateway and the customer processes it starts, in one image.
# Build:  docker build -t flawtrace-cloud .
# Run it through docker-compose.yml (it adds HTTPS and the data volume).
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    QA_PLAYWRIGHT_MCP_BIN=/opt/pw/node_modules/.bin/playwright-mcp \
    QA_PLAYWRIGHT_NO_SANDBOX=1 \
    npm_config_cache=/data/npm-cache \
    CLOUD_DATA=/data \
    CLOUD_HOST=0.0.0.0 \
    CLOUD_PORT=8080 \
    TRUST_PROXY=1

# git: the repository helper clones the customer's repositories. bash and tar: the helper scripts. tini: clean shutdown.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git bash tar ca-certificates tini curl \
 && rm -rf /var/lib/apt/lists/*

# The browser the UI-test agent drives, installed once at build time (no download when a customer starts a run).
# The Playwright MCP version is the one the app is written for (lib/playwright-cmd.js).
RUN mkdir -p /opt/pw /ms-playwright \
 && cd /opt/pw && npm init -y >/dev/null \
 && npm install --no-audit --no-fund @playwright/mcp@0.0.85 \
 && npx playwright install --with-deps chromium \
 && chmod -R a+rX /ms-playwright /opt/pw \
 && rm -rf /var/lib/apt/lists/*

# The app keeps its layout: ROOT holds agents/ and knowledge/, agent-ui/ holds the code.
WORKDIR /app
COPY agents /app/agents
COPY knowledge /app/knowledge
COPY agent-ui /app/agent-ui

# Customers' processes run as this user, never as root.
RUN useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin flawtrace \
 && mkdir -p /data && chown flawtrace /data
USER flawtrace

EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "agent-ui/cloud/server.js"]
