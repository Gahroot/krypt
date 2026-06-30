# CryptoMaple — Technical Architecture

The verified patterns behind the live Phase-1 slice, plus the deferred Phase-2 on-chain plan. This doc
describes **what was actually built** (read the code alongside it) and the design rules the chain layer
will follow.

- **Systems & business plan:** [`PLANNING.md`](../PLANNING.md)
- **World / content spine:** [`WORLD.md`](../WORLD.md)
- **Contracts package (Phase 2, stubs + tests):** [`packages/contracts/README.md`](../packages/contracts/README.md)

> **Status.** Phase 1 is live and runs **entirely off-chain** (`@maple/server` + `@maple/client`): a broad
> alpha far past the original one-mob slice — 5 fully-specced classes, ~26 authored maps (3 wired as live
> rooms today), 53 mobs (9 bosses), two-layer rarity loot, a search-rich Free Market, plus quests,
> parties, guilds, party quests, channels, trade, storage, achievements and a monster codex. Some authored
> systems aren't wired into the live loop yet (see [§8](#8-authored-but-not-yet-wired)). The chain layer
> (`packages/contracts`) is **scaffolded but deferred** — stubs with passing unit tests, no deploy
> scripts, no keys, no broadcasts — until the game is proven fun.

---

## 1. Stack & topology

**TypeScript end-to-end** — one language across client, server, and (Phase 2) chain, so a solo team moves
fast and shares code without a serialization boundary.

| Layer | Tech | Version (verified) |
|---|---|---|
| **Client** | Phaser 3 + Vite | `phaser` ^3.90, `vite` ^6 |
| **Netcode SDK** | `@colyseus/sdk` + `@colyseus/schema` | sdk ^0.17.43, schema ^4.0 |
| **Server** | Colyseus (authoritative, Node) | `colyseus` ^0.17.10, `@colyseus/tools` ^0.17, `@colyseus/schema` ^4.0 |
| **Shared** | Plain TS, zero runtime deps | — |
| **Chain (Phase 2)** | Base (Ethereum L2), Solidity + Foundry | solc 0.8.24, OpenZeppelin v5.6.0, Chainlink VRF 2.5 |

### Topology

```
┌──────────────────────────────────────────────────────────────┐
│  CLIENT — Phaser 3 + Vite (browser)                           │
│  scenes: Boot → Preload → CharacterCreate → MapScene + UI HUD │
│  • sends INPUTS only (move/attack/pickup intents)             │
│  • predicts the LOCAL player, LERPs remotes, renders state    │
│  • can NEVER move authoritatively, award mesos, or mint gear  │
└───────────────┬──────────────────────────────────────────────┘
                │  WebSocket
                │  ▲ up:   InputData + intents (MessageType.INPUT / PICKUP, list/buy/cancel)
                │  ▼ down: authoritative @colyseus/schema state patches (+ private wallet push)
┌───────────────▼──────────────────────────────────────────────┐
│  GAME SERVER — Colyseus (authoritative, Node)                 │
│  MapRoom (any map, channelled) MarketRoom · PartyQuestRoom    │
│  • fixed 1000/60 simulation    • order book + validation      │
│  • movement, combat, mob AI    • escrow, mesos, protocol fee  │
│  • loot rolls + mesos + exp    • accountStore / marketStore   │
│  • Legendary drop → records a server-side mint authorization  │
└───────────────┬──────────────────────────────────────────────┘
                │  (Phase 2) viem signer / indexer — NOT wired yet
                │  ▼ server-signed mint authorization for a confirmed Legendary
┌───────────────▼──────────────────────────────────────────────┐
│  BLOCKCHAIN — Base (Ethereum L2), Solidity + Foundry [Phase 2]│
│  MapleToken ($MAPLE)   GearNFT (ERC-721)   ItemStack (ERC-1155)│
│  PremiumMarket (on-chain market)   VRFHandler (VRF 2.5 bridge) │
└──────────────────────────────────────────────────────────────┘
```

### Anti-cheat principle (the whole reason for this shape)

**Clients send _inputs_, never outcomes.** The server owns movement, combat, mesos, exp, loot rolls, and
the market ledger. A client press is a *request*; the authoritative process resolves it and the result
flows back as synced state.

- The client transmits an `InputData` (`left/right/up/down/attack/tick`) per frame plus `PICKUP { uid }`
  and market intents. It never tells the server "I moved here," "I dealt 50 damage," or "I own this item."
- The local player is **predicted** for feel, but the server is the source of truth and silently corrects
  divergence; remotes are interpolated, never simulated.
- **The client can never mint gear.** Even in Phase 2, the only address allowed to authorize a mint is the
  server signer — clients are structurally excluded (see [§6](#6-the-off-chain--on-chain-lootmint-plan-phase-2)).

---

## 2. Monorepo layout

pnpm workspaces, Node ≥ 20, TypeScript strict.

```
packages/
  shared/     plain TS — the single source of truth (rarity, stats, classes, items, mobs, net), unit-tested
  server/     Colyseus authoritative game server (MapRoom + MarketRoom + PartyQuestRoom + managers + SQLite)
  client/     Phaser 3 + Vite browser client
  contracts/  Foundry / Solidity — Phase-2 on-chain layer (stubs + tests, deferred; not a pnpm member)
```

### Why `shared` is the single source of truth

`@maple/shared` is **pure data + pure functions with no runtime dependencies**, imported by *both* the
authoritative server (for logic) and the Phaser client (for display). Defining a mechanic once means the
two sides can never silently disagree about it.

- **Server** imports the *behaviour*: `rollPotential()`, `rollItemDrops()`, `rollMesos()`, `attackPower()`,
  `autoAssign()`, `maxHpForLevel()`, `isMintWorthy()`, `getMobDef()`, etc. — the loot/combat/leveling math.
- **Client** imports the *types + display data*: `getItemDef()`, `getPotentialTierInfo()` (tier label +
  border color), `MessageType`, and the `InputData` shape — so it can render a listing or a drop without
  knowing how the server rolled it.

### The import rule (enforced by structure)

The client imports **types and data from `shared`, and the Colyseus _client_ SDK — never server code.**

- Colyseus Schemas (`@type`-decorated classes) live *server-side only*. The browser mirrors them as plain
  interfaces in `packages/client/src/state-views.ts` (`PlayerView`, `MobView`, `LootView`, `ListingView`),
  so scenes get type-safety without pulling server classes into the bundle.
- The wire protocol (`InputData`, `MessageType`) lives in `packages/shared/src/net.ts`. The server
  re-exports it from `packages/server/src/types.ts` so both ends share one definition with zero coupling.

---

## 3. Authoritative netcode (the verified Colyseus pattern)

The simulation follows the verified Colyseus + Phaser tutorial pattern (the tutorial's `Part4Room` /
`Part4Scene`), adapted to a top-down field. Real files:

- **Server room:** `packages/server/src/rooms/MapRoom.ts` — **one room class hosts every map** (the map id
  is a constructor arg). Live maps register as `dawn_isle`, `heartland_harbor`, `meadowfield`, plus channel
  variants `{mapId}__ch{N}` (`CHANNELS_PER_MAP = 3`); registration lives in `app.config.ts`.
- **Synced schema:** `packages/server/src/rooms/schema/*` (`Player`, `Mob`, `LootDrop`, `TownState`, …)
- **Client scene:** `packages/client/src/scenes/MapScene.ts`

### Fixed timestep + per-player input queue + `fixedTick()`

The room runs a deterministic accumulator loop. `onCreate` starts a `setSimulationInterval` that drains a
time accumulator in fixed `1000 / 60` ms steps, calling `fixedTick()` exactly once per step regardless of
wall-clock jitter:

```ts
// MapRoom.ts — fixedTimeStep = 1000 / 60
let elapsed = 0;
this.setSimulationInterval((deltaTime) => {
  elapsed += deltaTime;
  while (elapsed >= this.fixedTimeStep) {
    elapsed -= this.fixedTimeStep;
    this.fixedTick(this.fixedTimeStep);
  }
});
```

Inputs are **queued per player, not applied on receipt.** The `INPUT` message handler only pushes onto a
per-player buffer; `fixedTick()` drains it inside the simulation step:

```ts
[MessageType.INPUT]: (client, input) => {
  const player = this.state.players.get(client.sessionId);
  if (player) player.inputQueue.push(input);   // server applies it on the next fixed tick
}
```

Each tick, `processPlayerInput()` shifts the queue, moves the player by `PLAYER_SPEED` (2.4 px/tick),
clamps to map bounds, resolves attacks inside the melee arc, and records `player.tick = input.tick` — the
**last processed input tick echoed back to the client for reconciliation.** `inputQueue` is a plain
field with **no `@type`**, so it never syncs to clients (server-only state). Mob AI, contact damage, loot
despawn, leveling, and respawns all resolve in the same tick.

### Schema sync via `@colyseus/schema` `@type` decorators

State that should reach clients is declared with `@type` on a `Schema` subclass; Colyseus computes and
broadcasts binary deltas. Server-only fields (timers, the input queue) are left undecorated so they stay
private:

```ts
export class Player extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("int8")   facing = 1;
  @type("number") tick = 0;          // last processed input tick → client reconciliation
  @type("int16")  hp = 50;
  @type({ map: InventoryItem }) inventory = new MapSchema<InventoryItem>();

  // ── server-only (NOT synced) ──
  inputQueue: InputData[] = [];
  attackCooldown = 0;
}
```

`TownState` holds `MapSchema`s of `Player`, `Mob`, and `LootDrop`; `MarketState` holds a `MapSchema` of
`Listing` plus `feeBps`. The client binds with the verified **0.17 `getStateCallbacks(room)`** API
(`$(room.state).players.onAdd/onChange/onRemove`, nested `inventory.onAdd`, etc.).

### Client reconciliation + interpolation

`MapScene.ts` runs the verified split-treatment of local vs. remote entities:

- **Local player — client-side prediction.** Every frame the scene sends its `InputData`, then applies the
  *same* movement the server will (`step = PLAYER_SPEED * (delta / FIXED_TIMESTEP)`), so control feels
  instant. The server stays authoritative and corrects drift; `player.tick` carries the reconciliation
  cursor. The camera follows the predicted sprite.
- **Remote players + mobs — interpolation.** Their authoritative `x/y/facing` is stashed on each sprite on
  `onChange`; `update()` LERPs the rendered sprite toward that target each frame
  (`Phaser.Math.Linear(..., REMOTE_LERP = 0.2)`), so the world stays smooth between state patches.
- **Combat + loot are intent-only.** Pressing attack plays a cosmetic local swing flourish but applies
  **zero** damage; the server resolves the swing, hits, kills, and drops. Pickup auto-vacuums the nearest
  in-range drop by sending `PICKUP { uid }`; the server re-checks the 60 px range before accepting it.

### Reference repos that informed this pattern

- **[colyseus/tutorial-phaser](https://github.com/colyseus/tutorial-phaser)** — the official Phaser +
  Colyseus tutorial. Its `Part4Room` / `Part4Scene` is the canonical "input-queue + fixed tick +
  client-prediction" pattern reproduced here (right down to the `ws://localhost:2567` default).
- **[orion3dgames/t5c](https://github.com/orion3dgames/t5c)** — an open-source Colyseus MMORPG with fully
  player-authoritative movement, client-side prediction + server reconciliation, loot tables, inventory,
  and ability-point leveling — a working reference for the larger room/economy shape.
- **[phaserjs/discord-multiplayer-template](https://github.com/phaserjs/discord-multiplayer-template)** — a
  Phaser + Colyseus monorepo template (`packages/client`, `packages/server`, `schemas/GameState`) that
  informed the workspace split and the schema-as-shared-contract structure.

---

## 4. Game systems (in `@maple/shared`, public + unit-tested)

All systems are reskins of proven MapleStory mechanics (mechanics aren't copyrightable; art/names/lore
are — see [`PLANNING.md` §2b](../PLANNING.md)). Every roll function takes an **injectable RNG**
(`rng: () => number = Math.random`) so it is deterministic and testable, and can later be driven by
Chainlink VRF output on-chain.

### Two-layer rarity (`rarity.ts`)

| Layer | Set by | Shown by | Tiers |
|---|---|---|---|
| **Potential tier** | rolled at drop | item **border** color | Rare → Epic → Unique → **Legendary** |
| **Base rank** | raised by upgrades | item **name** color | Normal → Enhanced → Star-forged → Mythic |

The Potential drop table is **public, weighted, and immutable** — weights total **1300**:

| Tier | Weight | Probability | Stat lines |
|---|---|---|---|
| Rare | 1000 | 76.92% | 1 |
| Epic | 250 | 19.23% | 2 |
| Unique | 45 | 3.46% | 3 |
| **Legendary** | 5 | **0.385%** | 3 |

`rollPotential(rng)` walks the public weights; `potentialOdds()` exposes the exact probabilities for
display/audit; `isMintWorthy(tier)` returns `true` **only for Legendary** (the lone tier that mints
on-chain in Phase 2). Base ranks carry stat multipliers (1.0 / 1.25 / 1.6 / 2.1) and a `nextBaseRank()`
upgrade ladder.

**Loot odds are PUBLIC + unit-tested** (`packages/shared/tests/rarity.test.ts`): boundary cases, a
200,000-sample seeded distribution check against the published weights, and the exact branch the server
uses to flag a Legendary mint. This is the **off-chain rehearsal of the on-chain "provably fair" claim** —
the direct answer to a central operator secretly nerfing rates (the Nexon cube-odds scandal in
`PLANNING.md`). The same table is what Phase 2's VRF roll will use.

### AP / SP stats (`stats.ts`)

- **AP (Ability Points):** `AP_PER_LEVEL = 5` granted on level-up, spent on STR/DEX/INT/LUK (+1 each) or
  max HP/MP (+10 / +6). `autoAssign(level, primary)` dumps AP into the class's primary stat (the proven
  meta + UI default). `spendAp()` is immutable (returns a new object).
- **SP (Skill Points):** `SP_PER_LEVEL = 3`, a separate pool feeding the class skill tree.
- `attackPower(stats, primary)` derives damage transparently from the primary stat. Tested in
  `stats.test.ts`.

### Classes (`classes.ts`)

Five archetypes (`WARRIOR`, `MAGE`, `ARCHER`, `THIEF`, `PIRATE`), each with a primary stat, a home town
from `WORLD.md`, HP/MP growth, and job-advancement tiers gated by level (1st @10 → 2nd @30 → 3rd @60 →
4th @100). **All five are fully specced** — 90+ named skills across active / buff / passive kinds, with
2nd-job **branches** (e.g. Warrior → Berserker / Guardian / Warlord) feeding distinct 3rd/4th-tier trees.
`allSkillsForClass()` / `unlockedJobTier()` / `maxHpForLevel()` / `maxMpForLevel()` are pure helpers.

### Items & mobs (`items.ts`, `mobs.ts`)

- **`ItemDef`** = static template (slot, level req, primary stat, base attack); **`ItemInstance`** = a
  concrete owned item with its rolled `baseRank` + `potentialTier` + bonus `PotentialLine`s. The catalog is
  **~150 items** across **16 equip slots** and **10 weapon types** (a 6-tier ladder per weapon type to
  Lv 60), plus consumables and materials.
- **`MobDef`** carries HP, exp, a mesos range, element, and a drop table. A kill rolls in two independent,
  tested stages: `rollMesos()` for currency, then `rollItemDrops()` per drop-table entry, then
  `rollPotential()` for each dropped item's tier. The roster is **53 mobs incl. 9 bosses**; boss
  encounters (phases, telegraphs, summon-adds, loot-owner tracking) run server-side in `bossManager.ts`,
  and spawns in `spawnManager.ts`.

---

## 5. Off-chain economy (the soft Mesos market)

The **Free Market** is the off-chain "soft market" — the reskinned MapleStory FM. It's an authoritative
order book: clients send list/buy/cancel **requests**; the server validates and settles.

- **Room:** `packages/server/src/rooms/MarketRoom.ts`
- **Durable store:** `packages/server/src/persistence/store.ts`
- **Client overlay:** `packages/client/src/scenes/Market.ts` (press **M**)

### Shared persistence (why the loop is real)

`store.ts` exports the core singletons shared across rooms, so the full loop closes end-to-end:

- **`accountStore`** — accounts keyed by a stable `accountId`, each with `mesos` + an `inventory` of
  `ItemRecord`s. New accounts start with `STARTER_MESOS = 300`.
- **`marketStore`** — the global listing order book (`ListingRecord`s with a monotonic `lst_N` id).

Persistence is **SQLite via `better-sqlite3`** (WAL mode; numbered migrations in `persistence/migrations/`,
opened in `persistence/db.ts`); `importFileData.ts` imports a legacy `.data/` JSON snapshot when present.
Beyond `accountStore` and `marketStore`, the store layer also holds `treasuryStore` (the fee sink),
`feedbackStore`, `moderationStore`, and analytics. The loop: loot a drop in `MapRoom` →
`accountStore.addItem` writes it through → open the Market → `MarketRoom` lists/sells it → mesos move
between accounts. This off-chain ledger is exactly what the on-chain Premium Market mirrors later.

### List / buy / cancel — server-side validation + the protocol fee

`MarketRoom` validates every action against `accountStore`; the synced `state.listings` is the **public**
order book, while each client also gets a **private `wallet` push** (their mesos + inventory) never
broadcast to others.

| Action | Server checks | Effect |
|---|---|---|
| `list` | price is a positive int; caller owns the item | **escrows** the item out of inventory onto the book |
| `cancel` | listing exists; caller is the seller | returns the escrowed item to the seller |
| `buy` | listing exists; not your own; `spendMesos` succeeds | item → buyer; `price − fee` → seller; **`fee` → protocol** |

The **protocol fee** is the reskinned MTS tax: `MarketState.feeBps = 250` (2.5%), taken as
`fee = floor(price * feeBps / 10_000)`. Rejections come back as a `market_error` message and surface as a
toast. The whole list → buy → settle path (including the exact fee math across two accounts) is asserted
in `packages/server/test/market.ts`; the authoritative combat/reward loop in `test/smoke.ts`.

---

## 6. The off-chain → on-chain loot/mint plan (Phase 2)

> **Deferred.** `packages/contracts` is Foundry stubs + **17 passing unit tests across 5 suites** —
> **no deploy scripts, no testnet/mainnet broadcasts, no RPC endpoints, no keys.** Pins: **OpenZeppelin
> v5.6.0**, **Chainlink VRF 2.5**, `solc 0.8.24`, `evm_version = cancun`, target chain **Base**.

### Only Legendary+ gear mints

By design, **not everything is an NFT.** Common/uncommon drops stay off-chain Mesos-economy items; only
the top Potential tier ever touches chain — `isMintWorthy(tier)` is **Legendary-only**. This keeps gas and
chain volume sane and makes true ownership meaningful.

The hook already exists server-side. On a Legendary drop, `MapRoom`:

1. flags the `LootDrop.legendary` schema field (the client shows a pulsing green legendary gem);
2. on pickup, appends a `PendingMint { session, itemUid, defId, tier }` to an **in-memory queue only the
   authoritative server can write**, logs `legendaryMintPending …`, and persists the item with
   `minted: false`.

No chain call is made yet — this is the recorded authorization that Phase 2 will redeem.

### Server-signed mint authorization (the anti-dupe design)

The mint must be gated so **clients can never mint** (or god-roll gear would be duped instantly). The
authoritative server is the only party that can authorize a mint, on a **confirmed** gameplay event:

```
Legendary drop confirmed (server)
        │  server signs a mint authorization for (player wallet, tokenId = item uid, metadata URI)
        ▼
GearNFT.mintGear(to, tokenId, uri)   ── callable ONLY by the server's authorizer key ──▶  ERC-721 minted to player
        ▲
        └── contract verifies the caller/signer is the configured server authorizer; clients are excluded
```

**Intended production form:** the server signs an **EIP-712 voucher** on the confirmed drop; the player
redeems it on-chain (so the *player* pays gas) and `GearNFT` verifies the signature came from the server
signer before minting. **Current stub form** (`GearNFT.sol`): the minimal equivalent — an `onlyAuthorizer`
gate where the server `mintAuthorizer` is the sole address allowed to call `mintGear(to, tokenId, uri)`,
rotatable by the owner via `setMintAuthorizer`, reverting `NotAuthorizer` for anyone else (asserted in
`test/GearNFT.t.sol`). Both enforce the same invariant: **only the server authorizes a mint; the client
never can.** `tokenId` mirrors the off-chain item uid 1:1; `tokenURI` carries rank / tier / stat lines /
origin boss / mint date.

### The contracts

| Contract | Standard / base | Role |
|---|---|---|
| `MapleToken.sol` | ERC-20, `Ownable` | **$MAPLE** — Premium Market currency + governance. Owner-only `mint` **stub** (production: capped/vested behind a DAO timelock, not an EOA). |
| `ItemStack.sol` | ERC-1155, `ERC1155Supply`, `Ownable` | Stackable materials/consumables (Cubes, scrolls, catalysts). Verified AVAXGods item pattern; server-`minter`-gated `mintItem`; v5 `_update` override for supply tracking. |
| `GearNFT.sol` | ERC-721, `ERC721URIStorage`, `Ownable` | Unique **Legendary** gear. **Server-authorized** mints (`mintAuthorizer`); clients never mint. |
| `VRFHandler.sol` | Chainlink **VRF 2.5**, `VRFConsumerBaseV2Plus` | **Replaceable** randomness bridge for the provably-fair Cube reroll (see audit rule below). |
| `PremiumMarket.sol` | `Ownable`, `ReentrancyGuard` | On-chain market: list/buy/cancel `GearNFT` priced in `$MAPLE`. **Mirrors `MarketRoom` exactly** — `fee = price * feeBps / 10_000`, default `250` (2.5%) → treasury — with a `MAX_FEE_BPS = 1000` (10%) cap so governance can't set a confiscatory rate. |

The on-chain `PremiumMarket` is the trustless twin of the off-chain `MarketRoom`: same escrow-on-list,
seller-only-cancel, not-your-own-buy semantics and identical fee math — but settled on a market that
**can't be unilaterally shut down**.

### The Cyfrin audit rule: never call VRF directly from an immutable contract

VRF is an evolving external dependency (coordinator migrations, v2 → v2.5, billing changes). Per the
**Cyfrin audit rule, immutable game contracts must not call Chainlink VRF directly** — if a permanent,
un-upgradeable contract hard-wired the coordinator, a VRF change could brick it forever.

So randomness lives behind a thin, **replaceable `VRFHandler`** (the only VRF-aware piece in the system).
Game contracts implement a minimal `IRandomnessConsumer` callback and never import Chainlink. The handler
(`VRFConsumerBaseV2Plus`) `requestRandomness()` → coordinator verifies → `fulfillRandomWords()` forwards
the verified words back to the originating consumer via `onRandomnessFulfilled()`. If VRF changes,
governance deploys a new handler and re-points consumers **without touching the immutable game logic**.

This is the technical backbone of the **provably-fair Cube** (`ItemStack.CUBE`): public, immutable odds +
verifiable randomness, the direct fix for hidden/rigged reroll rates.

---

## 7. What's intentionally NOT decentralized

Be honest about the trust model — it's a load-bearing part of the pitch.

- **Game logic is centralized.** This is an authoritative MMO server. Movement, combat, mob AI, mesos,
  exp/leveling, loot rolls, and the soft-market order book all live on **our** Colyseus process and its
  off-chain account/listing store. That centralization is *required* for anti-cheat — a trustless client
  would be a cheating client.
- **Only ownership + the premium market touch chain.** In Phase 2, just two things are decentralized:
  **item ownership** (Legendary gear as `GearNFT`; stackables as `ItemStack`) and the **Premium Market**
  (`PremiumMarket` settled in `$MAPLE`). Provably-fair rolls (`VRFHandler`) back the Cube. Everything else
  stays off-chain for speed and cost.
- **It's still a major improvement.** A central marketplace can be closed (Nexon killed the MTS); hidden
  RNG can be rigged (Nexon was fined ~$9M for nerfing cube odds). An on-chain market **can't be unilaterally
  shut down**, and immutable public odds + VRF **can't be secretly nerfed**. Players truly *own* and can
  sell their god-roll gear. We don't claim "decentralized game" — we claim **un-killable market + provably-
  fair drops + true ownership**, which is exactly the gap [`PLANNING.md`](../PLANNING.md) sets out to fill.

---

## 8. Authored but not yet wired

A few systems exist as data/code but aren't applied in the live loop yet. They're called out here (and on
the task list) so the doc never overstates what runs today:

- **Buff/passive skills don't change stats yet.** Casting a buff broadcasts a cosmetic `STATUS_EFFECTS`
  message; `shared/effects.ts` (DoT / HoT / stun / buff aggregation) is fully written but not imported by
  the server, so buffs and passives don't yet modify damage or defense.
- **Elements & status effects are data-only.** Mobs carry `element` + `elementMods` and `SkillDef` has an
  `element` field, but `computeDamage` takes no element, so the damage triangle and debuffs aren't applied.
  Mob `wDef / mDef / avoid` are also passed as `0` on player attacks today.
- **Scrolling is built but unwired.** `shared/consumables.ts` ships `SCROLLS` + `applyScroll` and
  `ItemInstance.enhancements`, but no room calls it. (Cube reroll and base-rank upgrade *are* wired.)
- **Friends list is UI-only.** The client panel + `FRIEND_*` messages exist; there's no server handler or
  persistence yet.
- **Only 3 of ~26 maps are registered as rooms.** `dawn_isle`, `heartland_harbor`, `meadowfield` (+
  channels); the rest are authored in `world.ts` but not yet joinable.

These are deliberate next steps, not regressions — the foundation is in place; the wiring is the work.

---

*See [`PLANNING.md`](../PLANNING.md) for the vision, tokenomics, risks, and roadmap, and
[`WORLD.md`](../WORLD.md) for the content spine. This doc tracks the code — update it when the patterns
change.*
