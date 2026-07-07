# Adding Content Without Breaking the Alpha

How-to guide for adding new maps, mobs, items, quests, and NPCs to CryptoMaple.
A new contributor can add a zone end-to-end by following this doc.

> **Source of truth:** `packages/shared/src/` is where all game data lives. Both the
> authoritative server and the Phaser client import it. Never define game data only on
> one side — if it's in `shared`, both ends agree automatically.

---

## Table of contents

1. [Architecture in 30 seconds](#architecture-in-30-seconds)
2. [Adding a new mob](#1-adding-a-new-mob)
3. [Adding a new item](#2-adding-a-new-item)
4. [Adding a new map](#3-adding-a-new-map)
5. [Adding a new NPC](#4-adding-a-new-npc)
6. [Adding a new quest](#5-adding-a-new-quest)
7. [Gate an unfinished zone (Coming Soon)](#6-gate-an-unfinished-zone-coming-soon)
8. [Tests that must stay green](#7-tests-that-must-stay-green)
9. [Performance & asset budgets](#8-performance--asset-budgets)
10. [Channel / room-scaling model](#9-channel--room-scaling-model)
11. [Full checklist for a new zone](#10-full-checklist-for-a-new-zone)

---

## Architecture in 30 seconds

```
@maple/shared     ← plain TS, zero deps, single source of truth
    ├── items.ts    ItemDef catalog   (~150 items, 16 slots, 10 weapon types)
    ├── mobs.ts     MobDef catalog    (74 mobs, 12 bosses)
    ├── world.ts    GameMap registry  (33 maps, all as MAPS[id])
    ├── npcs.ts     NpcDef catalog   (dialog trees + placement)
    ├── quests.ts   QuestDef catalog (chains, dailies, rewards)
    └── tests/      45+ integrity tests (vietest)

@maple/server    ← Colyseus authoritative (never trusts the client)
    ├── app.config.ts   auto-registers MAPS × 3 channels as rooms
    ├── rooms/MapRoom.ts  one room class hosts ALL maps
    └── test/            smoke.ts, market.ts, load.ts

@maple/client    ← Phaser 3 + Vite browser renderer
    ├── vite.config.ts   code-splits: phaser chunk, shared chunk, vendor chunk
    └── scenes/MapScene.ts  renders whatever MAPS[mapId] provides
```

**The golden rule:** add data to `shared`, and both server and client pick it up
automatically. The server auto-registers rooms from the `MAPS` registry — you never
touch `app.config.ts` to add a new map.

---

## 1. Adding a new mob

**File:** `packages/shared/src/mobs.ts`

### Step 1: Define the mob

Add an entry to the `MOBS` record. Every field on `MobDef`:

```ts
"mob.frost_wolf": {
  id: "mob.frost_wolf",
  name: "Frost Wolf",
  level: 38,
  maxHp: 420,
  exp: 540,                           // formula: 20 + floor(level²/6)
  mesosMin: 80,
  mesosMax: 200,
  speed: 0.6,
  element: "ICE",
  wDef: 12,
  mDef: 5,
  avoid: 8,
  dropTable: [
    { itemId: "etc.wolf_fang", chance: 0.35 },
    { itemId: "hat.frost_wolf_hood", chance: 0.02 },  // gear drops at low chance
  ],
},
```

### Step 2: If it's a boss

Add boss-specific fields:

```ts
"mob.frost_direwolf": {
  // ...all MobDef fields...
  isBoss: true,
  attackDamage: 120,
  attackCooldownMs: 2000,
  contactDamage: 80,
  aoeDamage: 60,
  phases: [0.7, 0.3],                 // HP thresholds for phase transitions
  attackPatternIds: ["bite", "howl"],
  summonAddIds: ["mob.frost_wolf"],
  dropTable: [
    { itemId: "wpn.iceclaw_blade", chance: 0.08, minPotentialTier: "UNIQUE", legendaryEligible: true },
  ],
},
```

### Step 3: Reference it in a map's `spawns`

See [Adding a new map](#3-adding-a-new-map) below.

### Mob balance rules

| Level band | maxHp range | exp | mesos range |
|---|---|---|---|
| 1–10 | 10–80 | 21–37 | 1–20 |
| 10–30 | 80–600 | 37–170 | 10–100 |
| 30–50 | 400–2,000 | 170–420 | 50–250 |
| 50–70 | 1,500–5,000 | 420–870 | 150–500 |
| 90–120 | 8,000–25,000 | 1,370–2,420 | 500–2,000 |

EXP formula: `20 + floor(level² / 6)` for smooth kill-per-level pacing.

---

## 2. Adding a new item

**File:** `packages/shared/src/items.ts`

### Equipment items

Add to the `ITEMS` record. ID prefix by slot:

| Slot | Prefix | Example |
|---|---|---|
| Weapon | `wpn.` | `wpn.frost_blade` |
| Hat | `hat.` | `hat.frost_wolf_hood` |
| Top | `top.` | `top.frost_plate` |
| Bottom | `bottom.` | `bottom.frost_legs` |
| Shoes | `shoes.` | `shoes.frost_boots` |
| Gloves | `gloves.` | `gloves.frost_grips` |
| Cape | `cape.` | `cape.frost_cloak` |
| Shield | `shield.` | `shield.frost_guard` |
| Overall | `overall.` | `overall.frost_suit` |
| Ring | `ring.` | `ring.frost_band` |
| Earring | `earring.` | `earring.frost_ear` |
| Pendant | `pendant.` | `pendant.frost_fang` |
| Belt | `belt.` | `belt.frost_chain` |
| Face | `face.` | `face.frost_mask` |
| Eye | `eye.` | `eye.frost_lens` |
| Shoulder | `shoulder.` | `shoulder.frost_pad` |
| Medal | `medal.` | `medal.frost_iron` |
| Badge | `badge.` | `badge.frost_rune` |
| Pocket | `pocket.` | `pocket.frost_amulet` |

Example weapon:

```ts
"wpn.frost_blade": {
  id: "wpn.frost_blade",
  name: "Frost Blade",
  slot: EquipSlot.WEAPON,
  levelReq: 40,
  primaryStat: "STR",
  baseStatBonus: 14,
  baseAttack: 68,
  weaponType: WeaponType.SWORD,
  classReq: [ClassArchetype.WARRIOR],
  reqStr: 120,
  reqDex: 40,
  wDef: 5,
  speed: 2,
},
```

Example armor:

```ts
"hat.frost_wolf_hood": {
  id: "hat.frost_wolf_hood",
  name: "Frost Wolf Hood",
  slot: EquipSlot.HAT,
  levelReq: 35,
  primaryStat: "STR",
  baseStatBonus: 8,
  baseAttack: 0,
  wDef: 18,
  mDef: 12,
},
```

### ETC (material/drop) items

Add to the `ETC_ITEMS` record:

```ts
"etc.wolf_fang": {
  id: "etc.wolf_fang",
  name: "Wolf Fang",
  description: "A sharp fang from a Frost Wolf, still frosty to the touch.",
},
```

### Item balance rules

- **Weapons:** strictly ascending `baseAttack` per `levelReq` within each `WeaponType`.
  Each weapon type needs 4–7 tiers covering levels 10, 20, 30, 40, 50, 60.
- **Armor:** `wDef`/`mDef` must be non-decreasing across level bands. At least one
  defense stat must strictly increase per band.
- **Core slots** (hat, top, bottom, shoes, gloves, cape, shield, overall) need items at
  levels 5, 10, 20, 30, 40, 50, 60.
- **Shields** are warrior-only (`classReq: [ClassArchetype.WARRIOR]`).
- No item may have `baseStatBonus: 0` or an empty `name`.

---

## 3. Adding a new map

**File:** `packages/shared/src/world.ts`

### Step 1: Define the geometry

```ts
// ── Frosthold Slopes — snow biome, Lv 35–45 ─────────────────────────────

const FROSTHOLD_SLOPES_GROUND_Y = 520;

const FROSTHOLD_SLOPES_SPAWNS: readonly MobSpawnZone[] = [
  { footholdId: 0, mobId: "mob.frost_wolf", count: 6 },
  { footholdId: 1, mobId: "mob.ice_elemental", count: 4 },
];

export const FROSTHOLD_SLOPES: GameMap = {
  id: "frosthold_slopes",
  name: "Frosthold Slopes",
  bgmKey: "snow",
  bgSet: "snow",                          // drives biome parallax + palette
  width: 2400,
  height: 700,

  footholds: [
    { id: 0, x1: 0, y1: FROSTHOLD_SLOPES_GROUND_Y, x2: 2400, y2: FROSTHOLD_SLOPES_GROUND_Y, solid: true },
    { id: 1, x1: 400, y1: 380, x2: 900, y2: 380 },
    { id: 2, x1: 1200, y1: 280, x2: 1700, y2: 280 },
  ],

  ladders: [
    { id: 0, x: 650, yTop: 380, yBottom: FROSTHOLD_SLOPES_GROUND_Y, kind: "ladder" },
    { id: 1, x: 1450, yTop: 280, yBottom: 380, kind: "rope" },
  ],

  spawns: FROSTHOLD_SLOPES_SPAWNS,

  portals: [
    {
      id: "to_frosthold",
      x: 2300,
      y: FROSTHOLD_SLOPES_GROUND_Y - 40,
      toMapId: "frosthold",
      toSpawnId: "arrival",
      label: "← Return to Frosthold",
    },
  ],

  spawnPoints: {
    arrival: { x: 100, y: FROSTHOLD_SLOPES_GROUND_Y - 40 },
  },

  playerSpawn: { x: 100, y: FROSTHOLD_SLOPES_GROUND_Y - 40 },
};
```

### Step 2: Register in the MAPS record

At the bottom of `world.ts`, add it to the `MAPS` object:

```ts
export const MAPS: Record<string, GameMap> = {
  // ...existing maps...
  [FROSTHOLD_SLOPES.id]: FROSTHOLD_SLOPES,
};
```

**That's it for room registration.** `app.config.ts` auto-discovers all `MAPS` keys and
registers each as `mapId__ch0`, `mapId__ch1`, `mapId__ch2` (3 channels). No manual
room registration needed.

### Required map fields

| Field | Requirement |
|---|---|
| `id` | Unique string, `snake_case` |
| `footholds` | ≥ 1 entry; no duplicate `id`s |
| `playerSpawn` | Valid `{x, y}` coordinates |
| `width`, `height` | > 0 |
| `portals[].toMapId` | Must reference a real map id (validated by tests) |
| `spawns[].footholdId` | Must reference a real foothold id |
| `spawns[].mobId` | Must reference a real mob id in `MOBS` |
| `bgSet` | One of the `BiomeVisualSet` values (optional, defaults to `"pastoral"`) |

### Biome visual sets available

`"pastoral"` · `"forest"` · `"rocky"` · `"urban"` · `"swamp"` · `"market"` ·
`"sky"` · `"snow"` · `"underground"` · `"underwater"` · `"jungle"`

---

## 4. Adding a new NPC

**File:** `packages/shared/src/npcs.ts`

```ts
"npc.frost_blacksmith": {
  id: "npc.frost_blacksmith",
  name: "Bjorn the Blacksmith",
  mapId: "frosthold",
  x: 800,
  y: 520 - 40,
  spriteKey: "npc_blacksmith",
  role: "shop",
  dialog: [
    { kind: "line", text: "Welcome to Frosthold! I forge the finest ice-tempered steel." },
    { kind: "line", text: "Need gear? Take a look.", action: { kind: "openShop", payload: "shop.frost_weapons" } },
  ],
},
```

NPC roles: `"guide"` · `"shop"` · `"job"` · `"quest"` · `"storage"` · `"ferry"` · `"travel"`

Dialog rules (enforced by tests):
- ≥ 1 dialog node
- All `next` indices must be valid (within the dialog array bounds)
- Branch nodes must have ≥ 1 choice

---

## 5. Adding a new quest

**File:** `packages/shared/src/quests.ts`

```ts
"quest.frost_wolf_hunt": {
  id: "quest.frost_wolf_hunt",
  name: "Thinning the Pack",
  giverNpcId: "npc.frost_blacksmith",     // must exist in NPCS
  requiredLevel: 35,
  prereqQuestId: "quest.frost_arrival",   // must exist in QUESTS (if set)
  objectives: [
    { kind: "kill", mobId: "mob.frost_wolf", count: 10 },
  ],
  rewards: { mesos: 500, exp: 2000, items: ["hat.frost_wolf_hood"] },
},
```

### Objective types

| Kind | Fields | Example |
|---|---|---|
| `kill` | `mobId`, `count` | Kill 10 Frost Wolves |
| `collect` | `itemId`, `count` | Collect 5 Wolf Fangs |
| `talk` | `npcId` | Talk to Bjorn |
| `level` | `level` | Reach level 40 |

### Quest integrity rules (enforced by tests)

- `giverNpcId` must resolve in `NPCS`
- Kill objective `mobId` must resolve in `MOBS`
- Collect objective `itemId` must resolve in `ITEMS` or `ETC_ITEMS`
- Talk objective `npcId` must resolve in `NPCS`
- Reward item ids must resolve in `ITEMS`
- `prereqQuestId` must resolve to a real quest (no self-references)
- Every quest needs ≥ 1 objective and a `rewards` object

---

## 6. Gate an unfinished zone (Coming Soon)

If a zone isn't ready for testers, gate it so no one can reach it:

### In `packages/shared/src/world.ts`

Mark all portals targeting the zone as `comingSoon: true`:

```ts
{
  id: "to_cogtown",
  x: 2300, y: 500,
  toMapId: "cogtown",
  label: "Cogtown Station",
  comingSoon: true,           // ← blocks portal use + shows amber orb
},
```

### In `packages/server/src/app.config.ts`

Add the map ids to `EXCLUDED_MAPS`:

```ts
const EXCLUDED_MAPS = new Set<string>([
  "tideways", "tideways_reef", "tideways_abyss",
  "drakemoor", "drakemoor_jungle_floor", "drakemoor_dragon_abyss",
  "cogtown", "cogtown_workshop", "cogtown_tower",  // ← add yours
]);
```

This prevents direct room joins via matchmaking. The server also enforces portal
gating in `checkPortalProximity` and the `MAP_TRAVEL` handler.

---

## 7. Tests that must stay green

All tests run from the repo root with `pnpm --filter @maple/shared test`.

### World integrity (`tests/world-integrity.test.ts`)

Runs automatically for **every map** in `MAPS`. Validates:

- ≥ 1 foothold per map
- Valid `playerSpawn` coordinates
- Positive `width` / `height`
- No duplicate foothold ids
- Every portal `toMapId` references a real map
- Every mob spawn `footholdId` references a real foothold
- Every mob spawn `mobId` references a real mob in `MOBS`
- Ladders have distinct `yTop`/`yBottom` and `x` within map bounds
- Every NPC has ≥ 1 dialog node
- All dialog `next` references are valid indices
- All quest kill objectives reference valid mob ids

### Quest integrity (`tests/quest-integrity.test.ts`)

- `giverNpcId` resolves in `NPCS`
- Kill `mobId` resolves in `MOBS`
- Collect `itemId` resolves in `ITEMS` or `ETC_ITEMS`
- Talk `npcId` resolves in `NPCS`
- Reward items resolve in `ITEMS`
- `prereqQuestId` resolves to a real quest
- No self-referencing prereqs
- No duplicate quest ids

### Item catalog tests

- **`weapon-catalog.test.ts`:** weapons have valid `weaponType`, `baseAttack > 0`,
  `baseStatBonus > 0`, non-empty name, valid `classReq`. Per-type ascending
  `baseAttack` by `levelReq`. 4–7 tiers per type covering levels 10–60.
- **`armor-catalog.test.ts`:** every equip slot has ≥ 1 entry. `wDef`/`mDef`
  non-decreasing across level bands. ID prefixes match slot. Shields are warrior-only.
  Core slots cover levels 5–60.
- **`accessory-catalog.test.ts`:** accessory slots have entries.
- **`boss-drops.test.ts`:** boss drop tables reference valid items.

### Other integrity tests

- **`mobs.test.ts`:** `rollMesos` stays within range; `rollItemDrops` respects per-entry chance.
- **`rarity.test.ts`:** 200k-sample distribution matches published weights.
- **`combat.test.ts`:** damage formula correctness.
- **`classes-items.test.ts`:** class-item compatibility.
- **`progression*.test.ts`:** level-up/AP/SP curves.

### Server smoke tests

```bash
pnpm --filter @maple/server test    # smoke.ts + market.ts
```

- `smoke.ts`: full combat loop — join room, fight mobs, die, collect loot.
- `market.ts`: list/buy/cancel with fee math.
- `load.ts`: headless CCU load test (see budgets below).

---

## 8. Performance & asset budgets

### Per-room entity caps (load-test justified)

| Metric | Budget | Source |
|---|---|---|
| **`maxClients` per channel** | **50** | Load test: clean to 80, derated 25% for GC/network |
| **Safe CCU for boss maps** | **40–45** | Extra boss AI + `boss_hp` broadcast overhead |
| **Channels per map** | **3** | `CHANNELS_PER_MAP = 3` in `app.config.ts` |
| **Max CCU per map** | **150** (3 × 50) | Before matchmaking opens new shards |
| **Tick budget** | **16.67 ms** (60 Hz) | `fixedTick` must complete within this |
| **Tick overrun threshold** | **p95 < 70% of budget** | i.e. < 11.67 ms; load test passes at p95 ≈ 1.5 ms |
| **Observed Hz** | Must stay ≥ 60 | Fixed-step accumulator recovers from spikes |

### Spawn limits (per map)

The `SpawnManager` enforces per-zone capacity from `MobSpawnZone.count`. Typical
values: 3–8 mobs per spawn zone. A combat map with 3–5 spawn zones ends up with
15–30 total mobs. **Don't exceed 30 total mob spawns per map** without re-running
the load test — more mobs = more AI ticks + collision checks per `fixedTick`.

### Bandwidth budget

| Players | Patch/client | Server→all (patch) | Verdict |
|---|---|---|---|
| 10 | ~285 B | ~0.4 Mbps | ✅ trivial |
| 25 | ~623 B | ~2.5 Mbps | ✅ fine |
| 50 | ~1.2 KB | ~9.5 Mbps | ✅ target cap |
| 80 | ~1.9 KB | ~24.5 Mbps | ⚠️ upper bound |
| 100 | ~2.4 KB | ~37 Mbps | ❌ too hot |

Bandwidth scales **quadratically**: patch size grows linearly with N (more players to
diff), sent to N clients → O(N²). Keep rooms at ≤ 50 to stay well under 10 Mbps.

### Client bundle budget

Vite splits the client into three chunks:

| Chunk | What | Limit |
|---|---|---|
| `phaser` | Phaser engine | ~1.5 MB (monolithic, can't split) |
| `shared` | `@maple/shared` game data | grows with content, currently ~400 KB |
| `vendor` | React, Radix, Colyseus SDK, zustand | ~200 KB |
| App code | Scenes, UI, overlays | stays under 700 KB |

**`chunkSizeWarningLimit: 1500`** in `vite.config.ts` — flags anything over 1.5 MB
(only Phaser can legitimately reach this). Everything else should stay under 700 KB.

**When adding content to `shared`:** the shared chunk grows with each new mob/item/map
definition. These are pure data (no runtime code), so compression is excellent. But if
the shared chunk exceeds ~600 KB unminified, consider whether you're adding data that
only the server needs (move it to a server-only file) or that's repetitive (share
templates instead of per-instance copies).

### Map size guidelines

| Map type | Recommended `width` | Footholds | Spawns |
|---|---|---|---|
| Town / hub | 1200–1600 | 4–8 | 0 (safe zone) |
| Combat field | 1600–2400 | 5–10 | 3–5 zones |
| Dungeon room | 800–1600 | 3–6 | 2–4 zones |
| Boss arena | 800–1200 | 2–4 | 1 zone + boss |

---

## 9. Channel / room-scaling model

```
                          ┌──── channel 0 (up to 50 players)
                          │
  Map: frosthold_slopes ──┼──── channel 1 (up to 50 players)
                          │
                          └──── channel 2 (up to 50 players)
                          = 150 max CCU for this map
```

### How it works

1. `app.config.ts` reads `MAPS` from `@maple/shared` and registers every map × 3
   channels as Colyseus rooms (lazy — no simulation runs until a client joins).
2. Room names: `frosthold_slopes__ch0`, `frosthold_slopes__ch1`, `frosthold_slopes__ch2`.
   Legacy bare names (`frosthold_slopes`) still work for backward compat → channel 0.
3. Clients request channel counts via `GET /channels?mapId=frosthold_slopes` and can
   switch via `CHANNEL_SWITCH` message.
4. `channelRegistry` tracks all online players across all rooms/channels for cross-
   channel whisper, guild chat, and session management (single-live-session guard).

### Scaling rules

- **One process hosts many rooms** on the same event loop. Each room is cheap until
  it hits 50 clients — then it's bandwidth-bound (see budget above).
- **Horizontal scaling:** add more channels (`CHANNELS_PER_MAP`) or more server
  processes. The `channelRegistry` is an in-memory singleton — for multi-process
  scaling, it would need Redis or similar (not needed yet).
- **Boss maps are heavier.** The `boss_hp` broadcast fires every tick to every
  client. Until it's throttled (send on HP change or at ≤10 Hz), treat boss maps as
  ~40–45 effective cap.

---

## 10. Full checklist for a new zone

Use this as a PR checklist when adding a complete zone (e.g. Cogtown):

### Data layer (`@maple/shared`)

- [ ] **Mobs** added to `mobs.ts` with balanced stats per level band
- [ ] **Items** added to `items.ts` — weapons follow ascending attack per type;
      armor follows ascending defense per band; ID prefixes match slot
- [ ] **ETC items** added for mob drops
- [ ] **Map** added to `world.ts` with footholds, ladders, spawns, portals,
      spawn points, `bgSet`, and `bgmKey`
- [ ] **Map** registered in the `MAPS` record
- [ ] **NPCs** added to `npcs.ts` with valid dialog trees and map placement
- [ ] **Quests** added to `quests.ts` — chain from existing content, all
      references (NPCs, mobs, items) resolve
- [ ] **Shop** entries (if applicable) in `shops.ts`
- [ ] **Set bonuses** (if applicable) in `sets.ts`

### Server layer (`@maple/server`)

- [ ] No changes needed for room registration (auto from `MAPS`)
- [ ] If alpha-gating: add map ids to `EXCLUDED_MAPS` in `app.config.ts`
- [ ] If portal-gating: mark portals as `comingSoon: true` in `world.ts`
- [ ] If a new boss: add encounter logic in `bossManager.ts` and attack patterns

### Client layer (`@maple/client`)

- [ ] If new `bgSet`: add parallax background art + terrain palette
- [ ] If new `bgmKey`: add music asset to the audio pipeline
- [ ] If new NPC `spriteKey`: add sprite sheet
- [ ] If new mob sprites: add mob sprite sheets
- [ ] Portal rendering picks up `comingSoon` automatically (amber orb)

### Tests

```bash
pnpm --filter @maple/shared test       # integrity + catalog tests
pnpm --filter @maple/server test       # smoke + market
pnpm --filter @maple/client test       # UI render tests
pnpm typecheck                          # full typecheck across all packages
```

All 45+ shared tests must pass. The world-integrity test auto-expands to cover
your new map. The quest-integrity test auto-expands to cover your new quests.

### Performance

- [ ] Run `pnpm --filter @maple/server run load -- --map your_new_map --sizes 25,50,75`
      if the map has more than 20 mob spawns or is expected to be a high-traffic zone
- [ ] Verify tick p95 stays under 11.67 ms at 50 clients
- [ ] Verify no tick overruns at 50 clients
- [ ] Keep total mob spawns ≤ 30 per map without a fresh load test

---

*This doc is the content-growth guardrail. Keep it current as systems evolve.*
