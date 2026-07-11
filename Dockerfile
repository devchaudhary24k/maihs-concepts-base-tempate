# Runtime shared by the generated-site template and clean repository imports.
FROM node:22-bookworm-slim AS runtime

# System deps:
# - git: the orchestrator clones/commits inside the container
# - build toolchain: fallback for native deps (sharp / esbuild / unrs-resolver)
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 python3-venv make g++ \
  && rm -rf /var/lib/apt/lists/*

# Enable pnpm via corepack (version pinned by package.json "packageManager").
RUN corepack enable

RUN groupadd --system --gid 10001 concept \
  && useradd --system --uid 10001 --gid concept --home-dir /home/concept --create-home concept

ENV NODE_ENV=development \
    NODE_OPTIONS=--no-deprecation \
    NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    HOME=/home/concept \
    PNPM_HOME=/home/concept/.local/share/pnpm \
    PATH=/home/concept/.local/share/pnpm:$PATH

WORKDIR /app
RUN mkdir -p /app /home/concept/.local/share/pnpm \
  && chown -R concept:concept /app /home/concept

EXPOSE 3000 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const net=require('node:net');const s=net.connect(Number(process.env.AGENT_PORT||4000),'127.0.0.1',()=>process.exit(0));s.on('error',()=>process.exit(1));s.setTimeout(3000,()=>process.exit(1));"

# Clean import image: system runtimes + the agent, with no website under /app.
FROM runtime AS import-runtime

RUN mkdir -p /opt/maihs-agent \
  && npm install --prefix /opt/maihs-agent --omit=dev ws@8.21.0 typescript@5.7.3
COPY --chown=concept:concept .agent/server.mjs /opt/maihs-agent/server.mjs

USER concept
ENV DEV_CMD="node -e setInterval(()=>{},2147483647)"
CMD ["node", "/opt/maihs-agent/server.mjs"]

# Generated-site builder image: template source + warm node_modules.
FROM runtime AS builder

# Install dependencies first so this layer is cached unless the lockfile changes.
# node_modules is built inside the image (correct linux binaries) — not copied.
COPY --chown=concept:concept package.json pnpm-lock.yaml .npmrc ./
USER concept
RUN pnpm install --frozen-lockfile

# Copy the rest of the repo (see .dockerignore for exclusions).
COPY --chown=concept:concept . .
RUN mkdir -p /app/.next /app/.wrangler /app/.open-next

# Defaults overridable by the orchestrator. PAYLOAD_SECRET is injected at runtime
# (never baked into this public image). Bind 0.0.0.0 so the proxy can reach the
# dev server; the local D1 SQLite lives in /app/.wrangler (mount a volume there
# to persist data across container restarts).
# PID 1 is the agent daemon. It spawns `pnpm exec next dev -H 0.0.0.0` as a
# child and exits when the last WS client has been gone for GRACE_MS, which
# also terminates the container.
CMD ["node", "/app/.agent/server.mjs"]
