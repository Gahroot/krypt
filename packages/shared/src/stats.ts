/**
 * Stats — the AP/SP character system, reskinned from MapleStory.
 *
 * Verified mechanics we clone:
 *  - AP ("Ability Points"): 5 granted per level-up, spent on STR/DEX/INT/LUK or max HP/MP.
 *    STR/DEX/INT/LUK rise +1 per AP. HP/MP gains vary by class.
 *  - SP ("Skill Points"): a separate pool, spent on the class skill tree (see classes.ts).
 *
 * All functions here are pure + deterministic so they can run identically on the authoritative
 * server (source of truth) and the client (display/prediction).
 */

export type PrimaryStat = "STR" | "DEX" | "INT" | "LUK";

export interface CharacterStats {
  STR: number;
  DEX: number;
  INT: number;
  LUK: number;
  HP: number;
  MP: number;
}

/** AP granted on every level-up. */
export const AP_PER_LEVEL = 5;

/** SP granted on every level-up (1st–4th job tiers). */
export const SP_PER_LEVEL = 3;

/** Base stats every new level-1 character starts with, before any AP is spent. */
export const BASE_STATS: Readonly<CharacterStats> = {
  STR: 4,
  DEX: 4,
  INT: 4,
  LUK: 4,
  HP: 50,
  MP: 5,
} as const;

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError(`level must be an integer >= 1, got ${level}`);
  }
}

/** Total AP a character has earned by the time they reach `level` (level 1 starts with 0 spendable AP). */
export function totalApByLevel(level: number): number {
  assertLevel(level);
  return (level - 1) * AP_PER_LEVEL;
}

/** Total SP a character has earned by `level`. */
export function totalSpByLevel(level: number): number {
  assertLevel(level);
  return (level - 1) * SP_PER_LEVEL;
}

/**
 * Auto-assign: dump every earned AP into the class's primary stat — the proven MapleStory meta,
 * and the default the UI offers. Deterministic and the canonical baseline the server trusts.
 */
export function autoAssign(level: number, primary: PrimaryStat): CharacterStats {
  assertLevel(level);
  return {
    ...BASE_STATS,
    [primary]: BASE_STATS[primary] + totalApByLevel(level),
  };
}

/**
 * Spend a single AP into a stat, returning a NEW stats object (never mutates).
 * Primary stats gain +1; HP gains +10 and MP +6 per point (class-agnostic baseline).
 */
export function spendAp(stats: CharacterStats, into: keyof CharacterStats): CharacterStats {
  const next = { ...stats };
  if (into === "HP") next.HP += 10;
  else if (into === "MP") next.MP += 6;
  else next[into] += 1;
  return next;
}

/** Simple, transparent attack-power derivation from the primary stat. Tunable later. */
export function attackPower(stats: CharacterStats, primary: PrimaryStat): number {
  return Math.floor(stats[primary] * 1.2 + 2);
}
