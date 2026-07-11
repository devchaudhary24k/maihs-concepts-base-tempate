# Dev-container base image for the AI website builder.
#
# This image bakes the template repo + a warm node_modules so a container can be
# spun up and developed in immediately (`next dev` with a local Miniflare D1).
# It is NOT a production artifact — production runs on Cloudflare Workers via
# `opennextjs-cloudflare build` + `wrangler deploy`, not this image.
FROM node:22-bookworm-slim

# System deps:
# - git: the orchestrator clones/commits inside the container
# - build toolchain: fallback for native deps (sharp / esbuild / unrs-resolver)
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
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

# Install dependencies first so this layer is cached unless the lockfile changes.
# node_modules is built inside the image (correct linux binaries) — not copied.
COPY --chown=concept:concept package.json pnpm-lock.yaml .npmrc ./
USER concept
RUN pnpm install --frozen-lockfile

# Copy the rest of the repo (see .dockerignore for exclusions).
COPY --chown=concept:concept . .
RUN mkdir -p /app/.next /app/.wrangler /app/.open-next

# next dev listens here. The orchestrator reverse-proxies this into the preview UI.
EXPOSE 3000
# Agent daemon (WebSocket RPC) — orchestrator drives file ops, shell, ts/eslint here.
EXPOSE 4000

# Defaults overridable by the orchestrator. PAYLOAD_SECRET is injected at runtime
# (never baked into this public image). Bind 0.0.0.0 so the proxy can reach the
# dev server; the local D1 SQLite lives in /app/.wrangler (mount a volume there
# to persist data across container restarts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const net=require('node:net');const s=net.connect(Number(process.env.AGENT_PORT||4000),'127.0.0.1',()=>process.exit(0));s.on('error',()=>process.exit(1));s.setTimeout(3000,()=>process.exit(1));"

# PID 1 is the agent daemon. It spawns `pnpm exec next dev -H 0.0.0.0` as a
# child and exits when the last WS client has been gone for GRACE_MS, which
# also terminates the container.
CMD ["node", "/app/.agent/server.mjs"]
