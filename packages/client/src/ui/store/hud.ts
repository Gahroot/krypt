import type { StateCreator } from "zustand";

import type { UIState } from "./index";

/**
 * HUD slice — bridge state for the always-on React HUD (StatusBars / SkillBar /
 * Minimap / QuestTracker).
 *
 * Follows the reference inventory slice: the Phaser `UIScene` pushes plain,
 * serializable *snapshots* in (`UIScene.publishHud*`) and registers an imperative
 * action registry (`registerHudActions`) the scene wires to authoritative
 * `room.send(...)` messages. React reads the snapshot and calls the actions — it
 * never touches Phaser/Colyseus.
 *
 * Snapshots are split into granular `setHud(patch)` merges so the high-frequency
 * pieces (skills/cooldowns, minimap dots) can be republished independently of the
 * slower vitals/quest pushes without clobbering each other.
 */

/** One quickslot in the skill bar, resolved to plain display data by Phaser. */
export interface HudSkillSlot {
  /** 0-based slot index (drives the `useSkill` action). */
  index: number;
  /** Key-binding hint shown in the corner (e.g. "1".."0"). */
  key: string;
  /** What's assigned, or null for an empty slot. */
  kind: "skill" | "consumable" | null;
  /** Skill ID (e.g. "warrior.rally") or item defId (e.g. "con.hp_potion_s"). */
  id: string;
  /** Skill kind for icon shape — only meaningful when kind === "skill". */
  skillKind?: "active" | "buff" | "passive";
  /** Short label rendered in the slot (kept for text fallback). */
  label: string;
  /** Full name shown in the hover tooltip. */
  fullName: string;
  /** False = greyed out (not enough MP, no stock, or not learned). */
  usable: boolean;
  /** Consumable stack count (omitted for skills / count ≤ 1). */
  count?: number;
  /** Wall-clock epoch (ms) the cooldown ends, or 0 when off cooldown. */
  cooldownEndAt: number;
  /** Total cooldown duration (ms) — drives the radial sweep denominator. */
  cooldownTotalMs: number;
}

/** A single objective line on a tracked quest. */
export interface HudQuestObjective {
  description: string;
  current: number;
  target: number;
  done: boolean;
}

/** One quest shown in the always-on quest tracker. */
export interface HudQuest {
  questId: string;
  name: string;
  /** All objectives met — prompts a "return to turn in" hint. */
  complete: boolean;
  objectives: HudQuestObjective[];
}

/** Active bonus-hunting banner data, or null when inactive. */
export interface HudBonusHunt {
  expMultiplier: number;
  dropMultiplier: number;
}

/** Static map geometry + live dots for the minimap, all in map-space units. */
export interface HudMinimap {
  mapName: string;
  playerCount: number;
  width: number;
  height: number;
  footholds: { x1: number; y1: number; x2: number; y2: number }[];
  ladders: { x: number; yTop: number; yBottom: number }[];
  portals: { x: number; y: number }[];
  npcs: { x: number; y: number; quest?: "available" | "active" | "turnin" | "guide" }[];
  /** Live entity dots (players + mobs), refreshed on a throttle. */
  dots: { x: number; y: number; kind: "self" | "player" | "mob" }[];
}

/** Per-element HUD visibility toggles. All default to true. */
export interface HudToggles {
  statusBars: boolean;
  minimap: boolean;
  skillBar: boolean;
  questTracker: boolean;
  chatBox: boolean;
}

/** Everything the always-on HUD needs. Pushed in granular patches from Phaser. */
export interface HudSnapshot {
  /** Master gate — false until the local player is bound. */
  visible: boolean;
  name: string;
  level: number;
  /** Player class / archetype (e.g. "WARRIOR", "MAGE", "ARCHER"). */
  archetype: string;
  /** Local player's mesos (currency) count. */
  mesos: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  /** EXP progress to next level, 0..1. */
  expRatio: number;
  /** Pre-formatted EXP percent (e.g. "12.3"). */
  expPct: string;
  skills: HudSkillSlot[];
  quests: HudQuest[];
  bonusHunt: HudBonusHunt | null;
  minimap: HudMinimap | null;
  /** Current equipped ammo info (null when no ammo-using weapon equipped). */
  ammo: {
    category: string;
    name: string;
    count: number;
    atkBonus: number;
  } | null;
  /** Per-element visibility toggles. */
  hudToggles: HudToggles;
  /** True while the local player is dead (shows DeathOverlay). */
  dead: boolean;
  /** Ms remaining until auto-respawn (countdown shown in DeathOverlay). */
  respawnCountdownMs: number;
}

/** Imperative HUD actions the scene wires so React can drive the game. */
export interface HudActions {
  /** Trigger the quickslot at `index` (sends SKILL_CAST / USE_CONSUMABLE). */
  useSkill(index: number): void;
}

const EMPTY_HUD: HudSnapshot = {
  visible: false,
  name: "Adventurer",
  level: 1,
  archetype: "BEGINNER",
  mesos: 0,
  hp: 0,
  maxHp: 0,
  mp: 0,
  maxMp: 0,
  expRatio: 0,
  expPct: "0.0",
  skills: [],
  quests: [],
  bonusHunt: null,
  minimap: null,
  ammo: null,
  hudToggles: {
    statusBars: true,
    minimap: true,
    skillBar: true,
    questTracker: true,
    chatBox: true,
  },
  dead: false,
  respawnCountdownMs: 0,
};

export interface HudSlice {
  hud: HudSnapshot;
  hudActions: HudActions | null;

  /** Merge a partial snapshot (preserves untouched fields). */
  setHud: (patch: Partial<HudSnapshot>) => void;
  setHudActions: (actions: HudActions | null) => void;
  /** Toggle a single HUD element's visibility. */
  toggleHudElement: (key: keyof HudToggles) => void;
}

export const createHudSlice: StateCreator<UIState, [], [], HudSlice> = (set) => ({
  hud: EMPTY_HUD,
  hudActions: null,

  setHud: (patch) => set((s) => ({ hud: { ...s.hud, ...patch } })),
  setHudActions: (actions) => set({ hudActions: actions }),
  toggleHudElement: (key) =>
    set((s) => ({
      hud: {
        ...s.hud,
        hudToggles: { ...s.hud.hudToggles, [key]: !s.hud.hudToggles[key] },
      },
    })),
});
