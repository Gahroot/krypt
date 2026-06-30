/**
 * Combat — deterministic, pure damage math with injectable randomness.
 *
 * Every function is a pure function of its inputs; the only side-effect source
 * is the caller-supplied `rng` callback, which defaults to `Math.random` for
 * convenience but can be seeded/replaced for deterministic replay on both the
 * authoritative server and the prediction client.
 *
 * Damage flow:
 *   1. hitChance → did the attack connect? (accuracy vs avoidance + level delta)
 *   2. rollCrit  → did the hit crit? (critRate vs rng)
 *   3. computeDamage → raw damage with min/max range, defense mitigation, crit
 *                       multiplier, and variance per hit.
 */

import type { Element } from "./mobs.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal attacker stats needed for damage computation. */
export interface AttackerCombatStats {
  /** Physical attack power (weapon + secondary). 0 for magic-only. */
  readonly atk: number;
  /** Magical attack power. 0 for physical-only. */
  readonly mAtk: number;
  /** Primary stat value used for scaling (e.g. STR for warrior). */
  readonly primaryStat: number;
  /** Skill damage percent (100 = 1× power, 200 = 2× power). */
  readonly skillDamagePercent: number;
  /** Number of separate hits in the attack. */
  readonly hitCount: number;
  /** Accuracy rating. */
  readonly accuracy: number;
  /** Critical hit rate (0–1). */
  readonly critRate: number;
  /** Attacker level. */
  readonly level: number;
}

/** Minimal defender stats for damage computation. */
export interface DefenderCombatStats {
  /** Physical defence. */
  readonly wDef: number;
  /** Magical defence. */
  readonly mDef: number;
  /** Avoidance (evasion) rating. Controls hitChance. */
  readonly avoid: number;
  /** Defender level. */
  readonly level: number;
}

export interface DamageResult {
  /** Total damage dealt across all hits. */
  readonly total: number;
  /** Damage dealt per individual hit. */
  readonly perHit: readonly number[];
  /** Whether the attack was a critical hit (true iff ANY hit critted). */
  readonly crit: boolean;
  /** Whether the attack connected at all (false = full miss). */
  readonly hit: boolean;
  /** Elemental multiplier applied (1 = neutral, 0 = immune, 0.5 = resist, 1.5 = weak). */
  readonly elementMultiplier: number;
}

export interface ComputeDamageOpts {
  /** Critical hit multiplier (default: 1.5). */
  readonly critMultiplier?: number;
  /** Injected RNG returning [0, 1). Default: Math.random. */
  readonly rng?: () => number;
  /** Element of the attack (FIRE, ICE, etc.). When set with targetElementMods, damage is scaled by the elemental multiplier. */
  readonly element?: Element;
  /** Target mob's elementMods map. Entries: 0=immune, 0.5=resist, 1.5=weak. Omitted entries default to 1. */
  readonly targetElementMods?: Partial<Record<Element, number>>;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Default critical hit damage multiplier. */
export const CRIT_MULTIPLIER = 1.5;

/**
 * Min/max damage as a fraction of base power.
 * At full defense, attacker still deals `DAMAGE_FLOOR` fraction of base power.
 * At zero defense, attacker deals up to `DAMAGE_CEIL` fraction.
 * These bounds mirror the MapleStory classic min-max range.
 */
export const DAMAGE_FLOOR = 0.3;
export const DAMAGE_CEIL = 1.0;

// ── Hit chance ───────────────────────────────────────────────────────────────

/**
 * Probability [0, 1] that an attack connects, given accuracy and avoidance
 * ratings.  A level advantage shifts the curve in the attacker's favour.
 *
 * Derived from the classic MapleStory formula:
 *   - accuracy >  avoidance → chance ≈ 1 − avoidance / (2 × accuracy)
 *   - accuracy ≤  avoidance → chance ≈ 2 × accuracy / avoidance
 *
 * @param attackerAccuracy  Attacker's accuracy rating.
 * @param defenderAvoid     Defender's avoidance rating.
 * @param levelDelta        `attackerLevel − defenderLevel`.
 *                          Positive = attacker is higher level (bonus).
 */
export function hitChance(
  attackerAccuracy: number,
  defenderAvoid: number,
  levelDelta: number,
): number {
  if (attackerAccuracy <= 0) return 0;
  if (defenderAvoid <= 0) return 1;

  // Base chance from the accuracy/avoidance ratio.
  let chance: number;
  if (attackerAccuracy >= defenderAvoid) {
    chance = 1 - defenderAvoid / (2 * attackerAccuracy);
  } else {
    chance = (2 * attackerAccuracy) / defenderAvoid;
  }

  // Level delta adjustment: ±1 % per level, capped to [0, 1].
  const levelBonus = Math.max(-0.25, Math.min(0.25, levelDelta * 0.01));
  chance += levelBonus;

  return Math.max(0, Math.min(1, chance));
}

// ── Critical hit ─────────────────────────────────────────────────────────────

/**
 * Roll for a critical hit.  Returns `true` if `rng() < critRate`.
 *
 * @param critRate  Probability of critting (0–1).
 * @param rng       RNG returning [0, 1). Default: `Math.random`.
 */
export function rollCrit(critRate: number, rng: () => number = Math.random): boolean {
  return rng() < critRate;
}

// ── Damage computation ───────────────────────────────────────────────────────

/**
 * Compute the damage of a single multi-hit attack.
 *
 * Algorithm:
 *   1. Base power   = (physical_atk + magical_atk) × (skillDamagePercent / 100)
 *   2. Min / max    = power × [DAMAGE_FLOOR, DAMAGE_CEIL] with a level-scaling
 *                     bonus that widens the range slightly per level.
 *   3. Defense      = (def × 4) / (attacker_level + 2)  — level-reduced mitigation.
 *   4. Raw per hit  = random in [min, max] − defense, floored at 1.
 *   5. Crit         = if rollCrit, multiply per-hit damage by critMultiplier.
 *   6. Hit          = if hitChance fails, every hit = 0 and crit = false.
 *
 * @param attacker  Attacker combat stats.
 * @param defender  Defender combat stats.
 * @param opts      Options: critMultiplier, rng.
 */
export function computeDamage(
  attacker: AttackerCombatStats,
  defender: DefenderCombatStats,
  opts: ComputeDamageOpts = {},
): DamageResult {
  const rng = opts.rng ?? Math.random;
  const critMul = opts.critMultiplier ?? CRIT_MULTIPLIER;

  // ── Elemental multiplier ──────────────────────────────────────
  let elemMul = 1;
  if (opts.element && opts.targetElementMods) {
    const entry = opts.targetElementMods[opts.element];
    if (entry !== undefined) elemMul = entry;
  }

  // ── Hit check ────────────────────────────────────────────────
  const levelDelta = attacker.level - defender.level;
  const hit = hitChance(attacker.accuracy, defender.avoid, levelDelta);
  if (rng() >= hit) {
    return {
      total: 0,
      perHit: new Array<number>(attacker.hitCount).fill(0),
      crit: false,
      hit: false,
      elementMultiplier: 1,
    };
  }

  // ── Base power ───────────────────────────────────────────────
  const basePower = (attacker.atk + attacker.mAtk) * (attacker.skillDamagePercent / 100);

  // ── Min / max range (level-scaled) ───────────────────────────
  const levelScale = 1 + attacker.level * 0.005;
  const minDmg = Math.max(1, Math.floor(basePower * DAMAGE_FLOOR * levelScale));
  const maxDmg = Math.max(minDmg, Math.floor(basePower * DAMAGE_CEIL * levelScale));

  // ── Defense mitigation ───────────────────────────────────────
  const defense = ((defender.wDef + defender.mDef) * 4) / (attacker.level + 2);

  // ── Roll per hit ─────────────────────────────────────────────
  const perHit: number[] = [];
  let total = 0;
  let anyCrit = false;

  for (let i = 0; i < attacker.hitCount; i++) {
    const variance = Math.floor(rng() * (maxDmg - minDmg + 1));
    let dmg = Math.max(1, minDmg + variance - Math.floor(defense));

    if (rollCrit(attacker.critRate, rng)) {
      dmg = Math.floor(dmg * critMul);
      anyCrit = true;
    }

    perHit.push(dmg);
    total += dmg;
  }

  // ── Apply elemental multiplier ────────────────────────────────
  if (elemMul !== 1) {
    const roundedMul = Math.round(elemMul * 100) / 100; // avoid fp noise
    total = 0;
    for (let i = 0; i < perHit.length; i++) {
      const hit = perHit[i];
      if (hit === undefined) continue;
      const scaled = Math.max(1, Math.floor(hit * roundedMul));
      perHit[i] = scaled;
      total += scaled;
    }
  }

  return { total, perHit, crit: anyCrit, hit: true, elementMultiplier: elemMul };
}
