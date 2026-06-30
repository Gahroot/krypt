# AGENTS.md

Guidance for coding agents working in this repo. Everything here is derived from the files below — when in doubt, read the source.

## Project

CryptoMaple is a **2D side-scroller MMORPG** with a player-owned free market. **Game-first; crypto is a bonus layer** (Phase 2, deferred). See [`README.md`](./README.md).

## Toolchain

- **Node ≥ 20** (pinned in [`.nvmrc`](./.nvmrc) → `20`).
- **pnpm 11** (root `packageManager`: `pnpm@11.0.9`); workspace defined in [`pnpm-workspace.yaml`](./pnpm-workspace.yaml) as `packages/*`.
- **TypeScript strict** ([`tsconfig.base.json`](./tsconfig.base.json): `strict`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, …).
- **ESM everywhere** — every TS package sets `"type": "module"`.
- Lint/format: ESLint flat config ([`eslint.config.mjs`](./eslint.config.mjs)) + Prettier; git hooks via [`lefthook.yml`](./lefthook.yml).

## Monorepo layout

| Package | What | Test runner |
| --- | --- | --- |
| [`packages/shared`](./packages/shared) (`@maple/shared`) | Plain TS — rarity / stats / classes / items / mobs. **Source of truth** for game data; both apps import it. | **vitest** |
| [`packages/server`](./packages/server) (`@maple/server`) | **Colyseus authoritative** game server (combat, mesos, drops, soft market). | **tsx** scripts (`tsx test/*.ts`) |
| [`packages/client`](./packages/client) (`@maple/client`) | **Phaser 3 + Vite** browser client. | **vitest** (React Testing Library + jsdom) for the React UI overlay, plus typecheck + build; a **Playwright** screenshot harness (`ui:screenshots`) captures each panel |
| [`packages/contracts`](./packages/contracts) | **Foundry** on-chain layer — **Phase 2, DEFERRED**. Stubs + unit tests only. | `forge test` |

**Note on `contracts`:** it has **no `package.json`** (Foundry, not pnpm), so pnpm ignores it. Its `lib/` dependencies (forge-std, OpenZeppelin v5, Chainlink) are **git-ignored** — don't expect them present and don't commit them. See [`packages/contracts/README.md`](./packages/contracts/README.md) before touching it.

## Commands

Run from the repo root unless noted.

```bash
pnpm install        # installs workspaces; lefthook installs hooks via `prepare`
pnpm dev            # server + client in parallel (Vite :5173, Colyseus :2567)
pnpm build          # build all packages (pnpm -r build)
pnpm test           # test all packages (pnpm -r test)
pnpm typecheck      # tsc --noEmit across all packages (pnpm -r typecheck)
pnpm lint           # eslint .
pnpm format         # prettier --write .
pnpm format:check   # prettier --check .
```

Target a single workspace when iterating:

```bash
pnpm --filter @maple/shared test       # vitest
pnpm --filter @maple/server test       # tsx test/smoke.ts && tsx test/market.ts
pnpm --filter @maple/client test       # vitest run (UI render/smoke tests)
pnpm --filter @maple/client build      # tsc --noEmit && vite build
pnpm --filter @maple/client ui:screenshots  # Playwright: capture a PNG per panel (needs `npx playwright install chromium`)
```

## Conventions

- Keep game data/logic in **`shared`** as the single source of truth; the server is **authoritative** (anti-cheat by design) and the client is a renderer.
- Respect existing TypeScript strictness — no `any`, no unused vars; the build will fail otherwise.
- Follow the style already in each package rather than reformatting wholesale.

## Further reading

- [`README.md`](./README.md) — overview, getting started, controls, server routes, `.env` config.
- [`PLANNING.md`](./PLANNING.md) — vision, systems, tokenomics, roadmap.
- [`WORLD.md`](./WORLD.md) — world/content spine: the "calm start → a little bit of everything" arc.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — verified technical patterns + on-chain mint design.
