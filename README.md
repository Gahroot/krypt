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

| Key             | Action                      |
| --------------- | --------------------------- |
| Arrows / WASD   | Move                        |
| SPACE           | Attack (or left-click)      |
| I               | Toggle inventory            |
| M               | Open / close the Free Market |

Walk into a Meadow Slime and attack to fight it; kills drop Mesos + rarity-rolled loot you can
auto-pick-up, then press **M** to list it on the Free Market and sell it for Mesos.

### Server routes

With the server running on `http://localhost:2567`:

- **`/health`** — liveness probe, returns `{ "ok": true, "service": "cryptomaple-server" }`.
- **`/monitor`** — Colyseus state inspector (rooms, clients, live state). Put it behind auth before any public deploy.
- **`/playground`** — interactive room playground for poking rooms by hand (dev only; disabled when `NODE_ENV=production`).

### Configuration (`.env`)

Config lives in a single **root** `.env` (copy it from `.env.example`) — both apps read it:

- `PORT` — Colyseus server port (default `2567`).
- `VITE_BACKEND_URL` — the server URL the browser client connects to (default `ws://localhost:2567`).

Only `VITE_`-prefixed variables are exposed to the browser; the Phase-2 chain secrets in `.env` stay
server-side. The localhost defaults work out of the box, so `.env` is optional for local dev, and the
Phase-2 chain variables can stay blank for now.

### Verify the backend

```bash
pnpm --filter @maple/server test    # boots the rooms in-process: combat + market loops
pnpm --filter @maple/client build   # type-checks and bundles the client
```

## Status

Phase 1 — vertical slice: walk around Meadowfield as a Warrior, kill a mob, get a rarity-rolled loot drop,
sell it on the Free Market for Mesos. Chain layer is scaffolded but deferred until the slice is proven fun.
