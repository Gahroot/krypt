/**
 * Backend connection config. The Colyseus server URL comes from VITE_BACKEND_URL (see .env.example),
 * defaulting to localhost for dev.
 */
export const BACKEND_URL: string = import.meta.env.VITE_BACKEND_URL ?? "ws://localhost:2567";

/**
 * A stable per-browser account id so your Mesos + items persist across reloads and are shared
 * between the town and the market. Phase 2 replaces this with a real wallet address.
 */
export function getAccountId(): string {
  const KEY = "cryptomaple.accountId";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = `web_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, id);
  }
  return id;
}

/** A display name, editable later via UI. */
export function getPlayerName(): string {
  return localStorage.getItem("cryptomaple.name") ?? "Adventurer";
}

/** Persisted character id, set after CREATE_CHARACTER succeeds. */
export function getCharId(): string | null {
  return localStorage.getItem("cryptomaple.charId");
}

export function setCharId(id: string): void {
  localStorage.setItem("cryptomaple.charId", id);
}

/** Persisted channel index, set after CHANNEL_SWITCH succeeds. Default 0. */
export function getCurrentChannel(): number {
  const raw = localStorage.getItem("cryptomaple.channel");
  const n = raw !== null ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function setCurrentChannel(ch: number): void {
  localStorage.setItem("cryptomaple.channel", String(ch));
}

/** A single quickslot entry — what's assigned to a slot. */
export interface QuickSlotEntry {
  type: "skill" | "consumable";
  id: string;
}

/** Read the quickslot layout for a character from localStorage. */
export function getQuickslots(charId: string): (QuickSlotEntry | null)[] {
  try {
    const raw = localStorage.getItem(`cryptomaple.quickslots.${charId}`);
    if (!raw) return [];
    return JSON.parse(raw) as (QuickSlotEntry | null)[];
  } catch {
    return [];
  }
}

/** Persist the quickslot layout for a character to localStorage. */
export function setQuickslots(charId: string, slots: (QuickSlotEntry | null)[]): void {
  localStorage.setItem(`cryptomaple.quickslots.${charId}`, JSON.stringify(slots));
}

// ─── Player settings (controls + video + audio + gameplay) ─────────────────────────────

import type { PlayerSettings } from "@maple/shared";

const SETTINGS_KEY = "cryptomaple.settings";

/** Read player settings from localStorage. Returns null if none saved. */
export function getSettings(): PlayerSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PlayerSettings;
  } catch {
    return null;
  }
}

/** Persist player settings to localStorage. */
export function setSettings(settings: PlayerSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ─── Auto-Pot config ─────────────────────────────────────────────────────

export interface AutoPotConfig {
  hpEnabled: boolean;
  hpThreshold: number;
  mpEnabled: boolean;
  mpThreshold: number;
  hpPotionId: string;
  mpPotionId: string;
}

const DEFAULT_AUTO_POT: AutoPotConfig = {
  hpEnabled: false,
  hpThreshold: 50,
  mpEnabled: false,
  mpThreshold: 50,
  hpPotionId: "pot.large_hp",
  mpPotionId: "pot.large_mp",
};

export function getAutoPot(charId: string): AutoPotConfig {
  try {
    const raw = localStorage.getItem(`cryptomaple.autoPot.${charId}`);
    if (!raw) return DEFAULT_AUTO_POT;
    return { ...DEFAULT_AUTO_POT, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_AUTO_POT;
  }
}

export function setAutoPot(charId: string, config: AutoPotConfig): void {
  localStorage.setItem(`cryptomaple.autoPot.${charId}`, JSON.stringify(config));
}

// ─── Skill Macros ────────────────────────────────────────────────────────

export interface MacroStep {
  type: "skill" | "consumable";
  id: string;
}

export interface SkillMacro {
  id: string;
  name: string;
  steps: MacroStep[];
}

export function getMacros(charId: string): SkillMacro[] {
  try {
    const raw = localStorage.getItem(`cryptomaple.macros.${charId}`);
    if (!raw) return [];
    return JSON.parse(raw) as SkillMacro[];
  } catch {
    return [];
  }
}

export function setMacros(charId: string, macros: SkillMacro[]): void {
  localStorage.setItem(`cryptomaple.macros.${charId}`, JSON.stringify(macros));
}

// ─── Coach marks (onboarding overlays — seen once per character) ───────────────

/** IDs of coach marks the player has already seen. */
export type CoachMarkId = "move" | "attack" | "jump" | "inventory" | "talk";

/** Read the set of coach mark IDs already dismissed for this character. */
export function getSeenCoachMarks(charId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`cryptomaple.coachmarks.${charId}`);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

/** Mark a single coach mark as seen for this character. */
export function markCoachMarkSeen(charId: string, id: CoachMarkId): void {
  const seen = getSeenCoachMarks(charId);
  seen.add(id);
  localStorage.setItem(`cryptomaple.coachmarks.${charId}`, JSON.stringify([...seen]));
}

// ─── Intro cinematic (seen once per character) ────────────────────────────────

/** Has this character already seen the Dawn Isle intro cinematic? */
export function hasSeenIntro(charId: string): boolean {
  return localStorage.getItem(`cryptomaple.intro.${charId}`) === "1";
}

/** Persist that this character has seen the intro. */
export function markIntroSeen(charId: string): void {
  localStorage.setItem(`cryptomaple.intro.${charId}`, "1");
}
