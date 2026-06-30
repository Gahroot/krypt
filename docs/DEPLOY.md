# Deployment

Two paths:

- **[Production — public server over `wss://`](#production--public-server-over-wss)** — a real domain, TLS, friends on other networks can join. **Use this to let remote testers in.**
- **[Local Docker Compose](#local-docker-compose)** — everything on `localhost`, no TLS. For development only; browsers on other machines cannot reach it and an `https://` page cannot open its `ws://`.

---

## Production — public server over `wss://`

The browser client is loaded from an `https://` page, so it can only open a **secure** WebSocket (`wss://`) to the game server — a plaintext `ws://` is blocked by the browser. We put **Caddy** in front of the Colyseus server; Caddy obtains real TLS certificates automatically and proxies `wss://` → the game server.

```
 tester's browser ──https──▶ play.example.com   (Caddy → static client container)
        │
        └──────────wss───────▶ api.example.com    (Caddy → Colyseus server :2567)
                                   terminates TLS, forwards the WebSocket upgrade
```

Files used:

| File | Role |
|------|------|
| `docker-compose.prod.yml` | server + client + Caddy + scheduled `backup`, persistent volumes |
| `Caddyfile` | auto-TLS reverse proxy for both domains |
| `.env.production.example` | template for domains + secrets (copy to `.env.production`) |
| `packages/server/Dockerfile`, `packages/client/Dockerfile` | the app images |

### Prerequisites (you must provide these)

1. **A host with a public IP** — any small VM works (≈1 vCPU / 1 GB is plenty). Examples: Hetzner Cloud, DigitalOcean Droplet, Fly.io Machine, AWS Lightsail, a Raspberry Pi with a port-forward. Install **Docker Engine + the Compose plugin** on it.
2. **A domain you control**, with two DNS records pointing at the host's public IP:
   - `api.example.com` → game server (`A` record, and `AAAA` if you have IPv6)
   - `play.example.com` → client
   (One apex domain is fine too; just pick two names you own.)
3. **Ports 80 and 443 open** to the internet on the host (Caddy needs `:80` for the ACME HTTP challenge and `:443` to serve). Open the firewall / security group accordingly.

> Caddy issues certificates via Let's Encrypt **only for domains that actually resolve to this host**. DNS must be live before you bring the stack up, or certificate issuance fails.

### Step 1 — Get the code on the host

```bash
git clone <your-repo-url> cryptomaple
cd cryptomaple
```

### Step 2 — Configure env + secrets

```bash
cp .env.production.example .env.production
```

Edit `.env.production`:

```bash
GAME_DOMAIN=api.example.com
CLIENT_DOMAIN=play.example.com
ACME_EMAIL=you@example.com

# Browser → game server. MUST be wss:// (https page can't open ws://).
VITE_BACKEND_URL=wss://api.example.com
# Only the client origin may call the API — never "*".
CORS_ORIGIN=https://play.example.com

# Generate a UNIQUE strong value for each:
AUTH_SECRET=...        # openssl rand -hex 32
MONITOR_SECRET=...     # openssl rand -hex 32
ADMIN_SECRET=...       # openssl rand -hex 32
```

Generate the three secrets:

```bash
for k in AUTH_SECRET MONITOR_SECRET ADMIN_SECRET; do echo "$k=$(openssl rand -hex 32)"; done
```

Paste the output into `.env.production`. `.env.production` is git-ignored — never commit it.

| Secret | Protects |
|--------|----------|
| `AUTH_SECRET` | Signs session tokens. A **stable** value means players stay logged in across server restarts; if unset the server boots with a random per-process secret and logs a loud warning. |
| `MONITOR_SECRET` | Gates `GET /monitor` (the Colyseus state inspector) in production. |
| `ADMIN_SECRET` | Gates the `/admin/*` moderation routes (ban / mute / kick / announce). |

### Step 3 — Bring the stack up

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

This builds both images, starts the server (waits until `/healthz` is healthy), builds the client with `VITE_BACKEND_URL` baked in, and starts Caddy. On first boot Caddy fetches certificates for both domains (watch progress with `docker compose -f docker-compose.prod.yml logs -f caddy`).

The app containers are **not** published to the host — only Caddy's `:80`/`:443` are exposed. SQLite persists in the `server-data` volume; certificates persist in `caddy-data` (so restarts don't re-request certs and hit rate limits).

### Step 4 — Verify (run from your laptop, not the server)

```bash
# 1) Health over HTTPS — expect {"status":"ok"}
curl https://api.example.com/healthz

# 2) /monitor is protected — expect 401 without the secret
curl -o /dev/null -w '%{http_code}\n' https://api.example.com/monitor
# …and reachable WITH it (a redirect or 200 → the inspector)
curl -o /dev/null -w '%{http_code}\n' "https://api.example.com/monitor?token=$MONITOR_SECRET"

# 3) Open the game
open https://play.example.com   # then create a character and play
```

Then have a friend on **another network** open `https://play.example.com`. Their browser connects to `wss://api.example.com` and they play on the same server.

> Verified locally with Caddy's internal CA before writing this doc: `/healthz` → `200 {"status":"ok"}`, `/monitor` → `401` without the token (and a redirect into the inspector with it), CORS reflected the client origin (not `*`), and a real Colyseus client joined a map room over `wss://` and received authoritative game state. On a public host the only difference is Caddy serving a publicly-trusted Let's Encrypt cert instead of its local CA.

### Updating / operating

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build   # redeploy

docker compose -f docker-compose.prod.yml logs -f server                              # tail logs
docker compose -f docker-compose.prod.yml down                                        # stop (keeps data)
docker compose -f docker-compose.prod.yml down -v                                     # stop + WIPE data
```

See [Backups & Restore](#backups--restore) below for the scheduled-backup service and the tested restore procedure.

### Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Caddy log: `obtaining certificate … failed` | DNS for the domain doesn't resolve to this host yet, or `:80`/`:443` aren't open. Fix DNS/firewall, then `docker compose … restart caddy`. |
| Browser console: *insecure WebSocket … blocked* | `VITE_BACKEND_URL` wasn't `wss://`. It's baked at **build** time — fix `.env.production` and rebuild with `up -d --build`. |
| Browser console: CORS error on `/auth/*` | `CORS_ORIGIN` doesn't exactly match the client origin (`https://CLIENT_DOMAIN`, no trailing slash). |
| Players logged out after every restart | `AUTH_SECRET` is unset → ephemeral secret. Set a stable value. |
| `502 Bad Gateway` from Caddy | The server container is unhealthy. Check `logs server`. |

### Single-VM variant (one domain)

To serve everything from one box but you only have one hostname, keep the same `Caddyfile` and set `CLIENT_DOMAIN` to a subdomain of the same apex (e.g. `play.example.com` + `api.example.com`). Hosting the static client elsewhere (Cloudflare Pages, Netlify) also works — just build it with `VITE_BACKEND_URL=wss://api.example.com` and set `CORS_ORIGIN` to that static origin.

---

## Local Docker Compose

For development on one machine (no TLS, `localhost` only):

```bash
docker compose up --build
```

| Service | URL | What |
|---------|-----|------|
| **Server** | `http://localhost:2567` | Colyseus game server (WebSocket + HTTP) |
| **Client** | `http://localhost:8080` | Phaser game client (static) |

The client connects via `ws://localhost:2567` (baked in at build time via `VITE_BACKEND_URL`). SQLite persists in the `server-data` volume; `docker compose down -v` wipes it.

This setup is **localhost-only** — remote machines can't reach it, and an `https://` page can't open its `ws://`. Use the production path above for remote testers.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `2567` | Colyseus server port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | Set to `production` for JSON logging, playground disabled, monitor auth required |
| `DATABASE_URL` | `sqlite://./data/maple.db` | SQLite file path (Postgres URL: driver not yet installed) |
| `CORS_ORIGIN` | `*` | Allowed CORS origin(s). Set to the client origin in production |
| `AUTH_SECRET` | _(ephemeral)_ | HMAC secret (≥16 chars) signing session tokens. Set in prod so sessions survive restarts |
| `AUTH_TOKEN_TTL_SECONDS` | `3600` | Session-token lifetime (clamped 60…2592000) |
| `MONITOR_SECRET` | — | Required in production to access `/monitor`. Pass as `?token=` or `X-Monitor-Token` header |
| `ADMIN_SECRET` | — | Required to access `/admin/*`. Pass as `?token=` or `X-Admin-Token` header |
| `VITE_BACKEND_URL` | `ws://localhost:2567` | **Client only** — WebSocket URL the browser connects to. Set at **build time**; must be `wss://` in production |
| `BACKUP_INTERVAL_SECONDS` | `86400` | `backup` service — seconds between snapshots (default daily) |
| `BACKUP_RETENTION` | `14` | Local snapshots to keep; oldest pruned |
| `BACKUP_DIR` | `<db-dir>/backups` | Where snapshots are written (`/app/data/backups` in prod) |
| `BACKUP_REMOTE_CMD` | — | Off-box upload command; `{}` is replaced with the snapshot path (e.g. `rclone copy {} remote:maple-backups`) |

## Health Checks

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `GET /health` | Liveness (existing) | None |
| `GET /healthz` | Liveness (Kubernetes-style) | None |
| `GET /metrics` | CCU, room count, uptime (ms) | None |
| `GET /channels?mapId=dawn_isle` | Channel player counts | None |
| `GET /monitor` | Colyseus state inspector | `MONITOR_SECRET` in production |
| `*  /admin/*` | Moderation (ban/mute/kick/announce/reports) | `ADMIN_SECRET` |

## Database Persistence

SQLite data lives at the path in `DATABASE_URL`. In production the named volume `server-data` is mounted at `/app/data` and `docker-compose.prod.yml` sets `DATABASE_URL=sqlite:///app/data/maple.db`, so **the database survives container restarts, rebuilds, and `docker compose down` / `up`** — only `down -v` (which deletes volumes) wipes it. The DB runs in WAL mode (`synchronous = NORMAL`), so a committed write is never lost to a process crash.

**Why SQLite for the alpha:** a single authoritative server process owns all writes; WAL gives concurrent reads and crash-safe commits. That is sufficient for alpha concurrency. Migrate to Postgres only when you run **multiple writer processes** or saturate a single box — the `DATABASE_URL` parser already recognises a `postgresql://` URL and errors clearly because the driver is not yet installed (see `packages/server/src/persistence/db.ts`).

### Migrations on a fresh boot

Schema migrations in `packages/server/src/persistence/migrations/*.sql` run automatically on every server start (`openDb` → `ensureMigrations`): each numbered file is applied once inside a transaction and recorded in `schema_migrations`, so a brand-new prod boot builds the full schema and an existing DB applies only what's pending. This is covered by automated tests — `test/dbMigration.ts` proves a fresh DB applies every migration and that re-opening is idempotent. Verify locally any time:

```bash
pnpm --filter @maple/server test   # includes dbMigration + dbBackup (restore) round-trips
```

## Backups & Restore

The restart guarantee above protects against crashes, **not** against a deleted volume, a dying disk, or a bad migration. Keep scheduled, off-box backups.

Backups use SQLite's **online backup API** (`db.backup()` in `scripts/db-backup.ts`): a consistent point-in-time snapshot taken while players are online — it never blocks gameplay and never copies a half-written page. Each snapshot is integrity-checked, gzipped, named `maple-<ISO-timestamp>.db.gz`, and pruned to `BACKUP_RETENTION`.

### Automated schedule (default: the `backup` service)

`docker-compose.prod.yml` includes a `backup` service (same image as the server, sharing the `server-data` volume). It snapshots every `BACKUP_INTERVAL_SECONDS` (default **daily**) into `/app/data/backups`, then ships each snapshot **off-box** via `BACKUP_REMOTE_CMD` — where `{}` is replaced by the snapshot path:

```bash
# in .env.production — pick the tool you have credentials for in the container:
BACKUP_INTERVAL_SECONDS=86400
BACKUP_RETENTION=14
BACKUP_REMOTE_CMD=rclone copy {} remote:maple-backups      # or: aws s3 cp {} s3://my-bucket/maple/
```

> ⚠️ If `BACKUP_REMOTE_CMD` is unset, snapshots live only in the local volume — that is **not** a real backup. Set an off-box target.

Check it's running and producing snapshots:

```bash
docker compose -f docker-compose.prod.yml logs -f backup
docker compose -f docker-compose.prod.yml exec backup ls -lh /app/data/backups
```

Trigger an immediate one-off snapshot (e.g. before a risky deploy):

```bash
docker compose -f docker-compose.prod.yml exec server node --import tsx packages/server/scripts/db-backup.ts
```

### Alternative: host cron

If you prefer the host's scheduler, run `scripts/backup-db.sh` from cron instead of the `backup` service. It snapshots inside the live server container, copies the file onto the host, and runs `BACKUP_REMOTE_CMD` for off-box:

```cron
# daily at 04:17
17 4 * * * cd /opt/cryptomaple && BACKUP_REMOTE_CMD='rclone copy {} remote:maple-backups' ./scripts/backup-db.sh >> /var/log/maple-backup.log 2>&1
```

### Restore procedure (tested)

`scripts/db-restore.ts` decompresses a snapshot, **integrity-checks it before touching the live DB**, then atomically swaps it in and clears WAL/SHM sidecars. The round-trip (backup → simulated data loss → restore → data intact) is covered by `test/dbBackup.ts`, which runs in CI.

```bash
# 1. STOP the server so nothing writes during the swap.
docker compose -f docker-compose.prod.yml stop server backup

# 2. Get the snapshot into the data volume (skip if it's already in /app/data/backups).
#    Pull it back from off-box first if needed, e.g. `rclone copy remote:maple-backups/<file> .`
docker compose -f docker-compose.prod.yml cp ./maple-<timestamp>.db.gz server:/app/data/backups/

# 3. Restore (replaces /app/data/maple.db). `run --rm` starts a throwaway server
#    container with the volume mounted but the game NOT serving.
docker compose -f docker-compose.prod.yml run --rm --no-deps server \
  node --import tsx packages/server/scripts/db-restore.ts /app/data/backups/maple-<timestamp>.db.gz

# 4. Start back up — migrations re-run automatically and are idempotent.
docker compose -f docker-compose.prod.yml up -d
```

Verify: `curl https://api.example.com/healthz` → `{"status":"ok"}`, then log in and confirm characters/mesos are present.

To rehearse a restore without Docker (what CI does), from `packages/server`:

```bash
DATABASE_URL=sqlite://./data/maple.db pnpm run db:backup    # → prints the snapshot path
DATABASE_URL=sqlite://./data/maple.db pnpm run db:restore ./data/backups/maple-<timestamp>.db.gz
```

## Server Docker Image

The server runs directly from TypeScript via `tsx` (the `@maple/shared` package ships raw `.ts`, so a compiled-JS approach would need extra build steps).

```bash
docker build -t cryptomaple-server -f packages/server/Dockerfile .
```

## Client — Static Hosting (host the client so testers just open a URL)

The client is a static Vite build that talks to an already-running `wss://` game
server. Build it once with that server URL **baked in** (it's read at build time
from `VITE_BACKEND_URL` — see `packages/client/src/backend.ts`), then drop
`packages/client/dist/` on any static host. Testers open the host's URL — no
local setup.

> **Prerequisite:** the game server is already deployed and reachable over
> `wss://` (see [Production — public server over `wss://`](#production--public-server-over-wss),
> or its “Single-VM variant”). Static hosting only covers the client.

### One command: build + deploy

`scripts/deploy-client.sh` bakes `VITE_BACKEND_URL` into a production build and
publishes `dist/` to the host you name. Run it from the repo root:

```bash
# Netlify (needs `npx netlify-cli`; auth via NETLIFY_AUTH_TOKEN + NETLIFY_SITE_ID, or `netlify link`)
VITE_BACKEND_URL=wss://api.example.com pnpm deploy:client netlify

# Cloudflare Pages (needs `npx wrangler`; auth via CLOUDFLARE_API_TOKEN; project via CF_PAGES_PROJECT)
VITE_BACKEND_URL=wss://api.example.com CF_PAGES_PROJECT=cryptomaple pnpm deploy:client cloudflare

# nginx / S3 / any static host — just build dist/, then copy it yourself
VITE_BACKEND_URL=wss://api.example.com pnpm deploy:client build
```

The script **refuses to run** without `VITE_BACKEND_URL` and warns if it isn't
`wss://` (an `https://` page can't open a plaintext `ws://`). It prints a
reminder to set the server's `CORS_ORIGIN` to the client origin.

### Last step (required): point the server's CORS at the client origin

The browser loads the client from one origin and calls the server's `/auth/*`
REST API on another, so the server must allow that origin. Set the server's
`CORS_ORIGIN` to the **exact** client origin — scheme + host, **no trailing
slash** — and restart it:

```bash
# e.g. Netlify gave you https://cryptomaple.netlify.app
CORS_ORIGIN=https://cryptomaple.netlify.app   # docker-compose.prod: edit .env.production, then `up -d`
```

If `CORS_ORIGIN` doesn't match, `/auth/*` calls fail with a CORS error in the
browser console and login never completes. (Default `*` works for a quick test
but must not be used in production.)

### Manual build (equivalent to `… deploy:client build`)

```bash
VITE_BACKEND_URL=wss://api.example.com pnpm --filter @maple/client build
# Serve dist/ with nginx, Caddy, Netlify, Cloudflare Pages, etc.
```

Built assets use **relative paths** (`base: "./"`) so they work behind any
reverse proxy or subdirectory. `packages/client/netlify.toml` and a copied-in
`_redirects` file configure the publish dir and a single-entry-point fallback
for Netlify / Cloudflare Pages.

### Verify (acceptance)

1. Open the public client URL. The **Welcome to CryptoMaple** login panel
   appears (Sign In / Register / Connect Wallet / Continue as Guest).
2. Open the browser console — there must be **no mixed-content** (`ws://`
   blocked) and **no CORS** errors.
3. Click **Continue as Guest** → you reach **Select Character** (“Create” /
   “Enter World”). That confirms the static client reached the hosted server
   over `wss://` and authenticated cross-origin.
