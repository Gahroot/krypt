# Plan: Add Runes + Treasure Hunter Boxes to Combat Maps

## Overview

Add two MapleStory-style map features to all combat maps (maps with non-empty `spawns`):
1. **Runes** — periodic interactable that grants a timed party-wide buff (EXP/speed/ATK)
2. **Treasure Hunter Boxes** — destructible chests that drop bonus EXP/mesos/items

## Design

### Runes
- Spawn every **60s** at a random foothold position on combat maps (max 1 active at a time)
- Despawn after **30s** if not activated
- Player presses **interact** (↑) near a rune → activates buff for **20s**
- Three buff types: EXP boost (+50%), Speed boost (+30% move speed), ATK boost (+20% ATK)
- Random selection on each spawn
- Visual: glowing circle + glyph symbol

### Treasure Hunter Boxes
- Spawn every **90s** at a random foothold position (max 1 active at a time)  
- Despawn after **45s** if not destroyed
- Has **500 HP** — player attacks it like a mob (melee/ranged/magic)
- On destroy: grants 100–300 bonus EXP + 500–2000 mesos to attacker + chance for random item drop
- Visual: chest sprite with HP bar when damaged

### Detection: A map is a "combat map" if `map.spawns.length > 0`

---

## Files to Change

### 1. `packages/shared/src/net.ts` — Add MessageTypes + payloads
- Add `RUNE_SPAWN` (127), `RUNE_DESPAWN` (128), `RUNE_ACTIVATE` (129)
- Add `TREASURE_SPAWN` (130), `TREASURE_HIT` (131), `TREASURE_DESTROY` (132)
- Define payload interfaces: `RuneSpawnPayload`, `RuneDespawnPayload`, `RuneActivatePayload`, `TreasureSpawnPayload`, `TreasureHitPayload`, `TreasureDestroyPayload`

### 2. `packages/shared/src/world.ts` — Add helper + constants
- Add `isCombatMap(map: GameMap): boolean` helper function
- Add `RuneType` enum-like union: `"exp" | "speed" | "atk"`
- Add rune/buff constants: `RUNE_SPAWN_INTERVAL_MS`, `RUNE_LIFETIME_MS`, `RUNE_BUFF_DURATION_MS`

### 3. `packages/server/src/runeManager.ts` — NEW file
- `RuneManager` class: handles spawn timer, active rune state, activation + buff application
- Methods: `tick(dt)`, `activate(sessionId)`, `getActiveRune()`
- Buff application: uses existing `applyEffect()` from shared
- Broadcasts `RUNE_SPAWN`, `RUNE_DESPAWN`, `RUNE_ACTIVATE` messages

### 4. `packages/server/src/treasureBoxManager.ts` — NEW file
- `TreasureBoxManager` class: handles spawn timer, box state, hit detection, loot generation
- Methods: `tick(dt)`, `onAttack(sessionId, player)`, `getActiveBox()`
- Uses existing `rollMesos()`, `rollItemDrops()` from shared for loot
- Broadcasts `TREASURE_SPAWN`, `TREASURE_HIT`, `TREASURE_DESTROY` messages

### 5. `packages/server/src/rooms/MapRoom.ts` — Integrate managers
- Import + instantiate `RuneManager` and `TreasureBoxManager` in `onCreate()` (only for combat maps)
- Add tick calls in `fixedTick()` 
- In `tryAttack()`: check if treasure box is in attack range before checking mobs
- Handle `RUNE_ACTIVATE` message from client (validate proximity)

### 6. `packages/server/src/types.ts` — Re-export new types
- Add re-exports for new payload types from `@maple/shared`

### 7. `packages/client/src/scenes/MapScene.ts` — Render + interact
- Listen for `RUNE_SPAWN` → render glowing rune sprite with prompt
- Listen for `RUNE_DESPAWN` → destroy rune sprite
- Listen for `RUNE_ACTIVATE` → play activation effect + show buff label
- Listen for `TREASURE_SPAWN` → render chest sprite
- Listen for `TREASURE_HIT` → flash + show damage number
- Listen for `TREASURE_DESTROY` → destroy chest + show reward floats
- Send `RUNE_ACTIVATE` when interact key pressed near rune

---

## Steps

1. **Add MessageTypes + payload interfaces** to `packages/shared/src/net.ts`
2. **Add `isCombatMap` helper + constants** to `packages/shared/src/world.ts`
3. **Create `packages/server/src/runeManager.ts`** — rune spawn/activate/buff logic
4. **Create `packages/server/src/treasureBoxManager.ts`** — box spawn/attack/loot logic
5. **Update `packages/server/src/types.ts`** — re-export new payload types
6. **Update `packages/server/src/rooms/MapRoom.ts`** — integrate both managers
7. **Update `packages/client/src/scenes/MapScene.ts`** — render runes + boxes, handle interactions
8. **Verify** — run `pnpm --filter @maple/shared test` then `pnpm typecheck`
