# ─── CryptoMaple Server ──────────────────────────────────────────────────────
# Single-stage: runs source with tsx (shared package ships raw TS, so compiled
# JS can't resolve it without a TS-aware runtime).
FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

WORKDIR /app

# Install dependencies first (layer cache).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile

# Copy source.
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/

ENV NODE_ENV=production
EXPOSE 2567

# tsx runs directly from source — shared's "main" points at raw TS.
CMD ["node", "--import", "tsx", "packages/server/src/index.ts"]
