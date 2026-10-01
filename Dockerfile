# syntax=docker/dockerfile:1
# Production images.
#   Web app (Next.js standalone output):  docker build -t whatsflow-web .
#   Background worker (webhooks, later campaigns):  docker build --target worker -t whatsflow-worker .
# Run migrations separately before starting: `npx prisma migrate deploy`.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]

# Background worker: runs worker/index.ts with the same source and dependencies.
FROM node:22-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production SERVICE_NAME=worker
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/src ./src
COPY --from=builder --chown=app:app /app/worker ./worker
COPY --from=builder --chown=app:app /app/package.json /app/tsconfig.json ./
USER app
CMD ["npx", "tsx", "--conditions=react-server", "worker/index.ts"]
