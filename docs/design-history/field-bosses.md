# Field Bosses — Heartland Regions

Add classic early-game field bosses (Mano, Stumpy, King Slime, Mushmom, Jr. Balrog) across the Heartland regions with full boss combat, summon-adds, multi-phase attacks, HP bar broadcast, timed spawns, and loot ownership.

## Overview

Five named field bosses placed across Heartland combat zones. Each boss has:
- **Rich drop tables**: rare gear + high-potential-tier guarantees + legendary-eligible items
- **Telegraphed multi-phase attack loop**: phase 1 → phase 2 (enrage at 50% HP) with different patterns
- **Summoned adds**: each boss summons its own minions during the encounter
- **HP bar broadcast**: server sends boss HP updates to all clients
- **Loot ownership**: killing party gets exclusive loot

## Boss Definitions

| Boss | Region | Level | HP | Element | Summon Item | Timed Spawn |
|------|--------|-------|----|---------|-------------|-------------|
| Mano | Meadowfield | 8 | 800 | PHYSICAL | — | Every 3 min |
| Stumpy | Sylvanreach Canopy | 12 | 1200 | POISON | — | Every 3 min |
| King Slime | Craghold Cliffs | 15 | 2000 | PHYSICAL | — | Every 4 min |
| Mushmom | Dusk Ward Backalley | 18 | 2500 | POISON | — | Every 4 min |
| Jr. Balrog | Mirefen Ruins | 22 | 3000 | DARK | item.balrog_talisman | Summoned via drop |

## Changes by File

### 1. `packages/shared/src/mobs.ts`

**Add to `MobDef` interface** (all optional, boss-tier only):

```ts
/** Named attack patterns for telegraphed multi-phase boss attacks. */
readonly attackPatternIds?: readonly string[];
/** Contact damage dealt when a player touches the boss. */
readonly contactDamage?: number;
/** AoE damage dealt by area attacks. */
readonly aoeDamage?: number;
/** Mob def ids to summon as adds during the encounter. */
readonly summonAddIds?: readonly string[];
/** Item id that, when used, summons this boss. */
readonly summonItemId?: string;
/** Phase HP thresholds (fraction of maxHp) that trigger phase transitions. */
readonly phases?: readonly number[];
```

**Define 5 new boss entries** in the `MOBS` record:

1. `mob.mano` — "Mano" (Lv 8, 800 HP, PHYSICAL)
   - Phase thresholds: [0.5]
   - Attack patterns: ["charge", "slam"]
   - Contact dmg: 15, AoE dmg: 20
   - Summons: ["mob.meadow_slime"]
   - Drop table: rare weapons (EPIC+), leather gear (RARE+), chance at legendary cape

2. `mob.stumpy` — "Stumpy" (Lv 12, 1200 HP, POISON)
   - Phase thresholds: [0.5]
   - Attack patterns: ["root_slam", "poison_cloud"]
   - Contact dmg: 20, AoE dmg: 30
   - Summons: ["mob.root_crawler"]
   - Drop table: rare weapons (EPIC+), forest gear (RARE+), chance at unique circlet

3. `mob.king_slime` — "King Slime" (Lv 15, 2000 HP, PHYSICAL)
   - Phase thresholds: [0.5]
   - Attack patterns: ["body_slam", "split_spawn"]
   - Contact dmg: 25, AoE dmg: 35
   - Summons: ["mob.meadow_slime", "mob.dawn_shroom"]
   - Drop table: rare weapons (EPIC+), armor (EPIC+), chance at unique helm

4. `mob.mushmom` — "Mushmom" (Lv 18, 2500 HP, POISON)
   - Phase thresholds: [0.5]
   - Attack patterns: ["spore_burst", "toxic_slam"]
   - Contact dmg: 30, AoE dmg: 40
   - Summons: ["mob.mushroom"]
   - Drop table: rare weapons (EPIC+), dark gear (UNIQUE+), chance at legendary weapon

5. `mob.jr_balrog` — "Jr. Balrog" (Lv 22, 3000 HP, DARK)
   - Phase thresholds: [0.5]
   - Attack patterns: ["dark_charge", "wing_slash", "abyssal_roar"]
   - Contact dmg: 40, AoE dmg: 55
   - Summons: ["mob.arc_wraith"]
   - summonItemId: "item.balrog_talisman"
   - Drop table: rare weapons (UNIQUE+), dark armor (EPIC+), legendary-eligible items

**Add helper**: `isBossSpawnZone(zone)` to identify boss zones by mobId lookup.

### 2. `packages/shared/src/world.ts`

Add a `BossSpawnZone` interface and add boss spawns to the relevant combat maps:

```ts
export interface BossSpawnZone extends MobSpawnZone {
  /** Interval in ms between timed respawns. Omit for summoned bosses. */
  readonly respawnIntervalMs?: number;
}
```

**Map changes:**

- `MEADOWFIELD`: Add `{ footholdId: 0, mobId: "mob.mano", count: 1 }` to spawns
- `SYLVANREACH_CANOPY`: Add `{ footholdId: 3, mobId: "mob.stumpy", count: 1 }` to spawns
- `CRAGHOLD_CLIFFS`: Add `{ footholdId: 3, mobId: "mob.king_slime", count: 1 }` to spawns
- `DUSK_WARD_BACKALLEY`: Add `{ footholdId: 4, mobId: "mob.mushmom", count: 1 }` to spawns (rooftop)
- `MIREFEN_RUINS`: Boss chamber already has Bogmaw. Add Jr. Balrog as **item-summoned** only — NOT in static spawns. Add a `bossSpawns` field to GameMap:

```ts
export interface GameMap {
  // ... existing fields ...
  /** Boss encounters that require special spawn conditions (timed, item-summoned, etc.) */
  readonly bossSpawns?: readonly BossSpawnZone[];
}
```

### 3. `packages/server/src/bossManager.ts` (NEW FILE)

`BossManager` class — manages boss encounters per room:

```ts
export interface BossEncounter {
  bossInstanceId: string;
  bossDefId: string;
  phase: number;
  lastAttackTick: number;
  attackPatternIndex: number;
  summonCooldown: number;
  addInstanceIds: string[];
  /** Session ids of players who have dealt damage (for loot ownership). */
  damageOwners: Set<string>;
}

export class BossManager {
  private encounters = new Map<string, BossEncounter>();
  private bossTimers = new Map<string, number>(); // bossDefId → time since last spawn

  /** Called each tick by MapRoom.fixedTick */
  tick(dt: number, state: TownState, map: GameMap, nextId: () => number): void;

  /** Called when a boss mob is hit — track damage owners, handle phase transitions */
  onBossHit(bossInstanceId: string, attackerSessionId: string, hp: number, maxHp: number, phases: readonly number[]): void;

  /** Called when a boss dies — return loot recipients */
  onBossDeath(bossInstanceId: string): Set<string>;

  /** Spawn timed bosses whose cooldown has elapsed */
  checkTimedSpawns(state: TownState, map: GameMap, nextId: () => number): void;

  /** Summon a boss from an item use */
  summonBoss(bossDefId: string, state: TownState, map: GameMap, x: number, y: number, footholdId: number, nextId: () => number): string | null;
}
```

**Multi-phase attack loop:**
- Phase 1 (100% → 50%): Basic attacks on a cooldown (from `attackCooldownMs`), summon adds periodically
- Phase 2 (≤50%): Attack cooldown reduced by 40%, new attack patterns activated, add summon rate doubled
- Each attack tick: broadcast a `"boss_attack"` message with pattern id, target, damage
- Telegraph: 500ms warning before each boss AoE attack

**Summon-adds logic:**
- Every N seconds (scaled by boss level), spawn 1-3 adds from `summonAddIds`
- Max adds capped at 6 per encounter
- Adds despawn when the boss dies or after 30s

**HP bar broadcast:**
- Every tick during boss encounter: broadcast `"boss_hp"` with `{ instanceId, mobId, hp, maxHp, phase, name }`

**Loot ownership:**
- When boss dies, only players in `damageOwners` set (and their party members) receive loot
- EXP distributed to all owners equally
- Mesos scaled to boss level

### 4. `packages/server/src/rooms/schema/Mob.ts`

Add server-only boss encounter fields:

```ts
// ─── Boss encounter state (server-only) ──
bossPhase = 0;           // current phase (0 = phase 1, 1 = phase 2)
bossPhaseTransitioned = false; // has the current phase transition been processed
bossPatternTimer = 0;    // ms until next attack pattern executes
bossSummonTimer = 0;     // ms until next add summon
```

### 5. `packages/server/src/spawnManager.ts`

Update `SpawnManager` constructor to accept `BossManager` and `onSpawn`/`onDeath` callbacks for boss tracking. Already has `onSpawn`/`onDeath` optional callbacks — wire them to BossManager.

Add `getRespawnDelay` handling for timed boss spawns using `bossSpawns` from the map.

### 6. `packages/server/src/rooms/MapRoom.ts`

- Import and instantiate `BossManager`
- Wire `onSpawn`/`onDeath` callbacks in `SpawnManager` creation to `BossManager`
- In `fixedTick`: call `bossManager.tick(dt, ...)`
- In `tryAttack`: when hitting a boss mob, call `bossManager.onBossHit(...)`
- In `killMob`: when killing a boss, call `bossManager.onBossDeath(...)` and only award loot to damage owners
- Handle `"use_summon_item"` message type for Jr. Balrog summoning
- Broadcast `boss_hp` and `boss_attack` messages to all clients

### 7. `packages/server/test/boss.ts` (NEW FILE)

Test that a boss:
1. **Spawns correctly** — boss instance appears in state.mobs with correct def
2. **Takes damage across phases** — hit boss from full HP, verify HP decreases, verify phase transition at 50%
3. **Dies and drops loot** — deal lethal damage, verify boss.dead = true, verify loot appears in state.loot
4. **Damage owners tracked** — only the attacking player is in the loot recipients
5. **Summons adds** — verify adds spawn during the encounter

Test uses a small boot+sleep pattern matching `mobCombat.ts`:
- Boot a room for a map with a boss (meadowfield for Mano)
- Connect a player, teleport next to boss
- Deal damage in a loop, checking phase transitions
- Kill the boss, verify loot and EXP

## Verification

1. `pnpm --filter @maple/shared typecheck` — shared types compile
2. `pnpm --filter @maple/shared test` — vitest passes (existing + any new shared tests)
3. `pnpm --filter @maple/server typecheck` — server types compile
4. `npx tsx packages/server/test/boss.ts` — new boss test passes
5. `pnpm typecheck` — full monorepo typecheck

## Steps

1. Add `BossSpawnZone` interface and `bossSpawns` field to `GameMap` in `packages/shared/src/world.ts`
2. Add boss fields to `MobDef` in `packages/shared/src/mobs.ts` (`attackPatternIds`, `contactDamage`, `aoeDamage`, `summonAddIds`, `summonItemId`, `phases`)
3. Define 5 boss mob entries in `MOBS` record: `mob.mano`, `mob.stumpy`, `mob.king_slime`, `mob.mushmom`, `mob.jr_balrog`
4. Place boss spawns on their respective combat zone maps in `world.ts` (Meadowfield, Canopy, Cliffs, Backalley) and add `bossSpawns` for Jr. Balrog on Mirefen Ruins
5. Add boss-phase server-only fields to `Mob` schema in `packages/server/src/rooms/schema/Mob.ts`
6. Create `packages/server/src/bossManager.ts` with full BossManager class (timed spawns, multi-phase attack loop, summon-adds, HP broadcast, loot ownership)
7. Integrate BossManager into `MapRoom.ts` — instantiate in onCreate, tick in fixedTick, wire hit/kill events, add summon-item message handler, broadcast boss messages
8. Wire SpawnManager onSpawn/onDeath callbacks to BossManager in MapRoom.onCreate
9. Create `packages/server/test/boss.ts` — test spawn, damage across phases, death + drops
10. Run full typecheck (`pnpm typecheck`) and boss test (`npx tsx packages/server/test/boss.ts`)
