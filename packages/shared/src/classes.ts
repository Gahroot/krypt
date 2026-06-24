/**
 * Classes — the job-advancement system, reskinned from MapleStory.
 *
 * Mechanic we clone: a base archetype advances through job tiers (1st → 2nd → 3rd → 4th) at level
 * gates, each unlocking new skills bought with SP (see stats.ts). All names/art here are original
 * reskins. Each archetype "lives" in a themed Heartland town (see WORLD.md).
 *
 * MVP: WARRIOR is fully specced (1st + 2nd tier skills). The other four are stubs with their
 * primary stat, home town, and tier gates wired so the UI + server can already reference them.
 */

import type { PrimaryStat } from "./stats.js";

export enum ClassArchetype {
  WARRIOR = "WARRIOR",
  MAGE = "MAGE",
  ARCHER = "ARCHER",
  THIEF = "THIEF",
  PIRATE = "PIRATE",
}

export interface SkillDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Max level the skill can be raised to with SP. */
  readonly maxLevel: number;
  /** Which job tier (1–4) unlocks this skill. */
  readonly jobTier: 1 | 2 | 3 | 4;
  /** Character level required before any SP can be put in. */
  readonly levelReq: number;
  readonly kind: "passive" | "active" | "buff";
}

export interface JobTier {
  readonly tier: 1 | 2 | 3 | 4;
  /** Reskinned advancement title, e.g. WARRIOR tier 1 = "Squire". */
  readonly title: string;
  /** Character level required to take this advancement. */
  readonly levelReq: number;
  readonly skills: readonly SkillDef[];
}

export interface ClassDef {
  readonly archetype: ClassArchetype;
  readonly name: string;
  readonly primaryStat: PrimaryStat;
  /** Home town id from WORLD.md where this class advances. */
  readonly hometown: string;
  /** HP gained per level-up (warriors are tanky). */
  readonly hpGrowth: number;
  /** MP gained per level-up. */
  readonly mpGrowth: number;
  readonly jobTiers: readonly JobTier[];
}

const WARRIOR: ClassDef = {
  archetype: ClassArchetype.WARRIOR,
  name: "Warrior",
  primaryStat: "STR",
  hometown: "craghold",
  hpGrowth: 22,
  mpGrowth: 3,
  jobTiers: [
    {
      tier: 1,
      title: "Squire",
      levelReq: 10,
      skills: [
        {
          id: "warrior.crushing_blow",
          name: "Crushing Blow",
          description: "A heavy single-target strike. Core early damage skill.",
          maxLevel: 20,
          jobTier: 1,
          levelReq: 10,
          kind: "active",
        },
        {
          id: "warrior.iron_hide",
          name: "Iron Hide",
          description: "Passive: increases max HP and defense.",
          maxLevel: 10,
          jobTier: 1,
          levelReq: 12,
          kind: "passive",
        },
        {
          id: "warrior.rally",
          name: "Rally",
          description: "Buff: temporarily raises attack power for you and nearby allies.",
          maxLevel: 10,
          jobTier: 1,
          levelReq: 15,
          kind: "buff",
        },
      ],
    },
    {
      tier: 2,
      title: "Vanguard",
      levelReq: 30,
      skills: [
        {
          id: "warrior.cleave",
          name: "Cleave",
          description: "A sweeping strike hitting multiple enemies in front of you.",
          maxLevel: 20,
          jobTier: 2,
          levelReq: 30,
          kind: "active",
        },
        {
          id: "warrior.bulwark",
          name: "Bulwark",
          description: "Passive: chance to block incoming attacks with a shield.",
          maxLevel: 15,
          jobTier: 2,
          levelReq: 35,
          kind: "passive",
        },
      ],
    },
  ],
};

/** Stub builder for the not-yet-specced archetypes. Tier gates + titles only. */
function stubClass(
  archetype: ClassArchetype,
  name: string,
  primaryStat: PrimaryStat,
  hometown: string,
  hpGrowth: number,
  mpGrowth: number,
  titles: [string, string, string, string],
): ClassDef {
  const gates: Array<{ tier: 1 | 2 | 3 | 4; levelReq: number }> = [
    { tier: 1, levelReq: 10 },
    { tier: 2, levelReq: 30 },
    { tier: 3, levelReq: 60 },
    { tier: 4, levelReq: 100 },
  ];
  return {
    archetype,
    name,
    primaryStat,
    hometown,
    hpGrowth,
    mpGrowth,
    jobTiers: gates.map((g, i) => ({
      tier: g.tier,
      title: titles[i],
      levelReq: g.levelReq,
      skills: [],
    })),
  };
}

const MAGE = stubClass(ClassArchetype.MAGE, "Mage", "INT", "sylvanreach", 6, 18, [
  "Adept",
  "Sage",
  "Archmage",
  "Luminary",
]);
const ARCHER = stubClass(ClassArchetype.ARCHER, "Archer", "DEX", "meadowfield", 12, 8, [
  "Scout",
  "Ranger",
  "Marksman",
  "Pathfinder",
]);
const THIEF = stubClass(ClassArchetype.THIEF, "Thief", "LUK", "dusk-ward", 11, 9, [
  "Cutpurse",
  "Rogue",
  "Shadow",
  "Nightlord",
]);
const PIRATE = stubClass(ClassArchetype.PIRATE, "Pirate", "STR", "tidewatch-harbor", 16, 7, [
  "Deckhand",
  "Buccaneer",
  "Corsair",
  "Dreadnought",
]);

export const CLASSES: Record<ClassArchetype, ClassDef> = {
  [ClassArchetype.WARRIOR]: WARRIOR,
  [ClassArchetype.MAGE]: MAGE,
  [ClassArchetype.ARCHER]: ARCHER,
  [ClassArchetype.THIEF]: THIEF,
  [ClassArchetype.PIRATE]: PIRATE,
};

export function getClass(archetype: ClassArchetype): ClassDef {
  return CLASSES[archetype];
}

/** Max HP at a given level for a class (base + per-level growth). */
export function maxHpForLevel(archetype: ClassArchetype, level: number): number {
  return 50 + (level - 1) * CLASSES[archetype].hpGrowth;
}

/** Max MP at a given level for a class. */
export function maxMpForLevel(archetype: ClassArchetype, level: number): number {
  return 5 + (level - 1) * CLASSES[archetype].mpGrowth;
}

/** The highest job tier a character of `level` is allowed to have advanced to (0 = none yet). */
export function unlockedJobTier(archetype: ClassArchetype, level: number): number {
  let unlocked = 0;
  for (const t of CLASSES[archetype].jobTiers) {
    if (level >= t.levelReq) unlocked = t.tier;
  }
  return unlocked;
}
