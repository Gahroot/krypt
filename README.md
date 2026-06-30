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
- Schema migrations live in `packages/server/src/persistence/migrations/` and run automatically on
  server start. To import legacy JSON data from a previous `.data/` directory, run:

```bash
npx tsx packages/server/src/persistence/importFileData.ts .data
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
- **~26 authored maps** across Dawn Isle, the Heartland (Meadowfield, Sylvanreach, Craghold, Dusk Ward,
  Crossway, Tidewatch Harbor, Mirefen) and the Far Reaches (Skyhaven, Frosthold) — see [`WORLD.md`](./WORLD.md).
  **3 are wired as live rooms today** (`dawn_isle`, `heartland_harbor`, `meadowfield`); the rest are
  content-ready but not yet registered (tracked on the task list).
- **53 mobs (9 bosses)**, two-layer rarity loot (potential tier + base rank), **~150 items**, cube reroll
  + base-rank upgrade, and a search-rich Free Market with a protocol-fee sink.
- **Meta & social:** 56 quests + job-advancement chains, party quests, guilds, parties, channels, trade,
  storage, whisper, achievements, a monster codex, fame, and a cash shop.
- **Persistence** via SQLite (`better-sqlite3`, WAL + migrations).

**Known not-yet-wired** (tracked as tasks): buff/passive skills don't yet affect stats; status effects and
elements are defined but not applied in combat; scrolling and the friends list are built but not
server-wired; only 3 maps are registered as rooms. The **chain layer** (`packages/contracts`) stays
scaffolded and deferred.
