/**
 * Progression — the canonical EXP curve and level-up mechanics.
 *
 * Pure + deterministic: identical results on authoritative server and client.
 * No MapleStory assets or names.
 *
 * After a level-up the server should recompute max HP/MP via
 * `maxHpForLevel` / `maxMpForLevel` from classes.ts, and the player
 * allocates the granted AP/SP themselves.
 */

import { ClassArchetype } from "./classes.js";
import { maxHpForLevel, maxMpForLevel } from "./classes.js";
import { AP_PER_LEVEL, SP_PER_LEVEL } from "./stats.js";

// ── Constants ──────────────────────────────────────────────────────────────

/** Maximum achievable character level. */
export const MAX_LEVEL = 200;

// ── EXP curve ──────────────────────────────────────────────────────────────

/**
 * EXP required to go from `level` → `level + 1`.
 *
 * Piecewise curve tuned so that a player grinding the highest-EXP mob in
 * their level band needs a smooth, gradually increasing number of kills
 * per level — no dead zones or spikes. Classic MapleStory pacing:
 *   • Lv  1–9  : fast (5–10 kills/level) — learn the game, feel powerful.
 *   • Lv 10–29 : steady (7–14 kills/level) — the Heartland grind.
 *   • Lv 30–69 : slower (17–33 kills/level) — Far Reaches expansion.
 *   • Lv 70+   : endgame ceiling.
 *
 * Piecewise segments:
 *   • Lv  1–9  :   80 + 20 × level     (gentle linear ramp)
 *   • Lv 10–29 :  200 + 30 × level     (moderate Heartland grind)
 *   • Lv 30–69 : 1000 + 10 × level²    (Far Reaches expansion)
 *   • Lv 70+   : 4000 + 30 × level²    (endgame ceiling)
 *
 * Mob EXP is tuned so the highest-EXP mob at each band yields a smooth
 * 5–33 kills-per-level progression — no dead zones, monotonic increase.
 *
 * Returns 0 at MAX_LEVEL (no further progression).
 */
export function expForLevel(level: number): number {
  if (level < 1 || level > MAX_LEVEL || !Number.isInteger(level)) {
    throw new RangeError(`level must be an integer in [1, ${MAX_LEVEL}], got ${level}`);
  }
  if (level >= MAX_LEVEL) return 0;
  if (level < 10) return 80 + 20 * level;
  if (level < 30) return 200 + 30 * level;
  if (level < 70) return 1000 + 10 * level * level;
  return 4000 + 30 * level * level;
}

/**
 * Total EXP required to reach `level` from level 1 (i.e. the sum of
 * `expForLevel(1)` through `expForLevel(level - 1)`).
 *
 * level 1 = 0 EXP (you start there).
 */
export function totalExpToLevel(level: number): number {
  if (level < 1 || level > MAX_LEVEL || !Number.isInteger(level)) {
    throw new RangeError(`level must be an integer in [1, ${MAX_LEVEL}], got ${level}`);
  }
  let total = 0;
  for (let l = 1; l < level; l++) {
    total += expForLevel(l);
  }
  return total;
}

// ── Level-up result ────────────────────────────────────────────────────────

export interface LevelUpResult {
  /** Final level after applying EXP. */
  readonly level: number;
  /** Remaining EXP toward the next level. */
  readonly exp: number;
  /** Whether at least one level-up occurred. */
  readonly leveledUp: boolean;
  /** Number of levels gained (0 when no level-up). */
  readonly levelsGained: number;
  /** Total AP granted across all level-ups in this call. */
  readonly apGained: number;
  /** Total SP granted across all level-ups in this call. */
  readonly spGained: number;
  /** New max HP recomputed for the final level. */
  readonly maxHp: number;
  /** New max MP recomputed for the final level. */
  readonly maxMp: number;
}

// ── Core function ──────────────────────────────────────────────────────────

/**
 * Apply `gained` EXP to a character, rolling over as many level-ups as needed.
 *
 * AP_PER_LEVEL and SP_PER_LEVEL are granted per level-up. Max HP/MP are
 * recomputed via the class definition (classes.ts).
 *
 * If the character is already at MAX_LEVEL the EXP is discarded.
 */
export function applyExp(
  current: { readonly level: number; readonly exp: number },
  gained: number,
  archetype: ClassArchetype,
): LevelUpResult {
  if (gained < 0) {
    throw new RangeError(`gained must be >= 0, got ${gained}`);
  }
  if (current.level < 1 || current.level > MAX_LEVEL) {
    throw new RangeError(`current.level must be in [1, ${MAX_LEVEL}], got ${current.level}`);
  }

  let level = current.level;
  let exp = current.exp + gained;

  // Roll over level-ups (cap at MAX_LEVEL).
  let levelsGained = 0;
  while (level < MAX_LEVEL && exp >= expForLevel(level)) {
    exp -= expForLevel(level);
    level++;
    levelsGained++;
  }

  // Clamp EXP at MAX_LEVEL (no further curve entry).
  if (level >= MAX_LEVEL) {
    exp = 0;
  }

  return {
    level,
    exp,
    leveledUp: levelsGained > 0,
    levelsGained,
    apGained: levelsGained * AP_PER_LEVEL,
    spGained: levelsGained * SP_PER_LEVEL,
    maxHp: maxHpForLevel(archetype, level),
    maxMp: maxMpForLevel(archetype, level),
  };
}

// ── Death penalty ───────────────────────────────────────────────────────────

/** Levels at or below this threshold are safe from death EXP penalties. */
export const DEATH_SAFE_LEVEL = 10;

/**
 * EXP loss percentage on death, scaled by level bracket (MapleStory-style).
 *
 * Brackets:
 *   1–10   →  0%  (safe tutorial zone)
 *   11–20  →  2%
 *   21–30  →  4%
 *   31–50  →  5%
 *   51–70  →  6%
 *   71–90  →  7%
 *   91–120 →  8%
 *   121–150 → 9%
 *   151–200 → 10%
 *
 * Throws RangeError for out-of-range or non-integer levels.
 */
export function deathPenaltyPercent(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    throw new RangeError(`level must be an integer in [1, ${MAX_LEVEL}], got ${level}`);
  }
  if (level <= 10) return 0;
  if (level <= 20) return 2;
  if (level <= 30) return 4;
  if (level <= 50) return 5;
  if (level <= 70) return 6;
  if (level <= 90) return 7;
  if (level <= 120) return 8;
  if (level <= 150) return 9;
  return 10;
}

/**
 * Calculate the EXP lost on death (MapleStory-style).
 *
 * Penalty = floor(expForLevel(level) × deathPenaltyPercent(level) / 100),
 * clamped to `currentExp` (you can never lose more EXP than you have — no de-levelling
 * from a death penalty).
 *
 * Returns 0 for safe levels (1–10), at MAX_LEVEL, or when currentExp is 0.
 *
 * @throws RangeError if level is out of [1, MAX_LEVEL] or currentExp is negative.
 */
export function deathExpLoss(level: number, currentExp: number): number {
  if (currentExp < 0) {
    throw new RangeError(`currentExp must be >= 0, got ${currentExp}`);
  }
  const pct = deathPenaltyPercent(level);
  if (pct === 0) return 0;
  const raw = Math.floor((expForLevel(level) * pct) / 100);
  return Math.min(raw, currentExp);
}
