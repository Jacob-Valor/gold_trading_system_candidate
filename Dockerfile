# syntax=docker/dockerfile:1
#
# Stage `base`   — shared runtime image
# Stage `deps`   — full node_modules incl. Prisma CLI (used by the `migrate` compose service)
# Stage `builder`— compiles the Next.js standalone output
# Stage `runner` — minimal production image: standalone server + static assets + generated prisma client

FROM node:26-alpine AS base
RUN apk add --no-cache openssl
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static
COPY --chown=node:node --from=builder /app/src/generated ./src/generated
# Keep Prisma schema/config alongside the standalone runtime for diagnostics.
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/prisma.config.ts ./
USER node
EXPOSE 3000
CMD ["node", "server.js"]