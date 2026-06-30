# ─── CryptoMaple Client — Build ──────────────────────────────────────────────
FROM node:20-alpine AS build

RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

WORKDIR /app

# Install dependencies (layer cache).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile

# Copy source.
COPY packages/shared/ packages/shared/
COPY packages/client/ packages/client/

ARG VITE_BACKEND_URL=ws://localhost:2567
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
RUN pnpm --filter @maple/client build

# ─── Serve ───────────────────────────────────────────────────────────────────
FROM nginx:alpine

# SPA fallback — serve index.html for all non-file routes.
RUN echo 'server { listen 80; root /usr/share/nginx/html; location / { try_files $uri $uri/ /index.html; } }' \
  > /etc/nginx/conf.d/default.conf

COPY --from=build /app/packages/client/dist /usr/share/nginx/html

EXPOSE 80
