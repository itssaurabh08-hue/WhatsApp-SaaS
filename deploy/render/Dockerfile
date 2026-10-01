# syntax=docker/dockerfile:1
# Single-container image for Render's free plan: the web app and the background
# worker run side by side (free plans have no background worker service).
# Used by render.yaml. For normal deployments use the root Dockerfile (separate images).

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
RUN npx prisma generate && npm run build && npm run build:worker

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    STORAGE_DRIVER=local \
    STORAGE_LOCAL_DIR=/app/.data/storage
RUN addgroup -S app && adduser -S app -G app
# Full dependencies: the worker and `prisma migrate deploy` need them.
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/prisma ./prisma
COPY --from=builder --chown=app:app /app/prisma.config.ts /app/package.json ./
COPY --chown=app:app deploy/start.sh ./start.sh
RUN chmod +x start.sh && mkdir -p /app/.data/storage && chown -R app:app /app/.data
USER app
CMD ["./start.sh"]
