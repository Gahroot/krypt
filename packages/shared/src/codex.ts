/**
 * Codex + Fame — Monster Codex (kill-tracking bonuses) and Fame (social reputation).
 *
 * Pure + deterministic: identical results on authoritative server and client.
 * No runtime dependencies.
 *
 * ## Monster Codex
 *
 * Tracks cumulative kills per mob type. At kill-count milestones the player
 * earns small permanent stat/EXP bonuses. The codex state is a simple
 * `Record<string, number>` mapping mobId → total kills, so it serialises
 * trivially into a database column or JSON payload.
 *
 * ## Fame
 *
 * A social reputation stat. Players may grant +1 or −1 fame to another player,
 * but only once per day per target. Certain equipment slots require a minimum
 * fame value to equip (fame gates).
 */

import type { CharacterStats } from "./stats.js";
import { MOBS } from "./mobs.js";

// ── Monster Codex ─────────────────────────────────────────────────────────

export interface CodexMilestone {
  /** Kill count required to reach this milestone. */
  readonly kills: number;
  /** Permanent stat bonus granted. Values are additive to base stats. */
  readonly statBonus?: Partial<CharacterStats>;
  /** Permanent EXP multiplier bonus (e.g. 0.01 = +1% EXP). */
  readonly expBonus?: number;
  /** Human-readable description for UI. */
  readonly description: string;
}

export interface MobCodexEntry {
  /** Mob definition id (e.g. "mob.meadow_slime"). */
  readonly mobId: string;
  /** Milestones, sorted ascending by kills. */
  readonly milestones: readonly CodexMilestone[];
}

/** Per-character runtime codex state — maps mobId → total kill count. */
export type CodexState = Record<string, number>;

// ── Codex entries ─────────────────────────────────────────────────────────

/**
 * Milestone tier for codex entries. Determines stat/EXP bonus scaling.
 *   - TIER_1 (Lv 1-5 starter): +1 stat, +1% EXP
 *   - TIER_2 (Lv 4-12 early):   +1 stat, +1% EXP
 *   - TIER_3 (Lv 10-18 mid):    +2 stat, +2% EXP
 *   - TIER_4 (Lv 15-25 mid+):   +2 stat, +2% EXP
 *   - TIER_5 (Lv 20-30 late):   +3 stat, +3% EXP
 *   - TIER_6 (Lv 30-45 end):    +3 stat, +3% EXP
 *   - TIER_7 (Lv 40-65 deep):   +3 stat, +3% EXP
 *   - BOSS:                      +3 stat, +3% EXP (fewer milestones)
 */
export type CodexTier =
  | "TIER_1"
  | "TIER_2"
  | "TIER_3"
  | "TIER_4"
  | "TIER_5"
  | "TIER_6"
  | "TIER_7"
  | "BOSS";

/** Milestone thresholds and stat assignments per tier. */
const TIER_CONFIG: Record<
  CodexTier,
  {
    kills: readonly number[];
    stat1: keyof CharacterStats;
    stat2: keyof CharacterStats;
    stat1Val: number;
    stat2Val: number;
    expPerMilestone: number;
  }
> = {
  TIER_1: {
    kills: [10, 50, 200],
    stat1: "STR",
    stat2: "DEX",
    stat1Val: 1,
    stat2Val: 1,
    expPerMilestone: 0.01,
  },
  TIER_2: {
    kills: [10, 50, 200],
    stat1: "DEX",
    stat2: "LUK",
    stat1Val: 1,
    stat2Val: 1,
    expPerMilestone: 0.01,
  },
  TIER_3: {
    kills: [10, 50, 200],
    stat1: "STR",
    stat2: "INT",
    stat1Val: 2,
    stat2Val: 1,
    expPerMilestone: 0.02,
  },
  TIER_4: {
    kills: [10, 50, 200],
    stat1: "INT",
    stat2: "LUK",
    stat1Val: 2,
    stat2Val: 1,
    expPerMilestone: 0.02,
  },
  TIER_5: {
    kills: [10, 50, 200],
    stat1: "INT",
    stat2: "LUK",
    stat1Val: 3,
    stat2Val: 2,
    expPerMilestone: 0.03,
  },
  TIER_6: {
    kills: [10, 50, 200],
    stat1: "STR",
    stat2: "DEX",
    stat1Val: 3,
    stat2Val: 2,
    expPerMilestone: 0.03,
  },
  TIER_7: {
    kills: [10, 50, 200],
    stat1: "STR",
    stat2: "INT",
    stat1Val: 3,
    stat2Val: 3,
    expPerMilestone: 0.03,
  },
  BOSS: {
    kills: [5, 20, 50],
    stat1: "STR",
    stat2: "LUK",
    stat1Val: 3,
    stat2Val: 3,
    expPerMilestone: 0.03,
  },
};

function buildMilestones(
  tier: CodexTier,
  labels: [string, string, string],
): readonly CodexMilestone[] {
  const c = TIER_CONFIG[tier];
  const [kills0, kills1, kills2] = c.kills;
  if (kills0 === undefined || kills1 === undefined || kills2 === undefined) {
    throw new Error(`buildMilestones: tier ${tier} is missing kill thresholds`);
  }
  const ms: CodexMilestone[] = [
    {
      kills: kills0,
      statBonus: { [c.stat1]: c.stat1Val },
      description: labels[0],
    },
    {
      kills: kills1,
      statBonus: { [c.stat2]: c.stat2Val },
      expBonus: c.expPerMilestone,
      description: labels[1],
    },
    {
      kills: kills2,
      expBonus: c.expPerMilestone,
      description: labels[2],
    },
  ];
  return ms;
}

function bossMilestones(labels: [string, string, string]): readonly CodexMilestone[] {
  const c = TIER_CONFIG.BOSS;
  const [kills0, kills1, kills2] = c.kills;
  if (kills0 === undefined || kills1 === undefined || kills2 === undefined) {
    throw new Error("bossMilestones: BOSS tier is missing kill thresholds");
  }
  return [
    {
      kills: kills0,
      statBonus: { [c.stat1]: c.stat1Val },
      expBonus: c.expPerMilestone,
      description: labels[0],
    },
    {
      kills: kills1,
      statBonus: { [c.stat2]: c.stat2Val },
      expBonus: c.expPerMilestone,
      description: labels[1],
    },
    {
      kills: kills2,
      statBonus: { [c.stat1]: 1, [c.stat2]: 1 },
      expBonus: c.expPerMilestone,
      description: labels[2],
    },
  ];
}

/**
 * Canonical codex definitions keyed by mobId.
 *
 * Covers every mob in the game across all zones. Bonuses scale by tier:
 *   - TIER_1/2 (starter/early): +1 stat, +1% EXP
 *   - TIER_3/4 (mid):           +2 stat, +2% EXP
 *   - TIER_5/6/7 (late/end):    +3 stat, +3% EXP
 *   - BOSS:                     +3 stat, +3% EXP (5/20/50 kill milestones)
 */
export const CODEX_ENTRIES: Record<string, MobCodexEntry> = {
  // ── Dawn Isle starter mobs (Lv 1-3) ── TIER_1 ─────────────────────────
  "mob.friendly_snail": {
    mobId: "mob.friendly_snail",
    milestones: buildMilestones("TIER_1", [
      "Crush 10 snails — +1 STR",
      "50 snails down — +1 DEX, +1% EXP",
      "200 snails obliterated — +1% EXP",
    ]),
  },
  "mob.green_puff": {
    mobId: "mob.green_puff",
    milestones: buildMilestones("TIER_1", [
      "Pop 10 green puffs — +1 STR",
      "50 puffs popped — +1 DEX, +1% EXP",
      "200 puffs — +1% EXP",
    ]),
  },
  "mob.dawn_shroom": {
    mobId: "mob.dawn_shroom",
    milestones: buildMilestones("TIER_1", [
      "Stomp 10 dawn shrooms — +1 STR",
      "50 shrooms stomped — +1 DEX, +1% EXP",
      "200 shrooms — +1% EXP",
    ]),
  },

  // ── Heartland Harbor (Lv 4) ── TIER_2 ──────────────────────────────────
  "mob.dock_rat": {
    mobId: "mob.dock_rat",
    milestones: buildMilestones("TIER_2", [
      "Catch 10 dock rats — +1 DEX",
      "50 rats caught — +1 LUK, +1% EXP",
      "200 rats — +1% EXP",
    ]),
  },

  // ── Meadowfield (Lv 2-12) ── TIER_2 ────────────────────────────────────
  "mob.meadow_slime": {
    mobId: "mob.meadow_slime",
    milestones: buildMilestones("TIER_2", [
      "Squish 10 slimes — +1 DEX",
      "50 slimes squashed — +1 LUK, +1% EXP",
      "200 slimes — +1% EXP",
    ]),
  },
  "mob.mushroom": {
    mobId: "mob.mushroom",
    milestones: buildMilestones("TIER_2", [
      "Crush 10 mushrooms — +1 DEX",
      "50 mushrooms crushed — +1 LUK, +1% EXP",
      "200 mushrooms — +1% EXP",
    ]),
  },
  "mob.thornback_hopper": {
    mobId: "mob.thornback_hopper",
    milestones: buildMilestones("TIER_2", [
      "Down 10 hoppers — +1 DEX",
      "50 hoppers — +1 LUK, +1% EXP",
      "200 hoppers — +1% EXP",
    ]),
  },
  "mob.crow": {
    mobId: "mob.crow",
    milestones: buildMilestones("TIER_2", [
      "Scare 10 crows — +1 DEX",
      "50 crows scattered — +1 LUK, +1% EXP",
      "200 crows — +1% EXP",
    ]),
  },

  // ── Craghold (Lv 10-18) ── TIER_3 ──────────────────────────────────────
  "mob.rock_lizard": {
    mobId: "mob.rock_lizard",
    milestones: buildMilestones("TIER_3", [
      "10 rock lizards slain — +2 STR",
      "50 lizards — +1 INT, +2% EXP",
      "200 lizards — +2% EXP",
    ]),
  },
  "mob.fossil_beetle": {
    mobId: "mob.fossil_beetle",
    milestones: buildMilestones("TIER_3", [
      "10 fossil beetles down — +2 STR",
      "50 beetles — +1 INT, +2% EXP",
      "200 beetles — +2% EXP",
    ]),
  },
  "mob.cliff_hawk": {
    mobId: "mob.cliff_hawk",
    milestones: buildMilestones("TIER_3", [
      "10 cliff hawks felled — +2 STR",
      "50 hawks — +1 INT, +2% EXP",
      "200 hawks — +2% EXP",
    ]),
  },
  "mob.quarry_crab": {
    mobId: "mob.quarry_crab",
    milestones: buildMilestones("TIER_3", [
      "10 quarry crabs crushed — +2 STR",
      "50 crabs — +1 INT, +2% EXP",
      "200 crabs — +2% EXP",
    ]),
  },
  "mob.boulder_golem": {
    mobId: "mob.boulder_golem",
    milestones: buildMilestones("TIER_3", [
      "10 boulder golems toppled — +2 STR",
      "50 golems — +1 INT, +2% EXP",
      "200 golems — +2% EXP",
    ]),
  },

  // ── Sylvanreach (Lv 10-17) ── TIER_3 ───────────────────────────────────
  "mob.forest_wisp": {
    mobId: "mob.forest_wisp",
    milestones: buildMilestones("TIER_3", [
      "10 forest wisps captured — +2 STR",
      "50 wisps — +1 INT, +2% EXP",
      "200 wisps — +2% EXP",
    ]),
  },
  "mob.canopy_moth": {
    mobId: "mob.canopy_moth",
    milestones: buildMilestones("TIER_3", [
      "10 canopy moths swatted — +2 STR",
      "50 moths — +1 INT, +2% EXP",
      "200 moths — +2% EXP",
    ]),
  },
  "mob.bark_spider": {
    mobId: "mob.bark_spider",
    milestones: buildMilestones("TIER_3", [
      "10 bark spiders squashed — +2 STR",
      "50 spiders — +1 INT, +2% EXP",
      "200 spiders — +2% EXP",
    ]),
  },
  "mob.root_crawler": {
    mobId: "mob.root_crawler",
    milestones: buildMilestones("TIER_3", [
      "10 root crawlers crushed — +2 STR",
      "50 crawlers — +1 INT, +2% EXP",
      "200 crawlers — +2% EXP",
    ]),
  },
  "mob.sylvan_sprite": {
    mobId: "mob.sylvan_sprite",
    milestones: buildMilestones("TIER_3", [
      "10 sylvan sprites dispersed — +2 STR",
      "50 sprites — +1 INT, +2% EXP",
      "200 sprites — +2% EXP",
    ]),
  },

  // ── Dusk Ward (Lv 10-19) ── TIER_4 ─────────────────────────────────────
  "mob.neon_rat": {
    mobId: "mob.neon_rat",
    milestones: buildMilestones("TIER_4", [
      "10 neon rats zapped — +2 INT",
      "50 rats — +1 LUK, +2% EXP",
      "200 rats — +2% EXP",
    ]),
  },
  "mob.tunnel_bat": {
    mobId: "mob.tunnel_bat",
    milestones: buildMilestones("TIER_4", [
      "10 tunnel bats banished — +2 INT",
      "50 bats — +1 LUK, +2% EXP",
      "200 bats — +2% EXP",
    ]),
  },
  "mob.spark_drone": {
    mobId: "mob.spark_drone",
    milestones: buildMilestones("TIER_4", [
      "10 spark drones shorted — +2 INT",
      "50 drones — +1 LUK, +2% EXP",
      "200 drones — +2% EXP",
    ]),
  },
  "mob.rail_sentinel": {
    mobId: "mob.rail_sentinel",
    milestones: buildMilestones("TIER_4", [
      "10 rail sentinels dismantled — +2 INT",
      "50 sentinels — +1 LUK, +2% EXP",
      "200 sentinels — +2% EXP",
    ]),
  },
  "mob.shadow_thug": {
    mobId: "mob.shadow_thug",
    milestones: buildMilestones("TIER_4", [
      "10 shadow thugs subdued — +2 INT",
      "50 thugs — +1 LUK, +2% EXP",
      "200 thugs — +2% EXP",
    ]),
  },
  "mob.neon_spider": {
    mobId: "mob.neon_spider",
    milestones: buildMilestones("TIER_4", [
      "10 neon spiders silenced — +2 INT",
      "50 spiders — +1 LUK, +2% EXP",
      "200 spiders — +2% EXP",
    ]),
  },
  "mob.arc_wraith": {
    mobId: "mob.arc_wraith",
    milestones: buildMilestones("TIER_4", [
      "10 arc wraiths dispelled — +2 INT",
      "50 wraiths — +1 LUK, +2% EXP",
      "200 wraiths — +2% EXP",
    ]),
  },

  // ── Subway PQ (Lv 20-28) ── TIER_5 ────────────────────────────────────
  "mob.subway_horror": {
    mobId: "mob.subway_horror",
    milestones: buildMilestones("TIER_5", [
      "10 subway horrors banished — +3 INT",
      "50 horrors — +2 LUK, +3% EXP",
      "200 horrors — +3% EXP",
    ]),
  },
  "mob.subway_overseer": {
    mobId: "mob.subway_overseer",
    milestones: buildMilestones("TIER_5", [
      "10 subway overseers toppled — +3 INT",
      "50 overseers — +2 LUK, +3% EXP",
      "200 overseers — +3% EXP",
    ]),
  },

  // ── Mirefen swamp (Lv 20-30) ── TIER_5 ────────────────────────────────
  "mob.bog_lurker": {
    mobId: "mob.bog_lurker",
    milestones: buildMilestones("TIER_5", [
      "10 bog lurkers purged — +3 INT",
      "50 lurkers — +2 LUK, +3% EXP",
      "200 lurkers — +3% EXP",
    ]),
  },
  "mob.mire_toad": {
    mobId: "mob.mire_toad",
    milestones: buildMilestones("TIER_5", [
      "10 mire toads croaked — +3 INT",
      "50 toads — +2 LUK, +3% EXP",
      "200 toads — +3% EXP",
    ]),
  },
  "mob.ruins_sentinel": {
    mobId: "mob.ruins_sentinel",
    milestones: buildMilestones("TIER_5", [
      "10 ruins sentinels shattered — +3 INT",
      "50 sentinels — +2 LUK, +3% EXP",
      "200 sentinels — +3% EXP",
    ]),
  },
  "mob.moss_wraith": {
    mobId: "mob.moss_wraith",
    milestones: buildMilestones("TIER_5", [
      "10 moss wraiths dispersed — +3 INT",
      "50 wraiths — +2 LUK, +3% EXP",
      "200 wraiths — +3% EXP",
    ]),
  },
  "mob.ruins_horror": {
    mobId: "mob.ruins_horror",
    milestones: buildMilestones("TIER_5", [
      "10 ruins horrors banished — +3 INT",
      "50 horrors — +2 LUK, +3% EXP",
      "200 horrors — +3% EXP",
    ]),
  },
  "mob.deep_swamp_thing": {
    mobId: "mob.deep_swamp_thing",
    milestones: buildMilestones("TIER_5", [
      "10 deep swamp things defeated — +3 INT",
      "50 swamp things — +2 LUK, +3% EXP",
      "200 swamp things — +3% EXP",
    ]),
  },

  // ── Skyhaven Driftpeaks (Lv 30-40) ── TIER_6 ──────────────────────────
  "mob.wind_sprite": {
    mobId: "mob.wind_sprite",
    milestones: buildMilestones("TIER_6", [
      "10 wind sprites grounded — +3 STR",
      "50 sprites — +2 DEX, +3% EXP",
      "200 sprites — +3% EXP",
    ]),
  },
  "mob.sky_serpent": {
    mobId: "mob.sky_serpent",
    milestones: buildMilestones("TIER_6", [
      "10 sky serpents slain — +3 STR",
      "50 serpents — +2 DEX, +3% EXP",
      "200 serpents — +3% EXP",
    ]),
  },
  "mob.thunder_hawk": {
    mobId: "mob.thunder_hawk",
    milestones: buildMilestones("TIER_6", [
      "10 thunder hawks downed — +3 STR",
      "50 hawks — +2 DEX, +3% EXP",
      "200 hawks — +3% EXP",
    ]),
  },

  // ── Frosthold Slopes (Lv 35-45) ── TIER_6 ──────────────────────────────
  "mob.frost_wolf": {
    mobId: "mob.frost_wolf",
    milestones: buildMilestones("TIER_6", [
      "10 frost wolves felled — +3 STR",
      "50 wolves — +2 DEX, +3% EXP",
      "200 wolves — +3% EXP",
    ]),
  },
  "mob.ice_elemental": {
    mobId: "mob.ice_elemental",
    milestones: buildMilestones("TIER_6", [
      "10 ice elementals shattered — +3 STR",
      "50 elementals — +2 DEX, +3% EXP",
      "200 elementals — +3% EXP",
    ]),
  },
  "mob.snow_wraith": {
    mobId: "mob.snow_wraith",
    milestones: buildMilestones("TIER_6", [
      "10 snow wraiths dispersed — +3 STR",
      "50 wraiths — +2 DEX, +3% EXP",
      "200 wraiths — +3% EXP",
    ]),
  },

  // ── Frosthold Icecave (Lv 40-65) ── TIER_7 ─────────────────────────────
  "mob.frost_crawler": {
    mobId: "mob.frost_crawler",
    milestones: buildMilestones("TIER_7", [
      "10 frost crawlers crushed — +3 STR",
      "50 crawlers — +3 INT, +3% EXP",
      "200 crawlers — +3% EXP",
    ]),
  },
  "mob.crystal_guardian": {
    mobId: "mob.crystal_guardian",
    milestones: buildMilestones("TIER_7", [
      "10 crystal guardians defeated — +3 STR",
      "50 guardians — +3 INT, +3% EXP",
      "200 guardians — +3% EXP",
    ]),
  },
  "mob.glacial_shard": {
    mobId: "mob.glacial_shard",
    milestones: buildMilestones("TIER_7", [
      "10 glacial shards destroyed — +3 STR",
      "50 shards — +3 INT, +3% EXP",
      "200 shards — +3% EXP",
    ]),
  },
  "mob.permafrost_revenant": {
    mobId: "mob.permafrost_revenant",
    milestones: buildMilestones("TIER_7", [
      "10 permafrost revenants banished — +3 STR",
      "50 revenants — +3 INT, +3% EXP",
      "200 revenants — +3% EXP",
    ]),
  },
  "mob.frost_banshee": {
    mobId: "mob.frost_banshee",
    milestones: buildMilestones("TIER_7", [
      "10 frost banshees silenced — +3 STR",
      "50 banshees — +3 INT, +3% EXP",
      "200 banshees — +3% EXP",
    ]),
  },

  // ── Boss mobs ───────────────────────────────────────────────────────────
  "mob.subway_curse_eye": {
    mobId: "mob.subway_curse_eye",
    milestones: bossMilestones([
      "Gaze of the Abyss x5 — +3 STR, +3% EXP",
      "20 Abyss Gazes — +3 LUK, +3% EXP",
      "50 Abyss Gazes — +1 STR, +1 LUK, +3% EXP",
    ]),
  },
  "mob.bogmaw": {
    mobId: "mob.bogmaw",
    milestones: bossMilestones([
      "Slay Bogmaw 5 times — +3 STR, +3% EXP",
      "20 Bogmaw kills — +3 LUK, +3% EXP",
      "50 Bogmaw kills — +1 STR, +1 LUK, +3% EXP",
    ]),
  },
  "mob.glacial_abomination": {
    mobId: "mob.glacial_abomination",
    milestones: bossMilestones([
      "Defeat Glacial Abomination x5 — +3 STR, +3% EXP",
      "20 Abominations — +3 LUK, +3% EXP",
      "50 Abominations — +1 STR, +1 LUK, +3% EXP",
    ]),
  },
  "mob.glacius_prime": {
    mobId: "mob.glacius_prime",
    milestones: bossMilestones([
      "10 Glacius Prime kills — +3 STR, +3% EXP",
      "20 Frost Titans — +3 LUK, +3% EXP",
      "50 Frost Titans — +1 STR, +1 LUK, +3% EXP",
    ]),
  },
  "mob.mano": {
    mobId: "mob.mano",
    milestones: bossMilestones([
      "Slay Mano 5 times — +3 STR, +3% EXP",
      "20 Mano kills — +3 LUK, +3% EXP",
      "50 Mano kills — +1 STR, +1 LUK, +3% EXP",
    ]),
  },
  "mob.stumpy": {
    mobId: "mob.stumpy",
    milestones: bossMilestones([
      "Fell Stumpy 5 times — +3 STR, +3% EXP",
      "20 Stumpy kills — +3 LUK, +3% EXP",
      "50 Stumpy kills — +1 STR, +1 LUK, +3% EXP",
    ]),
  },
  "mob.king_slime": {
    mobId: "mob.king_slime",
    milestones: bossMilestones([
      "Defeat King Slime x5 — +3 STR, +3% EXP",
      "20 King Slimes — +3 LUK, +3% EXP",
      "50 King Slimes — +1 STR, +1 LUK, +3% EXP",
    ]),
  },
  "mob.mushmom": {
    mobId: "mob.mushmom",
    milestones: bossMilestones([
      "Crush Mushmom 5 times — +3 STR, +3% EXP",
      "20 Mushmom kills — +3 LUK, +3% EXP",
      "50 Mushmom kills — +1 STR, +1 LUK, +3% EXP",
    ]),
  },
  "mob.jr_balrog": {
    mobId: "mob.jr_balrog",
    milestones: bossMilestones([
      "Banish Jr. Balrog x5 — +3 STR, +3% EXP",
      "20 Jr. Balrog kills — +3 LUK, +3% EXP",
      "50 Jr. Balrog kills — +1 STR, +1 LUK, +3% EXP",
    ]),
  },
};

// ── Codex helpers ─────────────────────────────────────────────────────────

/**
 * Return all milestones that have been achieved for a given mobId and kill count.
 * A milestone is achieved when `killCount >= milestone.kills`.
 */
export function getAchievedMilestones(mobId: string, killCount: number): CodexMilestone[] {
  const entry = CODEX_ENTRIES[mobId];
  if (!entry) return [];
  return entry.milestones.filter((m) => killCount >= m.kills);
}

/**
 * Evaluate the full codex state, returning every achieved milestone across all
 * mob types, the cumulative stat bonuses, and the total EXP multiplier bonus.
 */
export function evaluateCodexMilestones(codexState: CodexState): {
  newlyUnlocked: { mobId: string; milestone: CodexMilestone }[];
  totalStatBonus: Partial<CharacterStats>;
  totalExpBonus: number;
} {
  const newlyUnlocked: { mobId: string; milestone: CodexMilestone }[] = [];
  const totalStatBonus: Partial<CharacterStats> = {};
  let totalExpBonus = 0;

  for (const [mobId, killCount] of Object.entries(codexState)) {
    const achieved = getAchievedMilestones(mobId, killCount);

    for (const milestone of achieved) {
      newlyUnlocked.push({ mobId, milestone });

      // Accumulate stat bonuses.
      if (milestone.statBonus) {
        for (const [stat, value] of Object.entries(milestone.statBonus)) {
          const key = stat as keyof CharacterStats;
          totalStatBonus[key] = (totalStatBonus[key] ?? 0) + value;
        }
      }

      // Accumulate EXP bonuses.
      if (milestone.expBonus) {
        totalExpBonus += milestone.expBonus;
      }
    }
  }

  return { newlyUnlocked, totalStatBonus, totalExpBonus };
}

// ── Fame System ───────────────────────────────────────────────────────────

export interface FameState {
  /** Current fame value (can be negative). */
  fame: number;
  /** Map of targetCharId → timestamp of last fame action. Used for daily limit. */
  fameHistory: Record<string, number>;
}

export interface FameResult {
  success: boolean;
  /** The new fame total after the action. */
  newFame: number;
  /** Error message if failed. */
  message: string;
}

export const FAME_GAIN = 1;
export const FAME_LOSS = -1;
export const MS_PER_DAY = 86_400_000;

// ── Fame gates ────────────────────────────────────────────────────────────

export interface FameGate {
  readonly slot: string;
  readonly minFame: number;
}

/** Default fame gates for special equipment. */
export const FAME_GATES: readonly FameGate[] = [
  { slot: "title", minFame: 50 },
  { slot: "ring", minFame: 100 },
];

// ── Fame helpers ──────────────────────────────────────────────────────────

/**
 * Check whether the player is allowed to give fame to `targetCharId` at the
 * given `now` timestamp.
 */
export function canGiveFame(
  fameState: FameState,
  targetCharId: string,
  now: number,
): { allowed: boolean; reason?: string } {
  const lastAction = fameState.fameHistory[targetCharId];
  if (lastAction !== undefined && now - lastAction < MS_PER_DAY) {
    return {
      allowed: false,
      reason: "You have already given fame to this player today.",
    };
  }
  return { allowed: true };
}

/**
 * Attempt to give `amount` (+1 or −1) fame from the owning player to
 * `targetCharId`. Returns the result including the new fame total.
 */
export function giveFame(
  fameState: FameState,
  targetCharId: string,
  amount: number,
  now: number,
): FameResult {
  if (amount !== FAME_GAIN && amount !== FAME_LOSS) {
    return { success: false, newFame: fameState.fame, message: "Fame amount must be +1 or -1." };
  }

  const { allowed, reason } = canGiveFame(fameState, targetCharId, now);
  if (!allowed) {
    return { success: false, newFame: fameState.fame, message: reason ?? "Cannot give fame." };
  }

  const newFame = fameState.fame + amount;
  fameState.fame = newFame;
  fameState.fameHistory[targetCharId] = now;

  return {
    success: true,
    newFame,
    message: amount > 0 ? "Gained 1 fame." : "Lost 1 fame.",
  };
}

/**
 * Check whether the player's current fame meets the requirement for an
 * equipment slot. Returns `meets: true` when there is no gate for the slot.
 */
export function meetsFameGate(
  currentFame: number,
  slot: string,
): { meets: boolean; required?: number } {
  const gate = FAME_GATES.find((g) => g.slot === slot);
  if (!gate) return { meets: true };
  return currentFame >= gate.minFame ? { meets: true } : { meets: false, required: gate.minFame };
}

// ── Exploration Dispatch (idle Monster Collection) ─────────────────────────

/**
 * Exploration dispatch — send collected mobs on timed expeditions that
 * return mesos and items after a real-time delay.
 *
 * A mob is eligible for dispatch only if the player has registered it in
 * the codex (kill count ≥ 1). More codex entries unlock more slots.
 */

/** Predefined exploration durations. */
export type ExplorationDuration = "short" | "medium" | "long";

/** Duration → real-time ms mapping. */
export const EXPLORATION_DURATIONS: Record<ExplorationDuration, number> = {
  short: 15 * 60_000, // 15 minutes
  medium: 60 * 60_000, // 1 hour
  long: 4 * 60 * 60_000, // 4 hours
};

/** Mesos reward multiplier per duration (base mesos/hour × multiplier). */
const DURATION_MESOS_MULT: Record<ExplorationDuration, number> = {
  short: 0.25, // 15 min = ¼ hour
  medium: 1.0, // 1 hour
  long: 3.5, // 4 hours (slightly discounted vs 4×)
};

/** Maximum exploration slots available at various codex-entry counts. */
const SLOT_THRESHOLDS = [
  { minEntries: 0, slots: 2 },
  { minEntries: 10, slots: 3 },
  { minEntries: 25, slots: 4 },
  { minEntries: 40, slots: 5 },
  { minEntries: 50, slots: 6 },
] as const;

/** An active or completed exploration dispatch. */
export interface ExplorationSlot {
  /** Slot index (0-based). */
  slotIndex: number;
  /** Mob id being explored. */
  mobId: string;
  /** Epoch-ms when exploration started. */
  startAt: number;
  /** Duration class. */
  duration: ExplorationDuration;
  /** Total ms for this exploration. */
  durationMs: number;
  /** Epoch-ms when this exploration completes. */
  completeAt: number;
  /** Whether rewards have been claimed. */
  claimed: boolean;
}

/** Full exploration state for a character. */
export interface ExplorationState {
  /** Active dispatch slots. */
  slots: ExplorationSlot[];
}

/** Result of claiming an exploration. */
export interface ExplorationClaimResult {
  success: boolean;
  /** Mesos earned. */
  mesos: number;
  /** Item ids earned. */
  items: string[];
  /** Remaining exploration state. */
  state: ExplorationState;
  message: string;
}

/** Compute max exploration slots based on codex entry count. */
export function maxExplorationSlots(codexState: CodexState): number {
  const entryCount = Object.keys(codexState).filter((id) => (codexState[id] ?? 0) >= 1).length;
  const firstThreshold = SLOT_THRESHOLDS[0];
  if (firstThreshold === undefined) {
    throw new Error("maxExplorationSlots: SLOT_THRESHOLDS is empty");
  }
  let maxSlots: number = firstThreshold.slots;
  for (const t of SLOT_THRESHOLDS) {
    if (entryCount >= t.minEntries) maxSlots = t.slots;
  }
  return maxSlots;
}

/** Get the number of registered codex entries (kill count ≥ 1). */
export function registeredCodexEntries(codexState: CodexState): number {
  return Object.keys(codexState).filter((id) => (codexState[id] ?? 0) >= 1).length;
}

/** Base mesos per hour by mob level (rough scaling). */
function baseMesosPerHour(mobLevel: number): number {
  return Math.floor(20 + mobLevel * 5);
}

/**
 * Start a new exploration dispatch. Validates eligibility and creates
 * a slot. Pure function — caller persists the returned state.
 */
export function startExploration(
  state: ExplorationState,
  codexState: CodexState,
  mobId: string,
  duration: ExplorationDuration,
  now: number,
): { ok: boolean; state: ExplorationState; message: string } {
  const mobDef = MOBS[mobId];
  if (!mobDef) {
    return { ok: false, state, message: `Unknown mob: ${mobId}` };
  }

  // Must have at least 1 kill to register/dispatch.
  const kills = codexState[mobId] ?? 0;
  if (kills < 1) {
    return { ok: false, state, message: "You must have at least 1 kill to dispatch this mob." };
  }

  // Check slot capacity.
  const maxSlots = maxExplorationSlots(codexState);
  const activeSlots = state.slots.filter((s) => !s.claimed);
  if (activeSlots.length >= maxSlots) {
    return { ok: false, state, message: `All ${maxSlots} exploration slots are in use.` };
  }

  // Check the mob isn't already dispatched.
  if (activeSlots.some((s) => s.mobId === mobId)) {
    return { ok: false, state, message: "This mob is already on an exploration." };
  }

  const durationMs = EXPLORATION_DURATIONS[duration];
  const slotIndex = state.slots.length;
  const newSlot: ExplorationSlot = {
    slotIndex,
    mobId,
    startAt: now,
    duration,
    durationMs,
    completeAt: now + durationMs,
    claimed: false,
  };

  return {
    ok: true,
    state: { slots: [...state.slots, newSlot] },
    message: `${mobDef.name} dispatched on a ${duration} exploration!`,
  };
}

/**
 * Compute rewards for a completed exploration. Pure function with injectable RNG.
 * Mesos are based on mob level × duration. Items are rolled from the mob's
 * drop table at reduced rates.
 */
export function computeExplorationRewards(
  slot: ExplorationSlot,
  mobLevel: number,
  dropTable: readonly { itemId: string; chance: number }[],
  rng: () => number = Math.random,
): { mesos: number; items: string[] } {
  const base = baseMesosPerHour(mobLevel);
  const mult = DURATION_MESOS_MULT[slot.duration];
  const mesos = Math.floor(base * mult * (0.8 + rng() * 0.4)); // ±20% variance

  const items: string[] = [];
  // Exploration gives items at ¼ the normal drop rate.
  for (const entry of dropTable) {
    if (rng() < entry.chance * 0.25) {
      items.push(entry.itemId);
    }
  }

  return { mesos, items };
}

/** Claim all completed exploration slots. Returns claimed rewards + updated state. */
export function claimExplorations(
  state: ExplorationState,
  mobLevels: Record<string, number>,
  dropTables: Record<string, readonly { itemId: string; chance: number }[]>,
  now: number,
  rng: () => number = Math.random,
): {
  claims: { slotIndex: number; mobId: string; mesos: number; items: string[] }[];
  totalMesos: number;
  totalItems: string[];
  state: ExplorationState;
} {
  const claims: { slotIndex: number; mobId: string; mesos: number; items: string[] }[] = [];
  let totalMesos = 0;
  const totalItems: string[] = [];

  const updatedSlots = state.slots.map((slot) => {
    if (slot.claimed || now < slot.completeAt) return slot;

    const mobLevel = mobLevels[slot.mobId] ?? 1;
    const dropTable = dropTables[slot.mobId] ?? [];
    const rewards = computeExplorationRewards(slot, mobLevel, dropTable, rng);

    claims.push({
      slotIndex: slot.slotIndex,
      mobId: slot.mobId,
      mesos: rewards.mesos,
      items: rewards.items,
    });
    totalMesos += rewards.mesos;
    totalItems.push(...rewards.items);

    return { ...slot, claimed: true };
  });

  return {
    claims,
    totalMesos,
    totalItems,
    state: { slots: updatedSlots },
  };
}
