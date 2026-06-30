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

/** Secondary (derived) stats — physical/magical attack, defence, mobility, and crit. */
export interface SecondaryStats {
  /** Physical attack power. */
  readonly atk: number;
  /** Magical attack power. */
  readonly mAtk: number;
  /** Physical defence. */
  readonly wDef: number;
  /** Magical defence. */
  readonly mDef: number;
  /** Critical hit rate (0–1). */
  readonly critRate: number;
  /** Movement speed (100 = base). */
  readonly speed: number;
  /** Jump height (100 = base). */
  readonly jump: number;
  /** Accuracy rating. */
  readonly accuracy: number;
  /** Avoidance (evasion) rating. */
  readonly avoid: number;
}

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

// ───────────────────────────────────────────────────────────────────────────
// Secondary stat derivation — transparent, tunable, deterministic.
// All weights are exposed as constants so both server and client compute
// identical values, and designers can tweak without touching logic.
// ───────────────────────────────────────────────────────────────────────────

/** Physical ATK scaling weights: [STR, DEX, LUK] multipliers per archetype. */
export const PHYS_ATK_WEIGHTS: Record<PrimaryStat, readonly [number, number, number]> = {
  STR: [0.9, 0.3, 0.1],
  DEX: [0.2, 0.9, 0.2],
  INT: [0.1, 0.1, 0.1],
  LUK: [0.1, 0.2, 0.9],
};

/** Magical ATK scaling weights: [INT, LUK] multipliers per archetype. */
export const MGL_ATK_WEIGHTS: Record<PrimaryStat, readonly [number, number]> = {
  STR: [0.2, 0.05],
  DEX: [0.2, 0.05],
  INT: [1.0, 0.3],
  LUK: [0.3, 0.2],
};

/** Accuracy scaling: [STR, DEX, INT, LUK] multipliers. */
export const ACC_WEIGHTS: readonly [number, number, number, number] = [0.1, 0.5, 0.2, 0.3];

/** Avoidance scaling: [STR, DEX, INT, LUK] multipliers. LUK-primary thieves evade more. */
export const AVOID_WEIGHTS: readonly [number, number, number, number] = [0.1, 0.2, 0.1, 0.5];

/** Base secondary stats when no equipment is equipped. */
export const BASE_SECONDARY: Readonly<SecondaryStats> = {
  atk: 0,
  mAtk: 0,
  wDef: 0,
  mDef: 0,
  critRate: 0.05,
  speed: 100,
  jump: 100,
  accuracy: 0,
  avoid: 0,
} as const;

/**
 * Derive every secondary stat from the character's primary stats and an
 * optional equipment bonus. Pure, deterministic — same inputs always
 * produce the same outputs on both server and client.
 */
export function deriveSecondary(
  stats: CharacterStats,
  primary: PrimaryStat,
  equipBonus?: Partial<SecondaryStats>,
  effectBonus?: Partial<SecondaryStats>,
): SecondaryStats {
  // ── Physical ATK ──────────────────────────────────────────────
  const [wStr, wDex, wLuk] = PHYS_ATK_WEIGHTS[primary];
  const baseAtk = stats.STR * wStr + stats.DEX * wDex + stats.LUK * wLuk;

  // ── Magical ATK ───────────────────────────────────────────────
  const [wInt, wMluk] = MGL_ATK_WEIGHTS[primary];
  const baseMAtk = stats.INT * wInt + stats.LUK * wMluk;

  // ── Accuracy ──────────────────────────────────────────────────
  const baseAcc =
    stats.STR * ACC_WEIGHTS[0] +
    stats.DEX * ACC_WEIGHTS[1] +
    stats.INT * ACC_WEIGHTS[2] +
    stats.LUK * ACC_WEIGHTS[3];

  // ── Avoidance ─────────────────────────────────────────────────
  const baseAvoid =
    stats.STR * AVOID_WEIGHTS[0] +
    stats.DEX * AVOID_WEIGHTS[1] +
    stats.INT * AVOID_WEIGHTS[2] +
    stats.LUK * AVOID_WEIGHTS[3];

  const base: SecondaryStats = {
    atk: Math.floor(baseAtk),
    mAtk: Math.floor(baseMAtk),
    wDef: BASE_SECONDARY.wDef,
    mDef: BASE_SECONDARY.mDef,
    critRate: BASE_SECONDARY.critRate,
    speed: BASE_SECONDARY.speed,
    jump: BASE_SECONDARY.jump,
    accuracy: Math.floor(baseAcc),
    avoid: Math.floor(baseAvoid),
  };

  // Apply optional equipment and effect (buff/passive) bonuses.
  const eq = equipBonus ?? {};
  const eff = effectBonus ?? {};

  return {
    atk: base.atk + (eq.atk ?? 0) + (eff.atk ?? 0),
    mAtk: base.mAtk + (eq.mAtk ?? 0) + (eff.mAtk ?? 0),
    wDef: base.wDef + (eq.wDef ?? 0) + (eff.wDef ?? 0),
    mDef: base.mDef + (eq.mDef ?? 0) + (eff.mDef ?? 0),
    critRate: base.critRate + (eq.critRate ?? 0) + (eff.critRate ?? 0),
    speed: base.speed + (eq.speed ?? 0) + (eff.speed ?? 0),
    jump: base.jump + (eq.jump ?? 0) + (eff.jump ?? 0),
    accuracy: base.accuracy + (eq.accuracy ?? 0) + (eff.accuracy ?? 0),
    avoid: base.avoid + (eq.avoid ?? 0) + (eff.avoid ?? 0),
  };
}

/** Convenience: physical attack power only, delegating to deriveSecondary. */
export function attackPower(stats: CharacterStats, primary: PrimaryStat): number {
  return deriveSecondary(stats, primary).atk;
}
