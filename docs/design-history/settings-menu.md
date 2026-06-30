# Settings Menu with Full Key Rebinding

## Overview

Add a centralized keybinding service, a settings overlay (Esc toggle) with Controls/Video/Audio/Gameplay tabs, and server-side persistence for all player settings. Refactor MapScene + UI to read all key bindings from the service instead of hardcoded key checks.

## Architecture

```
packages/shared/src/keybindings.ts       # ActionId enum + DefaultKeyMap + types
packages/client/src/keybindings.ts       # KeyBindingService singleton (client-only)
packages/client/src/scenes/SettingsUI.ts # New Phaser scene (overlay, toggled with Esc)
packages/client/src/backend.ts           # Add getSettings/setSettings localStorage
packages/server/src/rooms/schema/Player.ts  # Add server-only settings field
packages/server/src/persistence/store.ts # Add settings CRUD to CharacterRecord
packages/shared/src/net.ts              # Add SETTINGS_SYNC MessageType
packages/server/src/persistence/migrations/005_settings.sql  # DB migration
```

---

## Step 1: Shared types — `packages/shared/src/keybindings.ts` (NEW)

Define a string-union `ActionId` for every rebindable action, a `DefaultKeyMap` constant, and `PlayerSettings` / `SettingsPayload` types.

```ts
// Rebindable action identifiers
export type ActionId =
  // Movement
  | "moveLeft" | "moveRight" | "moveUp" | "moveDown"
  // Combat / interaction
  | "attack" | "jump" | "jumpAlt" | "interact"
  // Quickslots 1-10
  | "quickslot1" | "quickslot2" | "quickslot3" | "quickslot4" | "quickslot5"
  | "quickslot6" | "quickslot7" | "quickslot8" | "quickslot9" | "quickslot10"
  // UI panels (openEquip removed — equip is inside inventory; pickup removed — auto-loot)
  | "openInventory" | "openSkills" | "openStats" | "openQuests"
  | "openMap" | "openChat"
  | "openMarket" | "openCashShop" | "openGuild" | "openParty" | "openFriends"
  | "openCube" | "openUpgrade"
  // Utility
  | "npcInteract";

// Phaser key code strings (e.g. "SPACE", "LEFT", "A", "I")
export type KeyBind = string;

export type KeyMap = Record<ActionId, KeyBind>;

export const DEFAULT_KEY_MAP: KeyMap = { ... };

// Full player settings (controls + video + audio + gameplay)
export interface PlayerSettings {
  keyMap: Partial<KeyMap>;           // overrides; default used for missing
  video: {
    fullscreen: boolean;
    uiScale: number;                 // 0.8 | 1.0 | 1.2 | 1.5
    fpsCap: number;                  // 30 | 60 | 120 | 0 (unlimited)
    showDamageNumbers: boolean;
  };
  audio: {
    masterVolume: number;            // 0-1
    bgmVolume: number;
    sfxVolume: number;
    muted: boolean;
  };
  gameplay: {
    showNpcPrompts: boolean;
    showMinimapNames: boolean;
  };
}

export const DEFAULT_SETTINGS: PlayerSettings = { ... };

// Wire format for server sync
export interface SettingsPayload {
  settings: PlayerSettings;
}
```

Export from `packages/shared/src/index.ts`.

## Step 2: Client keybinding service — `packages/client/src/keybindings.ts` (NEW)

A singleton class that:
1. Loads overrides from localStorage on init.
2. Provides `getActionKey(action): KeyBind` (merged default + overrides).
3. Provides `setActionKey(action, key): void` with conflict detection (swaps keys if target is taken).
4. Provides `resetToDefaults(): void`.
5. Provides `getSettings(): PlayerSettings` / `updateSettings(patch): void`.
6. Persists to localStorage via backend.ts helpers.

```ts
class KeyBindingService {
  private overrides: Partial<KeyMap>;
  private settings: PlayerSettings;

  constructor() { /* load from localStorage */ }

  getActionKey(action: ActionId): KeyBind { ... }
  getDisplayKey(action: ActionId): string { ... }  // human-readable (e.g. "SPACE", "A")
  setActionKey(action: ActionId, key: KeyBind): void { ... }  // auto-swaps conflicting action
  getConflict(action: ActionId, key: KeyBind): ActionId | null { ... }
  resetKey(action: ActionId): void { ... }
  resetAllKeys(): void { ... }

  getSettings(): PlayerSettings { ... }
  updateSettings(patch: Partial<PlayerSettings>): void { ... }
  loadFromServer(settings: PlayerSettings): void { ... }  // on SETTINGS_SYNC
  syncToServer(): SettingsPayload { ... }
}

export const keybindings = new KeyBindingService();
```

## Step 3: Backend persistence — `packages/client/src/backend.ts`

Add localStorage helpers for settings (mirroring quickslot pattern):

```ts
export function getSettings(): PlayerSettings | null { ... }
export function setSettings(s: PlayerSettings): void { ... }
```

## Step 4: Server-side persistence

### 4a. Migration `005_settings.sql`
```sql
ALTER TABLE characters ADD COLUMN settings TEXT NOT NULL DEFAULT '{}';
```

### 4b. `packages/server/src/persistence/store.ts`
- Add `settings?: PlayerSettings` to `CharacterRecord`
- Add `"settings"` to `CHAR_COL`, `JSON_CHAR_KEYS`
- Add `getSettings(charId)` / `setSettings(charId, settings)` methods

### 4c. `packages/server/src/rooms/schema/Player.ts`
Add a server-only field (no `@type`, not synced):
```ts
settings: PlayerSettings = DEFAULT_SETTINGS;
```

### 4d. `packages/shared/src/net.ts`
Add to MessageType:
```ts
SETTINGS_SYNC: 98,
```
Add payload:
```ts
export interface SettingsPayload { settings: PlayerSettings; }
```

### 4e. `packages/server/src/rooms/MapRoom.ts`
- On join: load `character.settings` into `player.settings`, send `SETTINGS_SYNC` to client
- Handle `SETTINGS_SYNC` from client: validate, persist to DB, update player

## Step 5: SettingsUI scene — `packages/client/src/scenes/SettingsUI.ts` (NEW)

A full-screen overlay scene with depth 10000. Registers as `"settings"` in main.ts.

**Layout:**
- Full semi-transparent backdrop (click to close)
- Centered panel: 480×500px
- Header: "⚙ Settings" + close (Esc) button
- Tab bar: Controls | Video | Audio | Gameplay
- Tab content area (scrollable if needed)
- Footer: "Reset to Defaults" button + "Apply" confirmation

**Controls Tab:**
- Grid: Action name (left) | Current key button (right)
- Click key button → enters "listening" state (button shows "..." + turns blue)
- Next keypress assigns the key (with conflict auto-swap)
- Reset button per key
- "Reset All" at the bottom

**Video Tab:**
- Fullscreen toggle (checkbox/switch)
- UI Scale: dropdown/buttons (80% / 100% / 120% / 150%)
- FPS Cap: dropdown (30 / 60 / 120 / Unlimited)
- Damage Numbers: toggle

**Audio Tab:**
- Master Volume: slider (0-100%)
- BGM Volume: slider
- SFX Volume: slider
- Mute: toggle
(Delegates to AudioManager for actual volume control)

**Gameplay Tab:**
- NPC Prompts: toggle
- Minimap Names: toggle

**Esc to close** — registered in the scene. When open, `registry.set("settingsOpen", true)` so MapScene + UI suppress game input.

### Visual Style
Matches existing UI: dark rounded panels (`PALETTE.panelFill`), `ui-monospace` font, same color tokens.

## Step 6: Refactor MapScene.ts input

Replace hardcoded key references with keybinding service reads.

**Current pattern:**
```ts
this.attackKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE, true);
```

**New pattern — in `setupInput()`:**
```ts
import { keybindings } from "../keybindings";
import type { ActionId } from "@maple/shared";

// Store Phaser.Key refs keyed by action for dynamic rebinding
private actionKeys = new Map<ActionId, Phaser.Input.Keyboard.Key>();

private bindActionKey(action: ActionId): Phaser.Input.Keyboard.Key {
  const code = Phaser.Input.Keyboard.KeyCodes[keybindings.getActionKey(action)] 
    ?? Phaser.Input.Keyboard.KeyCodes.SPACE;
  const key = this.input.keyboard!.addKey(code, true);
  this.actionKeys.set(action, key);
  return key;
}

private rebindAction(action: ActionId): void {
  // Remove old key, create new one
  const old = this.actionKeys.get(action);
  if (old) old.destroy();
  this.bindActionKey(action);
}
```

In `update()`:
```ts
const left = !suppressed && (
  this.cursors.left.isDown || 
  this.wasd.left.isDown || 
  (this.actionKeys.get("moveLeft")?.isDown ?? false)
);
```

Also replace the `keyboard.on("keydown-M")`, `keyboard.on("keydown-P")`, `keyboard.on("keydown-ENTER")` handlers to read from `keybindings.getActionKey("openMarket")` etc.

## Step 7: Refactor UI.ts key handlers

Replace all `this.input.keyboard?.on("keydown-I", ...)` etc. with a helper that reads from keybindings:

```ts
private bindToggleKey(action: ActionId, onToggle: () => void): void {
  const kb = this.input.keyboard;
  if (!kb) return;
  // Listen for raw keydown and match against the action's bound key
  kb.on("keydown", (event: KeyboardEvent) => {
    const bound = keybindings.getActionKey(action);
    if (event.code === `Key${bound}` || event.key.toUpperCase() === bound.toUpperCase()) {
      onToggle();
    }
  });
}
```

For quickslots, replace the hardcoded ONE/TWO/... with action-based lookups:
```ts
for (let i = 0; i < 10; i++) {
  this.bindToggleKey(`quickslot${i + 1}` as ActionId, () => this.executeQuickslot(i));
}
```

## Step 8: Wire Esc toggle

All Esc handlers live in **UI.ts** (not MapScene). Add to `UI.ts create()`:

```ts
// Settings overlay toggle — Esc opens/closes settings, closes all other panels
this.input.keyboard?.on("keydown-ESC", () => {
  if (this.chatFocused) return;
  const isOpen = this.registry.get("settingsOpen") === true;
  if (isOpen) {
    this.scene.stop("settings");
    this.registry.set("settingsOpen", false);
  } else {
    // Close all open panels first so they don't fight with settings
    this.closeAllPanels();
    this.scene.launch("settings");
    this.registry.set("settingsOpen", true);
  }
});
```

Add `private closeAllPanels(): void` that hides inventory, quest log, stat, skill tree, cube, upgrade, party, friends, guild, world map panels.

In MapScene `update()`, check `registry.get("settingsOpen")` alongside `chatFocused` / `dialogOpen` to suppress game input.

In every existing UI panel toggle (I, Q, S, K, W, C, U, G, O, F), add early return when `settingsOpen` is true:
```ts
if (this.chatFocused || this.registry.get("settingsOpen") === true) return;
```

## Step 9: Register scene + build verification

- Import `SettingsScene` in `packages/client/src/main.ts` and add to scene array
- Run `pnpm --filter @maple/client build` to verify strict TS compilation

## Key Design Decisions

1. **localStorage as fast cache + server as authority**: Settings load instantly from localStorage on page load; on room join, server sends authoritative copy and overwrites local. Changes save to both immediately for responsiveness.

2. **Conflict auto-swap**: When rebinding A→B and B is already bound to action C, C gets A (the old key). Classic MapleStory UX — no dead keys.

3. **Esc stays hardcoded**: Esc to open/close settings stays as a Phaser hardcoded listener because it's a system key that must work regardless of keymap state (and it can't be rebound in MapleStory). `toggleSettings` action ID exists but is only for display/documentation, not actually rebound.

4. **SettingsOpen flag**: A registry boolean (`"settingsOpen"`) gates game input in both MapScene and UI, same pattern as `"chatFocused"` and `"dialogOpen"`.

5. **Audio tab syncs with AudioManager**: SettingsUI reads/writes AudioManager volume levels directly via `getAudioManager()`. Audio settings in PlayerSettings are the source of truth; AudioManager applies them.

## Risks

- **Key capture during rebinding**: While listening for a new key in settings, we must suppress all other keyboard handlers. The `settingsOpen` registry flag handles this.
- **Phaser key recreation**: Phaser `addKey()` returns a sticky reference. On rebind, we must `destroy()` the old key and create a new one, then update the MapScene/UI references.
- **Migration safety**: The `settings` column uses `DEFAULT '{}'` so existing rows get a safe default without data loss.

## Steps

1. Create `packages/shared/src/keybindings.ts` — ActionId, KeyMap, DefaultKeyMap, PlayerSettings, DEFAULT_SETTINGS, SettingsPayload types. Export from index.ts.
2. Add `SETTINGS_SYNC: 98` to MessageType and `SettingsPayload` to `packages/shared/src/net.ts`.
3. Create `packages/client/src/keybindings.ts` — KeyBindingService singleton with localStorage persistence.
4. Add `getSettings()`/`setSettings()` helpers to `packages/client/src/backend.ts`.
5. Create SQL migration `packages/server/src/persistence/migrations/005_settings.sql`.
6. Add `settings` field to CharacterRecord, CHAR_COL, JSON_CHAR_KEYS, and get/set methods in `packages/server/src/persistence/store.ts`.
7. Add server-only `settings` field to `packages/server/src/rooms/schema/Player.ts`.
8. Add SETTINGS_SYNC handler in `packages/server/src/rooms/MapRoom.ts` (load on join, handle from client).
9. Refactor `packages/client/src/scenes/MapScene.ts` — replace hardcoded key references with keybinding service reads. Add `settingsOpen` check to `update()`. Add Esc → settings toggle.
10. Refactor `packages/client/src/scenes/UI.ts` — replace all `keydown-X` handlers with action-based keybinding lookups. Add `settingsOpen` check where `chatFocused` is checked.
11. Create `packages/client/src/scenes/SettingsUI.ts` — full settings overlay with Controls/Video/Audio/Gameplay tabs.
12. Register SettingsUI in `packages/client/src/main.ts`.
13. Run `pnpm --filter @maple/client build` and fix any TS errors.
14. Run `pnpm --filter @maple/shared test` and `pnpm --filter @maple/server test` to verify no regressions.
