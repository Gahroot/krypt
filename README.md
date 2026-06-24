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
nvm use            # Node 20+
pnpm install
pnpm dev           # runs server + client in parallel
```

Then open the client dev URL (printed by Vite). The server listens on `ws://localhost:2567` by default.

Copy `.env.example` → `.env` and adjust as needed. Phase-2 chain variables can stay blank for now.

## Status

Phase 1 — vertical slice: walk around Meadowfield as a Warrior, kill a mob, get a rarity-rolled loot drop,
sell it on the Free Market for Mesos. Chain layer is scaffolded but deferred until the slice is proven fun.
