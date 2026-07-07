/**
 * Classes — the job-advancement system, reskinned from MapleStory.
 *
 * Mechanic we clone: a base archetype advances through job tiers (1st → 2nd → 3rd → 4th) at level
 * gates, each unlocking new skills bought with SP (see stats.ts). All names/art here are original
 * reskins. Each archetype "lives" in a themed Heartland town (see WORLD.md).
 *
 * WARRIOR, MAGE, ARCHER, THIEF, and PIRATE are fully specced: tier 1 (shared) + 2 second-job
 * branches each, with tiers 2–4 and ~4–6 skills mixing active/passive/buff.
 * BEGINNER is a stub with its primary stat, home town, and tier gates wired so
 * the UI + server can already reference it.
 */

import type { PrimaryStat } from "./stats.js";
import type { Element } from "./mobs.js";

export enum ClassArchetype {
  BEGINNER = "BEGINNER",
  WARRIOR = "WARRIOR",
  MAGE = "MAGE",
  ARCHER = "ARCHER",
  THIEF = "THIEF",
  PIRATE = "PIRATE",
}

export interface SkillPrerequisite {
  readonly skillId: string;
  /** Required learned level of the prerequisite skill. */
  readonly level: number;
}

/** A value that scales linearly: base + perLevel × (level − 1). */
export interface BasePerLevel {
  readonly base: number;
  readonly perLevel: number;
}

/** Buff effect — exactly one key is present. */
export type BuffEffect =
  | { readonly atkPercent: number }
  | { readonly defPercent: number }
  | { readonly speed: number }
  | { readonly jump: number }
  | { readonly hpMpRegen: number }
  | { readonly mpPercent: number };

/** Debuff effect applied to targets by an active attack skill. Exactly one key is present. */
export type DebuffEffect =
  | { readonly stunMs: number }
  | { readonly slowPercent: number; readonly slowMs: number }
  | { readonly poisonTickDamage: number; readonly poisonTickMs: number; readonly poisonMs: number };

/** Resolved combat stats at a specific learned level. */
export interface SkillCombatStats {
  readonly mpCost: number;
  readonly cooldownMs: number;
  readonly damagePercent: number;
  readonly hitCount: number;
  readonly targetCount: number;
  readonly buffDurationMs: number;
  readonly buffEffect?: BuffEffect;
  readonly debuffEffect?: DebuffEffect;
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
  /** Elemental damage type for active attack skills. Absent for non-attack skills. */
  readonly element?: Element;
  /** Optional skill prerequisites — other skills that must be learned to at least a given level. */
  readonly requires?: readonly SkillPrerequisite[];

  // ── Combat data (active / buff / passive) ───────────────────────
  /** MP cost to cast. Absent for passives. */
  readonly mpCost?: BasePerLevel;
  /** Cooldown in milliseconds. */
  readonly cooldownMs?: BasePerLevel;
  /** Damage as a percent of ATK per hit. */
  readonly damagePercent?: BasePerLevel;
  /** Number of hits per cast. */
  readonly hitCount?: BasePerLevel;
  /** Max number of mobs this skill can hit. */
  readonly targetCount?: BasePerLevel;
  /** Duration of buff in milliseconds (buff skills only). */
  readonly buffDurationMs?: BasePerLevel;
  /** Effect applied while the buff is active, or permanent for passives. */
  readonly buffEffect?: BuffEffect;
  /** Optional debuff applied to targets hit by this attack skill. */
  readonly debuffEffect?: DebuffEffect;
}

export interface JobTier {
  readonly tier: 1 | 2 | 3 | 4;
  /** Reskinned advancement title, e.g. WARRIOR tier 1 = "Squire". */
  readonly title: string;
  /** Character level required to take this advancement. */
  readonly levelReq: number;
  readonly skills: readonly SkillDef[];
}

/**
 * A second-job specialization branch. At tier 2+ the player picks one branch; tiers 3 and 4
 * follow from that choice. Each branch carries its own tier structure and skill pool.
 */
export interface JobBranch {
  /** Stable id used for persistence (e.g. "berserker"). */
  readonly id: string;
  /** Display name for UI. */
  readonly name: string;
  /** Flavour text shown during branch selection. */
  readonly description: string;
  /** Tier 2–4 job tiers belonging to this branch. */
  readonly jobTiers: readonly JobTier[];
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
  /** Shared job tiers (tier 1 for all archetypes). */
  readonly jobTiers: readonly JobTier[];
  /** Specialization branches starting at tier 2. Empty/absent for stubs. */
  readonly branches?: readonly JobBranch[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// WARRIOR — the fully-specced reference archetype (STR primary)
// ═══════════════════════════════════════════════════════════════════════════════

const WARRIOR: ClassDef = {
  archetype: ClassArchetype.WARRIOR,
  name: "Warrior",
  primaryStat: "STR",
  hometown: "craghold",
  hpGrowth: 22,
  mpGrowth: 3,

  // ── Tier 1 — shared across all branches ─────────────────────────
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
          mpCost: { base: 8, perLevel: 1 },
          cooldownMs: { base: 800, perLevel: 0 },
          damagePercent: { base: 150, perLevel: 5 },
          hitCount: { base: 1, perLevel: 0 },
          targetCount: { base: 1, perLevel: 0 },
        },
        {
          id: "warrior.iron_hide",
          name: "Iron Hide",
          description: "Passive: toughens the body, granting permanent damage reduction.",
          maxLevel: 10,
          jobTier: 1,
          levelReq: 12,
          kind: "passive",
          buffEffect: { defPercent: 10 },
        },
        {
          id: "warrior.rally",
          name: "Rally",
          description: "Buff: raises attack power for you and nearby allies.",
          maxLevel: 10,
          jobTier: 1,
          levelReq: 15,
          kind: "buff",
          requires: [{ skillId: "warrior.iron_hide", level: 1 }],
          mpCost: { base: 15, perLevel: 1 },
          cooldownMs: { base: 30000, perLevel: 0 },
          buffDurationMs: { base: 10000, perLevel: 500 },
          buffEffect: { atkPercent: 15 },
        },
        {
          id: "warrior.battle_cry",
          name: "Battle Cry",
          description: "A war shout that damages and staggers nearby foes.",
          maxLevel: 15,
          jobTier: 1,
          levelReq: 18,
          kind: "active",
          requires: [{ skillId: "warrior.crushing_blow", level: 3 }],
          mpCost: { base: 12, perLevel: 1 },
          cooldownMs: { base: 1200, perLevel: 0 },
          damagePercent: { base: 110, perLevel: 5 },
          hitCount: { base: 1, perLevel: 0 },
          targetCount: { base: 3, perLevel: 0 },
          debuffEffect: { stunMs: 1000 },
        },
      ],
    },
  ],

  // ── Branches — tier 2+ specializations ──────────────────────────
  branches: [
    // ─── Berserker (offense DPS) ──────────────────────────────────
    {
      id: "berserker",
      name: "Berserker",
      description:
        "A path of relentless offense. Berserkers trade defense for devastating damage, " +
        "exceling at single-target annihilation.",
      jobTiers: [
        {
          tier: 2,
          title: "Berserker",
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
              requires: [{ skillId: "warrior.crushing_blow", level: 1 }],
              mpCost: { base: 18, perLevel: 2 },
              cooldownMs: { base: 1200, perLevel: 0 },
              damagePercent: { base: 120, perLevel: 8 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 3, perLevel: 0 },
            },
            {
              id: "warrior.frenzy",
              name: "Frenzy",
              description:
                "Passive: the lower your HP, the harder you strike. ATK rises as health drops.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 30,
              kind: "passive",
              requires: [{ skillId: "warrior.iron_hide", level: 3 }],
              buffEffect: { atkPercent: 12 },
            },
          ],
        },
        {
          tier: 3,
          title: "Destroyer",
          levelReq: 60,
          skills: [
            {
              id: "warrior.decimate",
              name: "Decimate",
              description: "A devastating AoE sweep that rends all foes in a wide arc.",
              maxLevel: 20,
              jobTier: 3,
              levelReq: 60,
              kind: "active",
              requires: [{ skillId: "warrior.cleave", level: 5 }],
              mpCost: { base: 25, perLevel: 2 },
              cooldownMs: { base: 1500, perLevel: 0 },
              damagePercent: { base: 180, perLevel: 10 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 5, perLevel: 0 },
            },
            {
              id: "warrior.berserk",
              name: "Berserk",
              description:
                "Buff: enter a frenzied state, sacrificing defense for raw attack power.",
              maxLevel: 10,
              jobTier: 3,
              levelReq: 60,
              kind: "buff",
              requires: [{ skillId: "warrior.frenzy", level: 5 }],
              mpCost: { base: 30, perLevel: 2 },
              cooldownMs: { base: 45000, perLevel: 0 },
              buffDurationMs: { base: 12000, perLevel: 500 },
              buffEffect: { atkPercent: 25 },
            },
          ],
        },
        {
          tier: 4,
          title: "Doombringer",
          levelReq: 100,
          skills: [
            {
              id: "warrior.annihilate",
              name: "Annihilate",
              description:
                "A twin-strike of apocalyptic force. The signature technique of the Doombringer.",
              maxLevel: 20,
              jobTier: 4,
              levelReq: 100,
              kind: "active",
              requires: [{ skillId: "warrior.decimate", level: 5 }],
              mpCost: { base: 40, perLevel: 3 },
              cooldownMs: { base: 2000, perLevel: 0 },
              damagePercent: { base: 300, perLevel: 15 },
              hitCount: { base: 2, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
            },
          ],
        },
      ],
    },

    // ─── Guardian (tank / defense) ────────────────────────────────
    {
      id: "guardian",
      name: "Guardian",
      description:
        "A path of iron resolve. Guardians become immovable walls, shielding allies " +
        "and weathering the fiercest blows.",
      jobTiers: [
        {
          tier: 2,
          title: "Guardian",
          levelReq: 30,
          skills: [
            {
              id: "warrior.phalanx",
              name: "Phalanx",
              description: "A shield bash that stuns the target and reinforces your stance.",
              maxLevel: 20,
              jobTier: 2,
              levelReq: 30,
              kind: "active",
              requires: [{ skillId: "warrior.iron_hide", level: 1 }],
              mpCost: { base: 14, perLevel: 1 },
              cooldownMs: { base: 1000, perLevel: 0 },
              damagePercent: { base: 100, perLevel: 6 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 2, perLevel: 0 },
              debuffEffect: { stunMs: 1500 },
            },
            {
              id: "warrior.fortress",
              name: "Fortress",
              description:
                "Passive: hardens your body into living armor, greatly increasing defense.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 30,
              kind: "passive",
              requires: [{ skillId: "warrior.iron_hide", level: 1 }],
              buffEffect: { defPercent: 15 },
            },
            {
              id: "warrior.bulwark",
              name: "Bulwark",
              description: "Passive: chance to block incoming attacks with a shield.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 35,
              kind: "passive",
              buffEffect: { defPercent: 15 },
            },
          ],
        },
        {
          tier: 3,
          title: "Sentinel",
          levelReq: 60,
          skills: [
            {
              id: "warrior.holy_shield",
              name: "Holy Shield",
              description:
                "Buff: conjures a radiant barrier that reduces all incoming damage for allies.",
              maxLevel: 10,
              jobTier: 3,
              levelReq: 60,
              kind: "buff",
              requires: [{ skillId: "warrior.fortress", level: 5 }],
              mpCost: { base: 25, perLevel: 2 },
              cooldownMs: { base: 40000, perLevel: 0 },
              buffDurationMs: { base: 10000, perLevel: 500 },
              buffEffect: { defPercent: 20 },
            },
            {
              id: "warrior.retribution",
              name: "Retribution",
              description: "A counterstrike that punishes attackers in a frontal cone.",
              maxLevel: 20,
              jobTier: 3,
              levelReq: 60,
              kind: "active",
              requires: [{ skillId: "warrior.phalanx", level: 5 }],
              mpCost: { base: 20, perLevel: 2 },
              cooldownMs: { base: 1800, perLevel: 0 },
              damagePercent: { base: 140, perLevel: 8 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 3, perLevel: 0 },
            },
          ],
        },
        {
          tier: 4,
          title: "Aegis",
          levelReq: 100,
          skills: [
            {
              id: "warrior.aegis",
              name: "Aegis",
              description:
                "Buff: an ultimate shield that grants near-invulnerability for a brief window.",
              maxLevel: 10,
              jobTier: 4,
              levelReq: 100,
              kind: "buff",
              requires: [{ skillId: "warrior.holy_shield", level: 5 }],
              mpCost: { base: 35, perLevel: 3 },
              cooldownMs: { base: 60000, perLevel: 0 },
              buffDurationMs: { base: 8000, perLevel: 500 },
              buffEffect: { defPercent: 30 },
            },
          ],
        },
      ],
    },

    // ─── Warlord (party support / balanced) ───────────────────────
    {
      id: "warlord",
      name: "Warlord",
      description:
        "A path of battlefield mastery. Warlords bolster their entire party, combining " +
        "martial prowess with commanding presence.",
      jobTiers: [
        {
          tier: 2,
          title: "Warlord",
          levelReq: 30,
          skills: [
            {
              id: "warrior.battle_standard",
              name: "Battle Standard",
              description:
                "Buff: plants a war banner that boosts ATK and DEF for the entire party.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 30,
              kind: "buff",
              requires: [{ skillId: "warrior.rally", level: 3 }],
              mpCost: { base: 18, perLevel: 1 },
              cooldownMs: { base: 35000, perLevel: 0 },
              buffDurationMs: { base: 12000, perLevel: 500 },
              buffEffect: { atkPercent: 10 },
            },
            {
              id: "warrior.onslaught",
              name: "Onslaught",
              description: "A rapid three-hit combo that overwhelms a single target.",
              maxLevel: 20,
              jobTier: 2,
              levelReq: 30,
              kind: "active",
              requires: [{ skillId: "warrior.crushing_blow", level: 5 }],
              mpCost: { base: 20, perLevel: 2 },
              cooldownMs: { base: 1000, perLevel: 0 },
              damagePercent: { base: 100, perLevel: 6 },
              hitCount: { base: 3, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
            },
          ],
        },
        {
          tier: 3,
          title: "Commander",
          levelReq: 60,
          skills: [
            {
              id: "warrior.hammer_smash",
              name: "Hammer Smash",
              description: "A ground-shattering slam that damages and slows all enemies in range.",
              maxLevel: 20,
              jobTier: 3,
              levelReq: 60,
              kind: "active",
              requires: [{ skillId: "warrior.onslaught", level: 5 }],
              mpCost: { base: 28, perLevel: 2 },
              cooldownMs: { base: 1600, perLevel: 0 },
              damagePercent: { base: 160, perLevel: 9 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 4, perLevel: 0 },
              debuffEffect: { slowPercent: 30, slowMs: 3000 },
            },
            {
              id: "warrior.endurance",
              name: "Endurance",
              description:
                "Passive: conditions your body for prolonged combat, increasing defense.",
              maxLevel: 10,
              jobTier: 3,
              levelReq: 60,
              kind: "passive",
              requires: [{ skillId: "warrior.battle_standard", level: 5 }],
              buffEffect: { defPercent: 10 },
            },
          ],
        },
        {
          tier: 4,
          title: "Conqueror",
          levelReq: 100,
          skills: [
            {
              id: "warrior.siege_breaker",
              name: "Siege Breaker",
              description:
                "A devastating multi-hit technique that demolishes all foes in a wide area.",
              maxLevel: 20,
              jobTier: 4,
              levelReq: 100,
              kind: "active",
              requires: [{ skillId: "warrior.hammer_smash", level: 10 }],
              mpCost: { base: 35, perLevel: 3 },
              cooldownMs: { base: 1800, perLevel: 0 },
              damagePercent: { base: 250, perLevel: 12 },
              hitCount: { base: 2, perLevel: 0 },
              targetCount: { base: 3, perLevel: 0 },
            },
          ],
        },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// Other archetypes (stubs — primary stat, home town, tier gates only)
// ═══════════════════════════════════════════════════════════════════════════════

const BEGINNER: ClassDef = {
  archetype: ClassArchetype.BEGINNER,
  name: "Beginner",
  primaryStat: "STR",
  hometown: "dawn-isle",
  hpGrowth: 12,
  mpGrowth: 6,
  jobTiers: [
    {
      tier: 1,
      title: "Islander",
      levelReq: 1,
      skills: [
        // ── Tutorial skills (Lv 1–9) ─────────────────────────────────────
        {
          id: "beginner.recovery",
          name: "Recovery",
          description:
            "Passive: island life toughens the body, passively restoring a small amount of HP and MP over time.",
          maxLevel: 5,
          jobTier: 1,
          levelReq: 1,
          kind: "passive",
          buffEffect: { hpMpRegen: 5 },
        },
        {
          id: "beginner.thrown_shell",
          name: "Thrown Shell",
          description:
            "Hurls a sturdy shell at a nearby foe. Weak but cheap — your first ranged attack on Dawn Isle.",
          maxLevel: 10,
          jobTier: 1,
          levelReq: 1,
          kind: "active",
          mpCost: { base: 2, perLevel: 0 },
          cooldownMs: { base: 600, perLevel: 0 },
          damagePercent: { base: 80, perLevel: 5 },
          hitCount: { base: 1, perLevel: 0 },
          targetCount: { base: 1, perLevel: 0 },
        },
        {
          id: "beginner.nimble_feet",
          name: "Nimble Feet",
          description: "Burst of island-honed swiftness, boosting movement speed for a short time.",
          maxLevel: 5,
          jobTier: 1,
          levelReq: 1,
          kind: "buff",
          mpCost: { base: 3, perLevel: 0 },
          cooldownMs: { base: 12000, perLevel: 0 },
          buffDurationMs: { base: 5000, perLevel: 500 },
          buffEffect: { speed: 15 },
        },
        {
          id: "beginner.leap",
          name: "Leap",
          description:
            "Passive: learned from the island's cliff edges, granting a permanent boost to jump height.",
          maxLevel: 5,
          jobTier: 1,
          levelReq: 3,
          kind: "passive",
          buffEffect: { jump: 15 },
        },

        // ── Pre-advancement skills (Lv 10+) ─────────────────────────────
        {
          id: "beginner.nimble_strike",
          name: "Nimble Strike",
          description: "A quick, precise strike. Basic Beginner attack skill.",
          maxLevel: 20,
          jobTier: 1,
          levelReq: 10,
          kind: "active",
          mpCost: { base: 5, perLevel: 1 },
          cooldownMs: { base: 600, perLevel: 0 },
          damagePercent: { base: 120, perLevel: 5 },
          hitCount: { base: 1, perLevel: 0 },
          targetCount: { base: 1, perLevel: 0 },
        },
        {
          id: "beginner.island_ward",
          name: "Island Ward",
          description:
            "Passive: hardens the body from island life, granting minor damage reduction.",
          maxLevel: 10,
          jobTier: 1,
          levelReq: 12,
          kind: "passive",
        },
      ],
    },
  ],
};

const MAGE: ClassDef = {
  archetype: ClassArchetype.MAGE,
  name: "Mage",
  primaryStat: "INT",
  hometown: "sylvanreach",
  hpGrowth: 6,
  mpGrowth: 18,

  // ── Tier 1 — shared across all branches ─────────────────────────
  jobTiers: [
    {
      tier: 1,
      title: "Adept",
      levelReq: 10,
      skills: [
        {
          id: "mage.arcane_bolt",
          name: "Arcane Bolt",
          description:
            "Launches a bolt of pure arcane energy at a single target. Core early damage skill.",
          maxLevel: 20,
          jobTier: 1,
          levelReq: 10,
          kind: "active",
          mpCost: { base: 6, perLevel: 1 },
          cooldownMs: { base: 600, perLevel: 0 },
          damagePercent: { base: 130, perLevel: 5 },
          hitCount: { base: 1, perLevel: 0 },
          targetCount: { base: 1, perLevel: 0 },
        },
        {
          id: "mage.arcane_mastery",
          name: "Arcane Mastery",
          description: "Passive: deepens arcane attunement, boosting magical attack power.",
          maxLevel: 10,
          jobTier: 1,
          levelReq: 12,
          kind: "passive",
          buffEffect: { atkPercent: 10 },
        },
        {
          id: "mage.mana_surge",
          name: "Mana Surge",
          description: "Passive: expands the mana reservoir, increasing max MP.",
          maxLevel: 10,
          jobTier: 1,
          levelReq: 15,
          kind: "passive",
          buffEffect: { mpPercent: 10 },
        },
        {
          id: "mage.mending_light",
          name: "Mending Light",
          description: "Channels restorative magic to heal a single ally.",
          maxLevel: 15,
          jobTier: 1,
          levelReq: 18,
          kind: "active",
          requires: [{ skillId: "mage.arcane_mastery", level: 1 }],
          mpCost: { base: 10, perLevel: 1 },
          cooldownMs: { base: 1000, perLevel: 0 },
          damagePercent: { base: 120, perLevel: 8 },
          hitCount: { base: 1, perLevel: 0 },
          targetCount: { base: 1, perLevel: 0 },
        },
      ],
    },
  ],

  // ── Branches — tier 2+ specializations ──────────────────────────
  branches: [
    // ─── Pyromancer (fire DPS) ────────────────────────────────────
    {
      id: "pyromancer",
      name: "Pyromancer",
      description:
        "A path of destructive flame. Pyromancers harness raw fire to incinerate foes, " +
        "exceling at sustained AoE damage.",
      jobTiers: [
        {
          tier: 2,
          title: "Pyromancer",
          levelReq: 30,
          skills: [
            {
              id: "mage.flame_lance",
              name: "Flame Lance",
              description: "Hurls a searing lance of flame at a single target.",
              maxLevel: 20,
              jobTier: 2,
              levelReq: 30,
              kind: "active",
              element: "FIRE",
              requires: [{ skillId: "mage.arcane_bolt", level: 1 }],
              mpCost: { base: 14, perLevel: 1 },
              cooldownMs: { base: 800, perLevel: 0 },
              damagePercent: { base: 160, perLevel: 8 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
            },
            {
              id: "mage.immolate",
              name: "Immolate",
              description: "Engulfs enemies in a burst of searing heat, scorching multiple foes.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 30,
              kind: "active",
              element: "FIRE",
              requires: [{ skillId: "mage.arcane_bolt", level: 3 }],
              mpCost: { base: 18, perLevel: 2 },
              cooldownMs: { base: 1200, perLevel: 0 },
              damagePercent: { base: 100, perLevel: 6 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 3, perLevel: 0 },
            },
          ],
        },
        {
          tier: 3,
          title: "Inferno",
          levelReq: 60,
          skills: [
            {
              id: "mage.firestorm",
              name: "Firestorm",
              description:
                "Conjures a swirling vortex of flame that ravages all foes in a wide area.",
              maxLevel: 20,
              jobTier: 3,
              levelReq: 60,
              kind: "active",
              element: "FIRE",
              requires: [{ skillId: "mage.flame_lance", level: 5 }],
              mpCost: { base: 24, perLevel: 2 },
              cooldownMs: { base: 1400, perLevel: 0 },
              damagePercent: { base: 170, perLevel: 10 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 5, perLevel: 0 },
            },
            {
              id: "mage.inferno_aura",
              name: "Inferno Aura",
              description: "Buff: wreathes you in flames, boosting attack power for a duration.",
              maxLevel: 10,
              jobTier: 3,
              levelReq: 60,
              kind: "buff",
              requires: [{ skillId: "mage.immolate", level: 3 }],
              mpCost: { base: 22, perLevel: 2 },
              cooldownMs: { base: 40000, perLevel: 0 },
              buffDurationMs: { base: 12000, perLevel: 500 },
              buffEffect: { atkPercent: 20 },
            },
          ],
        },
        {
          tier: 4,
          title: "Apocalypse",
          levelReq: 100,
          skills: [
            {
              id: "mage.cataclysm",
              name: "Cataclysm",
              description:
                "Unleashes an apocalyptic conflagration. The signature technique of the Apocalypse.",
              maxLevel: 20,
              jobTier: 4,
              levelReq: 100,
              kind: "active",
              element: "FIRE",
              requires: [{ skillId: "mage.firestorm", level: 5 }],
              mpCost: { base: 38, perLevel: 3 },
              cooldownMs: { base: 1800, perLevel: 0 },
              damagePercent: { base: 280, perLevel: 14 },
              hitCount: { base: 2, perLevel: 0 },
              targetCount: { base: 3, perLevel: 0 },
            },
          ],
        },
      ],
    },

    // ─── Glaciemancer (ice / lightning) ───────────────────────────
    {
      id: "glaciemancer",
      name: "Glaciemancer",
      description:
        "A path of frozen wrath. Glaciemancers wield ice and lightning in tandem, " +
        "slowing and shattering foes with crackling storms.",
      jobTiers: [
        {
          tier: 2,
          title: "Glaciemancer",
          levelReq: 30,
          skills: [
            {
              id: "mage.frost_bolt",
              name: "Frost Bolt",
              description: "Launches a shard of razor ice that slows the target.",
              maxLevel: 20,
              jobTier: 2,
              levelReq: 30,
              kind: "active",
              element: "ICE",
              requires: [{ skillId: "mage.arcane_bolt", level: 1 }],
              mpCost: { base: 12, perLevel: 1 },
              cooldownMs: { base: 700, perLevel: 0 },
              damagePercent: { base: 140, perLevel: 7 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
              debuffEffect: { slowPercent: 25, slowMs: 2500 },
            },
            {
              id: "mage.chain_lightning",
              name: "Chain Lightning",
              description: "Calls down a bolt of lightning that arcs between multiple enemies.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 30,
              kind: "active",
              element: "LIGHTNING",
              requires: [{ skillId: "mage.arcane_mastery", level: 3 }],
              mpCost: { base: 16, perLevel: 2 },
              cooldownMs: { base: 1000, perLevel: 0 },
              damagePercent: { base: 90, perLevel: 6 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 4, perLevel: 0 },
            },
          ],
        },
        {
          tier: 3,
          title: "Stormcaller",
          levelReq: 60,
          skills: [
            {
              id: "mage.blizzard",
              name: "Blizzard",
              description: "Summons a howling blizzard that pummels all foes in a wide area.",
              maxLevel: 20,
              jobTier: 3,
              levelReq: 60,
              kind: "active",
              element: "ICE",
              requires: [{ skillId: "mage.frost_bolt", level: 5 }],
              mpCost: { base: 22, perLevel: 2 },
              cooldownMs: { base: 1400, perLevel: 0 },
              damagePercent: { base: 150, perLevel: 9 },
              hitCount: { base: 2, perLevel: 0 },
              targetCount: { base: 4, perLevel: 0 },
            },
            {
              id: "mage.thunder_shield",
              name: "Thunder Shield",
              description:
                "Buff: encases you in crackling ice and lightning, greatly boosting defence.",
              maxLevel: 10,
              jobTier: 3,
              levelReq: 60,
              kind: "buff",
              requires: [{ skillId: "mage.chain_lightning", level: 3 }],
              mpCost: { base: 20, perLevel: 2 },
              cooldownMs: { base: 35000, perLevel: 0 },
              buffDurationMs: { base: 12000, perLevel: 500 },
              buffEffect: { defPercent: 20 },
            },
          ],
        },
        {
          tier: 4,
          title: "Tempest",
          levelReq: 100,
          skills: [
            {
              id: "mage.absolute_zero",
              name: "Absolute Zero",
              description:
                "Drains all heat from the area in a devastating flash-freeze. Signature Tempest technique.",
              maxLevel: 20,
              jobTier: 4,
              levelReq: 100,
              kind: "active",
              element: "ICE",
              requires: [{ skillId: "mage.blizzard", level: 5 }],
              mpCost: { base: 36, perLevel: 3 },
              cooldownMs: { base: 1800, perLevel: 0 },
              damagePercent: { base: 250, perLevel: 12 },
              hitCount: { base: 2, perLevel: 0 },
              targetCount: { base: 5, perLevel: 0 },
            },
          ],
        },
      ],
    },

    // ─── Luminarch (holy / support) ──────────────────────────────
    {
      id: "luminarch",
      name: "Luminarch",
      description:
        "A path of radiant grace. Luminarchs channel divine light to smite the wicked " +
        "and mend the wounded, serving as pillars of any party.",
      jobTiers: [
        {
          tier: 2,
          title: "Luminarch",
          levelReq: 30,
          skills: [
            {
              id: "mage.radiance",
              name: "Radiance",
              description: "Unleashes a blinding beam of holy light at a single foe.",
              maxLevel: 20,
              jobTier: 2,
              levelReq: 30,
              kind: "active",
              element: "HOLY",
              requires: [{ skillId: "mage.mending_light", level: 1 }],
              mpCost: { base: 14, perLevel: 1 },
              cooldownMs: { base: 900, perLevel: 0 },
              damagePercent: { base: 130, perLevel: 7 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
            },
            {
              id: "mage.sanctuary",
              name: "Sanctuary",
              description: "Buff: conjures a radiant barrier that heals allies over its duration.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 30,
              kind: "buff",
              requires: [{ skillId: "mage.mana_surge", level: 3 }],
              mpCost: { base: 16, perLevel: 1 },
              cooldownMs: { base: 30000, perLevel: 0 },
              buffDurationMs: { base: 10000, perLevel: 500 },
              buffEffect: { atkPercent: 10 },
            },
          ],
        },
        {
          tier: 3,
          title: "Celestine",
          levelReq: 60,
          skills: [
            {
              id: "mage.divine_wrath",
              name: "Divine Wrath",
              description: "Calls down a pillar of searing radiance upon all foes in range.",
              maxLevel: 20,
              jobTier: 3,
              levelReq: 60,
              kind: "active",
              element: "HOLY",
              requires: [{ skillId: "mage.radiance", level: 5 }],
              mpCost: { base: 24, perLevel: 2 },
              cooldownMs: { base: 1400, perLevel: 0 },
              damagePercent: { base: 155, perLevel: 9 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 4, perLevel: 0 },
            },
            {
              id: "mage.divine_ward",
              name: "Divine Ward",
              description:
                "Buff: envelops the party in a protective aura of light, raising defence.",
              maxLevel: 10,
              jobTier: 3,
              levelReq: 60,
              kind: "buff",
              requires: [{ skillId: "mage.sanctuary", level: 3 }],
              mpCost: { base: 22, perLevel: 2 },
              cooldownMs: { base: 35000, perLevel: 0 },
              buffDurationMs: { base: 12000, perLevel: 500 },
              buffEffect: { defPercent: 18 },
            },
          ],
        },
        {
          tier: 4,
          title: "Archon",
          levelReq: 100,
          skills: [
            {
              id: "mage.judgement",
              name: "Judgement",
              description:
                "Passes divine judgement — a devastating cascade of holy energy. Signature Archon technique.",
              maxLevel: 20,
              jobTier: 4,
              levelReq: 100,
              kind: "active",
              element: "HOLY",
              requires: [{ skillId: "mage.divine_wrath", level: 5 }],
              mpCost: { base: 36, perLevel: 3 },
              cooldownMs: { base: 1800, perLevel: 0 },
              damagePercent: { base: 260, perLevel: 13 },
              hitCount: { base: 2, perLevel: 0 },
              targetCount: { base: 3, perLevel: 0 },
            },
          ],
        },
      ],
    },
  ],
};
const ARCHER: ClassDef = {
  archetype: ClassArchetype.ARCHER,
  name: "Archer",
  primaryStat: "DEX",
  hometown: "meadowfield",
  hpGrowth: 12,
  mpGrowth: 8,

  // ── Tier 1 — shared across all branches ─────────────────────────
  jobTiers: [
    {
      tier: 1,
      title: "Scout",
      levelReq: 10,
      skills: [
        {
          id: "archer.twin_shot",
          name: "Twin Shot",
          description:
            "Fires two arrows in rapid succession at the nearest foe. Core early damage skill.",
          maxLevel: 20,
          jobTier: 1,
          levelReq: 10,
          kind: "active",
          mpCost: { base: 6, perLevel: 1 },
          cooldownMs: { base: 700, perLevel: 0 },
          damagePercent: { base: 75, perLevel: 3 },
          hitCount: { base: 2, perLevel: 0 },
          targetCount: { base: 1, perLevel: 0 },
        },
        {
          id: "archer.keen_eye",
          name: "Keen Eye",
          description: "Passive: sharpens aim and instinct, increasing critical hit rate.",
          maxLevel: 10,
          jobTier: 1,
          levelReq: 12,
          kind: "passive",
          buffEffect: { atkPercent: 8 },
        },
        {
          id: "archer.piercing_arrow",
          name: "Piercing Arrow",
          description:
            "A single, carefully aimed shot that punches through armour for heavy damage.",
          maxLevel: 20,
          jobTier: 1,
          levelReq: 15,
          kind: "active",
          requires: [{ skillId: "archer.keen_eye", level: 1 }],
          mpCost: { base: 10, perLevel: 1 },
          cooldownMs: { base: 1000, perLevel: 0 },
          damagePercent: { base: 180, perLevel: 8 },
          hitCount: { base: 1, perLevel: 0 },
          targetCount: { base: 1, perLevel: 0 },
        },
        {
          id: "archer.fleet_foot",
          name: "Fleet Foot",
          description: "Passive: years of forest life grant swiftness, boosting movement speed.",
          maxLevel: 10,
          jobTier: 1,
          levelReq: 12,
          kind: "passive",
          buffEffect: { speed: 8 },
        },
        {
          id: "archer.barbed_arrow",
          name: "Barbed Arrow",
          description: "Looses barbed arrows that rip through multiple enemies in a line.",
          maxLevel: 15,
          jobTier: 1,
          levelReq: 18,
          kind: "active",
          requires: [{ skillId: "archer.twin_shot", level: 3 }],
          mpCost: { base: 12, perLevel: 1 },
          cooldownMs: { base: 1100, perLevel: 0 },
          damagePercent: { base: 100, perLevel: 5 },
          hitCount: { base: 1, perLevel: 0 },
          targetCount: { base: 3, perLevel: 0 },
        },
      ],
    },
  ],

  // ── Branches — tier 2+ specializations ──────────────────────────
  branches: [
    // ─── Longbow path (multi-target / rapid-fire) ──────────────────
    {
      id: "longbow",
      name: "Longbow",
      description:
        "A path of sweeping volleys and relentless barrage. Longbow users saturate the " +
        "battlefield with arrows, excelling at multi-target devastation.",
      jobTiers: [
        {
          tier: 2,
          title: "Windrunner",
          levelReq: 30,
          skills: [
            {
              id: "archer.volley",
              name: "Volley",
              description: "Rains a coordinated volley of arrows on a cluster of foes.",
              maxLevel: 20,
              jobTier: 2,
              levelReq: 30,
              kind: "active",
              requires: [{ skillId: "archer.twin_shot", level: 1 }],
              mpCost: { base: 16, perLevel: 2 },
              cooldownMs: { base: 1200, perLevel: 0 },
              damagePercent: { base: 90, perLevel: 6 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 4, perLevel: 0 },
            },
            {
              id: "archer.swift_nock",
              name: "Swift Nock",
              description: "Passive: longbow training increases attack speed and power.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 30,
              kind: "passive",
              requires: [{ skillId: "archer.keen_eye", level: 3 }],
              buffEffect: { atkPercent: 10 },
            },
            {
              id: "archer.focus_spirit",
              name: "Focus Spirit",
              description:
                "Buff: channels inner focus, temporarily heightening DEX and attack power.",
              maxLevel: 10,
              jobTier: 2,
              levelReq: 35,
              kind: "buff",
              requires: [{ skillId: "archer.twin_shot", level: 5 }],
              mpCost: { base: 18, perLevel: 1 },
              cooldownMs: { base: 30000, perLevel: 0 },
              buffDurationMs: { base: 10000, perLevel: 500 },
              buffEffect: { atkPercent: 12 },
            },
          ],
        },
        {
          tier: 3,
          title: "Stormbow",
          levelReq: 60,
          skills: [
            {
              id: "archer.arrow_rain",
              name: "Arrow Rain",
              description:
                "Unleashes a torrent of arrows that blankets a wide area, shredding all foes within.",
              maxLevel: 20,
              jobTier: 3,
              levelReq: 60,
              kind: "active",
              requires: [{ skillId: "archer.volley", level: 5 }],
              mpCost: { base: 24, perLevel: 2 },
              cooldownMs: { base: 1400, perLevel: 0 },
              damagePercent: { base: 140, perLevel: 8 },
              hitCount: { base: 2, perLevel: 0 },
              targetCount: { base: 5, perLevel: 0 },
            },
            {
              id: "archer.wind_blessing",
              name: "Wind Blessing",
              description:
                "Buff: calls the wind to bless allies, greatly boosting accuracy and evasion.",
              maxLevel: 10,
              jobTier: 3,
              levelReq: 60,
              kind: "buff",
              requires: [{ skillId: "archer.focus_spirit", level: 3 }],
              mpCost: { base: 22, perLevel: 2 },
              cooldownMs: { base: 35000, perLevel: 0 },
              buffDurationMs: { base: 12000, perLevel: 500 },
              buffEffect: { speed: 15 },
            },
          ],
        },
        {
          tier: 4,
          title: "Galestriker",
          levelReq: 100,
          skills: [
            {
              id: "archer.tempest_flurry",
              name: "Tempest Flurry",
              description:
                "A devastating storm of arrows fired with inhuman speed. The signature " +
                "technique of the Galestriker.",
              maxLevel: 20,
              jobTier: 4,
              levelReq: 100,
              kind: "active",
              requires: [{ skillId: "archer.arrow_rain", level: 5 }],
              mpCost: { base: 38, perLevel: 3 },
              cooldownMs: { base: 1800, perLevel: 0 },
              damagePercent: { base: 120, perLevel: 8 },
              hitCount: { base: 3, perLevel: 0 },
              targetCount: { base: 4, perLevel: 0 },
            },
          ],
        },
      ],
    },

    // ─── Crossbow path (single-target / sniper) ───────────────────
    {
      id: "crossbow",
      name: "Crossbow",
      description:
        "A path of patience and precision. Crossbow marksmen deliver devastating " +
        "single-target shots, eliminating high-value targets with lethal efficiency.",
      jobTiers: [
        {
          tier: 2,
          title: "Deadeye",
          levelReq: 30,
          skills: [
            {
              id: "archer.aimed_shot",
              name: "Aimed Shot",
              description: "Takes careful aim and looses a devastating shot at a single target.",
              maxLevel: 20,
              jobTier: 2,
              levelReq: 30,
              kind: "active",
              requires: [{ skillId: "archer.piercing_arrow", level: 1 }],
              mpCost: { base: 14, perLevel: 1 },
              cooldownMs: { base: 1200, perLevel: 0 },
              damagePercent: { base: 200, perLevel: 10 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
            },
            {
              id: "archer.eagle_eye",
              name: "Eagle Eye",
              description:
                "Passive: hones a predator's gaze, greatly increasing critical hit rate.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 30,
              kind: "passive",
              requires: [{ skillId: "archer.keen_eye", level: 3 }],
              buffEffect: { atkPercent: 12 },
            },
            {
              id: "archer.reload_stance",
              name: "Reload Stance",
              description:
                "Buff: braces for a powerful shot, significantly boosting damage for a short window.",
              maxLevel: 10,
              jobTier: 2,
              levelReq: 35,
              kind: "buff",
              requires: [{ skillId: "archer.aimed_shot", level: 3 }],
              mpCost: { base: 20, perLevel: 1 },
              cooldownMs: { base: 30000, perLevel: 0 },
              buffDurationMs: { base: 8000, perLevel: 400 },
              buffEffect: { atkPercent: 18 },
            },
          ],
        },
        {
          tier: 3,
          title: "Ballista",
          levelReq: 60,
          skills: [
            {
              id: "archer.puncture",
              name: "Puncture",
              description:
                "A bone-crushing bolt that ignores armour, tearing through even the toughest foe.",
              maxLevel: 20,
              jobTier: 3,
              levelReq: 60,
              kind: "active",
              requires: [{ skillId: "archer.aimed_shot", level: 5 }],
              mpCost: { base: 26, perLevel: 2 },
              cooldownMs: { base: 1600, perLevel: 0 },
              damagePercent: { base: 280, perLevel: 12 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
            },
            {
              id: "archer.steady_aim",
              name: "Steady Aim",
              description:
                "Passive: disciplined breathing and stillness increase accuracy and critical chance.",
              maxLevel: 10,
              jobTier: 3,
              levelReq: 60,
              kind: "passive",
              requires: [{ skillId: "archer.eagle_eye", level: 5 }],
              buffEffect: { atkPercent: 10 },
            },
          ],
        },
        {
          tier: 4,
          title: "Arbalest",
          levelReq: 100,
          skills: [
            {
              id: "archer.hypervelocity",
              name: "Hypervelocity",
              description:
                "A single shot of apocalyptic precision. The signature technique of the Arbalest.",
              maxLevel: 20,
              jobTier: 4,
              levelReq: 100,
              kind: "active",
              requires: [{ skillId: "archer.puncture", level: 5 }],
              mpCost: { base: 40, perLevel: 3 },
              cooldownMs: { base: 2000, perLevel: 0 },
              damagePercent: { base: 400, perLevel: 18 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
            },
          ],
        },
      ],
    },
  ],
};
const THIEF: ClassDef = {
  archetype: ClassArchetype.THIEF,
  name: "Thief",
  primaryStat: "LUK",
  hometown: "dusk-ward",
  hpGrowth: 11,
  mpGrowth: 9,

  // ── Tier 1 — shared across all branches ─────────────────────────
  jobTiers: [
    {
      tier: 1,
      title: "Cutpurse",
      levelReq: 10,
      skills: [
        {
          id: "thief.shadow_rush",
          name: "Shadow Rush",
          description:
            "A swift dash attack infused with shadow. Core early damage skill." +
            " High burst potential when combined with crit passives.",
          maxLevel: 20,
          jobTier: 1,
          levelReq: 10,
          kind: "active",
          element: "DARK",
          mpCost: { base: 6, perLevel: 1 },
          cooldownMs: { base: 700, perLevel: 0 },
          damagePercent: { base: 150, perLevel: 6 },
          hitCount: { base: 1, perLevel: 0 },
          targetCount: { base: 1, perLevel: 0 },
        },
        {
          id: "thief.shadow_instinct",
          name: "Shadow Instinct",
          description:
            "Passive: heightens danger sense, granting permanent evasion " +
            "through increased movement speed.",
          maxLevel: 10,
          jobTier: 1,
          levelReq: 12,
          kind: "passive",
          buffEffect: { speed: 10 },
        },
        {
          id: "thief.keen_reflexes",
          name: "Keen Reflexes",
          description:
            "Passive: sharp instincts amplify critical hit potential, " + "boosting attack power.",
          maxLevel: 10,
          jobTier: 1,
          levelReq: 15,
          kind: "passive",
          buffEffect: { atkPercent: 10 },
        },
        {
          id: "thief.noxious_wound",
          name: "Noxious Wound",
          description:
            "A deep cut laced with venom that rends a single foe for heavy damage and applies a poison.",
          maxLevel: 15,
          jobTier: 1,
          levelReq: 18,
          kind: "active",
          requires: [{ skillId: "thief.shadow_rush", level: 3 }],
          element: "POISON",
          mpCost: { base: 10, perLevel: 1 },
          cooldownMs: { base: 1000, perLevel: 0 },
          damagePercent: { base: 180, perLevel: 8 },
          hitCount: { base: 1, perLevel: 0 },
          targetCount: { base: 1, perLevel: 0 },
          debuffEffect: { poisonTickDamage: 15, poisonTickMs: 1000, poisonMs: 4000 },
        },
      ],
    },
  ],

  // ── Branches — tier 2+ specializations ──────────────────────────
  branches: [
    // ─── Bladecaller (throwing-blade / ranged) ────────────────────
    {
      id: "bladecaller",
      name: "Bladecaller",
      description:
        "A path of whistling steel. Bladecallers hurl enchanted blades " +
        "from range, saturating the battlefield with razor-sharp volleys.",
      jobTiers: [
        {
          tier: 2,
          title: "Bladecaller",
          levelReq: 30,
          skills: [
            {
              id: "thief.ricochet_blade",
              name: "Ricochet Blade",
              description:
                "Hurls a blade that ricochets between enemies, striking " +
                "multiple foes in rapid succession.",
              maxLevel: 20,
              jobTier: 2,
              levelReq: 30,
              kind: "active",
              requires: [{ skillId: "thief.shadow_rush", level: 1 }],
              mpCost: { base: 14, perLevel: 1 },
              cooldownMs: { base: 900, perLevel: 0 },
              damagePercent: { base: 130, perLevel: 7 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 3, perLevel: 0 },
            },
            {
              id: "thief.focused_fury",
              name: "Focused Fury",
              description:
                "Buff: sharpens focus to a razor edge, greatly boosting " +
                "attack power for a duration.",
              maxLevel: 10,
              jobTier: 2,
              levelReq: 30,
              kind: "buff",
              requires: [{ skillId: "thief.keen_reflexes", level: 3 }],
              mpCost: { base: 16, perLevel: 1 },
              cooldownMs: { base: 30000, perLevel: 0 },
              buffDurationMs: { base: 10000, perLevel: 500 },
              buffEffect: { atkPercent: 15 },
            },
          ],
        },
        {
          tier: 3,
          title: "Tempest",
          levelReq: 60,
          skills: [
            {
              id: "thief.blade_storm",
              name: "Blade Storm",
              description:
                "Unleashes a swirling storm of throwing blades that shreds " +
                "all foes in a wide area.",
              maxLevel: 20,
              jobTier: 3,
              levelReq: 60,
              kind: "active",
              requires: [{ skillId: "thief.ricochet_blade", level: 5 }],
              mpCost: { base: 24, perLevel: 2 },
              cooldownMs: { base: 1400, perLevel: 0 },
              damagePercent: { base: 150, perLevel: 8 },
              hitCount: { base: 2, perLevel: 0 },
              targetCount: { base: 4, perLevel: 0 },
            },
            {
              id: "thief.cloak_of_razors",
              name: "Cloak of Razors",
              description:
                "Buff: conjures spectral blades that orbit you, enhancing " +
                "evasion and dealing retaliation damage.",
              maxLevel: 10,
              jobTier: 3,
              levelReq: 60,
              kind: "buff",
              requires: [{ skillId: "thief.focused_fury", level: 3 }],
              mpCost: { base: 20, perLevel: 2 },
              cooldownMs: { base: 35000, perLevel: 0 },
              buffDurationMs: { base: 12000, perLevel: 500 },
              buffEffect: { defPercent: 18 },
            },
          ],
        },
        {
          tier: 4,
          title: "Eclipse",
          levelReq: 100,
          skills: [
            {
              id: "thief.eclipse_barrage",
              name: "Eclipse Barrage",
              description:
                "A devastating salvo of enchanted blades that obliterates " +
                "all nearby foes. The signature technique of the Eclipse.",
              maxLevel: 20,
              jobTier: 4,
              levelReq: 100,
              kind: "active",
              element: "DARK",
              requires: [{ skillId: "thief.blade_storm", level: 5 }],
              mpCost: { base: 36, perLevel: 3 },
              cooldownMs: { base: 1800, perLevel: 0 },
              damagePercent: { base: 200, perLevel: 10 },
              hitCount: { base: 3, perLevel: 0 },
              targetCount: { base: 5, perLevel: 0 },
            },
          ],
        },
      ],
    },

    // ─── Cutthroat (dagger / melee) ──────────────────────────────
    {
      id: "cutthroat",
      name: "Cutthroat",
      description:
        "A path of brutal close-quarters combat. Cutthroats close the " +
        "distance and unleash devastating flurries of dagger strikes, " +
        "draining life from their victims.",
      jobTiers: [
        {
          tier: 2,
          title: "Cutthroat",
          levelReq: 30,
          skills: [
            {
              id: "thief.vicious_slash",
              name: "Vicious Slash",
              description:
                "A devastating close-range slash that tears through " +
                "a single target's defences.",
              maxLevel: 20,
              jobTier: 2,
              levelReq: 30,
              kind: "active",
              requires: [{ skillId: "thief.shadow_rush", level: 1 }],
              mpCost: { base: 12, perLevel: 1 },
              cooldownMs: { base: 800, perLevel: 0 },
              damagePercent: { base: 180, perLevel: 9 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
            },
            {
              id: "thief.evasive_mastery",
              name: "Evasive Mastery",
              description:
                "Passive: masterful dodging technique that reduces incoming " +
                "damage through superior positioning.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 30,
              kind: "passive",
              requires: [{ skillId: "thief.shadow_instinct", level: 3 }],
              buffEffect: { defPercent: 12 },
            },
            {
              id: "thief.blood_fang",
              name: "Blood Fang",
              description:
                "A vicious slash that drains life force from the target, " +
                "healing you for a portion of damage dealt.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 35,
              kind: "active",
              element: "DARK",
              requires: [{ skillId: "thief.vicious_slash", level: 3 }],
              mpCost: { base: 16, perLevel: 1 },
              cooldownMs: { base: 1200, perLevel: 0 },
              damagePercent: { base: 150, perLevel: 7 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
            },
          ],
        },
        {
          tier: 3,
          title: "Reaver",
          levelReq: 60,
          skills: [
            {
              id: "thief.shadow_dance",
              name: "Shadow Dance",
              description:
                "Buff: enters a fluid shadow dance, boosting both attack " +
                "power and movement speed.",
              maxLevel: 10,
              jobTier: 3,
              levelReq: 60,
              kind: "buff",
              requires: [{ skillId: "thief.evasive_mastery", level: 5 }],
              mpCost: { base: 22, perLevel: 2 },
              cooldownMs: { base: 35000, perLevel: 0 },
              buffDurationMs: { base: 12000, perLevel: 500 },
              buffEffect: { atkPercent: 20 },
            },
            {
              id: "thief.flicker_assault",
              name: "Flicker Assault",
              description:
                "A frenzied flurry of flickering dagger strikes that " +
                "overwhelms a single target with rapid multi-hit damage.",
              maxLevel: 20,
              jobTier: 3,
              levelReq: 60,
              kind: "active",
              requires: [{ skillId: "thief.blood_fang", level: 5 }],
              mpCost: { base: 26, perLevel: 2 },
              cooldownMs: { base: 1600, perLevel: 0 },
              damagePercent: { base: 100, perLevel: 6 },
              hitCount: { base: 4, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
            },
          ],
        },
        {
          tier: 4,
          title: "Harbinger",
          levelReq: 100,
          skills: [
            {
              id: "thief.void_ripper",
              name: "Void Ripper",
              description:
                "Tears through reality itself with dual daggers. The " +
                "signature technique of the Harbinger.",
              maxLevel: 20,
              jobTier: 4,
              levelReq: 100,
              kind: "active",
              requires: [{ skillId: "thief.flicker_assault", level: 5 }],
              mpCost: { base: 38, perLevel: 3 },
              cooldownMs: { base: 1800, perLevel: 0 },
              damagePercent: { base: 280, perLevel: 14 },
              hitCount: { base: 2, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
            },
          ],
        },
      ],
    },

    // ─── Shadowmancer (magic-stealth / debuffs) ──────────────────
    {
      id: "shadowmancer",
      name: "Shadowmancer",
      description:
        "A path of arcane subterfuge. Shadowmancers weave void magic " +
        "and illusion to evade, debilitate, and strike from beyond sight.",
      jobTiers: [
        {
          tier: 2,
          title: "Shadowmancer",
          levelReq: 30,
          skills: [
            {
              id: "thief.smokescreen",
              name: "Smokescreen",
              description:
                "Buff: deploys a cloud of shadow that boosts evasion " +
                "for you and nearby allies.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 30,
              kind: "buff",
              requires: [{ skillId: "thief.shadow_instinct", level: 1 }],
              mpCost: { base: 14, perLevel: 1 },
              cooldownMs: { base: 28000, perLevel: 0 },
              buffDurationMs: { base: 10000, perLevel: 500 },
              buffEffect: { speed: 12 },
            },
            {
              id: "thief.phantom_strike",
              name: "Phantom Strike",
              description:
                "A magic-infused attack launched from the shadows, " +
                "striking multiple foes with void energy.",
              maxLevel: 20,
              jobTier: 2,
              levelReq: 30,
              kind: "active",
              element: "DARK",
              requires: [{ skillId: "thief.keen_reflexes", level: 1 }],
              mpCost: { base: 12, perLevel: 1 },
              cooldownMs: { base: 900, perLevel: 0 },
              damagePercent: { base: 140, perLevel: 8 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 2, perLevel: 0 },
            },
          ],
        },
        {
          tier: 3,
          title: "Wraith",
          levelReq: 60,
          skills: [
            {
              id: "thief.void_cloak",
              name: "Void Cloak",
              description:
                "Buff: wraps yourself in void energy, becoming nearly " +
                "untouchable for a brief window.",
              maxLevel: 10,
              jobTier: 3,
              levelReq: 60,
              kind: "buff",
              requires: [{ skillId: "thief.smokescreen", level: 5 }],
              mpCost: { base: 22, perLevel: 2 },
              cooldownMs: { base: 40000, perLevel: 0 },
              buffDurationMs: { base: 8000, perLevel: 400 },
              buffEffect: { defPercent: 22 },
            },
            {
              id: "thief.wraith_talon",
              name: "Wraith Talon",
              description:
                "Summons a spectral talon that rends enemies with void " +
                "energy, striking multiple targets.",
              maxLevel: 20,
              jobTier: 3,
              levelReq: 60,
              kind: "active",
              element: "DARK",
              requires: [{ skillId: "thief.phantom_strike", level: 5 }],
              mpCost: { base: 22, perLevel: 2 },
              cooldownMs: { base: 1400, perLevel: 0 },
              damagePercent: { base: 160, perLevel: 9 },
              hitCount: { base: 2, perLevel: 0 },
              targetCount: { base: 3, perLevel: 0 },
            },
          ],
        },
        {
          tier: 4,
          title: "Umbra",
          levelReq: 100,
          skills: [
            {
              id: "thief.umbra_dominion",
              name: "Umbra Dominion",
              description:
                "Claims dominion over shadow itself, unleashing a " +
                "devastating void assault. The signature Umbra technique.",
              maxLevel: 20,
              jobTier: 4,
              levelReq: 100,
              kind: "active",
              element: "DARK",
              requires: [{ skillId: "thief.wraith_talon", level: 5 }],
              mpCost: { base: 38, perLevel: 3 },
              cooldownMs: { base: 2000, perLevel: 0 },
              damagePercent: { base: 300, perLevel: 15 },
              hitCount: { base: 2, perLevel: 0 },
              targetCount: { base: 3, perLevel: 0 },
            },
          ],
        },
      ],
    },
  ],
};
// ═══════════════════════════════════════════════════════════════════════════════
// PIRATE — fully specced archetype (STR primary; Gunner branch favours DEX)
// ═══════════════════════════════════════════════════════════════════════════════

const PIRATE: ClassDef = {
  archetype: ClassArchetype.PIRATE,
  name: "Pirate",
  primaryStat: "STR",
  hometown: "tidewatch-harbor",
  hpGrowth: 16,
  mpGrowth: 7,

  // ── Tier 1 — shared across all branches ─────────────────────────
  jobTiers: [
    {
      tier: 1,
      title: "Deckhand",
      levelReq: 10,
      skills: [
        {
          id: "pirate.gut_punch",
          name: "Gut Punch",
          description:
            "A vicious close-range hook that crumples a single foe. Core early damage skill.",
          maxLevel: 20,
          jobTier: 1,
          levelReq: 10,
          kind: "active",
          mpCost: { base: 8, perLevel: 1 },
          cooldownMs: { base: 700, perLevel: 0 },
          damagePercent: { base: 140, perLevel: 5 },
          hitCount: { base: 1, perLevel: 0 },
          targetCount: { base: 1, perLevel: 0 },
        },
        {
          id: "pirate.sea_fortitude",
          name: "Sea Fortitude",
          description:
            "Passive: a sailor's endurance hardens the body, granting permanent damage reduction.",
          maxLevel: 10,
          jobTier: 1,
          levelReq: 12,
          kind: "passive",
          buffEffect: { defPercent: 10 },
        },
        {
          id: "pirate.tidewalker_dash",
          name: "Tidewalker Dash",
          description:
            "A quick burst of speed that dashes you forward, striking the first foe in your path.",
          maxLevel: 15,
          jobTier: 1,
          levelReq: 14,
          kind: "active",
          mpCost: { base: 6, perLevel: 1 },
          cooldownMs: { base: 3000, perLevel: 0 },
          damagePercent: { base: 100, perLevel: 4 },
          hitCount: { base: 1, perLevel: 0 },
          targetCount: { base: 1, perLevel: 0 },
        },
        {
          id: "pirate.buccaneers_bellow",
          name: "Buccaneer's Bellow",
          description: "Buff: a fearsome war cry that raises your attack power for a duration.",
          maxLevel: 10,
          jobTier: 1,
          levelReq: 16,
          kind: "buff",
          requires: [{ skillId: "pirate.sea_fortitude", level: 1 }],
          mpCost: { base: 15, perLevel: 1 },
          cooldownMs: { base: 30000, perLevel: 0 },
          buffDurationMs: { base: 10000, perLevel: 500 },
          buffEffect: { atkPercent: 15 },
        },
        {
          id: "pirate.riptide_sweep",
          name: "Riptide Sweep",
          description:
            "A sweeping strike carried by ocean force, hitting multiple enemies in front of you.",
          maxLevel: 15,
          jobTier: 1,
          levelReq: 18,
          kind: "active",
          requires: [{ skillId: "pirate.gut_punch", level: 3 }],
          mpCost: { base: 12, perLevel: 1 },
          cooldownMs: { base: 1200, perLevel: 0 },
          damagePercent: { base: 110, perLevel: 5 },
          hitCount: { base: 1, perLevel: 0 },
          targetCount: { base: 3, perLevel: 0 },
        },
      ],
    },
  ],

  // ── Branches — tier 2+ specializations ──────────────────────────
  branches: [
    // ─── Brawler (melee knuckle / STR) ────────────────────────────
    {
      id: "brawler",
      name: "Brawler",
      description:
        "A path of iron fists and brute force. Brawlers close the distance and pummel " +
        "foes with devastating knuckle strikes, excelling at raw melee damage.",
      jobTiers: [
        {
          tier: 2,
          title: "Brawler",
          levelReq: 30,
          skills: [
            {
              id: "pirate.knuckle_crash",
              name: "Knuckle Crash",
              description: "A crushing overhead blow that shatters a single foe's guard.",
              maxLevel: 20,
              jobTier: 2,
              levelReq: 30,
              kind: "active",
              requires: [{ skillId: "pirate.gut_punch", level: 1 }],
              mpCost: { base: 16, perLevel: 2 },
              cooldownMs: { base: 1000, perLevel: 0 },
              damagePercent: { base: 170, perLevel: 8 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
            },
            {
              id: "pirate.iron_liver",
              name: "Iron Liver",
              description:
                "Passive: conditioned by countless bar brawls, your body shrugs off punishment.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 30,
              kind: "passive",
              requires: [{ skillId: "pirate.sea_fortitude", level: 3 }],
              buffEffect: { defPercent: 12 },
            },
            {
              id: "pirate.tidal_lunge",
              name: "Tidal Lunge",
              description: "A surging forward lunge that strikes everything in your path.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 35,
              kind: "active",
              requires: [{ skillId: "pirate.gut_punch", level: 5 }],
              mpCost: { base: 18, perLevel: 2 },
              cooldownMs: { base: 1200, perLevel: 0 },
              damagePercent: { base: 150, perLevel: 7 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 2, perLevel: 0 },
            },
          ],
        },
        {
          tier: 3,
          title: "Bruiser",
          levelReq: 60,
          skills: [
            {
              id: "pirate.tidal_slam",
              name: "Tidal Slam",
              description:
                "Slams the ground with oceanic fury, sending a shockwave that crushes all nearby foes.",
              maxLevel: 20,
              jobTier: 3,
              levelReq: 60,
              kind: "active",
              requires: [{ skillId: "pirate.knuckle_crash", level: 5 }],
              mpCost: { base: 24, perLevel: 2 },
              cooldownMs: { base: 1500, perLevel: 0 },
              damagePercent: { base: 180, perLevel: 10 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 5, perLevel: 0 },
            },
            {
              id: "pirate.brawlers_resolve",
              name: "Brawler's Resolve",
              description:
                "Buff: channels inner steel, greatly boosting attack power for a duration.",
              maxLevel: 10,
              jobTier: 3,
              levelReq: 60,
              kind: "buff",
              requires: [{ skillId: "pirate.iron_liver", level: 5 }],
              mpCost: { base: 22, perLevel: 2 },
              cooldownMs: { base: 40000, perLevel: 0 },
              buffDurationMs: { base: 12000, perLevel: 500 },
              buffEffect: { atkPercent: 20 },
            },
          ],
        },
        {
          tier: 4,
          title: "Juggernaut",
          levelReq: 100,
          skills: [
            {
              id: "pirate.earthshaker",
              name: "Earthshaker",
              description:
                "A double-fisted hammerblow that cracks the earth itself. The signature Juggernaut technique.",
              maxLevel: 20,
              jobTier: 4,
              levelReq: 100,
              kind: "active",
              requires: [{ skillId: "pirate.tidal_slam", level: 5 }],
              mpCost: { base: 38, perLevel: 3 },
              cooldownMs: { base: 2000, perLevel: 0 },
              damagePercent: { base: 200, perLevel: 10 },
              hitCount: { base: 2, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
            },
            {
              id: "pirate.adamantine_fury",
              name: "Adamantine Fury",
              description:
                "Buff: enters an unstoppable rampage, sacrificing composure for devastating attack power.",
              maxLevel: 10,
              jobTier: 4,
              levelReq: 100,
              kind: "buff",
              requires: [{ skillId: "pirate.brawlers_resolve", level: 3 }],
              mpCost: { base: 30, perLevel: 3 },
              cooldownMs: { base: 45000, perLevel: 0 },
              buffDurationMs: { base: 12000, perLevel: 500 },
              buffEffect: { atkPercent: 25 },
            },
          ],
        },
      ],
    },

    // ─── Gunner (ranged gun / DEX) ───────────────────────────────
    {
      id: "gunner",
      name: "Gunner",
      description:
        "A path of calculated firepower. Gunners rain devastation from range, " +
        "favoured by marksmen who pair DEX with gunnery to obliterate enemies at distance.",
      jobTiers: [
        {
          tier: 2,
          title: "Gunner",
          levelReq: 30,
          skills: [
            {
              id: "pirate.scorch_shot",
              name: "Scorch Shot",
              description: "Fires a searing round that burns a single target on impact.",
              maxLevel: 20,
              jobTier: 2,
              levelReq: 30,
              kind: "active",
              element: "FIRE",
              requires: [{ skillId: "pirate.gut_punch", level: 1 }],
              mpCost: { base: 14, perLevel: 1 },
              cooldownMs: { base: 900, perLevel: 0 },
              damagePercent: { base: 160, perLevel: 7 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
            },
            {
              id: "pirate.keen_sights",
              name: "Keen Sights",
              description: "Passive: sharpens aim and reflexes, permanently boosting attack power.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 30,
              kind: "passive",
              requires: [{ skillId: "pirate.sea_fortitude", level: 3 }],
              buffEffect: { atkPercent: 10 },
            },
            {
              id: "pirate.ricochet_round",
              name: "Ricochet Round",
              description:
                "A bullet designed to ricochet between enemies, striking multiple targets.",
              maxLevel: 15,
              jobTier: 2,
              levelReq: 35,
              kind: "active",
              requires: [{ skillId: "pirate.scorch_shot", level: 3 }],
              mpCost: { base: 16, perLevel: 2 },
              cooldownMs: { base: 1100, perLevel: 0 },
              damagePercent: { base: 130, perLevel: 6 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 2, perLevel: 0 },
            },
          ],
        },
        {
          tier: 3,
          title: "Bombardier",
          levelReq: 60,
          skills: [
            {
              id: "pirate.grapeshot_barrage",
              name: "Grapeshot Barrage",
              description:
                "Unleashes a devastating spread of grapeshot that shreds all foes in a wide area.",
              maxLevel: 20,
              jobTier: 3,
              levelReq: 60,
              kind: "active",
              requires: [{ skillId: "pirate.scorch_shot", level: 5 }],
              mpCost: { base: 22, perLevel: 2 },
              cooldownMs: { base: 1400, perLevel: 0 },
              damagePercent: { base: 170, perLevel: 9 },
              hitCount: { base: 2, perLevel: 0 },
              targetCount: { base: 5, perLevel: 0 },
            },
            {
              id: "pirate.lock_and_load",
              name: "Lock and Load",
              description: "Buff: readies all firearms, boosting attack power for a duration.",
              maxLevel: 10,
              jobTier: 3,
              levelReq: 60,
              kind: "buff",
              requires: [{ skillId: "pirate.keen_sights", level: 5 }],
              mpCost: { base: 20, perLevel: 2 },
              cooldownMs: { base: 35000, perLevel: 0 },
              buffDurationMs: { base: 12000, perLevel: 500 },
              buffEffect: { atkPercent: 18 },
            },
          ],
        },
        {
          tier: 4,
          title: "Cannoneer",
          levelReq: 100,
          skills: [
            {
              id: "pirate.broadsider",
              name: "Broadsider",
              description:
                "A single cataclysmic shot from a ship-grade cannon. The signature Cannoneer technique.",
              maxLevel: 20,
              jobTier: 4,
              levelReq: 100,
              kind: "active",
              requires: [{ skillId: "pirate.grapeshot_barrage", level: 5 }],
              mpCost: { base: 40, perLevel: 3 },
              cooldownMs: { base: 2000, perLevel: 0 },
              damagePercent: { base: 320, perLevel: 16 },
              hitCount: { base: 1, perLevel: 0 },
              targetCount: { base: 1, perLevel: 0 },
            },
            {
              id: "pirate.megaton_volley",
              name: "Megaton Volley",
              description:
                "A relentless barrage of explosive rounds that obliterates all foes in a wide radius.",
              maxLevel: 20,
              jobTier: 4,
              levelReq: 100,
              kind: "active",
              requires: [{ skillId: "pirate.broadsider", level: 1 }],
              mpCost: { base: 38, perLevel: 3 },
              cooldownMs: { base: 1800, perLevel: 0 },
              damagePercent: { base: 180, perLevel: 10 },
              hitCount: { base: 2, perLevel: 0 },
              targetCount: { base: 4, perLevel: 0 },
            },
          ],
        },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// Registry + public helpers
// ═══════════════════════════════════════════════════════════════════════════════

export const CLASSES: Record<ClassArchetype, ClassDef> = {
  [ClassArchetype.BEGINNER]: BEGINNER,
  [ClassArchetype.WARRIOR]: WARRIOR,
  [ClassArchetype.MAGE]: MAGE,
  [ClassArchetype.ARCHER]: ARCHER,
  [ClassArchetype.THIEF]: THIEF,
  [ClassArchetype.PIRATE]: PIRATE,
};

export function getClass(archetype: ClassArchetype): ClassDef {
  return CLASSES[archetype];
}

/** Get the specialization branches for an archetype (empty array if none). */
export function getBranchesForArchetype(archetype: ClassArchetype): readonly JobBranch[] {
  return CLASSES[archetype].branches ?? [];
}

/** Look up a specific branch by id within an archetype. */
export function getBranch(archetype: ClassArchetype, branchId: string): JobBranch | undefined {
  return (CLASSES[archetype].branches ?? []).find((b) => b.id === branchId);
}

/** Max HP at a given level for a class (base + per-level growth). */
export function maxHpForLevel(archetype: ClassArchetype, level: number): number {
  return 50 + (level - 1) * CLASSES[archetype].hpGrowth;
}

/** Max MP at a given level for a class. */
export function maxMpForLevel(archetype: ClassArchetype, level: number): number {
  return 5 + (level - 1) * CLASSES[archetype].mpGrowth;
}

/**
 * The highest job tier a character of `level` is allowed to have advanced to (0 = none yet).
 * Checks both base jobTiers and branch tiers.
 */
export function unlockedJobTier(archetype: ClassArchetype, level: number): number {
  let unlocked = 0;
  const cls = CLASSES[archetype];
  for (const t of cls.jobTiers) {
    if (level >= t.levelReq) unlocked = t.tier;
  }
  for (const b of cls.branches ?? []) {
    for (const t of b.jobTiers) {
      if (level >= t.levelReq) unlocked = Math.max(unlocked, t.tier);
    }
  }
  return unlocked;
}

/**
 * Collect every SkillDef across all job tiers and branches for a class.
 * This is the canonical skill catalog used by the skillbook and tests.
 */
export function allSkillsForClass(archetype: ClassArchetype): readonly SkillDef[] {
  const cls = CLASSES[archetype];
  const base = cls.jobTiers.flatMap((t) => t.skills);
  const branchSkills = (cls.branches ?? []).flatMap((b) => b.jobTiers.flatMap((t) => t.skills));
  return [...base, ...branchSkills];
}

/** Flatten every SkillDef across all tiers within a single branch. */
export function allBranchSkills(branch: JobBranch): readonly SkillDef[] {
  return branch.jobTiers.flatMap((t) => t.skills);
}

/**
 * Return every skill in a branch the character is eligible to learn at `charLevel`.
 * Respects levelReq, prerequisite skills, and whether the branch tier is unlocked.
 * Does NOT enforce the branch-choice gate — use `learnSkill` for that.
 */
export function branchSkillsFor(
  archetype: ClassArchetype,
  branchId: string,
  charLevel: number,
  book: Record<string, number> = {},
): readonly SkillDef[] {
  const branch = getBranch(archetype, branchId);
  if (!branch) return [];
  const tier = unlockedJobTier(archetype, charLevel);
  return allBranchSkills(branch).filter((s) => {
    if (s.jobTier > tier) return false;
    if (charLevel < s.levelReq) return false;
    const current = book[s.id] ?? 0;
    if (current >= s.maxLevel) return false;
    if (s.requires) {
      if (!s.requires.every((r) => (book[r.skillId] ?? 0) >= r.level)) return false;
    }
    return true;
  });
}

/**
 * Find which branch owns a given skillId, or undefined for tier-1 (shared) skills.
 */
export function getSkillBranch(archetype: ClassArchetype, skillId: string): JobBranch | undefined {
  for (const branch of CLASSES[archetype].branches ?? []) {
    for (const tier of branch.jobTiers) {
      if (tier.skills.some((s) => s.id === skillId)) return branch;
    }
  }
  return undefined;
}

// ── Skill combat resolution ───────────────────────────────────────────────

/** Resolve a BasePerLevel at a given skill level (clamped to >= 0). */
function resolveBpl(bpl: BasePerLevel | undefined, level: number): number {
  if (!bpl) return 0;
  return Math.max(0, bpl.base + bpl.perLevel * (level - 1));
}

/** Resolve all combat stats for a skill at a given learned level. */
export function skillStatAt(skill: SkillDef, level: number): SkillCombatStats {
  return {
    mpCost: resolveBpl(skill.mpCost, level),
    cooldownMs: resolveBpl(skill.cooldownMs, level),
    damagePercent: resolveBpl(skill.damagePercent, level),
    hitCount: resolveBpl(skill.hitCount, level),
    targetCount: resolveBpl(skill.targetCount, level),
    buffDurationMs: resolveBpl(skill.buffDurationMs, level),
    buffEffect: skill.buffEffect,
    debuffEffect: skill.debuffEffect,
  };
}
