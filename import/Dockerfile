FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 python3-venv make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

RUN groupadd --system --gid 10001 concept \
  && useradd --system --uid 10001 --gid concept --home-dir /home/concept --create-home concept \
  && mkdir -p /app /opt/maihs-agent /home/concept/.local/share/pnpm \
  && chown -R concept:concept /app /home/concept

RUN npm install --prefix /opt/maihs-agent --omit=dev ws@8.21.0 typescript@5.7.3
COPY --chown=concept:concept .agent/server.mjs /opt/maihs-agent/server.mjs

ENV NODE_ENV=development \
    NODE_OPTIONS=--no-deprecation \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    HOME=/home/concept \
    PNPM_HOME=/home/concept/.local/share/pnpm \
    PATH=/home/concept/.local/share/pnpm:$PATH \
    DEV_CMD="node -e setInterval(()=>{},2147483647)"

WORKDIR /app
USER concept

EXPOSE 3000 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const net=require('node:net');const s=net.connect(Number(process.env.AGENT_PORT||4000),'127.0.0.1',()=>process.exit(0));s.on('error',()=>process.exit(1));s.setTimeout(3000,()=>process.exit(1));"

CMD ["node", "/opt/maihs-agent/server.mjs"]
