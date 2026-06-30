/**
 * KeyBindingService — single source of truth for all key bindings and player settings on the client.
 *
 * Merges a `Partial<KeyMap>` override (persisted in localStorage) on top of `DEFAULT_KEY_MAP`.
 * Provides conflict detection with auto-swap (classic Maple UX — no dead keys).
 *
 * The server holds the authoritative copy; localStorage is a fast cache that loads instantly
 * before the Colyseus connection is established.
 */

import {
  type ActionId,
  type KeyBind,
  type KeyMap,
  type PlayerSettings,
  type SettingsPayload,
  DEFAULT_KEY_MAP,
  DEFAULT_SETTINGS,
  ALL_ACTION_IDS,
} from "@maple/shared";
import { getSettings as loadLocal, setSettings as saveLocal } from "./backend";

// ─── Helpers ───────────────────────────────────────────────────────────────────────────────────

/** Human-readable display name for a Phaser KeyCodes string. */
function displayKey(code: KeyBind): string {
  const map: Record<string, string> = {
    SPACE: "Space",
    LEFT: "←",
    RIGHT: "→",
    UP: "↑",
    DOWN: "↓",
    ALT: "Alt",
    ENTER: "Enter",
    ONE: "1",
    TWO: "2",
    THREE: "3",
    FOUR: "4",
    FIVE: "5",
    SIX: "6",
    SEVEN: "7",
    EIGHT: "8",
    NINE: "9",
    ZERO: "0",
  };
  return map[code] ?? code.charAt(0) + code.slice(1).toLowerCase();
}

/**
 * Convert a browser `KeyboardEvent.code` to the Phaser KeyCodes name string used
 * by the keybinding service (e.g. "KeyA" → "A", "Digit1" → "ONE", "Space" → "SPACE").
 * Returns `null` for keys that have no game-binding equivalent.
 *
 * Centralised here so both the Phaser scene and the React settings overlay share
 * one capture→keybind mapping rather than duplicating it.
 */
export function keyBindFromEventCode(code: string): KeyBind | null {
  // Letters: KeyA → "A", KeyB → "B", etc.
  if (code.startsWith("Key") && code.length === 4) {
    return code.charAt(3);
  }
  // Digits: Digit0 → "ZERO", Digit1 → "ONE", etc.
  const digitMap: Record<string, string> = {
    Digit0: "ZERO",
    Digit1: "ONE",
    Digit2: "TWO",
    Digit3: "THREE",
    Digit4: "FOUR",
    Digit5: "FIVE",
    Digit6: "SIX",
    Digit7: "SEVEN",
    Digit8: "EIGHT",
    Digit9: "NINE",
  };
  if (digitMap[code]) return digitMap[code];
  // Special keys.
  const specialMap: Record<string, string> = {
    Space: "SPACE",
    ArrowLeft: "LEFT",
    ArrowRight: "RIGHT",
    ArrowUp: "UP",
    ArrowDown: "DOWN",
    Enter: "ENTER",
    Escape: "ESCAPE",
    AltLeft: "ALT",
    AltRight: "ALT",
    ControlLeft: "CTRL",
    ControlRight: "CTRL",
    ShiftLeft: "SHIFT",
    ShiftRight: "SHIFT",
    Tab: "TAB",
    Backspace: "BACKSPACE",
    Delete: "DELETE",
  };
  return specialMap[code] ?? null;
}

// ─── Service ───────────────────────────────────────────────────────────────────────────────────

class KeyBindingService {
  private overrides: Partial<KeyMap> = {};
  private settings: PlayerSettings = structuredClone(DEFAULT_SETTINGS);

  constructor() {
    const saved = loadLocal();
    if (saved) {
      // Merge over defaults so settings added after a player last saved (e.g.
      // `video.screenShake`) inherit their default instead of being `undefined`,
      // which would desync the settings toggles from the live behaviour.
      this.settings = {
        keyMap: saved.keyMap ?? {},
        video: { ...DEFAULT_SETTINGS.video, ...saved.video },
        audio: { ...DEFAULT_SETTINGS.audio, ...saved.audio },
        gameplay: { ...DEFAULT_SETTINGS.gameplay, ...saved.gameplay },
      };
      this.overrides = saved.keyMap ?? {};
    }
  }

  // ── Key binding lookups ──────────────────────────────────────────────────────────────

  /** Get the Phaser KeyCodes string for an action (overrides merge on default). */
  getActionKey(action: ActionId): KeyBind {
    return this.overrides[action] ?? DEFAULT_KEY_MAP[action];
  }

  /** Human-readable label for the current binding (e.g. "Space", "←"). */
  getDisplayKey(action: ActionId): string {
    return displayKey(this.getActionKey(action));
  }

  /** Find which action currently owns a given key, or null. */
  getActionForKey(key: KeyBind): ActionId | null {
    for (const action of ALL_ACTION_IDS) {
      if (this.getActionKey(action) === key) return action;
    }
    return null;
  }

  // ── Rebinding ────────────────────────────────────────────────────────────────────────

  /** Find the action that would conflict if `key` were assigned to `action`, or null. */
  getConflict(action: ActionId, key: KeyBind): ActionId | null {
    const current = this.getActionForKey(key);
    if (!current || current === action) return null;
    return current;
  }

  /**
   * Assign `key` to `action`. If another action owns `key`, swap keys (classic Maple UX).
   * Persists immediately.
   */
  setActionKey(action: ActionId, key: KeyBind): void {
    const conflict = this.getConflict(action, key);
    if (conflict) {
      // Swap: conflict gets the old key that `action` currently has.
      const oldKey = this.getActionKey(action);
      this.overrides[conflict] = oldKey;
    }
    this.overrides[action] = key;
    this.persist();
  }

  /** Reset a single action to its default binding. */
  resetKey(action: ActionId): void {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.overrides[action];
    this.persist();
  }

  /** Reset all key bindings to defaults. */
  resetAllKeys(): void {
    this.overrides = {};
    this.persist();
  }

  // ── Settings ─────────────────────────────────────────────────────────────────────────

  getSettings(): PlayerSettings {
    return this.settings;
  }

  /** Merge a partial patch into settings and persist. */
  updateSettings(patch: Partial<PlayerSettings>): void {
    if (patch.video) this.settings.video = { ...this.settings.video, ...patch.video };
    if (patch.audio) this.settings.audio = { ...this.settings.audio, ...patch.audio };
    if (patch.gameplay) this.settings.gameplay = { ...this.settings.gameplay, ...patch.gameplay };
    if (patch.keyMap) this.overrides = patch.keyMap;
    this.persist();
  }

  /** Apply settings received from the server (authoritative). */
  loadFromServer(payload: SettingsPayload): void {
    const s = payload.settings;
    // Merge over defaults so fields the server hasn't seen yet (e.g. a newly
    // added `video.screenShake`) keep their default rather than going undefined.
    this.settings = {
      keyMap: s.keyMap ?? {},
      video: { ...DEFAULT_SETTINGS.video, ...s.video },
      audio: { ...DEFAULT_SETTINGS.audio, ...s.audio },
      gameplay: { ...DEFAULT_SETTINGS.gameplay, ...s.gameplay },
    };
    this.overrides = s.keyMap ?? {};
    this.persist();
  }

  /** Build a payload suitable for sending to the server. */
  toPayload(): SettingsPayload {
    return { settings: { ...this.settings, keyMap: { ...this.overrides } } };
  }

  // ── Persistence ──────────────────────────────────────────────────────────────────────

  private persist(): void {
    this.settings.keyMap = { ...this.overrides };
    saveLocal(this.settings);
  }
}

export const keybindings = new KeyBindingService();
