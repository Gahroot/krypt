/**
 * Centralized keybinding definitions shared by client and (optionally) server.
 *
 * Every rebindable game action gets an `ActionId`. The `DEFAULT_KEY_MAP` maps each
 * action to a Phaser KeyCodes string (e.g. "SPACE", "A", "I"). Player overrides
 * are stored as a `Partial<KeyMap>` — missing entries fall through to the default.
 *
 * `PlayerSettings` bundles controls + video + audio + gameplay preferences and is
 * the serialised payload persisted to the server and localStorage.
 */

// ─── Action identifiers ────────────────────────────────────────────────────────────────────────

/** Every rebindable game action. */
export type ActionId =
  // Movement
  | "moveLeft"
  | "moveRight"
  | "moveUp"
  | "moveDown"
  // Combat / interaction
  | "attack"
  | "jump"
  | "jumpAlt"
  | "interact"
  // Quickslots 1-10
  | "quickslot1"
  | "quickslot2"
  | "quickslot3"
  | "quickslot4"
  | "quickslot5"
  | "quickslot6"
  | "quickslot7"
  | "quickslot8"
  | "quickslot9"
  | "quickslot10"
  // UI panels
  | "openInventory"
  | "openSkills"
  | "openStats"
  | "openQuests"
  | "openMap"
  | "openChat"
  | "openMarket"
  | "openCashShop"
  | "openGuild"
  | "openParty"
  | "openFriends"
  | "openCube"
  | "openUpgrade"
  // Utility
  | "npcInteract"
  // Combat QoL
  | "lootAll"
  | "macro1"
  | "macro2"
  | "macro3"
  | "macro4"
  | "macro5";

/** Array of all action IDs in a stable display order. */
export const ALL_ACTION_IDS: readonly ActionId[] = [
  "moveLeft",
  "moveRight",
  "moveUp",
  "moveDown",
  "attack",
  "jump",
  "jumpAlt",
  "interact",
  "quickslot1",
  "quickslot2",
  "quickslot3",
  "quickslot4",
  "quickslot5",
  "quickslot6",
  "quickslot7",
  "quickslot8",
  "quickslot9",
  "quickslot10",
  "openInventory",
  "openSkills",
  "openStats",
  "openQuests",
  "openMap",
  "openChat",
  "openMarket",
  "openCashShop",
  "openGuild",
  "openParty",
  "openFriends",
  "openCube",
  "openUpgrade",
  "npcInteract",
  "lootAll",
  "macro1",
  "macro2",
  "macro3",
  "macro4",
  "macro5",
] as const;

/** Human-readable label for each action (shown in the controls grid). */
export const ACTION_LABELS: Record<ActionId, string> = {
  moveLeft: "Move Left",
  moveRight: "Move Right",
  moveUp: "Move Up / Climb",
  moveDown: "Move Down / Climb",
  attack: "Attack",
  jump: "Jump",
  jumpAlt: "Jump (Alt)",
  interact: "Interact / Portal",
  quickslot1: "Quick Slot 1",
  quickslot2: "Quick Slot 2",
  quickslot3: "Quick Slot 3",
  quickslot4: "Quick Slot 4",
  quickslot5: "Quick Slot 5",
  quickslot6: "Quick Slot 6",
  quickslot7: "Quick Slot 7",
  quickslot8: "Quick Slot 8",
  quickslot9: "Quick Slot 9",
  quickslot10: "Quick Slot 10",
  openInventory: "Inventory",
  openSkills: "Skills",
  openStats: "Stats / AP",
  openQuests: "Quests",
  openMap: "World Map",
  openChat: "Chat",
  openMarket: "Free Market",
  openCashShop: "Cash Shop",
  openGuild: "Guild",
  openParty: "Party",
  openFriends: "Friends",
  openCube: "Cube (Potential)",
  openUpgrade: "Forge (Upgrade)",
  npcInteract: "Talk to NPC",
  lootAll: "Loot All",
  macro1: "Macro 1",
  macro2: "Macro 2",
  macro3: "Macro 3",
  macro4: "Macro 4",
  macro5: "Macro 5",
};

// ─── Key map ────────────────────────────────────────────────────────────────────────────────────

/** Phaser KeyCodes strings. Keys match what `Phaser.Input.Keyboard.KeyCodes[KEY]` resolves. */
export type KeyBind = string;

/** Complete action → key mapping. */
export type KeyMap = Record<ActionId, KeyBind>;

/** Default bindings (classic MapleStory–inspired). */
export const DEFAULT_KEY_MAP: KeyMap = {
  // Movement — arrow keys are always wired; WASD duplicates via MapScene
  moveLeft: "LEFT",
  moveRight: "RIGHT",
  moveUp: "UP",
  moveDown: "DOWN",
  // Combat
  attack: "SPACE",
  jump: "ALT",
  jumpAlt: "C",
  interact: "ENTER",
  // Quickslots
  quickslot1: "ONE",
  quickslot2: "TWO",
  quickslot3: "THREE",
  quickslot4: "FOUR",
  quickslot5: "FIVE",
  quickslot6: "SIX",
  quickslot7: "SEVEN",
  quickslot8: "EIGHT",
  quickslot9: "NINE",
  quickslot10: "ZERO",
  // UI panels
  openInventory: "I",
  openSkills: "K",
  openStats: "S",
  openQuests: "Q",
  openMap: "W",
  openChat: "ENTER",
  openMarket: "M",
  openCashShop: "P",
  openGuild: "G",
  openParty: "O",
  openFriends: "F",
  openCube: "C",
  openUpgrade: "U",
  // Utility
  npcInteract: "ENTER",
  lootAll: "Z",
  macro1: "",
  macro2: "",
  macro3: "",
  macro4: "",
  macro5: "",
};

// ─── Player settings ───────────────────────────────────────────────────────────────────────────

/** Video settings. */
export interface VideoSettings {
  fullscreen: boolean;
  /** UI scale multiplier: 0.8 | 1.0 | 1.2 | 1.5. */
  uiScale: number;
  /** FPS cap: 30 | 60 | 120 | 0 (unlimited). */
  fpsCap: number;
  /** Show floating damage numbers above mobs/players. */
  showDamageNumbers: boolean;
  /** Camera shake on player hits / crits / boss slams. Disable for reduced motion. */
  screenShake: boolean;
}

/** Audio settings (mirrors AudioManager localStorage keys). */
export interface AudioSettings {
  masterVolume: number;
  bgmVolume: number;
  sfxVolume: number;
  muted: boolean;
}

/** Gameplay settings. */
export interface GameplaySettings {
  showNpcPrompts: boolean;
  showMinimapNames: boolean;
}

/** Full player settings bundle — serialised to server + localStorage. */
export interface PlayerSettings {
  /** Per-action key overrides. Missing keys fall through to DEFAULT_KEY_MAP. */
  keyMap: Partial<KeyMap>;
  video: VideoSettings;
  audio: AudioSettings;
  gameplay: GameplaySettings;
}

/** Safe defaults used when no saved settings exist. */
export const DEFAULT_SETTINGS: PlayerSettings = {
  keyMap: {},
  video: {
    fullscreen: false,
    uiScale: 1.0,
    fpsCap: 60,
    showDamageNumbers: true,
    screenShake: true,
  },
  audio: {
    masterVolume: 1.0,
    bgmVolume: 0.7,
    sfxVolume: 1.0,
    muted: false,
  },
  gameplay: {
    showNpcPrompts: true,
    showMinimapNames: true,
  },
};

// ─── Wire payload ──────────────────────────────────────────────────────────────────────────────

/** Client → server and server → client settings sync payload. */
export interface SettingsPayload {
  settings: PlayerSettings;
}
