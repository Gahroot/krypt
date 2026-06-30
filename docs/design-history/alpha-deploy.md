# Plan: Make Alpha Deployable

**Goal:** Docker-ready server + static-hosted client, structured logging, health/metrics, env-driven config, deployment docs.

---

## 1. Structured Logger — `packages/server/src/logger.ts` (NEW)

Lightweight JSON logger (no deps). `process.env.NODE_ENV === "production"` → JSON; otherwise human-readable.
Export `log.info()`, `log.warn()`, `log.error()` accepting `(msg, meta?)`.

## 2. Env Config — `packages/server/src/app.config.ts` (MODIFY)

Current state: `/health` exists, CORS is imported but not wired, `/monitor` is unprotected.
Changes:
- Add `cors` middleware reading `CORS_ORIGIN` env (default `*`).
- Add structured request-logging middleware (logs method, path, status, duration).
- Add `/healthz` (liveness probe — `200 { status: "ok" }`).
- Add `/metrics` endpoint using `matchMaker.stats.local` (CCU, room count) + uptime.
- Log server lifecycle (room create/dispose) via Express-level middleware only — don't touch room files.
- Protect `/monitor` behind `MONITOR_SECRET` env in production.

## 3. Server Entry — `packages/server/src/index.ts` (MODIFY)

Read `HOST` env (default `0.0.0.0`). Structured startup log with port, host, NODE_ENV.

## 4. Server Dockerfile — `packages/server/Dockerfile` (NEW)

Multi-stage:
1. **Builder:** `node:20-alpine`, pnpm, install, `tsc` (server) + type-check shared
2. **Runner:** `node:20-alpine`, pnpm, copy `build/` + `node_modules`, `node build/index.js`

Wait — shared has no build step (consumed as raw TS). Server `tsc` with `moduleResolution: "Bundler"` will emit JS that imports from `@maple/shared`, but at runtime the `workspace:*` link points to `shared/src/index.ts`. In the runner stage, `tsx` is the safest runtime for TS imports. So: runner uses `npx tsx src/index.ts` or we install tsx.

Better approach: **single-stage Dockerfile**, just `node:20-alpine`, pnpm install, `node --import tsx src/index.ts` (tsx handles TS imports). This is simpler and avoids the shared-TS problem entirely.

## 5. Client Dockerfile — `packages/client/Dockerfile` (NEW)

Multi-stage:
1. **Builder:** `node:20-alpine`, pnpm, install, `VITE_BACKEND_URL` build-arg, `vite build`
2. **Runner:** `nginx:alpine`, copy `dist/`, nginx config for SPA fallback + static serving

## 6. Docker Compose — `docker-compose.yml` (NEW)

Two services:
- **server:** builds `./packages/server`, exposes `PORT`, env for `CORS_ORIGIN`, `DATABASE_URL`, healthcheck via `/healthz`
- **client:** builds `./packages/client` with `VITE_BACKEND_URL` arg, serves on port 8080→80, depends_on server

## 7. `.dockerignore` (NEW, root)

Ignore `node_modules`, `**/node_modules`, `.git`, `packages/*/build`, `packages/*/dist`, `data/`, `.env`.

## 8. `.env.example` (MODIFY)

Add `HOST=0.0.0.0`, `CORS_ORIGIN=*`, `MONITOR_SECRET=changeme`.

## 9. `docs/DEPLOY.md` (NEW)

Sections: Prerequisites, Quick Start (docker-compose), Manual Deploy (server Docker + client static), Environment Variables table, Health Checks, Database Persistence, Reverse Proxy.

## 10. `README.md` (MODIFY)

Add a "Deployment" section after "Verify the backend" with quick-start + pointer to `docs/DEPLOY.md`.

## 11. Client Vite Config — `packages/client/vite.config.ts` (MODIFY)

Add `base: "./"` so built assets use relative paths (works behind any reverse proxy / subpath).

---

## Execution Order

1. `packages/server/src/logger.ts` — new file
2. `packages/server/src/app.config.ts` — modify
3. `packages/server/src/index.ts` — modify
4. `.env.example` — modify
5. `packages/client/vite.config.ts` — modify
6. `packages/server/Dockerfile` — new file
7. `packages/client/Dockerfile` — new file
8. `.dockerignore` — new file
9. `docker-compose.yml` — new file
10. `docs/DEPLOY.md` — new file
11. `README.md` — modify
12. Verify: `pnpm build` (server tsc + client vite build)
13. Mark task done
