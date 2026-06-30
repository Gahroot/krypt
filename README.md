# CryptoMaple (working title)

A 2D side-scroller MMORPG with a **player-owned free market**. Grind mobs → gear drops with rarity/potential
→ trade it. The spiritual successor to old-school MapleStory's Free Market + MTS.

> **North Star: build a game that's too good to fail.** A genuinely great standalone MMORPG comes first.
> The crypto economy (un-killable market, provably-fair drops, true ownership) is a *bonus* layer — never
> the reason to play. See [`PLANNING.md`](./PLANNING.md).

## Docs

- [`PLANNING.md`](./PLANNING.md) — vision, research, systems, tokenomics, architecture, risks, roadmap.
- [`WORLD.md`](./WORLD.md) — the world/content spine: the "calm start → a little bit of everything" arc.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — verified technical patterns + the on-chain mint design.

## Monorepo layout

```
packages/
  shared/     plain TS — rarity / stats / classes / items / mobs (one source of truth, unit-tested)
  server/     Colyseus authoritative game server (combat, mesos, drops, soft market)
  client/     Phaser 3 + Vite browser client
  contracts/  Foundry — on-chain items + market (Phase 2, deferred)
```

## Stack

- **Client:** Phaser 3 + Vite + TypeScript
- **Server:** Colyseus (authoritative, anti-cheat by design)
- **Chain (Phase 2):** Base (Ethereum L2), Solidity + Foundry, OpenZeppelin v5, Chainlink VRF 2.5
- **Tooling:** pnpm workspaces, Node ≥ 20, TypeScript strict

## Getting started

```bash
nvm use                # Node 20+ (see .nvmrc)
cp .env.example .env   # optional — localhost defaults already work
pnpm install
pnpm dev               # starts the server + client together, in parallel
```

Then open **http://localhost:5173** in your browser.

One command (`pnpm dev`) runs both workspaces in parallel: the Colyseus game server
(`@maple/server`, `ws://localhost:2567`) and the Vite client (`@maple/client`,
`http://localhost:5173`). Leave it running; both hot-reload on save.

### Git hooks (quality gates)

`pnpm install` installs [Lefthook](https://lefthook.dev) git hooks automatically (root
`prepare` → `lefthook install`), so a **fresh clone is protected after the first install** —
no manual setup. Config lives in [`lefthook.yml`](./lefthook.yml).

| Hook | Runs on | Checks |
| ----------- | ------------- | --------------------------------------------------------- |
| `pre-commit` | staged files  | `prettier --check` (format) + `eslint` — fast, < 1s typical |
| `pre-push`   | whole repo    | `pnpm -r typecheck` + `pnpm -r test`                        |

So a Prettier/ESLint violation **blocks the commit**, and a type error or failing test
**blocks the push** — before anything leaves your machine. A clean change passes straight
through.

Verify hooks are wired up (useful right after cloning):

```bash
pnpm exec lefthook install     # re-sync hooks into .git/hooks (idempotent)
pnpm exec lefthook validate    # prints "All good" when lefthook.yml is valid
```

In a genuine emergency you can bypass them — `LEFTHOOK=0 git commit …` or
`git push --no-verify` — but CI runs the same checks, so prefer fixing the issue.

### Controls

| Key            | Action                                   |
| -------------- | ---------------------------------------- |
| Arrows / WASD  | Move                                     |
| ALT            | Jump                                     |
| SPACE          | Attack (or left-click)                   |
| ENTER          | Interact / talk to NPC / chat            |
| 1 – 0          | Quickslots (assigned skills & potions)   |
| Z              | Loot all nearby drops                    |
| I / K / S / Q  | Inventory / Skills / Stats / Quests      |
| W / M / P      | World map / Free Market / Cash Shop       |
| G / O / F      | Guild / Party / Friends                  |

> Every key is **rebindable in Settings**; the full default map lives in
> `packages/shared/src/keybindings.ts`.

Pick a class in character creation and spawn on **Dawn Isle**. Attack mobs to fight them; kills drop
Mesos + rarity-rolled loot you auto-pick-up. Spend AP/SP as you level, advance your job, then press **M**
to list surplus gear on the Free Market — or party up, join a guild, and trade with other players.

### Server routes

With the server running on `http://localhost:2567`:

- **`/healthz`** — liveness probe, returns `{ "status": "ok" }`.
- **`/metrics`** — operational metrics: `{ ccu, roomCount, uptimeMs }`.
- **`/auth/guest`** (POST) — mint a brand-new **server-issued** account + signed session token: `{ token, accountId }`. New players authenticate here.
- **`/auth/login`** (POST `{ email, password }` or `{ token }`) — credential login (recovers the same account on any browser) or token refresh; returns `{ token, accountId }`, or `401` if the credential/token is invalid. The token is the credential — identity is never client-chosen.
- **`/auth/refresh`** (POST `{ token }` or `Authorization: Bearer`) — exchange a still-valid token for a fresh one with a renewed expiry (same accountId); returns `{ token, accountId }`, `401` if expired/invalid, or `403` if banned. The client calls this proactively so long play sessions stay connected.
- **`/channels?mapId=meadowfield`** — live player counts per channel for a map.
- **`/monitor`** — Colyseus state inspector (rooms, clients, live state). Protected behind `MONITOR_SECRET` in production.
- **`/playground`** — interactive room playground for poking rooms by hand (dev only; disabled when `NODE_ENV=production`).
- **`/admin/*`** — moderation + ops (feedback, reports, mute/ban/kick, announce). Gated by `ADMIN_SECRET`.

### Configuration (`.env`)

Config lives in a single **root** `.env` (copy it from `.env.example`) — both apps read it:

- `PORT` — Colyseus server port (default `2567`).
- `VITE_BACKEND_URL` — the server URL the browser client connects to (default `ws://localhost:2567`).
- `DATABASE_URL` — persistence target (default `sqlite://./data/maple.db`; see **Database** below).
- `CORS_ORIGIN` — allowed browser origin for the HTTP API (default `*`).
- `MONITOR_SECRET` / `ADMIN_SECRET` — protect `/monitor` and `/admin/*` in production.
- `AUTH_SECRET` — HMAC secret (≥16 chars) used to sign session tokens. **Set this in production** so sessions survive restarts; if unset, an ephemeral per-process secret is used (fine for local dev/tests, invalidated on restart). Never hardcode it — it is read from the environment.
- `AUTH_TOKEN_TTL_SECONDS` — session-token lifetime in seconds (default `3600` = 1 hour, clamped to `60`…`2592000`). Tokens are short-lived by design; the client refreshes them proactively before expiry.
- `LOG_LEVEL` — minimum log level: `debug` | `info` | `warn` | `error` (default `debug` in dev, `info` in production). Logs are emitted as one-line JSON (`level`, `t`, `msg`, plus room/session/account context) so they're greppable: e.g. `… | grep '"level":"error"'`.
- `LOG_PRETTY` — set to `1` for human-readable single-line logs in a dev terminal instead of JSON (ignored in production).
- `SENTRY_DSN` (or `ERROR_TRACKER_DSN`) — **optional**. When set, unhandled exceptions, promise rejections, and caught room-handler errors are shipped to the error tracker. The DSN is never logged. Requires `@sentry/node` to be installed (lazily loaded); if the DSN is set but the package is absent, the server warns once and logs-only. With no DSN, nothing is sent off-box.

Identity is **server-issued**: every room join must present a signed token (verified in each room's `onAuth`), and the trusted `accountId` is derived from that token — never from `options.accountId`. A client cannot load an account or character it didn't authenticate as.

**Session lifecycle.** Tokens carry a short TTL. The client decodes the token's `exp` and silently refreshes via **`POST /auth/refresh`** ~60s before it lapses (re-arming after each success), so multi-hour play sessions never get kicked. If a refresh fails — or a room join's `onAuth` rejects an expired/revoked token (`AUTH_FAILED`) — the client clears just the credential (preserving local UI state) and routes cleanly back to login for re-authentication.

Only `VITE_`-prefixed variables are exposed to the browser; the Phase-2 chain secrets in `.env` stay
server-side. The localhost defaults work out of the box, so `.env` is optional for local dev, and the
Phase-2 chain variables can stay blank for now.

### Database

Persistence is backed by **SQLite** via `better-sqlite3` (WAL mode for concurrent reads).

- `DATABASE_URL` — defaults to `sqlite://./data/maple.db`. The file and parent directory are created
  automatically on first boot.
- For production, swap to Postgres by installing a PG driver and setting
  `DATABASE_URL=postgresql://user:pass@host:5432/maple` (driver not yet installed — clear error if
  attempted).
- In production the DB lives on a mounted volume (`server-data` → `/app/data`), so it **survives
  restarts and rebuilds**. Automated off-box backups + a tested restore procedure are documented in
  [`docs/DEPLOY.md`](docs/DEPLOY.md#backups--restore); snapshot/restore locally with
  `pnpm --filter @maple/server run db:backup` and `db:restore <snapshot.db.gz>`.
- Schema migrations live in `packages/server/src/persistence/migrations/` and run automatically on
  server start. To import legacy JSON data from a previous `.data/` directory, run:

```bash
npx tsx packages/server/src/persistence/importFileData.ts .data
```

#### Reset & seed (local dev / testing)

For repeatable testing — or to recover a local DB that has drifted into a bad/corrupt state — reset
the database and re-apply every migration from a clean slate:

```bash
pnpm --filter @maple/server run db:reset   # delete maple.db (+ WAL/SHM), recreate, run migrations
pnpm --filter @maple/server run db:seed    # add test accounts/characters at varied levels
```

- **`db:reset`** removes the SQLite file and its WAL/SHM sidecars, then recreates a fresh, fully
  migrated database. The server boots cleanly against the result.
- **`db:seed`** creates two test accounts (`test_alice`, `test_bob`) with characters spanning
  Lv 1 → 100 across classes (Warrior, Mage, Archer, Thief) for playtesting. It is idempotent —
  characters whose names already exist are skipped, so it's safe to re-run after `db:reset`.
- Both honour `DATABASE_URL` (default `sqlite://./data/maple.db`), so they target the same file the
  server boots against. A typical reset-then-play flow:

```bash
pnpm --filter @maple/server run db:reset && pnpm --filter @maple/server run db:seed && pnpm dev
```

### Verify the backend

```bash
pnpm --filter @maple/server test    # boots the rooms in-process: combat + market loops
pnpm --filter @maple/client build   # type-checks and bundles the client
```

### Deployment

```bash
docker compose up --build   # server on :2567, client on :8080
```

The client is a static Vite build — serve `packages/client/dist/` from any static host. The server
Dockerfile runs source via `tsx` (the shared package ships raw TS). See [`docs/DEPLOY.md`](./docs/DEPLOY.md)
for environment variables, health checks, reverse proxy setup, and manual deployment.

## Status

**Phase 1 — a broad off-chain alpha**, far past the original one-mob slice. In the repo today:

- **5 playable classes** (Warrior, Mage, Archer, Thief, Pirate) with branching job tiers
  (1st → 4th @ Lv 10/30/60/100), 90+ skills, AP/SP allocation and a Lv 200 curve.
- **33 authored maps** across Dawn Isle, the Heartland (Meadowfield, Sylvanreach, Craghold, Dusk Ward,
  Crossway, Tidewatch Harbor, Mirefen) and the Far Reaches (Skyhaven, Frosthold) — see [`WORLD.md`](./WORLD.md).
  **Every authored map is registered as a live room** (with channels), derived from the shared `MAPS`
  registry in `packages/server/src/app.config.ts` — no hand-maintained allow-list.
- **74 mobs (12 bosses)**, two-layer rarity loot (potential tier + base rank), **~150 items**, cube reroll
  + base-rank upgrade, and a search-rich Free Market with a protocol-fee sink.
- **Combat depth:** buff/passive skills modify stats, status effects (DoT/HoT/stun/slow) tick in the live
  loop, and the elemental damage triangle is applied — all server-authoritative.
- **Meta & social:** 56 quests + job-advancement chains, party quests, guilds, parties, channels, trade,
  storage, whisper, achievements, a monster codex, fame, and a cash shop.
- **Persistence** via SQLite (`better-sqlite3`, WAL + migrations).

**Known not-yet-wired** (tracked as tasks): equipment **scrolling** is built in `@maple/shared`
(`SCROLLS` + `applyScroll`) but no room calls it yet. The **chain layer** (`packages/contracts`) stays
scaffolded and deferred.
