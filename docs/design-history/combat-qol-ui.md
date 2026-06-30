# Combat QoL — UI Wiring Plan

## Context

The entire backend and client runtime are **already implemented**:
- Shared types: all message types (`PICKUP_ALL`/`MACRO_CAST`/`MACRO_LAYOUT`/`AUTO_POT_SYNC`), interfaces (`AutoPotConfig`, `SkillMacro`, `MacroStep`), keybinding actions (`lootAll`, `macro1`–`macro5`)
- Server handlers: `handlePickupAll`, `handleMacroCast`, `handleMacroLayout`, `handleAutoPotSync` (all fully implemented in `MapRoom.ts`)
- Server persistence: `setAutoPot()`, `setMacros()` in `store.ts`, SQL migration `006`
- Server `onJoin`: sends `AUTO_POT_SYNC` + `MACRO_LAYOUT` to client on connect
- Client `UI.ts`: `tickAutoPot()` in update loop, `executeMacro()`, message listeners for `AUTO_POT_SYNC`/`MACRO_LAYOUT`
- Client `MapScene.ts`: `doLootAll()`, loot-all hotkey, macro keybindings

**What's missing**: UI panels where players can (a) configure auto-pot toggles/thresholds/potions and (b) create/edit skill macros. The Controls tab also doesn't list `lootAll` or `macro1`–`macro5` as rebindable.

---

## Changes

### 1. SettingsUI.ts — Add `lootAll` + `macro1–5` to Controls tab

In the `CONTROL_SECTIONS` array, add a new section:
```ts
{
  label: "Combat QoL",
  actions: ["lootAll", "macro1", "macro2", "macro3", "macro4", "macro5"],
},
```

### 2. SettingsUI.ts — Add "Combat QoL" tab

Add a 5th tab: `"Combat QoL"` to `TAB_LABELS` and `renderTab()` switch.

**Increase `PANEL_H`** from `480` to `560` to fit the content.

#### Auto-Pot section (~160px):
- Toggle: "HP Auto-Pot" → `autoPotConfig.hpEnabled`
- Slider: "HP Threshold" → `autoPotConfig.hpThreshold` (0–100 range, use `addSliderPctRow` helper)
- Option: "HP Potion" → `autoPotConfig.hpPotionId` with options `[{id:"pot.small_hp",name:"Minor (50)"},{id:"pot.large_hp",name:"Greater (150)"},{id:"pot.hp_percent",name:"% HP (30%)"}]`
- Toggle: "MP Auto-Pot" → `autoPotConfig.mpEnabled`
- Slider: "MP Threshold" → `autoPotConfig.mpThreshold`
- Option: "MP Potion" → `autoPotConfig.mpPotionId` with options `[{id:"pot.small_mp",name:"Minor (30)"},{id:"pot.large_mp",name:"Greater (100)"}]`

#### Skill Macros section (~340px, scrollable):
- For each of 5 slots (show existing + empty "New Macro" slots):
  - Row: macro name (editable text), step count badge, Edit/Clear buttons
  - When editing: flat list of steps with × to remove, dropdown "+ Add Step" (skills from class + consumables)
- Limit: max 5 macros, max 10 steps each

**New helper**: `addSliderPctRow(label, value, y, onChange)` — wraps `addSliderRow` with 0–100 range (internally divides/multiplies by 100).

### 3. SettingsUI.ts — Store state + sync on close

- Private fields: `autoPotConfig`, `macros`, `playerClass` (fetched from registry/localStorage)
- On tab open: load current values from `UI.ts` via `getAutoPotConfig()`/`getMacros()` public methods
- On value change: update local state
- On close: call `UI.updateAutoPotConfig()` and `UI.updateMacros()` to persist

### 4. UI.ts — Add public getter/setter methods

```ts
/** Get current auto-pot config (read by SettingsUI). */
getAutoPotConfig(): AutoPotConfig { return { ...this.autoPotConfig }; }

/** Get current macros (read by SettingsUI). */
getMacros(): SkillMacro[] { return this.macros.map(m => ({ ...m, steps: [...m.steps] })); }

/** Update auto-pot config + send to server. */
updateAutoPotConfig(config: AutoPotConfig): void {
  this.autoPotConfig = config;
  const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<...>;
  if (room) room.send(MessageType.AUTO_POT_SYNC, { config });
}

/** Update macros + send to server. */
updateMacros(macros: SkillMacro[]): void {
  this.macros = macros;
  const room = this.registry.get(ROOM_REGISTRY_KEY) as Room<...>;
  if (room) room.send(MessageType.MACRO_LAYOUT, { macros });
}
```

---

## Files to modify

| File | Change |
|------|--------|
| `packages/client/src/scenes/SettingsUI.ts` | Add tab, Controls section, auto-pot UI, macro editor UI, persist wiring |
| `packages/client/src/scenes/UI.ts` | Add `getAutoPotConfig()`, `getMacros()`, `updateAutoPotConfig()`, `updateMacros()` public methods |

No server changes needed — everything is already wired.

---

## Steps

1. **SettingsUI.ts** — Add `"Combat QoL"` to `CONTROL_SECTIONS` array
2. **SettingsUI.ts** — Add `"Combat QoL"` to `TAB_LABELS`, increase `PANEL_H` to 560, add case in `renderTab()`
3. **SettingsUI.ts** — Add `addSliderPctRow()` helper (0–100 percentage slider)
4. **SettingsUI.ts** — Add `autoPotConfig`/`macros`/`playerClass` private fields, load from UI on tab open
5. **SettingsUI.ts** — Implement `renderCombatQoLTab(y0)` with auto-pot toggles/sliders/pickers + macro editor (inline steps with add/remove)
6. **SettingsUI.ts** — Wire `close()` to call `UI.updateAutoPotConfig()` and `UI.updateMacros()`
7. **UI.ts** — Add `getAutoPotConfig()`, `getMacros()`, `updateAutoPotConfig()`, `updateMacros()` public methods
8. **Verify** — `pnpm typecheck` + `pnpm --filter @maple/client build`
