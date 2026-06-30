# Combat QoL: Auto-Pot, Loot-All, Skill Macros

## Overview

Three MapleStory-standard combat QoL features wired through the existing authoritative server pattern. All three reuse existing validation (handleUseConsumable, handlePickup, handleSkillCast) — no new power, just convenience.

---

## 1. Shared Types (`packages/shared/src/net.ts`)

### New MessageType entries (after `SETTINGS_SYNC: 98`)
- `PICKUP_ALL: 99` — vacuum all in-range drops
- `MACRO_CAST: 100` — execute a skill macro by id
- `MACRO_LAYOUT: 102` — sync macro definitions client↔server
- `AUTO_POT_SYNC: 103` — sync auto-pot config client↔server

### New payload interfaces

```ts
// ── Auto-Pot ──────────────────────────────────────────────────
export interface AutoPotConfig {
  hpEnabled: boolean;
  hpThreshold: number;   // 0–100 percent
  mpEnabled: boolean;
  mpThreshold: number;   // 0–100 percent
  hpPotionId: string;    // consumable defId, e.g. "pot.large_hp"
  mpPotionId: string;    // consumable defId, e.g. "pot.large_mp"
}

export interface AutoPotSyncPayload {
  config: AutoPotConfig;
}

// ── Loot All ──────────────────────────────────────────────────
// No payload needed — empty signal. Server iterates state.loot.

// ── Skill Macros ──────────────────────────────────────────────
export interface MacroStep {
  type: "skill" | "consumable";
  id: string;
}

export interface SkillMacro {
  id: string;
  name: string;
  steps: MacroStep[];
}

export interface MacroLayoutPayload {
  macros: SkillMacro[];
}

export interface MacroCastPayload {
  macroId: string;
}
```

### Export from `packages/shared/src/index.ts`
Add re-exports for the new types.

---

## 2. Shared Keybindings (`packages/shared/src/keybindings.ts`)

### New ActionIds
- `"lootAll"` — pick up all in-range drops
- `"macro1"` through `"macro5"` — trigger skill macros

### Updates
- Add to `ActionId` union
- Add to `ALL_ACTION_IDS` array
- Add to `ACTION_LABELS` (e.g. `"Loot All"`, `"Macro 1"`, ...)
- Add to `DEFAULT_KEY_MAP` (e.g. `lootAll: "Z"`, `macro1-macro5: unbound`)

---

## 3. Server Persistence

### Migration: `packages/server/src/persistence/migrations/006_combat_qol.sql`
```sql
ALTER TABLE characters ADD COLUMN auto_pot TEXT NOT NULL DEFAULT '{}';
ALTER TABLE characters ADD COLUMN macros TEXT NOT NULL DEFAULT '[]';
```

### `CharacterRecord` (store.ts)
Add fields:
- `autoPot?: AutoPotConfig`
- `macros?: SkillMacro[]`

### `CHAR_COL` mapping
- `autoPot: "auto_pot"`
- `macros: "macros"`

### `JSON_CHAR_KEYS` set
Add `"autoPot"` and `"macros"`.

### `deserializeCharRow` (store.ts)
Parse `auto_pot` and `macros` from JSON.

### New store methods
- `getAutoPot(charId): AutoPotConfig | undefined`
- `setAutoPot(charId, config): void`
- `getMacros(charId): SkillMacro[]`
- `setMacros(charId, macros): void`

### Hydration backfill (constructor)
Default `autoPot` → `{ hpEnabled: false, hpThreshold: 50, mpEnabled: false, mpThreshold: 50, hpPotionId: "pot.large_hp", mpPotionId: "pot.large_mp" }`
Default `macros` → `[]`

---

## 4. Server Player Schema (`packages/server/src/rooms/schema/Player.ts`)

Add server-only fields (no `@type`, not synced):
```ts
autoPot: AutoPotConfig = { hpEnabled: false, hpThreshold: 50, mpEnabled: false, mpThreshold: 50, hpPotionId: "pot.large_hp", mpPotionId: "pot.large_mp" };
macros: SkillMacro[] = [];
```

---

## 5. Server Handlers (`packages/server/src/rooms/MapRoom.ts`)

### Message registration (in the `onMessage` map)
```ts
[MessageType.PICKUP_ALL]: (client) => { this.handlePickupAll(client); },
[MessageType.MACRO_CAST]: (client, msg) => { this.handleMacroCast(client, msg); },
[MessageType.MACRO_LAYOUT]: (client, msg) => { this.handleMacroLayout(client, msg); },
[MessageType.AUTO_POT_SYNC]: (client, msg) => { this.handleAutoPotSync(client, msg); },
```

### `handlePickupAll(client)`
- Get player, skip if dead
- Iterate `state.loot`, for each drop: check distance ≤ `PICKUP_RANGE`
- For each in-range drop: reuse the exact logic from `handlePickup` (create InventoryItem, write to DB, delete drop, quest progress)
- Throttle: max 1 per 200ms per player

### `handleMacroCast(client, msg)`
- Validate macro exists in `player.macros`
- For each step in the macro:
  - If `type === "skill"`: call `handleSkillCast(client, { skillId })` (reuse existing)
  - If `type === "consumable"`: call `handleUseConsumable(client, { defId })` (reuse existing)
- Each step is independently validated — fails silently if on cooldown / not learned / no item

### `handleMacroLayout(client, msg)`
- Validate: array of `{ id, name, steps }`, max 5 macros, max 10 steps each
- Store in `player.macros`
- Persist via `accountStore.setMacros(charId, macros)`

### `handleAutoPotSync(client, msg)`
- Validate config shape
- Clamp thresholds to 0–100
- Only allow `pot.*` or `con.*` potion defIds (reuse `isConsumable` + `getConsumableDef`)
- Store in `player.autoPot`
- Persist via `accountStore.setAutoPot(charId, config)`

### Load on join (existing hydration block ~line 2460)
```ts
player.autoPot = character.autoPot ?? { ...defaults };
player.macros = character.macros ?? [];
```
Send `AUTO_POT_SYNC` + `MACRO_LAYOUT` to client after join (like QUICKSLOT_LAYOUT is sent).

---

## 6. Client: Loot-All Input (`packages/client/src/scenes/MapScene.ts`)

### Add keybinding in `create()`
After existing key setup, bind `lootAll` action to a keydown handler:
```ts
keybindings.onActionDown("lootAll", () => {
  room.send(MessageType.PICKUP_ALL);
});
```

If `KeyBindingService` doesn't have `onActionDown`, use the raw keyboard listener pattern already used elsewhere.

### Constant
```ts
const LOOT_ALL_COOLDOWN_MS = 300;
```

---

## 7. Client: Auto-Pot Logic (`packages/client/src/scenes/UI.ts`)

### State fields
```ts
private autoPotConfig: AutoPotConfig = { hpEnabled: false, hpThreshold: 50, mpEnabled: false, mpThreshold: 50, hpPotionId: "pot.large_hp", mpPotionId: "pot.large_mp" };
private lastAutoPotHpAt = 0;
private lastAutoPotMpAt = 0;
private readonly AUTO_POT_COOLDOWN_MS = 800;
```

### In `update(time, delta)` — add auto-pot check
```ts
this.tickAutoPot(time);
```

### `tickAutoPot(time)`
- Skip if no localPlayer, dead, or room not connected
- If `hpEnabled` and `hp/maxHp * 100 < hpThreshold` and `time - lastAutoPotHpAt > AUTO_POT_COOLDOWN_MS`:
  - Send `USE_CONSUMABLE { defId: hpPotionId }` via room
  - Set `lastAutoPotHpAt = time`
- Same for MP with `mpEnabled`

### Wire AUTO_POT_SYNC listener in `setupQuickslotMessageListeners` (or new method)
On `MessageType.AUTO_POT_SYNC`, update `this.autoPotConfig`.

### Settings panel integration
In the settings panel (already exists as a panel system), add an "Auto-Pot" section:
- HP toggle + threshold slider (or number input)
- MP toggle + threshold slider
- Potion selector dropdown (filtered to heal potions from inventory)
- Save button → sends `AUTO_POT_SYNC` to server

### localStorage fallback
Use `getAutoPot/setAutoPot` in `backend.ts` (new functions, same pattern as quickslots).

---

## 8. Client: Skill Macros (`packages/client/src/scenes/UI.ts`)

### State fields
```ts
private macros: SkillMacro[] = [];
private macroPanelOpen = false;
private macroPanelContainer!: Phaser.GameObjects.Container;
private macroPanelBg!: Phaser.GameObjects.Graphics;
```

### MACRO_LAYOUT listener
On `MessageType.MACRO_LAYOUT`, update `this.macros`.

### Macro casting (from quickslot keyboard handler or macro panel)
When a macro key is pressed (macro1–macro5):
```ts
room.send(MessageType.MACRO_CAST, { macroId: this.macros[i].id });
```

### Macro editing UI
A simple panel (toggle via a new keybind or accessible from the skill tree):
- List existing macros with name + step count
- Add / edit / delete buttons
- When editing: show learned skills and consumables from inventory as draggable items
- Each macro has a name field and a list of steps
- Save → `MACRO_LAYOUT` message to server + localStorage backup

### localStorage backup
`getMacros/setMacros` in `backend.ts`.

---

## 9. Client Backend (`packages/client/src/backend.ts`)

### New functions
```ts
export interface AutoPotConfig { hpEnabled: boolean; hpThreshold: number; mpEnabled: boolean; mpThreshold: number; hpPotionId: string; mpPotionId: string; }

export function getAutoPot(charId: string): AutoPotConfig { ... }
export function setAutoPot(charId: string, config: AutoPotConfig): void { ... }

export interface SkillMacro { id: string; name: string; steps: Array<{ type: "skill" | "consumable"; id: string }>; }

export function getMacros(charId: string): SkillMacro[] { ... }
export function setMacros(charId: string, macros: SkillMacro[]): void { ... }
```

---

## Files Changed

| File | Change |
|------|--------|
| `packages/shared/src/net.ts` | Add MessageType entries + payload interfaces |
| `packages/shared/src/index.ts` | Re-export new types |
| `packages/shared/src/keybindings.ts` | Add lootAll, macro1–5 ActionIds + defaults |
| `packages/server/src/persistence/migrations/006_combat_qol.sql` | New migration |
| `packages/server/src/persistence/store.ts` | CharacterRecord + CHAR_COL + JSON_CHAR_KEYS + methods |
| `packages/server/src/rooms/schema/Player.ts` | autoPot + macros fields |
| `packages/server/src/rooms/MapRoom.ts` | 4 new handlers + hydration + sends |
| `packages/client/src/backend.ts` | localStorage helpers |
| `packages/client/src/scenes/MapScene.ts` | lootAll keybind |
| `packages/client/src/scenes/UI.ts` | Auto-pot tick, macro panel, macro casting |

---

## Verification

1. `pnpm --filter @maple/shared build` — shared types compile
2. `pnpm --filter @maple/server typecheck` — server passes
3. `pnpm --filter @maple/client build` — client builds (tsc + vite)
4. `pnpm test` — existing tests still pass
5. `pnpm typecheck` — cross-package

---

## Steps

1. Add MessageType entries (99–103) and payload interfaces to `packages/shared/src/net.ts`
2. Export new types from `packages/shared/src/index.ts`
3. Add `lootAll` and `macro1`–`macro5` ActionIds to `packages/shared/src/keybindings.ts`
4. Create migration `006_combat_qol.sql` adding `auto_pot` and `macros` columns
5. Add `autoPot` and `macros` to `CharacterRecord`, `CHAR_COL`, `JSON_CHAR_KEYS`, `deserializeCharRow`, and new store methods in `packages/server/src/persistence/store.ts`
6. Add `autoPot` and `macros` server-only fields to `packages/server/src/rooms/schema/Player.ts`
7. Add 4 message handlers + hydration in `packages/server/src/rooms/MapRoom.ts`
8. Add localStorage helpers for auto-pot and macros in `packages/client/src/backend.ts`
9. Add loot-all keybind in `packages/client/src/scenes/MapScene.ts`
10. Add auto-pot tick logic + macro panel + MACRO_CAST/AUTO_POT_SYNC listeners in `packages/client/src/scenes/UI.ts`
11. Run `pnpm typecheck && pnpm --filter @maple/client build` to verify
