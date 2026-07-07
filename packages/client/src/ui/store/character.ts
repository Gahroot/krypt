import type { StateCreator } from "zustand";
import type { CharacterAppearance, PrimaryStat, SecondaryStats } from "@maple/shared";

import type { UIState } from "./index";
import type { InvItemSnapshot } from "./inventory";

/**
 * Character slice — bridge state for the React character-progression overlays
 * (StatsPanel / SkillTreePanel / EquipmentPanel).
 *
 * Follows the reference inventory slice: the Phaser `UIScene` pushes plain,
 * serializable snapshots in (`UIScene.publishCharacter / publishEquipment /
 * setSkillBook`) and registers an imperative action registry
 * (`registerCharacterActions`) the scene wires to the authoritative SPEND_AP /
 * LEARN_SKILL / EQUIP / UNEQUIP / TITLE_EQUIP `room.send(...)` messages. React
 * reads the snapshot and calls the actions — it never touches Phaser/Colyseus.
 */

/** Allocatable + auto-derived stat keys for AP spending. */
export type StatKey = "STR" | "DEX" | "INT" | "LUK" | "HP" | "MP";

/** Equipment bonus aggregated across worn gear (drives derived-stat math). */
export interface EquipBonus {
  // Primary stat bonuses from gear (rank-multiplied + potentials + flames)
  str: number;
  dex: number;
  int: number;
  luk: number;
  hp: number;
  mp: number;
  // Secondary stat bonuses from gear (weapon ATK + armor DEF/speed/jump)
  atk: number;
  wDef: number;
  mDef: number;
  speed: number;
  jump: number;
}

/** Plain snapshot of the local player's progression for the stat panel. */
export interface CharacterSnapshot {
  name: string;
  level: number;
  archetype: string;
  /** Branch specialization id (e.g. "berserker"), empty string before 2nd-job. */
  branchId: string;
  jobTitle: string;
  /** The class primary stat (e.g. STR for Warrior). */
  primaryStat: PrimaryStat;
  str: number;
  dex: number;
  intel: number;
  luk: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  exp: number;
  expNeed: number;
  ap: number;
  fame: number;
  equippedTitle: string;
  ownedTitles: string[];
  /** Aggregated equipment bonus — combined with stats to derive secondary stats. */
  equipBonus: EquipBonus;
  /** Set bonus contribution (primary + secondary stats). */
  setBonus: {
    STR: number;
    DEX: number;
    INT: number;
    LUK: number;
    HP: number;
    MP: number;
    atk: number;
    mAtk: number;
    wDef: number;
    mDef: number;
    speed: number;
    jump: number;
    accuracy: number;
    avoid: number;
    critRate: number;
  };
  /** Passive skill contribution to secondary stats. */
  passiveBonus: SecondaryStats;
  /** Active buff contribution to secondary stats. */
  buffBonus: SecondaryStats;
  /** Final derived secondary stats (matches server combat math). */
  derived: SecondaryStats;
  /** Look used by the equipment paper-doll preview. */
  appearance: CharacterAppearance;
}

/** One paper-doll slot: the slot id and the worn item (or null when empty). */
export interface EquipSlotSnapshot {
  slot: string;
  item: InvItemSnapshot | null;
}

/** Imperative actions the scene wires so React can drive progression. */
export interface CharacterActions {
  /** Spend one AP into a stat (STR/DEX/INT/LUK/HP/MP). */
  spendAp(stat: StatKey): void;
  /** Dump all remaining AP into the class primary stat. */
  autoAssignAp(): void;
  /** Equip (or, with "", unequip) a title. */
  equipTitle(title: string): void;
  /** Learn / level up a skill by id. */
  learnSkill(skillId: string): void;
  /** Unequip the gear in a paper-doll slot. */
  unequip(slot: string): void;
  /** Close the stat panel. */
  closeStatPanel(): void;
  /** Close the skill-tree panel. */
  closeSkillTree(): void;
  /** Close the equipment panel. */
  closeEquipment(): void;
}

export interface CharacterSlice {
  statPanelOpen: boolean;
  skillTreeOpen: boolean;
  equipmentOpen: boolean;
  character: CharacterSnapshot | null;
  /** Learned skill levels keyed by skill id (server source of truth). */
  skillBook: Record<string, number>;
  equipment: EquipSlotSnapshot[];
  characterActions: CharacterActions | null;

  setStatPanelOpen: (open: boolean) => void;
  setSkillTreeOpen: (open: boolean) => void;
  setEquipmentOpen: (open: boolean) => void;
  setCharacter: (snapshot: CharacterSnapshot | null) => void;
  setSkillBook: (book: Record<string, number>) => void;
  setEquipment: (slots: EquipSlotSnapshot[]) => void;
  setCharacterActions: (actions: CharacterActions | null) => void;
}

export const createCharacterSlice: StateCreator<UIState, [], [], CharacterSlice> = (set) => ({
  statPanelOpen: false,
  skillTreeOpen: false,
  equipmentOpen: false,
  character: null,
  skillBook: {},
  equipment: [],
  characterActions: null,

  setStatPanelOpen: (open) => set({ statPanelOpen: open }),
  setSkillTreeOpen: (open) => set({ skillTreeOpen: open }),
  setEquipmentOpen: (open) => set({ equipmentOpen: open }),
  setCharacter: (snapshot) => set({ character: snapshot }),
  setSkillBook: (book) => set({ skillBook: book }),
  setEquipment: (slots) => set({ equipment: slots }),
  setCharacterActions: (actions) => set({ characterActions: actions }),
});
