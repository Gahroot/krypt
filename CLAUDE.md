# CLAUDE.md

CryptoMaple — a **2D side-scroller MMORPG** (MapleStory-like) with an authoritative game server and a deferred on-chain layer. Game-first; crypto is a dormant Phase-2 bonus. See [AGENTS.md](./AGENTS.md), [PLANNING.md](./PLANNING.md), [WORLD.md](./WORLD.md), [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for deeper context.

## Packages (pnpm workspace `packages/*`)

- **`@maple/shared`** — pure TS, **single source of truth** for game data: `world.ts` (29 maps + geometry), `items.ts`, `mobs.ts`, `classes.ts`, `quests.ts`, plus `net.ts` (numeric `MessageType` opcodes) and `protocol.ts` (`PROTOCOL_VERSION`). Consumed as **raw TS source** (`main` → `src/index.ts`, no build/dist); both apps import it.
- **`@maple/server`** — **authoritative Colyseus 0.17** server. `rooms/MapRoom.ts` (~9.5k lines, the core zone sim), `MarketRoom`, `PartyQuestRoom`; Colyseus `Schema` state in `rooms/schema/`. `app.config.ts` registers a room per map (3 channels each) + Express auth/characters/admin routes. Persistence = **SQLite (`better-sqlite3`)** in `persistence/` with numbered SQL migrations.
- **`@maple/client`** — **Phaser 3 + Vite** client with a **React 19 DOM overlay**. `main.ts` boots the Phaser game then mounts React into `#react-overlay`. `scenes/MapScene.ts` connects via `@colyseus/sdk` (client prediction/reconciliation). Phaser↔React bridge is a **Zustand** store in `ui/store/` (dev exposes `window.__uiStore`).
- **`contracts`** — **Foundry/Solidity**, Phase-2 **DEFERRED**, stubs + `forge test` only. **No `package.json`** → excluded from the pnpm workspace and from `pnpm -r *`. `lib/`, `out/`, `cache/` are git-ignored (`forge install` locally; never commit).

## Architecture invariants

- Server is authoritative: **clients send inputs only**; server owns all state, combat, mesos, and loot rolls. Auth identity is always server-signed (never client-supplied).
- Keep game data/logic in `shared`; the server enforces it and the client renders it.
- Legendary drops record a `legendaryMintPending` marker but make **no chain call** (Phase 2). On-chain market is stub-only.
- **ESLint chain-import guard**: client may not import `viem`/`wagmi`/`ethers`/`@maple/contracts`; server may use `viem` but not `ethers`/`wagmi`/`@maple/contracts`.

## Commands (from root unless noted)

```bash
pnpm dev            # server (:2567) + client (:5173) in parallel
pnpm build          # pnpm -r build
pnpm test           # pnpm -r test  (skips contracts entirely)
pnpm typecheck      # pnpm -r typecheck
pnpm lint           # eslint .
```

Per-package specifics:

```bash
pnpm --filter @maple/server test          # NOT vitest — sequential `tsx test/*.ts` chain; first failure aborts the rest
pnpm --filter @maple/server db:reset       # also db:seed / db:backup / db:restore (tsx scripts/*.ts)
pnpm --filter @maple/client test           # vitest (jsdom + RTL) — React overlay only
pnpm --filter @maple/client ui:screenshots # Playwright headless Chromium → PNG per panel (needs `npx playwright install chromium`)
pnpm --filter @maple/shared test           # vitest
cd packages/contracts && forge test        # Solidity; not part of the JS pipeline
```

- **Node 20** (`.nvmrc`), **pnpm 11**. `client build` gates typecheck first (`tsc --noEmit && vite build`).
- Git hooks (`lefthook.yml`): pre-commit runs prettier+eslint on staged files; **pre-push runs `pnpm -r typecheck` then `pnpm -r test`**. Bypass with `LEFTHOOK=0` / `--no-verify`.
