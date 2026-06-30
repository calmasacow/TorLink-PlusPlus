# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder

WORKDIR /app

# Pin pnpm to the version declared by package.json for reproducible builds.
RUN corepack enable && corepack prepare pnpm@10.34.4 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --config.dangerously-allow-all-builds=true

COPY tsconfig.json tsup.config.ts ./
COPY scripts ./scripts
COPY src ./src
COPY web ./web
RUN pnpm run build && pnpm prune --prod

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S torlink && adduser -S torlink -G torlink

COPY --from=builder --chown=torlink:torlink /app/package.json ./package.json
COPY --from=builder --chown=torlink:torlink /app/node_modules ./node_modules
COPY --from=builder --chown=torlink:torlink /app/dist ./dist
COPY --from=builder --chown=torlink:torlink /app/web ./web

USER torlink

EXPOSE 9117

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http=require('node:http'); const req=http.get('http://127.0.0.1:9117/health',res=>process.exit(res.statusCode===200?0:1)); req.on('error',()=>process.exit(1)); req.setTimeout(3000,()=>{req.destroy(); process.exit(1);});"

CMD ["node", "dist/index.js", "serve"]
