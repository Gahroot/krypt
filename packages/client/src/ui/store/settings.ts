import type { StateCreator } from "zustand";
import type {
  ActionId,
  VideoSettings,
  AudioSettings,
  GameplaySettings,
  AutoPotConfig,
  SkillMacro,
} from "@maple/shared";

import type { UIState } from "./index";

/**
 * Settings slice — bridge state for the React settings overlay (SettingsPanel).
 *
 * Follows the reference inventory slice: a plain, serializable snapshot pushed
 * in from Phaser (`SettingsScene`), an `open` flag, and a per-feature action
 * registry the scene wires to the authoritative side (keybinding service +
 * AudioManager + Phaser scale/loop + `room.send` via UIScene). React reads the
 * snapshot and calls the actions — it never touches Phaser/Colyseus or
 * re-implements binding logic (that lives in `../../keybindings.ts`).
 */

/** Per-action display strings (e.g. "Space", "←") for every rebindable action. */
export type KeyDisplayMap = Record<ActionId, string>;

/** Boolean settings that the panel can flip via the generic `toggle` action. */
export type SettingsToggleKey =
  | "video.fullscreen"
  | "video.showDamageNumbers"
  | "video.screenShake"
  | "audio.muted"
  | "gameplay.showNpcPrompts"
  | "gameplay.showMinimapNames";

/** Everything the settings UI needs in one immutable push from Phaser. */
export interface SettingsSnapshot {
  video: VideoSettings;
  audio: AudioSettings;
  gameplay: GameplaySettings;
  /** Human-readable current binding for each action (from the keybinding service). */
  keyDisplays: KeyDisplayMap;
  autoPot: AutoPotConfig;
  macros: SkillMacro[];
  /** Local player's class archetype — used to list castable skills for macros. */
  archetype: string;
}

/** Imperative actions the scene wires so React can drive settings. */
export interface SettingsActions {
  /** Set an audio channel volume (0–1) and apply it live. */
  setVolume(channel: "master" | "bgm" | "sfx", value: number): void;
  /** Flip a boolean setting and apply any live side effect (fullscreen/mute). */
  toggle(key: SettingsToggleKey, value: boolean): void;
  /** Set a numeric video option (UI scale / FPS cap) and apply it live. */
  setVideoOption(key: "uiScale" | "fpsCap", value: number): void;
  /** Rebind an action to a Phaser KeyCodes name (handles swap + live rebind + persist). */
  rebind(action: ActionId, key: string): void;
  /** Reset a single action to its default binding. */
  resetKey(action: ActionId): void;
  /** Reset all key bindings to defaults. */
  resetDefaults(): void;
  /** Replace the auto-pot config. */
  setAutoPot(config: AutoPotConfig): void;
  /** Replace the skill-macro list. */
  setMacros(macros: SkillMacro[]): void;
  /** Close the settings overlay. */
  close(): void;
}

const EMPTY_SETTINGS: SettingsSnapshot = {
  video: { fullscreen: false, uiScale: 1, fpsCap: 60, showDamageNumbers: true, screenShake: true },
  audio: { masterVolume: 1, bgmVolume: 0.7, sfxVolume: 1, muted: false },
  gameplay: { showNpcPrompts: true, showMinimapNames: true },
  keyDisplays: {} as KeyDisplayMap,
  autoPot: {
    hpEnabled: false,
    hpThreshold: 50,
    mpEnabled: false,
    mpThreshold: 50,
    hpPotionId: "pot.large_hp",
    mpPotionId: "pot.large_mp",
  },
  macros: [],
  archetype: "WARRIOR",
};

export interface SettingsSlice {
  settingsOpen: boolean;
  settings: SettingsSnapshot;
  settingsActions: SettingsActions | null;

  setSettingsOpen: (open: boolean) => void;
  setSettings: (snapshot: SettingsSnapshot) => void;
  setSettingsActions: (actions: SettingsActions | null) => void;
}

export const createSettingsSlice: StateCreator<UIState, [], [], SettingsSlice> = (set) => ({
  settingsOpen: false,
  settings: EMPTY_SETTINGS,
  settingsActions: null,

  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSettings: (snapshot) => set({ settings: snapshot }),
  setSettingsActions: (actions) => set({ settingsActions: actions }),
});
