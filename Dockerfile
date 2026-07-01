# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Pin pnpm to the version declared by package.json for reproducible builds.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.34.4 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --config.dangerously-allow-all-builds=true

COPY tsconfig.json tsup.config.ts ./
COPY scripts ./scripts
COPY src ./src
COPY web ./web
RUN pnpm run build && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="TorLink++" \
  org.opencontainers.image.description="Torlink fork with Torznab API, Web GUI, qBittorrent handoff, and embedded native TUI" \
  org.opencontainers.image.source="https://github.com/calmasacow/TorLink-PlusPlus" \
  org.opencontainers.image.url="https://github.com/calmasacow/TorLink-PlusPlus" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.authors="Original Torlink by bairon; TorLink++ fork by calmasacow"

ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system torlink \
  && useradd --system --create-home --gid torlink torlink \
  && mkdir -p /downloads \
  && chown torlink:torlink /downloads

COPY --from=builder --chown=torlink:torlink /app/package.json ./package.json
COPY --from=builder --chown=torlink:torlink /app/node_modules ./node_modules
COPY --from=builder --chown=torlink:torlink /app/dist ./dist
COPY --from=builder --chown=torlink:torlink /app/web ./web

EXPOSE 9117

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http=require('node:http'); const req=http.get('http://127.0.0.1:9117/health',res=>process.exit(res.statusCode===200?0:1)); req.on('error',()=>process.exit(1)); req.setTimeout(3000,()=>{req.destroy(); process.exit(1);});"

CMD ["sh", "-c", "mkdir -p /downloads && chown -R torlink:torlink /downloads && exec runuser -u torlink -- env HOME=/home/torlink XDG_CONFIG_HOME=/home/torlink/.config XDG_DATA_HOME=/home/torlink/.local/share node dist/index.js serve"]
