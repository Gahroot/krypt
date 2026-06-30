/**
 * Mobs — monster definitions + drop tables for all zones.
 *
 * A drop roll has two independent stages (both public + testable):
 *   1. Does an item drop at all?  (per-entry `chance`)
 *   2. If it drops, what Potential tier does it roll?  (rarity.rollPotential)
 * This mirrors MapleStory: most kills give mesos + maybe a common item; the rare god-roll is the
 * lottery on top.
 *
 * ## Boss combat
 *
 * Boss mobs (isBoss=true) carry `attackDamage` and `attackCooldownMs` fields that the
 * authoritative Colyseus server MUST use when scheduling boss auto-attacks:
 *   - `attackDamage` is the base hit the boss deals per attack.
 *   - `attackCooldownMs` is the minimum pause between attacks.
 * Boss drop tables use `minPotentialTier` to guarantee a quality floor and
 * `legendaryEligible` to flag items that may mint on-chain (Phase 2).
 */

import type { PotentialTier } from "./rarity.js";
import { familiarCardId, FAMILIAR_CARD_DROP_CHANCE } from "./familiars.js";

/**
 * Elemental affinity for mobs and skills.
 * Follows MapleStory's element triangle for mage targeting.
 */
export type Element =
  | "FIRE"
  | "ICE"
  | "LIGHTNING"
  | "POISON"
  | "HOLY"
  | "DARK"
  | "PHYSICAL"
  | "NONE";

/**
 * Map of attack-element → damage multiplier against this mob.
 * 0 = immune, 0.5 = resist, 1 = neutral (implicit), 1.5 = weak.
 * Any attack element *not* in this map defaults to 1.0 (neutral).
 */
export type ElementModsMap = Partial<Record<Element, number>>;

export interface DropTableEntry {
  readonly itemId: string;
  /** Probability in [0, 1] that this item drops per kill. */
  readonly chance: number;
  /**
   * Minimum Potential tier guaranteed when this item drops.
   * Only meaningful on boss loot — the authoritative server should apply this
   * floor when rolling potential for a boss kill so that even "bad" rolls are
   * still useful gear. Higher tiers are still rolled normally above this floor.
   */
  readonly minPotentialTier?: PotentialTier;
  /**
   * When true the item is eligible for on-chain minting if the rolled
   * Potential reaches LEGENDARY (Phase 2). The server must set this flag on
   * the resulting ItemInstance so the mint-hook can pick it up.
   */
  readonly legendaryEligible?: boolean;
}

export interface MobDef {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly maxHp: number;
  /** EXP granted on kill. */
  readonly exp: number;
  /** Mesos drop range (inclusive). */
  readonly mesosMin: number;
  readonly mesosMax: number;
  /** Movement speed in px/tick for server wander. */
  readonly speed: number;
  readonly dropTable: readonly DropTableEntry[];

  /** Physical defence — mitigates physical attack damage. */
  readonly wDef: number;
  /** Magical defence — mitigates magic attack damage. */
  readonly mDef: number;
  /** Avoidance (evasion) rating — reduces hit chance. */
  readonly avoid: number;

  /** Elemental affinity — determines which attacks are strong/weak. */
  readonly element: Element;
  /**
   * Damage multipliers from incoming attack elements.
   * Omitted entries default to 1.0 (neutral).
   */
  readonly elementMods?: ElementModsMap;

  // ── Boss-tier fields (optional) ─────────────────────────────────────
  /** True for dungeon / field bosses. The server uses this to gate encounter logic. */
  readonly isBoss?: boolean;
  /**
   * Base physical damage the boss deals per hit. The authoritative server
   * should use this value (with optional variance) when computing boss
   * attack damage against players.
   */
  readonly attackDamage?: number;
  /**
   * Minimum milliseconds between boss attacks. The authoritative server
   * should respect this cooldown when scheduling boss auto-attacks so that
   * the encounter pacing matches the intended difficulty.
   */
  readonly attackCooldownMs?: number;

  /** Named attack patterns for telegraphed multi-phase boss attacks. */
  readonly attackPatternIds?: readonly string[];
  /** Contact damage dealt when a player touches the boss. */
  readonly contactDamage?: number;
  /** AoE damage dealt by area attacks. */
  readonly aoeDamage?: number;
  /** Mob def ids to summon as adds during the encounter. */
  readonly summonAddIds?: readonly string[];
  /** Item id that, when used, summons this boss. */
  readonly summonItemId?: string;
  /** HP thresholds (fraction of maxHp, 0–1) that trigger phase transitions. */
  readonly phases?: readonly number[];
}

export const MOBS: Record<string, MobDef> = {
  // ── Dawn Isle starter mobs (Lv 1-3) ──────────────────────────────────
  // Mob EXP follows formula: 20 + floor(level²/6) for smooth kill-per-level pacing.
  // Non-boss mobs include a familiar card drop (2 % chance) — added below their existing drops.

  "mob.friendly_snail": {
    id: "mob.friendly_snail",
    name: "Friendly Snail",
    level: 1,
    maxHp: 10,
    exp: 21,
    mesosMin: 1,
    mesosMax: 3,
    speed: 0.2,
    element: "PHYSICAL",
    wDef: 0,
    mDef: 0,
    avoid: 0,
    dropTable: [{ itemId: "etc.snail_shell", chance: 0.3 }],
  },
  "mob.green_puff": {
    id: "mob.green_puff",
    name: "Green Puff",
    level: 2,
    maxHp: 20,
    exp: 21,
    mesosMin: 2,
    mesosMax: 6,
    speed: 0.4,
    element: "PHYSICAL",
    wDef: 1,
    mDef: 0,
    avoid: 0,
    dropTable: [{ itemId: "etc.green_puff_fiber", chance: 0.25 }],
  },
  "mob.dawn_shroom": {
    id: "mob.dawn_shroom",
    name: "Dawn Shroom",
    level: 3,
    maxHp: 30,
    exp: 21,
    mesosMin: 3,
    mesosMax: 10,
    speed: 0.5,
    element: "POISON",
    wDef: 1,
    mDef: 1,
    avoid: 0,
    dropTable: [{ itemId: "hat.leather_cap", chance: 0.02 }],
  },
  // ── Heartland Harbor mobs ─────────────────────────────────────────────
  "mob.dock_rat": {
    id: "mob.dock_rat",
    name: "Dock Rat",
    level: 4,
    maxHp: 45,
    exp: 23,
    mesosMin: 5,
    mesosMax: 15,
    speed: 0.6,
    element: "PHYSICAL",
    wDef: 3,
    mDef: 2,
    avoid: 3,
    dropTable: [
      { itemId: "etc.rat_whisker", chance: 0.25 },
      { itemId: "etc.cargo_manifest", chance: 0.1 },
      { itemId: "hat.leather_cap", chance: 0.03 },
      { itemId: "shoes.worn_boots", chance: 0.02 },
    ],
  },
  // ── Harbor Docks combat mobs (Lv 4–12) ─────────────────────────────
  "mob.barnacle_crab": {
    id: "mob.barnacle_crab",
    name: "Barnacle Crab",
    level: 5,
    maxHp: 55,
    exp: 24,
    mesosMin: 6,
    mesosMax: 18,
    speed: 0.4,
    element: "PHYSICAL",
    wDef: 6,
    mDef: 3,
    avoid: 2,
    dropTable: [
      { itemId: "etc.crab_claw", chance: 0.22 },
      { itemId: "hat.leather_cap", chance: 0.03 },
      { itemId: "shoes.worn_boots", chance: 0.03 },
    ],
  },
  "mob.harbor_gull": {
    id: "mob.harbor_gull",
    name: "Harbor Gull",
    level: 6,
    maxHp: 50,
    exp: 26,
    mesosMin: 8,
    mesosMax: 22,
    speed: 1.0,
    element: "PHYSICAL",
    wDef: 4,
    mDef: 4,
    avoid: 8,
    dropTable: [
      { itemId: "etc.gull_feather", chance: 0.2 },
      { itemId: "wpn.bronze_shortsword", chance: 0.03 },
    ],
  },
  "mob.deckhand_specter": {
    id: "mob.deckhand_specter",
    name: "Deckhand Specter",
    level: 8,
    maxHp: 75,
    exp: 30,
    mesosMin: 10,
    mesosMax: 28,
    speed: 0.7,
    element: "DARK",
    wDef: 6,
    mDef: 8,
    avoid: 5,
    dropTable: [
      { itemId: "etc.spectral_cloth", chance: 0.18 },
      { itemId: "hat.leather_cap", chance: 0.04 },
      { itemId: "wpn.bronze_shortsword", chance: 0.04 },
    ],
  },
  "mob.bilge_rat": {
    id: "mob.bilge_rat",
    name: "Bilge Rat",
    level: 10,
    maxHp: 95,
    exp: 37,
    mesosMin: 12,
    mesosMax: 32,
    speed: 0.8,
    element: "PHYSICAL",
    wDef: 8,
    mDef: 5,
    avoid: 6,
    dropTable: [
      { itemId: "etc.rat_whisker", chance: 0.22 },
      { itemId: "etc.cargo_manifest", chance: 0.08 },
      { itemId: "wpn.iron_broadsword", chance: 0.04 },
      { itemId: "top.traveler_jerkin", chance: 0.03 },
    ],
  },
  // ── Meadowfield mobs (Lv 2-12) ───────────────────────────────────────
  "mob.meadow_slime": {
    id: "mob.meadow_slime",
    name: "Meadow Slime",
    level: 2,
    maxHp: 30,
    exp: 21,
    mesosMin: 3,
    mesosMax: 12,
    speed: 0.5,
    element: "PHYSICAL",
    wDef: 0,
    mDef: 0,
    avoid: 0,
    dropTable: [
      { itemId: "wpn.bronze_shortsword", chance: 0.05 },
      { itemId: "hat.leather_cap", chance: 0.04 },
      { itemId: "etc.slime_jelly", chance: 0.2 },
    ],
  },
  "mob.thornback_hopper": {
    id: "mob.thornback_hopper",
    name: "Thornback Hopper",
    level: 6,
    maxHp: 70,
    exp: 26,
    mesosMin: 8,
    mesosMax: 25,
    speed: 0.9,
    element: "PHYSICAL",
    wDef: 5,
    mDef: 3,
    avoid: 4,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.03 },
      { itemId: "top.traveler_jerkin", chance: 0.05 },
      { itemId: "etc.hopper_thorn", chance: 0.18 },
    ],
  },
  "mob.mushroom": {
    id: "mob.mushroom",
    name: "Mushroom",
    level: 4,
    maxHp: 40,
    exp: 23,
    mesosMin: 4,
    mesosMax: 14,
    speed: 0.6,
    element: "POISON",
    wDef: 3,
    mDef: 3,
    avoid: 1,
    dropTable: [
      { itemId: "hat.leather_cap", chance: 0.03 },
      { itemId: "etc.mushroom_cap", chance: 0.2 },
    ],
  },
  "mob.crow": {
    id: "mob.crow",
    name: "Crow",
    level: 12,
    maxHp: 120,
    exp: 44,
    mesosMin: 15,
    mesosMax: 40,
    speed: 1.0,
    element: "DARK",
    wDef: 8,
    mDef: 6,
    avoid: 10,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.05 },
      { itemId: "top.traveler_jerkin", chance: 0.05 },
    ],
  },
  // ── Craghold mobs — rocky desert plateau (Lv 10–18) ────────────────────
  "mob.rock_lizard": {
    id: "mob.rock_lizard",
    name: "Rock Lizard",
    level: 10,
    maxHp: 100,
    exp: 37,
    mesosMin: 10,
    mesosMax: 30,
    speed: 0.7,
    element: "PHYSICAL",
    wDef: 14,
    mDef: 8,
    avoid: 5,
    dropTable: [
      { itemId: "wpn.bronze_shortsword", chance: 0.04 },
      { itemId: "hat.leather_cap", chance: 0.04 },
      { itemId: "shoes.worn_boots", chance: 0.03 },
      { itemId: "etc.lizard_scale", chance: 0.18 },
    ],
  },
  "mob.fossil_beetle": {
    id: "mob.fossil_beetle",
    name: "Fossil Beetle",
    level: 12,
    maxHp: 130,
    exp: 44,
    mesosMin: 14,
    mesosMax: 38,
    speed: 0.6,
    element: "PHYSICAL",
    wDef: 18,
    mDef: 10,
    avoid: 4,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.04 },
      { itemId: "hat.leather_cap", chance: 0.03 },
      { itemId: "shield.iron_buckler", chance: 0.03 },
      { itemId: "etc.beetle_shell", chance: 0.18 },
    ],
  },
  "mob.cliff_hawk": {
    id: "mob.cliff_hawk",
    name: "Cliff Hawk",
    level: 14,
    maxHp: 160,
    exp: 53,
    mesosMin: 18,
    mesosMax: 45,
    speed: 1.1,
    element: "PHYSICAL",
    wDef: 10,
    mDef: 8,
    avoid: 12,
    dropTable: [
      { itemId: "wpn.gale_bow", chance: 0.04 },
      { itemId: "cape.travelers_mantle", chance: 0.04 },
      { itemId: "shoes.worn_boots", chance: 0.03 },
      { itemId: "etc.hawk_feather", chance: 0.18 },
    ],
  },
  "mob.quarry_crab": {
    id: "mob.quarry_crab",
    name: "Quarry Crab",
    level: 16,
    maxHp: 200,
    exp: 63,
    mesosMin: 22,
    mesosMax: 55,
    speed: 0.5,
    element: "PHYSICAL",
    wDef: 22,
    mDef: 12,
    avoid: 3,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.05 },
      { itemId: "top.traveler_jerkin", chance: 0.04 },
      { itemId: "shoes.worn_boots", chance: 0.04 },
    ],
  },
  "mob.boulder_golem": {
    id: "mob.boulder_golem",
    name: "Boulder Golem",
    level: 18,
    maxHp: 260,
    exp: 74,
    mesosMin: 28,
    mesosMax: 70,
    speed: 0.4,
    element: "PHYSICAL",
    wDef: 30,
    mDef: 15,
    avoid: 2,
    dropTable: [
      { itemId: "wpn.oak_maul", chance: 0.05 },
      { itemId: "shield.iron_buckler", chance: 0.05 },
      { itemId: "hat.leather_cap", chance: 0.04 },
    ],
  },
  // ── Sylvanreach mobs — treetop forest (Lv 10–17) ───────────────────────
  "mob.forest_wisp": {
    id: "mob.forest_wisp",
    name: "Forest Wisp",
    level: 10,
    maxHp: 90,
    exp: 37,
    mesosMin: 8,
    mesosMax: 25,
    speed: 0.8,
    element: "ICE",
    wDef: 6,
    mDef: 14,
    avoid: 6,
    dropTable: [
      { itemId: "wpn.oakwood_staff", chance: 0.03 },
      { itemId: "hat.woven_circlet", chance: 0.03 },
      { itemId: "etc.wisp_dust", chance: 0.2 },
    ],
  },
  "mob.canopy_moth": {
    id: "mob.canopy_moth",
    name: "Canopy Moth",
    level: 12,
    maxHp: 110,
    exp: 44,
    mesosMin: 12,
    mesosMax: 32,
    speed: 1.0,
    element: "PHYSICAL",
    wDef: 8,
    mDef: 8,
    avoid: 9,
    dropTable: [
      { itemId: "wpn.gale_bow", chance: 0.03 },
      { itemId: "hat.leather_cap", chance: 0.04 },
      { itemId: "etc.moth_wing", chance: 0.18 },
    ],
  },
  "mob.bark_spider": {
    id: "mob.bark_spider",
    name: "Bark Spider",
    level: 14,
    maxHp: 140,
    exp: 53,
    mesosMin: 15,
    mesosMax: 40,
    speed: 0.7,
    element: "POISON",
    wDef: 12,
    mDef: 14,
    avoid: 7,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.04 },
      { itemId: "top.traveler_jerkin", chance: 0.04 },
      { itemId: "shoes.worn_boots", chance: 0.03 },
      { itemId: "etc.spider_silk", chance: 0.18 },
    ],
  },
  "mob.root_crawler": {
    id: "mob.root_crawler",
    name: "Root Crawler",
    level: 15,
    maxHp: 170,
    exp: 58,
    mesosMin: 18,
    mesosMax: 45,
    speed: 0.6,
    element: "POISON",
    wDef: 18,
    mDef: 12,
    avoid: 5,
    dropTable: [
      { itemId: "wpn.oak_maul", chance: 0.04 },
      { itemId: "shield.iron_buckler", chance: 0.03 },
      { itemId: "hat.leather_cap", chance: 0.04 },
    ],
  },
  "mob.sylvan_sprite": {
    id: "mob.sylvan_sprite",
    name: "Sylvan Sprite",
    level: 17,
    maxHp: 210,
    exp: 68,
    mesosMin: 22,
    mesosMax: 55,
    speed: 0.9,
    element: "ICE",
    wDef: 8,
    mDef: 18,
    avoid: 8,
    dropTable: [
      { itemId: "wpn.frostwick", chance: 0.04 },
      { itemId: "hat.woven_circlet", chance: 0.04 },
      { itemId: "cape.travelers_mantle", chance: 0.03 },
    ],
  },
  // ── Dusk Ward mobs — neon night city / subway / backalley (Lv 10–19) ──
  "mob.neon_rat": {
    id: "mob.neon_rat",
    name: "Neon Rat",
    level: 10,
    maxHp: 85,
    exp: 37,
    mesosMin: 8,
    mesosMax: 22,
    speed: 1.0,
    element: "PHYSICAL",
    wDef: 8,
    mDef: 6,
    avoid: 8,
    dropTable: [
      { itemId: "wpn.nightfang_dagger", chance: 0.03 },
      { itemId: "shoes.worn_boots", chance: 0.03 },
      { itemId: "etc.neon_tag", chance: 0.18 },
    ],
  },
  "mob.tunnel_bat": {
    id: "mob.tunnel_bat",
    name: "Tunnel Bat",
    level: 11,
    maxHp: 100,
    exp: 40,
    mesosMin: 10,
    mesosMax: 28,
    speed: 1.2,
    element: "DARK",
    wDef: 6,
    mDef: 8,
    avoid: 10,
    dropTable: [
      { itemId: "wpn.hardwood_crossbow", chance: 0.03 },
      { itemId: "hat.leather_cap", chance: 0.04 },
      { itemId: "etc.bat_wing", chance: 0.18 },
    ],
  },
  "mob.spark_drone": {
    id: "mob.spark_drone",
    name: "Spark Drone",
    level: 13,
    maxHp: 130,
    exp: 49,
    mesosMin: 14,
    mesosMax: 36,
    speed: 0.8,
    element: "LIGHTNING",
    wDef: 12,
    mDef: 14,
    avoid: 6,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.04 },
      { itemId: "top.traveler_jerkin", chance: 0.04 },
    ],
  },
  "mob.rail_sentinel": {
    id: "mob.rail_sentinel",
    name: "Rail Sentinel",
    level: 15,
    maxHp: 160,
    exp: 58,
    mesosMin: 18,
    mesosMax: 44,
    speed: 0.6,
    element: "LIGHTNING",
    wDef: 20,
    mDef: 16,
    avoid: 4,
    dropTable: [
      { itemId: "wpn.oak_maul", chance: 0.04 },
      { itemId: "shield.iron_buckler", chance: 0.03 },
      { itemId: "hat.leather_cap", chance: 0.04 },
    ],
  },
  "mob.shadow_thug": {
    id: "mob.shadow_thug",
    name: "Shadow Thug",
    level: 16,
    maxHp: 190,
    exp: 63,
    mesosMin: 20,
    mesosMax: 50,
    speed: 0.7,
    element: "DARK",
    wDef: 14,
    mDef: 14,
    avoid: 9,
    dropTable: [
      { itemId: "wpn.nightfang_dagger", chance: 0.05 },
      { itemId: "cape.travelers_mantle", chance: 0.04 },
      { itemId: "top.traveler_jerkin", chance: 0.04 },
    ],
  },
  "mob.neon_spider": {
    id: "mob.neon_spider",
    name: "Neon Spider",
    level: 17,
    maxHp: 220,
    exp: 68,
    mesosMin: 24,
    mesosMax: 58,
    speed: 0.9,
    element: "POISON",
    wDef: 14,
    mDef: 18,
    avoid: 8,
    dropTable: [
      { itemId: "wpn.ember_wand", chance: 0.04 },
      { itemId: "hat.woven_circlet", chance: 0.04 },
      { itemId: "top.traveler_jerkin", chance: 0.03 },
    ],
  },
  "mob.arc_wraith": {
    id: "mob.arc_wraith",
    name: "Arc Wraith",
    level: 19,
    maxHp: 270,
    exp: 82,
    mesosMin: 28,
    mesosMax: 70,
    speed: 0.8,
    element: "DARK",
    wDef: 10,
    mDef: 22,
    avoid: 10,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.05 },
      { itemId: "top.traveler_jerkin", chance: 0.05 },
      { itemId: "shoes.worn_boots", chance: 0.04 },
    ],
  },

  // ── Dusk Ward Subway PQ mobs (Lv 20–28) ──────────────────────────────
  "mob.subway_horror": {
    id: "mob.subway_horror",
    name: "Subway Horror",
    level: 20,
    maxHp: 300,
    exp: 87,
    mesosMin: 30,
    mesosMax: 75,
    speed: 0.6,
    element: "DARK",
    wDef: 18,
    mDef: 22,
    avoid: 8,
    dropTable: [{ itemId: "item.subway_pass", chance: 0.35 }],
  },
  "mob.subway_overseer": {
    id: "mob.subway_overseer",
    name: "Subway Overseer",
    level: 24,
    maxHp: 420,
    exp: 116,
    mesosMin: 40,
    mesosMax: 100,
    speed: 0.7,
    element: "DARK",
    wDef: 24,
    mDef: 28,
    avoid: 10,
    dropTable: [{ itemId: "item.subway_pass", chance: 0.45 }],
  },
  // ── BOSS — Dusk Ward Subway PQ boss ────────────────────────────────
  "mob.subway_curse_eye": {
    id: "mob.subway_curse_eye",
    name: "Gaze of the Abyss",
    level: 28,
    maxHp: 4500,
    exp: 1500,
    mesosMin: 150,
    mesosMax: 400,
    speed: 0.5,
    element: "DARK",
    elementMods: { DARK: 0, HOLY: 1.5 },
    wDef: 35,
    mDef: 40,
    avoid: 18,
    isBoss: true,
    attackDamage: 90,
    attackCooldownMs: 1200,
    attackPatternIds: ["dark_slam", "curse_cloud", "abyssal_roar"],
    contactDamage: 50,
    aoeDamage: 65,
    summonAddIds: ["mob.subway_horror", "mob.tunnel_bat"],
    phases: [0.5, 0.25],
    dropTable: [
      {
        itemId: "top.pq_subway_vest",
        chance: 0.3,
        minPotentialTier: "RARE" as PotentialTier,
        legendaryEligible: true,
      },
      { itemId: "hat.iron_crest_helm", chance: 0.1 },
      { itemId: "shoes.steel_toed_greaves", chance: 0.1 },
      { itemId: "cape.ironbound_cape", chance: 0.1 },
    ],
  },

  // ── Mirefen swamp mobs (Lv 20–30) ─────────────────────────────────────
  "mob.bog_lurker": {
    id: "mob.bog_lurker",
    name: "Bog Lurker",
    level: 20,
    maxHp: 350,
    exp: 87,
    mesosMin: 35,
    mesosMax: 90,
    speed: 0.6,
    element: "POISON",
    wDef: 22,
    mDef: 18,
    avoid: 8,
    dropTable: [
      { itemId: "wpn.steel_fang", chance: 0.05 },
      { itemId: "hat.iron_crest_helm", chance: 0.04 },
      { itemId: "top.chainmail_tunic", chance: 0.04 },
      { itemId: "etc.bog_sample", chance: 0.15 },
    ],
  },
  "mob.mire_toad": {
    id: "mob.mire_toad",
    name: "Mire Toad",
    level: 22,
    maxHp: 420,
    exp: 101,
    mesosMin: 40,
    mesosMax: 100,
    speed: 0.5,
    element: "POISON",
    wDef: 26,
    mDef: 20,
    avoid: 6,
    dropTable: [
      { itemId: "wpn.frostwick", chance: 0.04 },
      { itemId: "bottom.steel_chausses", chance: 0.04 },
      { itemId: "shoes.ironclad_sabatons", chance: 0.03 },
    ],
  },
  "mob.ruins_sentinel": {
    id: "mob.ruins_sentinel",
    name: "Ruins Sentinel",
    level: 25,
    maxHp: 550,
    exp: 125,
    mesosMin: 50,
    mesosMax: 130,
    speed: 0.7,
    element: "DARK",
    wDef: 32,
    mDef: 24,
    avoid: 8,
    dropTable: [
      { itemId: "wpn.iron_bell", chance: 0.05 },
      { itemId: "hat.iron_crest_helm", chance: 0.04 },
      { itemId: "shoes.ironclad_sabatons", chance: 0.04 },
      { itemId: "etc.ruins_tablet", chance: 0.12 },
    ],
  },
  "mob.moss_wraith": {
    id: "mob.moss_wraith",
    name: "Moss Wraith",
    level: 27,
    maxHp: 640,
    exp: 141,
    mesosMin: 55,
    mesosMax: 140,
    speed: 0.8,
    element: "POISON",
    wDef: 24,
    mDef: 30,
    avoid: 10,
    dropTable: [
      { itemId: "wpn.shadow_fang", chance: 0.05 },
      { itemId: "hat.rogue_cowl", chance: 0.04 },
      { itemId: "cape.wardens_cloak", chance: 0.04 },
    ],
  },
  "mob.ruins_horror": {
    id: "mob.ruins_horror",
    name: "Ruins Horror",
    level: 28,
    maxHp: 720,
    exp: 151,
    mesosMin: 60,
    mesosMax: 150,
    speed: 0.7,
    element: "DARK",
    wDef: 28,
    mDef: 32,
    avoid: 8,
    dropTable: [
      { itemId: "wpn.shadow_fang", chance: 0.05 },
      { itemId: "hat.rogue_cowl", chance: 0.04 },
      { itemId: "cape.wardens_cloak", chance: 0.04 },
    ],
  },
  "mob.deep_swamp_thing": {
    id: "mob.deep_swamp_thing",
    name: "Deep Swamp Thing",
    level: 29,
    maxHp: 810,
    exp: 161,
    mesosMin: 65,
    mesosMax: 165,
    speed: 0.6,
    element: "POISON",
    wDef: 34,
    mDef: 28,
    avoid: 7,
    dropTable: [
      { itemId: "wpn.shadow_fang", chance: 0.06 },
      { itemId: "hat.rogue_cowl", chance: 0.05 },
      { itemId: "cape.wardens_cloak", chance: 0.04 },
    ],
  },
  // ── BOSS — Mirefen Ruins dungeon boss ──────────────────────────────
  "mob.bogmaw": {
    id: "mob.bogmaw",
    name: "Bogmaw, the Ruin Behemoth",
    level: 30,
    maxHp: 5500,
    exp: 2000,
    mesosMin: 200,
    mesosMax: 500,
    speed: 0.4,
    element: "POISON",
    wDef: 45,
    mDef: 42,
    avoid: 18,
    isBoss: true,
    attackDamage: 110,
    attackCooldownMs: 1500,
    attackPatternIds: ["toxic_slam", "bog_cloud", "mire_roar"],
    contactDamage: 60,
    aoeDamage: 80,
    summonAddIds: ["mob.bog_lurker", "mob.mire_toad"],
    phases: [0.5, 0.25],
    dropTable: [
      { itemId: "wpn.crimson_edge", chance: 0.15, legendaryEligible: true },
      { itemId: "wpn.iron_bell", chance: 0.12, legendaryEligible: true },
      { itemId: "wpn.shadow_fang", chance: 0.12, legendaryEligible: true },
      { itemId: "wpn.frostwick", chance: 0.1, legendaryEligible: true },
      { itemId: "hat.steel_vanguard", chance: 0.14, minPotentialTier: "EPIC" as PotentialTier },
      { itemId: "hat.iron_crest_helm", chance: 0.12, minPotentialTier: "EPIC" as PotentialTier },
      { itemId: "top.plate_cuirass", chance: 0.12, minPotentialTier: "EPIC" as PotentialTier },
      { itemId: "bottom.steel_chausses", chance: 0.1, minPotentialTier: "EPIC" as PotentialTier },
      { itemId: "shoes.ironclad_sabatons", chance: 0.1, minPotentialTier: "EPIC" as PotentialTier },
      { itemId: "shield.reinforced_targe", chance: 0.1, minPotentialTier: "EPIC" as PotentialTier },
    ],
  },

  // ── Skyhaven Driftpeaks mobs — floating sky islands (Lv 30–40) ─────────
  // Expansion mobs give significantly more EXP to match the steeper Lv 30+ curve.
  "mob.wind_sprite": {
    id: "mob.wind_sprite",
    name: "Wind Sprite",
    level: 30,
    maxHp: 750,
    exp: 600,
    mesosMin: 70,
    mesosMax: 180,
    speed: 1.1,
    element: "LIGHTNING",
    wDef: 24,
    mDef: 30,
    avoid: 18,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.06 },
      { itemId: "top.traveler_jerkin", chance: 0.06 },
      { itemId: "etc.sky_crystal", chance: 0.15 },
    ],
  },
  "mob.sky_serpent": {
    id: "mob.sky_serpent",
    name: "Sky Serpent",
    level: 34,
    maxHp: 1000,
    exp: 700,
    mesosMin: 90,
    mesosMax: 230,
    speed: 0.9,
    element: "LIGHTNING",
    wDef: 30,
    mDef: 35,
    avoid: 16,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.06 },
      { itemId: "top.traveler_jerkin", chance: 0.06 },
      { itemId: "etc.serpent_scale", chance: 0.15 },
    ],
  },
  "mob.thunder_hawk": {
    id: "mob.thunder_hawk",
    name: "Thunder Hawk",
    level: 38,
    maxHp: 1350,
    exp: 800,
    mesosMin: 110,
    mesosMax: 290,
    speed: 1.3,
    element: "LIGHTNING",
    wDef: 28,
    mDef: 38,
    avoid: 22,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.07 },
      { itemId: "top.traveler_jerkin", chance: 0.07 },
    ],
  },

  // ── BOSS — Skyhaven Driftpeaks field boss ──────────────────────────
  "mob.tempest_lord": {
    id: "mob.tempest_lord",
    name: "Tempest Lord, the Storm Titan",
    level: 40,
    maxHp: 15000,
    exp: 9000,
    mesosMin: 380,
    mesosMax: 850,
    speed: 0.6,
    element: "LIGHTNING",
    elementMods: { LIGHTNING: 0, ICE: 1.5, PHYSICAL: 1.5 },
    wDef: 55,
    mDef: 65,
    avoid: 28,
    isBoss: true,
    attackDamage: 250,
    attackCooldownMs: 2200,
    attackPatternIds: ["storm_slam", "chain_lightning", "gale_roar"],
    contactDamage: 110,
    aoeDamage: 180,
    summonAddIds: ["mob.thunder_hawk", "mob.sky_serpent"],
    phases: [0.5, 0.25],
    dropTable: [
      { itemId: "wpn.solstice_blade", chance: 0.14, legendaryEligible: true },
      { itemId: "wpn.earthcrusher", chance: 0.14, legendaryEligible: true },
      { itemId: "wpn.celestine_rod", chance: 0.12, legendaryEligible: true },
      { itemId: "wpn.skyfire_longbow", chance: 0.12, legendaryEligible: true },
      { itemId: "wpn.siege_arbalest", chance: 0.12, legendaryEligible: true },
      { itemId: "wpn.soulreaver", chance: 0.1, legendaryEligible: true },
      { itemId: "hat.dragonbone_crown", chance: 0.14, minPotentialTier: "UNIQUE" as PotentialTier },
      {
        itemId: "top.ironwrought_mantle",
        chance: 0.12,
        minPotentialTier: "UNIQUE" as PotentialTier,
      },
      {
        itemId: "bottom.dragonscale_tassets",
        chance: 0.1,
        minPotentialTier: "EPIC" as PotentialTier,
      },
      {
        itemId: "shoes.dragonscale_treads",
        chance: 0.1,
        minPotentialTier: "EPIC" as PotentialTier,
      },
      { itemId: "cape.dragonscale_cloak", chance: 0.1, minPotentialTier: "EPIC" as PotentialTier },
    ],
  },

  // ── Frosthold Slopes mobs — snow mountain blizzard (Lv 35–45) ──────────
  "mob.frost_wolf": {
    id: "mob.frost_wolf",
    name: "Frost Wolf",
    level: 35,
    maxHp: 1100,
    exp: 750,
    mesosMin: 85,
    mesosMax: 210,
    speed: 1.2,
    element: "ICE",
    wDef: 35,
    mDef: 28,
    avoid: 20,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.06 },
      { itemId: "top.traveler_jerkin", chance: 0.06 },
      { itemId: "etc.frost_fang", chance: 0.15 },
    ],
  },
  "mob.ice_elemental": {
    id: "mob.ice_elemental",
    name: "Ice Elemental",
    level: 38,
    maxHp: 1400,
    exp: 800,
    mesosMin: 100,
    mesosMax: 260,
    speed: 0.7,
    element: "ICE",
    elementMods: { ICE: 0, FIRE: 1.5, LIGHTNING: 1.5 },
    wDef: 25,
    mDef: 42,
    avoid: 14,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.07 },
      { itemId: "top.traveler_jerkin", chance: 0.07 },
      { itemId: "etc.ice_shard", chance: 0.15 },
    ],
  },
  "mob.snow_wraith": {
    id: "mob.snow_wraith",
    name: "Snow Wraith",
    level: 42,
    maxHp: 1800,
    exp: 900,
    mesosMin: 130,
    mesosMax: 330,
    speed: 0.9,
    element: "ICE",
    wDef: 30,
    mDef: 45,
    avoid: 18,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.07 },
      { itemId: "top.traveler_jerkin", chance: 0.07 },
      { itemId: "etc.frozen_heart", chance: 0.1 },
    ],
  },
  // ── BOSS — Frosthold Slopes field boss ─────────────────────────────
  "mob.glacius_prime": {
    id: "mob.glacius_prime",
    name: "Glacius Prime, the Frost Titan",
    level: 45,
    maxHp: 12000,
    exp: 8000,
    mesosMin: 350,
    mesosMax: 800,
    speed: 0.5,
    element: "ICE",
    elementMods: { ICE: 0, FIRE: 1.5, LIGHTNING: 1.5 },
    wDef: 65,
    mDef: 60,
    avoid: 30,
    isBoss: true,
    attackDamage: 220,
    attackCooldownMs: 2000,
    attackPatternIds: ["frost_slam", "blizzard_cloud", "glacial_roar"],
    contactDamage: 100,
    aoeDamage: 160,
    summonAddIds: ["mob.frost_wolf", "mob.ice_elemental"],
    phases: [0.5, 0.25],
    dropTable: [
      { itemId: "wpn.solstice_blade", chance: 0.14, legendaryEligible: true },
      { itemId: "wpn.earthcrusher", chance: 0.14, legendaryEligible: true },
      { itemId: "wpn.celestine_rod", chance: 0.12, legendaryEligible: true },
      { itemId: "wpn.skyfire_longbow", chance: 0.12, legendaryEligible: true },
      { itemId: "wpn.siege_arbalest", chance: 0.12, legendaryEligible: true },
      { itemId: "wpn.soulreaver", chance: 0.1, legendaryEligible: true },
      { itemId: "wpn.phantom_grasp", chance: 0.1, legendaryEligible: true },
      { itemId: "wpn.hellion_cannon", chance: 0.1, legendaryEligible: true },
      { itemId: "wpn.titan_grip", chance: 0.1, legendaryEligible: true },
      { itemId: "hat.dragonbone_crown", chance: 0.14, minPotentialTier: "UNIQUE" as PotentialTier },
      {
        itemId: "top.ironwrought_mantle",
        chance: 0.12,
        minPotentialTier: "UNIQUE" as PotentialTier,
      },
      {
        itemId: "bottom.dragonscale_tassets",
        chance: 0.1,
        minPotentialTier: "EPIC" as PotentialTier,
      },
      {
        itemId: "shoes.dragonscale_treads",
        chance: 0.1,
        minPotentialTier: "EPIC" as PotentialTier,
      },
      {
        itemId: "shield.ironwrought_aegis",
        chance: 0.1,
        minPotentialTier: "EPIC" as PotentialTier,
      },
      { itemId: "cape.dragonscale_cloak", chance: 0.1, minPotentialTier: "EPIC" as PotentialTier },
    ],
  },

  // ── Frosthold Icecave mobs — underground ice cavern (Lv 40–65) ─────────
  "mob.frost_crawler": {
    id: "mob.frost_crawler",
    name: "Frost Crawler",
    level: 40,
    maxHp: 1600,
    exp: 800,
    mesosMin: 120,
    mesosMax: 300,
    speed: 0.6,
    element: "ICE",
    wDef: 42,
    mDef: 35,
    avoid: 14,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.07 },
      { itemId: "top.traveler_jerkin", chance: 0.07 },
    ],
  },
  "mob.crystal_guardian": {
    id: "mob.crystal_guardian",
    name: "Crystal Guardian",
    level: 44,
    maxHp: 2100,
    exp: 950,
    mesosMin: 150,
    mesosMax: 380,
    speed: 0.8,
    element: "ICE",
    wDef: 55,
    mDef: 40,
    avoid: 12,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.08 },
      { itemId: "top.traveler_jerkin", chance: 0.08 },
    ],
  },
  "mob.glacial_shard": {
    id: "mob.glacial_shard",
    name: "Glacial Shard",
    level: 50,
    maxHp: 2800,
    exp: 1100,
    mesosMin: 180,
    mesosMax: 450,
    speed: 0.6,
    element: "ICE",
    wDef: 60,
    mDef: 50,
    avoid: 16,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.08 },
      { itemId: "top.traveler_jerkin", chance: 0.08 },
    ],
  },
  "mob.permafrost_revenant": {
    id: "mob.permafrost_revenant",
    name: "Permafrost Revenant",
    level: 55,
    maxHp: 3500,
    exp: 1300,
    mesosMin: 200,
    mesosMax: 520,
    speed: 0.7,
    element: "ICE",
    elementMods: { ICE: 0, FIRE: 1.5, LIGHTNING: 1.5 },
    wDef: 55,
    mDef: 60,
    avoid: 18,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.09 },
      { itemId: "top.traveler_jerkin", chance: 0.09 },
    ],
  },
  "mob.frost_banshee": {
    id: "mob.frost_banshee",
    name: "Frost Banshee",
    level: 60,
    maxHp: 4200,
    exp: 1500,
    mesosMin: 230,
    mesosMax: 600,
    speed: 0.9,
    element: "ICE",
    wDef: 48,
    mDef: 65,
    avoid: 22,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.1 },
      { itemId: "top.traveler_jerkin", chance: 0.1 },
    ],
  },
  // ── BOSS — Frosthold Icecave dungeon boss ──────────────────────────
  "mob.glacial_abomination": {
    id: "mob.glacial_abomination",
    name: "Glacial Abomination",
    level: 50,
    maxHp: 18000,
    exp: 10000,
    mesosMin: 450,
    mesosMax: 1000,
    speed: 0.4,
    element: "ICE",
    elementMods: { ICE: 0, FIRE: 1.5, LIGHTNING: 1.5 },
    wDef: 80,
    mDef: 75,
    avoid: 28,
    isBoss: true,
    attackDamage: 310,
    attackCooldownMs: 2500,
    attackPatternIds: ["ice_slam", "frost_cloud", "abyssal_roar", "frozen_slam"],
    contactDamage: 140,
    aoeDamage: 220,
    summonAddIds: ["mob.crystal_guardian", "mob.glacial_shard"],
    phases: [0.5, 0.25],
    dropTable: [
      { itemId: "wpn.voidcleaver", chance: 0.14, legendaryEligible: true },
      { itemId: "wpn.titans_grudge", chance: 0.14, legendaryEligible: true },
      { itemId: "wpn.voidspire", chance: 0.12, legendaryEligible: true },
      { itemId: "wpn.zephyrs_reach", chance: 0.12, legendaryEligible: true },
      { itemId: "wpn.harbinger", chance: 0.12, legendaryEligible: true },
      { itemId: "wpn.eclipse_blade", chance: 0.1, legendaryEligible: true },
      { itemId: "wpn.abyssal_rake", chance: 0.1, legendaryEligible: true },
      { itemId: "wpn.leviathans_roar", chance: 0.1, legendaryEligible: true },
      { itemId: "wpn.devastator", chance: 0.1, legendaryEligible: true },
      {
        itemId: "hat.obsidian_greathelm",
        chance: 0.14,
        minPotentialTier: "UNIQUE" as PotentialTier,
      },
      { itemId: "hat.arcane_diadem", chance: 0.14, minPotentialTier: "UNIQUE" as PotentialTier },
      {
        itemId: "top.dragonscale_aegis",
        chance: 0.12,
        minPotentialTier: "UNIQUE" as PotentialTier,
      },
      {
        itemId: "bottom.obsidian_cuisses",
        chance: 0.1,
        minPotentialTier: "UNIQUE" as PotentialTier,
      },
      {
        itemId: "shoes.obsidian_stalkers",
        chance: 0.1,
        minPotentialTier: "UNIQUE" as PotentialTier,
      },
      {
        itemId: "shield.obsidian_citadel",
        chance: 0.1,
        minPotentialTier: "UNIQUE" as PotentialTier,
      },
      { itemId: "cape.obsidian_shroud", chance: 0.1, minPotentialTier: "UNIQUE" as PotentialTier },
    ],
  },

  // ── Tideways mobs — underwater / Aqua Road parallel (Lv 35–55) ─────────
  "mob.reef_jellyfish": {
    id: "mob.reef_jellyfish",
    name: "Reef Jellyfish",
    level: 35,
    maxHp: 1200,
    exp: 750,
    mesosMin: 90,
    mesosMax: 230,
    speed: 0.6,
    element: "ICE",
    wDef: 20,
    mDef: 35,
    avoid: 15,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.06 },
      { itemId: "top.traveler_jerkin", chance: 0.06 },
      { itemId: "etc.jelly_tentacle", chance: 0.18 },
    ],
  },
  "mob.sea_urchin": {
    id: "mob.sea_urchin",
    name: "Sea Urchin",
    level: 38,
    maxHp: 1400,
    exp: 800,
    mesosMin: 100,
    mesosMax: 260,
    speed: 0.4,
    element: "PHYSICAL",
    wDef: 40,
    mDef: 25,
    avoid: 8,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.07 },
      { itemId: "shield.iron_buckler", chance: 0.04 },
      { itemId: "etc.urchin_spine", chance: 0.18 },
    ],
  },
  "mob.pufferfish": {
    id: "mob.pufferfish",
    name: "Pufferfish",
    level: 40,
    maxHp: 1600,
    exp: 850,
    mesosMin: 110,
    mesosMax: 280,
    speed: 0.7,
    element: "PHYSICAL",
    wDef: 30,
    mDef: 30,
    avoid: 12,
    contactDamage: 15,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.07 },
      { itemId: "top.traveler_jerkin", chance: 0.07 },
      { itemId: "etc.puffer_spine", chance: 0.15 },
    ],
  },
  "mob.anglerfish": {
    id: "mob.anglerfish",
    name: "Anglerfish",
    level: 45,
    maxHp: 2200,
    exp: 1000,
    mesosMin: 140,
    mesosMax: 350,
    speed: 0.8,
    element: "DARK",
    wDef: 35,
    mDef: 40,
    avoid: 14,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.08 },
      { itemId: "top.traveler_jerkin", chance: 0.08 },
      { itemId: "etc.lure_light", chance: 0.15 },
    ],
  },
  "mob.tiger_shark": {
    id: "mob.tiger_shark",
    name: "Tiger Shark",
    level: 50,
    maxHp: 3000,
    exp: 1200,
    mesosMin: 170,
    mesosMax: 430,
    speed: 1.1,
    element: "PHYSICAL",
    wDef: 45,
    mDef: 35,
    avoid: 18,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.09 },
      { itemId: "top.traveler_jerkin", chance: 0.09 },
      { itemId: "etc.shark_tooth", chance: 0.15 },
    ],
  },
  "mob.sea_serpent": {
    id: "mob.sea_serpent",
    name: "Sea Serpent",
    level: 55,
    maxHp: 3800,
    exp: 1400,
    mesosMin: 200,
    mesosMax: 500,
    speed: 0.9,
    element: "ICE",
    wDef: 40,
    mDef: 50,
    avoid: 20,
    dropTable: [
      { itemId: "wpn.iron_broadsword", chance: 0.1 },
      { itemId: "top.traveler_jerkin", chance: 0.1 },
      { itemId: "etc.serpen_scale", chance: 0.12 },
    ],
  },
  // ── BOSS — Tideways Abyss boss ───────────────────────────────────────
  "mob.kraken": {
    id: "mob.kraken",
    name: "The Kraken, Abyssal Terror",
    level: 55,
    maxHp: 25000,
    exp: 15000,
    mesosMin: 500,
    mesosMax: 1100,
    speed: 0.4,
    element: "ICE",
    elementMods: { ICE: 0, FIRE: 1.5, LIGHTNING: 1.5 },
    wDef: 75,
    mDef: 80,
    avoid: 30,
    isBoss: true,
    attackDamage: 350,
    attackCooldownMs: 2500,
    attackPatternIds: ["ink_slam", "tentacle_sweep", "abyssal_roar", "crushing_grip"],
    contactDamage: 150,
    aoeDamage: 250,
    summonAddIds: ["mob.anglerfish", "mob.tiger_shark"],
    phases: [0.5, 0.25],
    dropTable: [
      { itemId: "wpn.voidcleaver", chance: 0.14, legendaryEligible: true },
      { itemId: "wpn.titans_grudge", chance: 0.14, legendaryEligible: true },
      { itemId: "wpn.voidspire", chance: 0.12, legendaryEligible: true },
      { itemId: "wpn.zephyrs_reach", chance: 0.12, legendaryEligible: true },
      { itemId: "wpn.harbinger", chance: 0.12, legendaryEligible: true },
      { itemId: "wpn.eclipse_blade", chance: 0.1, legendaryEligible: true },
      { itemId: "wpn.abyssal_rake", chance: 0.1, legendaryEligible: true },
      { itemId: "wpn.leviathans_roar", chance: 0.1, legendaryEligible: true },
      { itemId: "wpn.devastator", chance: 0.1, legendaryEligible: true },
      {
        itemId: "hat.obsidian_greathelm",
        chance: 0.14,
        minPotentialTier: "UNIQUE" as PotentialTier,
      },
      { itemId: "hat.arcane_diadem", chance: 0.14, minPotentialTier: "UNIQUE" as PotentialTier },
      {
        itemId: "top.dragonscale_aegis",
        chance: 0.12,
        minPotentialTier: "UNIQUE" as PotentialTier,
      },
      {
        itemId: "bottom.obsidian_cuisses",
        chance: 0.1,
        minPotentialTier: "UNIQUE" as PotentialTier,
      },
      {
        itemId: "shoes.obsidian_stalkers",
        chance: 0.1,
        minPotentialTier: "UNIQUE" as PotentialTier,
      },
      {
        itemId: "shield.obsidian_citadel",
        chance: 0.1,
        minPotentialTier: "UNIQUE" as PotentialTier,
      },
      { itemId: "cape.obsidian_shroud", chance: 0.1, minPotentialTier: "UNIQUE" as PotentialTier },
    ],
  },

  // ── Drakemoor mobs — dragon jungle, first true endgame (Lv 90–120) ──────
  // Dense, powerful jungle/dragon creatures. These are the first mobs that
  // genuinely threaten a geared party. Fire and poison dominate the element palette.

  "mob.jungle_viper": {
    id: "mob.jungle_viper",
    name: "Jungle Viper",
    level: 90,
    maxHp: 18000,
    exp: 12000,
    mesosMin: 400,
    mesosMax: 950,
    speed: 1.4,
    element: "POISON",
    wDef: 120,
    mDef: 80,
    avoid: 45,
    dropTable: [
      { itemId: "wpn.voidcleaver", chance: 0.1, legendaryEligible: true },
      { itemId: "etc.viper_fang", chance: 0.18 },
    ],
  },
  "mob.fang_beetle": {
    id: "mob.fang_beetle",
    name: "Fang Beetle",
    level: 95,
    maxHp: 22000,
    exp: 14000,
    mesosMin: 450,
    mesosMax: 1100,
    speed: 0.8,
    element: "PHYSICAL",
    wDef: 180,
    mDef: 90,
    avoid: 30,
    dropTable: [
      { itemId: "wpn.titans_grudge", chance: 0.1, legendaryEligible: true },
      { itemId: "etc.chitin_plate", chance: 0.18 },
    ],
  },
  "mob.dragon_skeleton": {
    id: "mob.dragon_skeleton",
    name: "Dragon Skeleton",
    level: 100,
    maxHp: 28000,
    exp: 16000,
    mesosMin: 500,
    mesosMax: 1250,
    speed: 0.9,
    element: "FIRE",
    elementMods: { FIRE: 0, ICE: 1.5 },
    wDef: 150,
    mDef: 140,
    avoid: 35,
    dropTable: [
      { itemId: "wpn.eclipse_blade", chance: 0.1, legendaryEligible: true },
      { itemId: "etc.dragon_bone", chance: 0.15 },
    ],
  },
  "mob.vine_wraith": {
    id: "mob.vine_wraith",
    name: "Vine Wraith",
    level: 105,
    maxHp: 32000,
    exp: 18000,
    mesosMin: 550,
    mesosMax: 1400,
    speed: 0.7,
    element: "POISON",
    wDef: 100,
    mDef: 160,
    avoid: 40,
    dropTable: [
      { itemId: "wpn.abyssal_rake", chance: 0.1, legendaryEligible: true },
      { itemId: "etc.withered_vine", chance: 0.15 },
    ],
  },
  "mob.crimson_drake": {
    id: "mob.crimson_drake",
    name: "Crimson Drake",
    level: 110,
    maxHp: 38000,
    exp: 20000,
    mesosMin: 600,
    mesosMax: 1550,
    speed: 1.1,
    element: "FIRE",
    elementMods: { FIRE: 0, ICE: 1.5 },
    wDef: 160,
    mDef: 140,
    avoid: 40,
    contactDamage: 80,
    dropTable: [
      { itemId: "wpn.leviathans_roar", chance: 0.1, legendaryEligible: true },
      { itemId: "etc.drake_scale", chance: 0.15 },
    ],
  },
  "mob.ember_turtle": {
    id: "mob.ember_turtle",
    name: "Ember Turtle",
    level: 115,
    maxHp: 45000,
    exp: 22000,
    mesosMin: 650,
    mesosMax: 1700,
    speed: 0.5,
    element: "FIRE",
    elementMods: { FIRE: 0, ICE: 1.5 },
    wDef: 220,
    mDef: 180,
    avoid: 20,
    dropTable: [
      { itemId: "wpn.devastator", chance: 0.1, legendaryEligible: true },
      { itemId: "etc.ember_shell", chance: 0.15 },
    ],
  },
  "mob.shadow_wyrm": {
    id: "mob.shadow_wyrm",
    name: "Shadow Wyrm",
    level: 120,
    maxHp: 52000,
    exp: 25000,
    mesosMin: 700,
    mesosMax: 1900,
    speed: 1.2,
    element: "DARK",
    elementMods: { DARK: 0, HOLY: 1.5 },
    wDef: 170,
    mDef: 200,
    avoid: 48,
    dropTable: [
      { itemId: "wpn.phantom_grasp", chance: 0.1, legendaryEligible: true },
      { itemId: "etc.wyrm_essence", chance: 0.12 },
    ],
  },
  "mob.firedrake_broodling": {
    id: "mob.firedrake_broodling",
    name: "Firedrake Broodling",
    level: 118,
    maxHp: 48000,
    exp: 24000,
    mesosMin: 680,
    mesosMax: 1800,
    speed: 1.0,
    element: "FIRE",
    elementMods: { FIRE: 0, ICE: 1.5 },
    wDef: 180,
    mDef: 160,
    avoid: 42,
    contactDamage: 70,
    dropTable: [
      { itemId: "wpn.hellion_cannon", chance: 0.1, legendaryEligible: true },
      { itemId: "etc.drake_scale", chance: 0.12 },
    ],
  },

  // ── RAID BOSS — Pyroclasm, the Dragon Sovereign ────────────────────────
  // The first true endgame raid boss. Multi-phase encounter with 4 phases,
  // 8 attack patterns, and adds drawn from the Drakemoor mob pool. This is
  // the pinnacle PvE challenge at launch — a 6-player party fight with
  // Legendary-tier guaranteed loot. The encounter escalates through:
  //   Phase 0 (100–75%): Grounded assault — breath weapons + claw swipes.
  //   Phase 1 (75–50%): Takes flight — aerial bombardment + summoned brood.
  //   Phase 2 (50–25%): Enraged — faster attacks, wider AoE, shadow phase.
  //   Phase 3 (<25%): Sovereign's Wrath — full kit unlocked, lethal speed.
  "mob.pyroclasm": {
    id: "mob.pyroclasm",
    name: "Pyroclasm, the Dragon Sovereign",
    level: 120,
    maxHp: 250000,
    exp: 200000,
    mesosMin: 5000,
    mesosMax: 12000,
    speed: 0.7,
    element: "FIRE",
    elementMods: { FIRE: 0, ICE: 1.5, LIGHTNING: 2.0, DARK: 1.25 },
    wDef: 280,
    mDef: 260,
    avoid: 55,
    isBoss: true,
    attackDamage: 500,
    attackCooldownMs: 2000,
    attackPatternIds: [
      "dragon_claw",
      "inferno_breath",
      "tail_sweep",
      "aerial_bombardment",
      "brood_summon",
      "shadow_flame",
      "sovereign_roar",
      "extinction_event",
    ],
    contactDamage: 200,
    aoeDamage: 350,
    summonAddIds: ["mob.crimson_drake", "mob.firedrake_broodling", "mob.shadow_wyrm"],
    phases: [0.75, 0.5, 0.25],
    dropTable: [
      // ── Legendary weapons (guaranteed min tier, on-chain eligible) ────────
      {
        itemId: "wpn.sovereigns_edge",
        chance: 0.2,
        minPotentialTier: "LEGENDARY" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "wpn.dragonfire_cataclysm",
        chance: 0.2,
        minPotentialTier: "LEGENDARY" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "wpn.verdant_apocalypse",
        chance: 0.18,
        minPotentialTier: "LEGENDARY" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "wpn.shadow_piercer",
        chance: 0.18,
        minPotentialTier: "LEGENDARY" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "wpn.tyrants_fury",
        chance: 0.15,
        minPotentialTier: "LEGENDARY" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "wpn.serpentstongue",
        chance: 0.15,
        minPotentialTier: "LEGENDARY" as PotentialTier,
        legendaryEligible: true,
      },
      // ── Legendary armours ────────────────────────────────────────────────
      {
        itemId: "hat.dragonborne_helm",
        chance: 0.15,
        minPotentialTier: "UNIQUE" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "top.sovereign_plate",
        chance: 0.15,
        minPotentialTier: "UNIQUE" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "bottom.dragonhide_cuisses",
        chance: 0.12,
        minPotentialTier: "UNIQUE" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "shoes.dragonhide_treads",
        chance: 0.12,
        minPotentialTier: "UNIQUE" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "shield.dragonward_aegis",
        chance: 0.12,
        minPotentialTier: "UNIQUE" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "cape.dragonfire_shroud",
        chance: 0.12,
        minPotentialTier: "UNIQUE" as PotentialTier,
        legendaryEligible: true,
      },
      // ── Rare crafting material (for future crafting/upgrade systems) ───────
      { itemId: "etc.sovereign_heart", chance: 0.3 },
      { itemId: "etc.dragonfire_core", chance: 0.25 },
    ],
  },

  // ── HEARTLAND FIELD BOSSES ──────────────────────────────────────────────
  // Classic early-game field bosses parity (Mano / Stumpy / King Slime / Mushmom / Jr. Balrog).
  // These spawn as rare timed encounters in the Heartland combat zones.

  "mob.mano": {
    id: "mob.mano",
    name: "Mano",
    level: 8,
    maxHp: 800,
    exp: 500,
    mesosMin: 60,
    mesosMax: 150,
    speed: 0.6,
    element: "PHYSICAL",
    wDef: 10,
    mDef: 8,
    avoid: 6,
    isBoss: true,
    attackDamage: 35,
    attackCooldownMs: 1800,
    attackPatternIds: ["charge", "slam"],
    contactDamage: 15,
    aoeDamage: 20,
    summonAddIds: ["mob.meadow_slime"],
    phases: [0.5],
    dropTable: [
      {
        itemId: "wpn.bronze_shortsword",
        chance: 0.25,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "wpn.oak_maul",
        chance: 0.2,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
      { itemId: "hat.leather_cap", chance: 0.2, minPotentialTier: "RARE" as PotentialTier },
      { itemId: "top.traveler_jerkin", chance: 0.15, minPotentialTier: "RARE" as PotentialTier },
      { itemId: "shoes.worn_boots", chance: 0.15, minPotentialTier: "RARE" as PotentialTier },
      {
        itemId: "cape.travelers_mantle",
        chance: 0.08,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
    ],
  },

  "mob.stumpy": {
    id: "mob.stumpy",
    name: "Stumpy",
    level: 12,
    maxHp: 1200,
    exp: 800,
    mesosMin: 80,
    mesosMax: 200,
    speed: 0.4,
    element: "POISON",
    elementMods: { POISON: 0, FIRE: 1.5 },
    wDef: 16,
    mDef: 18,
    avoid: 8,
    isBoss: true,
    attackDamage: 55,
    attackCooldownMs: 2000,
    attackPatternIds: ["root_slam", "poison_cloud"],
    contactDamage: 20,
    aoeDamage: 30,
    summonAddIds: ["mob.root_crawler"],
    phases: [0.5],
    dropTable: [
      {
        itemId: "wpn.iron_broadsword",
        chance: 0.22,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "wpn.oakwood_staff",
        chance: 0.18,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "hat.woven_circlet",
        chance: 0.15,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
      { itemId: "top.traveler_jerkin", chance: 0.18, minPotentialTier: "RARE" as PotentialTier },
      { itemId: "shoes.worn_boots", chance: 0.15, minPotentialTier: "RARE" as PotentialTier },
      {
        itemId: "cape.travelers_mantle",
        chance: 0.1,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
      { itemId: "shield.iron_buckler", chance: 0.12, minPotentialTier: "RARE" as PotentialTier },
    ],
  },

  "mob.king_slime": {
    id: "mob.king_slime",
    name: "King Slime",
    level: 15,
    maxHp: 2000,
    exp: 1000,
    mesosMin: 120,
    mesosMax: 300,
    speed: 0.35,
    element: "PHYSICAL",
    wDef: 22,
    mDef: 20,
    avoid: 8,
    isBoss: true,
    attackDamage: 70,
    attackCooldownMs: 2200,
    attackPatternIds: ["body_slam", "split_spawn"],
    contactDamage: 25,
    aoeDamage: 35,
    summonAddIds: ["mob.meadow_slime", "mob.dawn_shroom"],
    phases: [0.5],
    dropTable: [
      {
        itemId: "wpn.iron_broadsword",
        chance: 0.22,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "wpn.gale_bow",
        chance: 0.18,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "wpn.nightfang_dagger",
        chance: 0.18,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "hat.iron_crest_helm",
        chance: 0.15,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
      { itemId: "top.traveler_jerkin", chance: 0.15, minPotentialTier: "RARE" as PotentialTier },
      { itemId: "shoes.worn_boots", chance: 0.12, minPotentialTier: "RARE" as PotentialTier },
      { itemId: "shield.iron_buckler", chance: 0.1, minPotentialTier: "RARE" as PotentialTier },
    ],
  },

  "mob.mushmom": {
    id: "mob.mushmom",
    name: "Mushmom",
    level: 18,
    maxHp: 2500,
    exp: 1300,
    mesosMin: 150,
    mesosMax: 380,
    speed: 0.45,
    element: "POISON",
    elementMods: { POISON: 0, FIRE: 1.5, HOLY: 1.5 },
    wDef: 24,
    mDef: 28,
    avoid: 10,
    isBoss: true,
    attackDamage: 85,
    attackCooldownMs: 2400,
    attackPatternIds: ["spore_burst", "toxic_slam"],
    contactDamage: 30,
    aoeDamage: 40,
    summonAddIds: ["mob.mushroom"],
    phases: [0.5],
    dropTable: [
      {
        itemId: "wpn.iron_broadsword",
        chance: 0.2,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "wpn.nightfang_dagger",
        chance: 0.18,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "wpn.ember_wand",
        chance: 0.18,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "hat.iron_crest_helm",
        chance: 0.15,
        minPotentialTier: "UNIQUE" as PotentialTier,
        legendaryEligible: true,
      },
      { itemId: "top.traveler_jerkin", chance: 0.15, minPotentialTier: "RARE" as PotentialTier },
      { itemId: "shoes.worn_boots", chance: 0.12, minPotentialTier: "RARE" as PotentialTier },
      {
        itemId: "cape.travelers_mantle",
        chance: 0.12,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
    ],
  },

  "mob.jr_balrog": {
    id: "mob.jr_balrog",
    name: "Jr. Balrog",
    level: 22,
    maxHp: 3000,
    exp: 2000,
    mesosMin: 180,
    mesosMax: 450,
    speed: 0.7,
    element: "DARK",
    elementMods: { DARK: 0, HOLY: 1.5 },
    wDef: 20,
    mDef: 30,
    avoid: 14,
    isBoss: true,
    attackDamage: 100,
    attackCooldownMs: 1600,
    attackPatternIds: ["dark_charge", "wing_slash", "abyssal_roar"],
    contactDamage: 40,
    aoeDamage: 55,
    summonAddIds: ["mob.arc_wraith"],
    summonItemId: "item.balrog_talisman",
    phases: [0.5],
    dropTable: [
      {
        itemId: "wpn.shadow_fang",
        chance: 0.18,
        minPotentialTier: "UNIQUE" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "wpn.iron_bell",
        chance: 0.18,
        minPotentialTier: "UNIQUE" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "wpn.ember_wand",
        chance: 0.15,
        minPotentialTier: "UNIQUE" as PotentialTier,
        legendaryEligible: true,
      },
      {
        itemId: "hat.rogue_cowl",
        chance: 0.14,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
      { itemId: "top.traveler_jerkin", chance: 0.15, minPotentialTier: "RARE" as PotentialTier },
      {
        itemId: "cape.wardens_cloak",
        chance: 0.12,
        minPotentialTier: "EPIC" as PotentialTier,
        legendaryEligible: true,
      },
      { itemId: "shoes.worn_boots", chance: 0.12, minPotentialTier: "RARE" as PotentialTier },
      { itemId: "shield.iron_buckler", chance: 0.1, minPotentialTier: "RARE" as PotentialTier },
    ],
  },
};

// ── Inject familiar card drops into all non-boss mobs (2% chance each). ──────
for (const mob of Object.values(MOBS)) {
  if (!mob.isBoss) {
    // Cast away readonly so we can push — the runtime array is mutable.
    (mob.dropTable as DropTableEntry[]).push({
      itemId: familiarCardId(mob.id),
      chance: FAMILIAR_CARD_DROP_CHANCE,
    });
  }
}

/** Set of field-boss mob def ids for quick lookup. */
export const FIELD_BOSS_IDS = new Set(
  Object.values(MOBS)
    .filter((m) => m.isBoss && !m.summonItemId)
    .map((m) => m.id),
);

/** Set of item-summoned boss mob def ids. */
export const SUMMON_BOSSES_BY_ITEM = new Map<string, string>();
for (const m of Object.values(MOBS)) {
  if (m.isBoss && m.summonItemId) SUMMON_BOSSES_BY_ITEM.set(m.summonItemId, m.id);
}

export function getMobDef(id: string): MobDef | undefined {
  return MOBS[id];
}

// ── Elite variant system ───────────────────────────────────────────────────────
/**
 * Elite scaling constants — applied to a base MobDef to produce an elite variant.
 * Elites sit between normal mobs and field bosses in difficulty: they hit harder,
 * have more HP, award better loot, and grant bonus EXP.
 */
export const ELITE_SCALING = {
  /** HP multiplier (elites are beefier but not boss-tier). */
  hpMultiplier: 2.0,
  /** Damage multiplier applied to attackDamage / contactDamage / aoeDamage. */
  damageMultiplier: 1.5,
  /** EXP multiplier — elites are worth 3× a normal mob of the same level. */
  expMultiplier: 3,
  /** Mesos multiplier — elites drop 2.5× mesos. */
  mesosMultiplier: 2.5,
  /** Flat bonus added to wDef and mDef for tankiness. */
  defenceBonus: 8,
  /** Flat bonus added to avoidance. */
  avoidBonus: 4,
  /** Chance (0–1) that a normal non-boss spawn promotes to elite. */
  promotionChance: 0.05,
  /** Chance (0–1) of rolling an extra rare drop on elite kill (in addition to normal table). */
  rareDropChance: 0.08,
  /** Minimum Potential tier guaranteed on elite rare drops. */
  rareDropMinTier: "RARE" as PotentialTier,
  /** EXP multiplier granted on kill (stacks with rune EXP). */
  eliteKillExpMultiplier: 1.5,
} as const;

/**
 * Create an elite variant of a base MobDef. Returns a new object with scaled
 * stats — the original is never mutated. Boss mobs are excluded (they already
 * have their own tier).
 */
export function createEliteMob(base: MobDef): MobDef {
  if (base.isBoss) return base; // bosses are never elite-promoted

  const s = ELITE_SCALING;
  const eliteDropTable: DropTableEntry[] = [
    {
      itemId: base.dropTable[0]?.itemId ?? base.id,
      chance: s.rareDropChance,
      minPotentialTier: s.rareDropMinTier,
    },
  ];

  return {
    ...base,
    name: `Elite ${base.name}`,
    maxHp: Math.round(base.maxHp * s.hpMultiplier),
    exp: Math.round(base.exp * s.expMultiplier),
    mesosMin: Math.round(base.mesosMin * s.mesosMultiplier),
    mesosMax: Math.round(base.mesosMax * s.mesosMultiplier),
    wDef: base.wDef + s.defenceBonus,
    mDef: base.mDef + s.defenceBonus,
    avoid: base.avoid + s.avoidBonus,
    attackDamage:
      base.attackDamage !== undefined
        ? Math.round(base.attackDamage * s.damageMultiplier)
        : undefined,
    contactDamage:
      base.contactDamage !== undefined
        ? Math.round(base.contactDamage * s.damageMultiplier)
        : undefined,
    aoeDamage:
      base.aoeDamage !== undefined ? Math.round(base.aoeDamage * s.damageMultiplier) : undefined,
    dropTable: [...base.dropTable, ...eliteDropTable],
  };
}

/**
 * Roll whether a normal non-boss spawn promotes to elite.
 * @param rng float in [0, 1); inject for tests.
 */
export function rollEliteChance(rng: () => number = Math.random): boolean {
  return rng() < ELITE_SCALING.promotionChance;
}

/** The mob that spawns in the Meadowfield slice. */
export const STARTER_MOB_ID = "mob.meadow_slime";

/**
 * Roll mesos for a kill in [mesosMin, mesosMax].
 * @param rng float in [0, 1); inject for tests.
 */
export function rollMesos(mob: MobDef, rng: () => number = Math.random): number {
  const span = mob.mesosMax - mob.mesosMin;
  return mob.mesosMin + Math.floor(rng() * (span + 1));
}

/**
 * Roll which item ids (if any) drop from a kill. Each drop-table entry is an independent check.
 * @param rng float in [0, 1); inject for tests.
 */
export function rollItemDrops(mob: MobDef, rng: () => number = Math.random): string[] {
  const drops: string[] = [];
  for (const entry of mob.dropTable) {
    if (rng() < entry.chance) drops.push(entry.itemId);
  }
  return drops;
}

/**
 * Compute the elemental damage multiplier for an attack element against a mob.
 *
 * Lookup order:
 *  1. mob.elementMods[attackElement] — explicit multiplier (0 = immune, 0.5 = resist, 1.5 = weak)
 *  2. Falls back to 1 (neutral) if no entry exists for that attack element.
 *
 * A PHYSICAL or NONE attack element against any mob always returns 1 (neutral)
 * unless explicitly overridden in elementMods.
 *
 * @returns Damage multiplier ≥ 0 (typically 0, 0.5, 1, or 1.5).
 */
export function elementalMultiplier(mob: MobDef, attackElement: Element): number {
  if (mob.elementMods && attackElement in mob.elementMods) {
    const mod = mob.elementMods[attackElement];
    if (mod !== undefined) {
      return mod;
    }
  }
  return 1;
}

/**
 * Get the effective MobDef for a mob instance — returns the elite-scaled variant
 * when `isElite` is true, otherwise the base def. Use this in combat resolution
 * and reward calculation so elites use their boosted stats.
 */
export function getEffectiveMobDef(base: MobDef | undefined, isElite: boolean): MobDef | undefined {
  if (!base || !isElite) return base;
  return createEliteMob(base);
}
