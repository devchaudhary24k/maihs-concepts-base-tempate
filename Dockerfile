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

WORKDIR /app

# Install dependencies first so this layer is cached unless the lockfile changes.
# node_modules is built inside the image (correct linux binaries) — not copied.
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# Copy the rest of the repo (see .dockerignore for exclusions).
COPY . .

# next dev listens here. The orchestrator reverse-proxies this into the preview UI.
EXPOSE 3000
# Agent daemon (WebSocket RPC) — orchestrator drives file ops, shell, ts/eslint here.
EXPOSE 4000

# Defaults overridable by the orchestrator. PAYLOAD_SECRET is injected at runtime
# (never baked into this public image). Bind 0.0.0.0 so the proxy can reach the
# dev server; the local D1 SQLite lives in /app/.wrangler (mount a volume there
# to persist data across container restarts).
ENV NODE_ENV=development \
    NODE_OPTIONS=--no-deprecation
# PID 1 is the agent daemon. It spawns `pnpm exec next dev -H 0.0.0.0` as a
# child and exits when the last WS client has been gone for GRACE_MS, which
# also terminates the container.
CMD ["node", "/app/.agent/server.mjs"]
