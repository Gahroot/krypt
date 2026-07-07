# Familiar System Implementation Plan

> **⚠ Alpha status: FLAGGED OFF.** The familiar system is gated behind `FAMILIAR_ENABLED = false`
> in `packages/shared/src/familiars.ts`. Two items remain before shipping:
> 1. **Sprite rendering** — MapScene does not draw familiar entities; summoned familiars are invisible.
> 2. **Balance/perf tuning** — 30% ATK × 3 familiars = ~90% free DPS; `tickFamiliar` runs the full
>    equip/stat pipeline per attack. Needs damage cap, scaling, or cooldown adjustments.
> Flip the flag to `true` once both are resolved.

## Overview

Add a MapleStory-style familiar system: defeating mobs has a small chance to drop a **familiar card**; cards register in a persistent **familiar collection**; the player can **summon up to 3 familiars** that fight nearby mobs for a fraction of player damage.

## Design Decisions

- **Max summoned familiars**: 3 (tunable constant)
- **Familiar card drop rate**: 2% per mob kill (global constant `FAMILIAR_CARD_DROP_CHANCE`)
- **Familiar card item ID pattern**: `familiar.card.{mobId}` (e.g. `familiar.card.mob.friendly_snail`)
- **Familiar damage**: 30% of summoning player's attack power, on a 1500ms cooldown
- **Familiar HP**: 50% of source mob's maxHp
- **Familiar speed**: matches source mob's speed
- **Familiar aggro range**: 150px horizontal, 80px vertical
- **Familiar attack range**: 50px (melee)
- **Familiar collection state**: persisted in `CharacterRecord.familiars` as `{ registered: string[], summoned: string[] }`

## Files to Create

### 1. `packages/shared/src/familiars.ts` (NEW)
Familiar definitions and helpers:
- `FamiliarCollection` type: `{ registered: string[]; summoned: string[] }`
- `FAMILIAR_CARD_DROP_CHANCE = 0.02`
- `FAMILIAR_MAX_SUMMONED = 3`
- `FAMILIAR_DAMAGE_FRACTION = 0.30`
- `FAMILIAR_ATTACK_COOLDOWN_MS = 1500`
- `FAMILIAR_AGGRO_RANGE = 150`
- `FAMILIAR_AGGRO_VERT = 80`
- `FAMILIAR_ATTACK_RANGE = 50`
- `FAMILIAR_DEAGGRO_RANGE = 200`
- `FAMILIAR_CARD_PREFIX = "familiar.card."`
- `familiarCardId(mobId: string): string` — returns the card item ID
- `familiarIdFromCard(cardItemId: string): string | null` — extracts mobId from card
- `isFamiliarCard(itemId: string): boolean` — checks prefix
- `deriveFamiliarStats(mobDef: MobDef): FamiliarStats` — derives { hp, attackDamage, speed, level, name } from source mob

### 2. `packages/server/src/rooms/schema/Familiar.ts` (NEW)
Colyseus Schema for synced familiar entity:
```ts
class Familiar extends Schema {
  @type("string") mobId = "";       // source mob def id
  @type("string") ownerSession = ""; // owner session id
  @type("number") x = 0;
  @type("number") y = 0;
  @type("int8") facing = 1;
  @type("int16") hp = 0;
  @type("int16") maxHp = 0;
  @type("boolean") dead = false;
  @type("boolean") hit = false;
  // Server-only AI state (not synced)
  instanceId: string;
  targetMobKey: string;
  attackCooldown: number;
  aiState: "idle" | "follow" | "chase" | "attack";
}
```

## Files to Modify

### 3. `packages/shared/src/mobs.ts`
Add a familiar card drop entry to every non-boss mob's dropTable:
```ts
{ itemId: "familiar.card.mob.friendly_snail", chance: 0.02 },
```
This adds `{ itemId: familiarCardId(mob.id), chance: FAMILIAR_CARD_DROP_CHANCE }` to each mob's `dropTable` array. Import from `./familiars.js` at top. Boss mobs do NOT drop familiar cards (consistent with MapleStory).

### 4. `packages/shared/src/net.ts`
Add message type constants and payloads:
- `FAMILIAR_SYNC = 120` — server → client: full familiar collection
- `FAMILIAR_SUMMON = 121` — client → server: summon a familiar
- `FAMILIAR_DISMISS = 122` — client → server: dismiss a familiar
- `FAMILIAR_CARD_DROP = 123` — server → client: you found a familiar card!

Payloads:
```ts
interface FamiliarSyncPayload {
  registered: string[];
  summoned: string[];
}
interface FamiliarSummonPayload { mobId: string; }
interface FamiliarDismissPayload { mobId: string; }
interface FamiliarCardDropPayload { mobId: string; mobName: string; }
```

### 5. `packages/shared/src/index.ts`
Add `export * from "./familiars.js";`

### 6. `packages/server/src/rooms/schema/TownState.ts`
Add `@type({ map: Familiar }) familiars = new MapSchema<Familiar>();`

### 7. `packages/server/src/persistence/store.ts`
- Add `familiars?: { registered: string[]; summoned: string[] }` to `CharacterRecord`
- Add `familiars` to `CHAR_COL` mapping (`"familiars"`)
- Add `familiars` to `JSON_CHAR_KEYS`
- Add serialization/deserialization in `deserializeCharRow` / default in `serializeCharRow`

### 8. `packages/server/src/types.ts`
Re-export new familiar payload types from `@maple/shared`.

### 9. `packages/server/src/rooms/MapRoom.ts`
Major changes:
- **Import**: `Familiar`, `FAMILIAR_*` constants, `familiarCardId`, `isFamiliarCard`, `familiarIdFromCard`, `deriveFamiliarStats`
- **familiarCardDrops()** in `killMob()`: After rolling item drops, roll `Math.random() < FAMILIAR_CARD_DROP_CHANCE`. If hit and the mob is NOT a boss, check if the player already has this familiar registered. If not, register it, persist, and send `FAMILIAR_CARD_DROP` notification + `FAMILIAR_SYNC`.
- **Message handlers**:
  - `FAMILIAR_SUMMON`: validate registered, count < max, spawn Familiar entity at player position, set AI to follow.
  - `FAMILIAR_DISMISS`: find and remove the familiar, delete from state.
- **familiar AI tick** in `fixedTick()`: For each familiar in `state.familiars`:
  1. Find owner player. If owner dead or gone → dismiss.
  2. **follow**: move toward owner, stay within 80px. If mob within aggro range → **chase**.
  3. **chase**: move toward target mob. If in attack range and cooldown ready → **attack**. If mob out of deaggro → back to **follow**.
  4. **attack**: deal damage (player's ATK × FAMILIAR_DAMAGE_FRACTION), set cooldown. If mob dead → back to **follow**.
  5. Broadcast `COMBAT_HIT` for familiar attacks (attackerSession = owner session).
- **onJoin**: restore familiar collection from character record, sync to client. Respawn summoned familiars at player position.
- **onLeave**: dismiss all familiars for the leaving player.
- **persistPlayer**: include `familiars` in the update patch.

### 10. `packages/client/src/state-views.ts`
- Add `FamiliarView` interface: `{ mobId: string; ownerSession: string; x: number; y: number; facing: number; hp: number; maxHp: number; dead: boolean; hit: boolean; }`
- Add `familiars: MapSchema<FamiliarView>` to `TownStateView`

### 11. `packages/client/src/scenes/UI.ts`
- Import `FAMILIAR_MAX_SUMMONED`, `familiarIdFromCard` from `@maple/shared`
- Add familiar collection/summon panel (toggled with `V` key)
  - Shows registered familiars in a grid with mob name, level, HP stats
  - Summon/Dismiss buttons for each registered familiar
  - Shows currently summoned count / max
- Listen for `FAMILIAR_SYNC` → update local state
- Listen for `FAMILIAR_CARD_DROP` → show notification toast ("You found a {name} Familiar Card!")
- Send `FAMILIAR_SUMMON` / `FAMILIAR_DISMISS` messages on button click

## Verification Criteria

1. `pnpm --filter @maple/server test` passes
2. `pnpm typecheck` passes (all packages)
3. Familiar card drops appear in mob drop tables
4. Familiar collection state persists across sessions
5. Summoned familiars attack nearby mobs on the server
6. Client UI renders familiar collection panel

## Steps

1. Create `packages/shared/src/familiars.ts` with all constants, types, and helper functions
2. Add `export * from "./familiars.js"` to `packages/shared/src/index.ts`
3. Add familiar card drops to every non-boss mob in `packages/shared/src/mobs.ts`
4. Add familiar message types and payloads to `packages/shared/src/net.ts`
5. Create `packages/server/src/rooms/schema/Familiar.ts` Colyseus schema
6. Add `familiars` field to `TownState.ts`
7. Add `familiars` to `CharacterRecord`, `CHAR_COL`, `JSON_CHAR_KEYS`, and serialization in `packages/server/src/persistence/store.ts`
8. Re-export familiar payload types in `packages/server/src/types.ts`
9. Add familiar AI, message handlers, card drop logic, persistence, and onJoin/onLeave handling in `MapRoom.ts`
10. Add `FamiliarView` and update `TownStateView` in `packages/client/src/state-views.ts`
11. Add familiar collection/summon UI panel in `packages/client/src/scenes/UI.ts`
12. Run `pnpm --filter @maple/shared test` to verify shared package
13. Run `pnpm --filter @maple/server test` to verify server package
14. Run `pnpm typecheck` to verify all packages compile
