# Deployment

## Quick Start (Docker Compose)

```bash
# From the repo root:
docker compose up --build
```

This starts:

| Service | URL | What |
|---------|-----|------|
| **Server** | `http://localhost:2567` | Colyseus game server (WebSocket + HTTP) |
| **Client** | `http://localhost:8080` | Phaser game client (static) |

The client connects to the server via `ws://localhost:2567` (baked in at build time via `VITE_BACKEND_URL`).

SQLite data persists in a Docker volume (`server-data`). Stop with `Ctrl+C`; data survives restarts. To wipe: `docker compose down -v`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `2567` | Colyseus server port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | Set to `production` for JSON logging, playground disabled, monitor auth required |
| `DATABASE_URL` | `sqlite://./data/maple.db` | SQLite file path (or Postgres URL, driver not yet installed) |
| `CORS_ORIGIN` | `*` | Allowed CORS origin(s) |
| `MONITOR_SECRET` | — | Required in production to access `/monitor`. Pass as `?token=` or `X-Monitor-Token` header |
| `VITE_BACKEND_URL` | `ws://localhost:2567` | **Client only** — WebSocket URL the browser connects to. Set at **build time** |

## Health Checks

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `GET /health` | Liveness (existing) | None |
| `GET /healthz` | Liveness (Kubernetes-style) | None |
| `GET /metrics` | CCU, room count, uptime (ms) | None |
| `GET /channels?mapId=dawn_isle` | Channel player counts | None |
| `GET /monitor` | Colyseus state inspector | `MONITOR_SECRET` in production |

## Server Docker Image

The server runs directly from TypeScript source via `tsx` (the `@maple/shared` package ships raw `.ts` files, so a compiled-JS approach would need extra build steps).

```bash
# Build
docker build -t cryptomaple-server ./packages/server

# Run
docker run -p 2567:2567 \
  -e DATABASE_URL=sqlite://./data/maple.db \
  -e CORS_ORIGIN=* \
  -v maple-data:/app/data \
  cryptomaple-server
```

## Client — Static Hosting

The client is a static Vite build. Serve `packages/client/dist/` from any static host.

```bash
# Build (set the server URL at build time)
VITE_BACKEND_URL=wss://your-server.example.com \
  pnpm --filter @maple/client build

# Serve dist/ with nginx, Caddy, Netlify, Cloudflare Pages, etc.
```

The built assets use **relative paths** (`base: "./"`) so they work behind any reverse proxy or subdirectory.

### nginx config

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;

  location / {
    try_files $uri $uri/ /index.html;  # SPA fallback
  }
}
```

## Database Persistence

SQLite data lives at the path in `DATABASE_URL` (default `./data/maple.db`). In Docker, mount a volume to `/app/data` to persist across container restarts.

Schema migrations run automatically on server start.

## Reverse Proxy (nginx / Caddy)

For production with a domain, put both services behind a single reverse proxy:

```nginx
# WebSocket + HTTP for the game server
location /ws {
  proxy_pass http://localhost:2567;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}

# Static client
location / {
  root /path/to/client/dist;
  try_files $uri $uri/ /index.html;
}
```

Set `VITE_BACKEND_URL=wss://your-domain.com` before building the client so the browser connects to the correct WebSocket endpoint.
