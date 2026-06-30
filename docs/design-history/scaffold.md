# Scaffold Plan — MMORPG Monorepo (Phaser + Colyseus + Base)

Goal: lay down a working, end-to-end **vertical slice** of the game — walk around Meadowfield as a
Warrior, kill a mob, get a rarity-rolled loot drop, trade it on the Free Market (Mesos) — plus a
**scaffolded-but-deferred** on-chain package. Game-first; crypto is bonus (per `PLANNING.md` North Star).

Everything below is modeled on **verified, current** open-source code (links in §1). No invented APIs.

---

## 1. Research Findings (verified patterns + reference repos)

**Authoritative netcode — the anti-cheat core.** Colyseus' canonical pattern is a fixed-timestep server
simulation with a **per-player input queue**: the client sends *inputs*, the server owns *positions/state*.
This is exactly our "client can never mint gear" requirement.
- `colyseus/tutorial-phaser` → `server/src/rooms/Part4Room.ts` (server) + `client/src/scenes/Part4Scene.ts`
  (client prediction + interpolation, strong-typed to server via `import type`). **This is our template.**
- Verified server pattern: `class Part4Room extends Room` with `state = new MyRoomState()`,
  `fixedTimeStep = 1000/60`, `setSimulationInterval`, `player.inputQueue.push(input)`, `fixedTick()`.
- Verified schema pattern: `import { Schema, type, MapSchema } from "@colyseus/schema"`,
  `@type("number") x: number`, `@type({ map: Player }) players = new MapSchema<Player>()`.
- Verified client pattern: `Callbacks.get(room)`, `callbacks.onAdd("players", …)`, `callbacks.onChange`,
  LERP remote players, client-predict local player, `room.send(0, input)`.

**2D MMORPG reference (closest analog).** `orion3dgames/t5c` (★173, MIT) — a real top-down 2D MMORPG on
Colyseus: `src/server/rooms/schema/Entity.ts`, `LootSchema.ts`, `state/GameRoomState.ts`, `src/shared/*`.
Model our **Entity/Mob/Loot/State** layering and shared-folder split on this.

**Full MMORPG platform (architecture reference).** `damian-pastorini/reldens` (★565, MIT) — Colyseus + Phaser
MMORPG engine (rooms, features, players). Reference for room/feature organization as we grow.

**Monorepo layout.** `phaserjs/discord-multiplayer-template` (★45) — pnpm workspaces, `packages/client` +
`packages/server`, root `dev` script runs both in parallel. We extend with `packages/shared` + `packages/contracts`.

**On-chain game items (verified, current).**
- OpenZeppelin Contracts **v5.6.0**. ERC1155 game-item pattern proven by `adrianhajdin/project_web3_battle_game`
  (★479) `AVAXGods.sol`: `contract X is ERC1155, Ownable, ERC1155Supply` with `uint256 constant`
  token-IDs per item type. Constructor (OZ v5): `ERC1155("uri…") Ownable(initialOwner)`.
- Provably-fair rolls: **Chainlink VRF v2.5** (`VRFConsumerBaseV2Plus`). VRF 2.0 is being sunset — use 2.5.
  **Audit-sourced design rule (Cyfrin):** don't let immutable game contracts call VRF directly; put a
  replaceable **`VRFHandler` bridge** between them so randomness sourcing can be swapped without bricking gear.
- Wallet (client): viem verified pattern `createWalletClient({ chain, transport: custom(window.ethereum) })`;
  wagmi on top for React-free hooks later. Chain = **Base** (Ethereum L2).

---

## 2. Target Monorepo Structure

```
<repo root>
├─ package.json                # private root, pnpm workspaces, parallel dev script
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ .nvmrc  .gitignore  .env.example
├─ PLANNING.md  WORLD.md       # existing
├─ docs/ARCHITECTURE.md        # verified patterns + chain mint design (new)
└─ packages/
   ├─ shared/                  # plain TS — the reskinned MapleStory systems (no deps, unit-tested)
   │  └─ src/{rarity,stats,classes,items,mobs,index}.ts  +  tests/
   ├─ server/                  # Colyseus authoritative server
   │  └─ src/
   │     ├─ index.ts  app.config.ts
   │     └─ rooms/{TownRoom,MarketRoom}.ts  rooms/schema/{Player,Mob,LootDrop,TownState}.ts
   ├─ client/                  # Phaser 3 + Vite
   │  └─ src/
   │     ├─ main.ts  backend.ts
   │     └─ scenes/{Boot,Preload,Meadowfield,UI,Market}.ts
   └─ contracts/               # Foundry — DEFERRED (Phase 2). Stubs + tests only, no mainnet.
      └─ src/{MapleToken,ItemStack,GearNFT,VRFHandler,PremiumMarket}.sol  test/
```

**Why `shared/`:** rarity tables, class defs, stat formulas, item/mob data are pure data + pure functions
used by both server (authoritative logic) and client (display). Colyseus Schemas stay server-side; the client
imports *types* via `import type` (verified tutorial pattern). Keeping game data in `shared` = one source of truth.

---

## 3. Verified Versions / Tooling

- Node ≥ 20, **pnpm** workspaces. TypeScript strict.
- **Colyseus 0.16.x** (`colyseus`, `@colyseus/schema`; client SDK per tutorial-phaser). Scaffold the server
  with `npm create colyseus-app@latest` into `packages/server` to pin correct versions, then add our rooms.
- **Phaser 3.8x** + **Vite** + TS. Scaffold client from the official Phaser Vite-TS template to pin versions,
  then add the Colyseus SDK + our scenes.
- **Foundry** (`forge`), **OpenZeppelin v5.6.0**, **Chainlink contracts (VRF 2.5)** — `packages/contracts` only.
- Use the official generators for client/server so dependency versions are correct, then refactor both into
  the pnpm workspace and layer the verified `Part4Room`/`Part4Scene` patterns on top.

---

## 4. Build Sequence (game-first; chain deferred)

- **A. Foundation** — monorepo tooling + `shared` systems (rarity/stats/classes), unit-tested. Pure TS, instantly verifiable.
- **B. Authoritative server** — `TownRoom` (Meadowfield): movement, mob spawns, melee combat, death/respawn, Mesos, loot rolls.
- **C. Client** — Phaser Meadowfield scene: connect, client-predicted movement, render players/mobs/loot, attack, HUD.
- **D. Free Market (soft)** — `MarketRoom` off-chain Mesos order book + `Market` scene. Completes the fun loop.
- **E. Chain (DEFERRED, Phase 2)** — Foundry contracts as stubs + tests; wallet + server-signed mint wired only after the slice is proven fun.

Verification gate after D: you can walk → fight → loot a rarity-rolled item → sell it for Mesos. That's the "too good to fail" core.

---

## 5. Risks / Notes
- Don't let the official generators fight the monorepo: scaffold, then move into `packages/*` and dedupe lockfiles. Re-read generated files before editing.
- Keep combat/Mesos/loot **off-chain** in the server simulation; only ownership + premium market ever touch chain (Phase 2).
- Loot roll must live in `shared` with **public, deterministic, testable** odds — this is the on-chain "provably fair" claim rehearsed off-chain first.
- Placeholder art only (colored rects / free CC0 sprites). No MapleStory assets, names, or `.wz` files — ever.

---

## Steps

1. Create monorepo root files: `package.json` (private, `packageManager: pnpm`, parallel `dev` script), `pnpm-workspace.yaml` (`packages/*`), `tsconfig.base.json` (strict), `.gitignore`, `.nvmrc`, `.env.example`, and a root `README.md` linking `PLANNING.md` + `WORLD.md`; run `git init`.
2. Create `packages/shared` (plain TS lib + vitest): implement `rarity.ts` (PotentialTier RARE/EPIC/UNIQUE/LEGENDARY with colors + weighted drop table + `rollPotential()`; BaseRank upgrade ladder), `stats.ts` (STR/DEX/INT/LUK/HP/MP + AP allocation of 5/level + SP), `classes.ts` (Warrior MVP + 4 archetype stubs with job-tier skill trees), `items.ts` (slots + item defs), `mobs.ts` (one Meadowfield starter mob + drop table), and `index.ts` barrel.
3. Add vitest unit tests in `packages/shared/tests`: assert `rollPotential()` weight distribution over N samples, AP-per-level allocation, and a Legendary-drop flag path; wire `pnpm --filter @maple/shared test`.
4. Scaffold `packages/server` with the Colyseus generator, refactor into the workspace (pnpm), and add `@maple/shared` as a workspace dependency; keep `src/index.ts` (gameServer listen) + `src/app.config.ts` (room registration).
5. Implement server schemas in `packages/server/src/rooms/schema/` modeled on `t5c` + `Part4Room`: `Player` (x, y, hp/mp, level, stats, mesos, inventory MapSchema), `Mob` (x, y, hp, type), `LootDrop` (x, y, itemId, tier), and `TownState` (mapW/H + MapSchemas of players/mobs/loot) using `@type` decorators.
6. Implement `TownRoom` (Meadowfield) using the verified `Part4Room` authoritative pattern: `fixedTimeStep=1000/60`, `setSimulationInterval`, per-player `inputQueue`, `fixedTick()` movement; `onJoin` spawns a Warrior `Player`, `onLeave` removes it.
7. Extend `TownRoom.fixedTick` with gameplay: mob spawn/wander, server-validated melee attack messages, mob death → `rollPotential()` loot drop (from `@maple/shared`) → `LootDrop` in state, pickup → inventory + Mesos, and a `legendaryMintPending` flag stored for the future chain step (no chain call yet).
8. Implement `MarketRoom`: off-chain soft-market order book (list item for Mesos, buy, cancel) with in-memory state + JSON-file persistence; validate funds/ownership server-side; expose via Colyseus messages + schema list.
9. Scaffold `packages/client` from the official Phaser Vite-TS template, refactor into the workspace, add the Colyseus JS SDK (matching the server's 0.16 SDK) + `@maple/shared`; set up `src/backend.ts` (server URL) and `src/main.ts` (Phaser game config + scene list).
10. Implement `Boot` + `Preload` scenes loading placeholder pastoral tilemap + Warrior/mob/loot placeholder sprites (CC0 or generated colored frames); no MapleStory assets.
11. Implement `MeadowfieldScene` using the verified `Part4Scene` pattern: connect to `TownRoom`, `Callbacks.get(room)`, `onAdd/onChange/onRemove` for players/mobs/loot, client-predict the local player, LERP remotes, send inputs at fixed tick via `room.send`.
12. Add melee attack + loot pickup on the client: input → `room.send` attack/pickup messages, render mob hit/death and loot-drop sprites from state changes (server stays authoritative).
13. Implement `UIScene` HUD overlay: HP/MP bars, level, AP/SP, Mesos counter, and a simple inventory panel reading the local `Player` schema; update reactively on schema change.
14. Implement `MarketScene` wired to `MarketRoom`: browse listings, list an owned item for Mesos, buy a listing; reflect Mesos/inventory changes from server state.
15. Wire the root `pnpm dev` to run server + client in parallel, add run instructions to README, and manually verify the full loop end-to-end on localhost (walk → fight → rarity loot → sell for Mesos).
16. Scaffold `packages/contracts` (Foundry, **Phase 2 / deferred**): `forge init`, install OpenZeppelin v5 + Chainlink (VRF 2.5); add stubs `MapleToken` (ERC20), `ItemStack` (ERC1155+ERC1155Supply, AVAXGods pattern), `GearNFT` (ERC721), `VRFHandler` (VRFConsumerBaseV2Plus bridge), `PremiumMarket`; add minimal `forge test` for each; no testnet/mainnet deploy.
17. Write `docs/ARCHITECTURE.md` capturing the verified patterns, reference-repo links, the off-chain→on-chain loot/"provably fair" plan, and the **server-signed mint authorization** design for when the chain layer is switched on.
