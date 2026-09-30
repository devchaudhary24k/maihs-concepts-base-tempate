FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

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

COPY --chown=concept:concept plain/package.json plain/pnpm-lock.yaml plain/.npmrc ./
USER concept
RUN pnpm install --frozen-lockfile

COPY --chown=concept:concept plain/ .
COPY --chown=concept:concept .agent/ .agent/
RUN mkdir -p /app/.next /app/.wrangler /app/.open-next

EXPOSE 3000
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const net=require('node:net');const s=net.connect(Number(process.env.AGENT_PORT||4000),'127.0.0.1',()=>process.exit(0));s.on('error',()=>process.exit(1));s.setTimeout(3000,()=>process.exit(1));"

CMD ["node", "/app/.agent/server.mjs"]
