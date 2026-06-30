import { describe, it, expect } from "vitest";
import {
  hitChance,
  rollCrit,
  computeDamage,
  type AttackerCombatStats,
  type DefenderCombatStats,
} from "../src/combat.js";
import { MOBS } from "../src/mobs.js";
import { mulberry32, sequence } from "./rng.js";

// ── Shared test fixtures ──────────────────────────────────────────────────────

const WARRIOR: AttackerCombatStats = {
  atk: 300,
  mAtk: 20,
  primaryStat: 350,
  skillDamagePercent: 150,
  hitCount: 1,
  accuracy: 120,
  critRate: 0.15,
  level: 100,
};

const MAGE: AttackerCombatStats = {
  atk: 10,
  mAtk: 400,
  primaryStat: 400,
  skillDamagePercent: 120,
  hitCount: 2,
  accuracy: 90,
  critRate: 0.05,
  level: 80,
};

const NORMAL_MOB: DefenderCombatStats = { wDef: 50, mDef: 50, avoid: 80, level: 100 };
const BOSS: DefenderCombatStats = { wDef: 200, mDef: 200, avoid: 150, level: 110 };

// ── hitChance ─────────────────────────────────────────────────────────────────

describe("hitChance", () => {
  it("returns 0 when attacker accuracy is 0", () => {
    expect(hitChance(0, 100, 0)).toBe(0);
  });

  it("returns 1 when defender avoidance is 0", () => {
    expect(hitChance(100, 0, 0)).toBe(1);
  });

  it("returns ~0.5 when accuracy equals avoidance (same level)", () => {
    // accuracy > avoid → 1 - avoid/(2×acc) = 1 - 100/200 = 0.5
    // with levelBonus=0, chance = 0.5
    expect(hitChance(100, 100, 0)).toBe(0.5);
  });

  it("returns a higher probability when accuracy exceeds avoidance", () => {
    const chance = hitChance(200, 100, 0);
    // accuracy > avoid → 1 - 100/400 = 0.75
    expect(chance).toBeCloseTo(0.75);
  });

  it("returns a lower probability when avoidance exceeds accuracy", () => {
    const chance = hitChance(50, 200, 0);
    // accuracy ≤ avoid → 2×50/200 = 0.5
    expect(chance).toBeCloseTo(0.5);
  });

  it("applies level delta bonus for higher-level attacker", () => {
    const base = hitChance(100, 100, 0);
    const boosted = hitChance(100, 100, 10);
    // +10 levels → +0.1 bonus
    expect(boosted).toBeCloseTo(base + 0.1);
  });

  it("applies level delta penalty for lower-level attacker", () => {
    const base = hitChance(100, 100, 0);
    const penalized = hitChance(100, 100, -10);
    expect(penalized).toBeCloseTo(base - 0.1);
  });

  it("caps level bonus at ±0.25 (25 levels max shift)", () => {
    const extreme = hitChance(100, 100, 50);
    const maxCapped = hitChance(100, 100, 30);
    // Both should be clamped to +0.25 level bonus
    expect(extreme).toBe(maxCapped);
    expect(extreme).toBeCloseTo(0.5 + 0.25);
  });

  it("clamps final result to [0, 1]", () => {
    // Very high avoidance with huge level deficit
    const low = hitChance(10, 1000, -30);
    expect(low).toBeGreaterThanOrEqual(0);
    expect(low).toBeLessThanOrEqual(1);

    const high = hitChance(1000, 10, 30);
    expect(high).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
  });
});

// ── rollCrit ──────────────────────────────────────────────────────────────────

describe("rollCrit", () => {
  it("returns false when critRate is 0", () => {
    expect(rollCrit(0, () => 0.99)).toBe(false);
  });

  it("returns true when critRate is 1", () => {
    expect(rollCrit(1, () => 0.99)).toBe(true);
  });

  it("returns true when rng < critRate", () => {
    expect(rollCrit(0.3, () => 0.1)).toBe(true);
  });

  it("returns false when rng >= critRate", () => {
    expect(rollCrit(0.3, () => 0.5)).toBe(false);
  });

  it("is deterministic with a seeded RNG", () => {
    const rng = mulberry32(42);
    const results = Array.from({ length: 100 }, () => rollCrit(0.25, rng));
    // Re-run with the same seed — must be identical
    const rng2 = mulberry32(42);
    const results2 = Array.from({ length: 100 }, () => rollCrit(0.25, rng2));
    expect(results).toEqual(results2);
  });

  it("crit rate ~0.25 matches expected frequency over 10 000 rolls", () => {
    const rng = mulberry32(12345);
    let crits = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      if (rollCrit(0.25, rng)) crits++;
    }
    const observed = crits / N;
    expect(observed).toBeCloseTo(0.25, 1); // within 0.1
  });
});

// ── computeDamage — miss ──────────────────────────────────────────────────────

describe("computeDamage — miss", () => {
  it("returns all zeros when hitChance returns 0", () => {
    // accuracy=0 means hitChance=0, so rng won't matter
    const result = computeDamage({ ...WARRIOR, accuracy: 0, hitCount: 3 }, NORMAL_MOB, {
      rng: () => 0.5,
    });
    expect(result.hit).toBe(false);
    expect(result.total).toBe(0);
    expect(result.crit).toBe(false);
    expect(result.perHit).toEqual([0, 0, 0]);
  });

  it("returns all zeros when rng exceeds hitChance", () => {
    // hitChance(120, 50, 0) ≈ 0.792; rng=0.99 > 0.792 → miss
    const result = computeDamage(WARRIOR, NORMAL_MOB, { rng: () => 0.99 });
    expect(result.hit).toBe(false);
    expect(result.total).toBe(0);
  });
});

// ── computeDamage — normal hit ────────────────────────────────────────────────

describe("computeDamage — normal hit", () => {
  it("deals positive damage on a confirmed hit", () => {
    // Force a hit with rng returning 0.01 (< hitChance)
    // Force a non-crit with rng returning 0.99 (>= critRate=0.15)
    const rng = sequence([0.01, 0.99]);
    const result = computeDamage(WARRIOR, NORMAL_MOB, { rng });
    expect(result.hit).toBe(true);
    expect(result.total).toBeGreaterThan(0);
    expect(result.perHit.length).toBe(1);
  });

  it("damage scales with skillDamagePercent", () => {
    const rng = () => 0.01; // always hit, always crit
    const base = computeDamage({ ...WARRIOR, skillDamagePercent: 100 }, NORMAL_MOB, {
      rng,
      critMultiplier: 1,
    });
    const doubled = computeDamage({ ...WARRIOR, skillDamagePercent: 200 }, NORMAL_MOB, {
      rng,
      critMultiplier: 1,
    });
    // 200% should deal roughly 2× damage of 100% (ignoring defense diff from rounding)
    expect(doubled.total).toBeGreaterThan(base.total);
  });

  it("multi-hit attack produces perHit array of correct length", () => {
    const rng = sequence([0.01, 0.99, 0.01, 0.99, 0.01, 0.99]);
    const result = computeDamage({ ...MAGE, hitCount: 3 }, NORMAL_MOB, { rng });
    expect(result.hit).toBe(true);
    expect(result.perHit.length).toBe(3);
    expect(result.total).toBe(result.perHit.reduce((a, b) => a + b, 0));
  });

  it("total is always the sum of perHit", () => {
    const rng = mulberry32(777);
    const result = computeDamage(WARRIOR, NORMAL_MOB, { rng });
    expect(result.total).toBe(result.perHit.reduce((a, b) => a + b, 0));
  });

  it("each hit is at least 1 (min-damage floor)", () => {
    // High defense, weak attacker → damage is clamped at 1
    const rng = sequence([0.01, 0.5, 0.01, 0.5]);
    const result = computeDamage({ ...WARRIOR, atk: 5, mAtk: 0, skillDamagePercent: 100 }, BOSS, {
      rng,
      critMultiplier: 1,
    });
    expect(result.hit).toBe(true);
    for (const dmg of result.perHit) {
      expect(dmg).toBeGreaterThanOrEqual(1);
    }
  });
});

// ── computeDamage — crit ──────────────────────────────────────────────────────

describe("computeDamage — crit", () => {
  it("critMultiplier scales damage when rollCrit triggers", () => {
    // Same base: rng provides hit=0.01, variance=0.5, then crit roll
    // Crit version: crit roll = 0.0 → crit triggers (0.0 < 0.15)
    const rngCrit = sequence([0.01, 0.5, 0.0]);
    const critResult = computeDamage(WARRIOR, NORMAL_MOB, {
      rng: rngCrit,
    });

    // No-crit version: same hit + variance, but critRate=0 → never crits
    const rngNoCrit = sequence([0.01, 0.5, 0.99]);
    const noCritResult = computeDamage({ ...WARRIOR, critRate: 0 }, NORMAL_MOB, { rng: rngNoCrit });

    // Crit should deal more than no-crit
    expect(critResult.crit).toBe(true);
    expect(critResult.total).toBeGreaterThan(noCritResult.total);
  });

  it("crit=true in result when at least one hit crits", () => {
    const rng = sequence([0.01, 0.0]);
    const result = computeDamage(WARRIOR, NORMAL_MOB, { rng });
    expect(result.crit).toBe(true);
  });

  it("crit=false in result when no hits crit", () => {
    // rng for crit roll = 0.99 (> critRate=0.15) → no crit
    const rng = sequence([0.01, 0.99]);
    const result = computeDamage(WARRIOR, NORMAL_MOB, { rng });
    expect(result.crit).toBe(false);
  });

  it("custom critMultiplier is respected", () => {
    const rng = sequence([0.01, 0.0]);
    const result = computeDamage(WARRIOR, NORMAL_MOB, {
      rng,
      critMultiplier: 2.0,
    });
    expect(result.crit).toBe(true);
    // All hits should be multiplied by 2.0
    expect(result.total).toBeGreaterThan(0);
  });

  it("crit with 100% critRate always crits", () => {
    const rng = sequence([0.01, 0.99, 0.01, 0.99, 0.01, 0.99]);
    const result = computeDamage({ ...WARRIOR, critRate: 1, hitCount: 3 }, NORMAL_MOB, { rng });
    expect(result.crit).toBe(true);
  });
});

// ── computeDamage — defense mitigation ────────────────────────────────────────

describe("computeDamage — defense mitigation", () => {
  it("higher defense reduces damage", () => {
    const rng = sequence([0.01, 0.99]);
    const rng2 = sequence([0.01, 0.99]);
    const lowDef = computeDamage(WARRIOR, { ...NORMAL_MOB, wDef: 10, mDef: 10 }, { rng });
    const highDef = computeDamage(WARRIOR, { ...NORMAL_MOB, wDef: 200, mDef: 200 }, { rng: rng2 });
    expect(highDef.total).toBeLessThan(lowDef.total);
  });

  it("defense is level-scaled (higher attacker level = less mitigation)", () => {
    const rng = sequence([0.01, 0.99]);
    const rng2 = sequence([0.01, 0.99]);
    const lowLevel = computeDamage({ ...WARRIOR, level: 10 }, NORMAL_MOB, {
      rng,
      critMultiplier: 1,
    });
    const highLevel = computeDamage({ ...WARRIOR, level: 100 }, NORMAL_MOB, {
      rng: rng2,
      critMultiplier: 1,
    });
    // Defense = (def × 4) / (level + 2), so higher level → lower defense
    expect(highLevel.total).toBeGreaterThan(lowLevel.total);
  });

  it("zero defense allows full base-power damage", () => {
    const rng = sequence([0.01, 0.0]);
    const result = computeDamage(
      { ...WARRIOR, atk: 100, mAtk: 0, critRate: 1 },
      { wDef: 0, mDef: 0, avoid: 0, level: 100 },
      { rng, critMultiplier: 1 },
    );
    // basePower = 100 × (150/100) = 150
    // levelScale = 1 + 100 × 0.005 = 1.5
    // minDmg = floor(150 × 0.3 × 1.5) = floor(67.5) = 67
    // maxDmg = floor(150 × 1.0 × 1.5) = floor(225) = 225
    // rng for variance = 0.0 → variance = 0 → dmg = 67
    // crit × 1 → 67
    expect(result.perHit[0]).toBe(67);
  });
});

// ── computeDamage — mob defense integration ──────────────────────────────────

describe("computeDamage — mob defense from MobDef reduces damage", () => {
  const ATTACKER: AttackerCombatStats = {
    atk: 80,
    mAtk: 10,
    primaryStat: 120,
    skillDamagePercent: 100,
    hitCount: 1,
    accuracy: 100,
    critRate: 0,
    level: 10,
  };

  it("a level 10 mob's defense reduces damage compared to zero defense", () => {
    const mobDef = MOBS["mob.rock_lizard"]!;
    const rng = sequence([0.01, 0.99]);
    const rng2 = sequence([0.01, 0.99]);
    const withDef = computeDamage(
      ATTACKER,
      { wDef: mobDef.wDef, mDef: mobDef.mDef, avoid: mobDef.avoid, level: mobDef.level },
      { rng },
    );
    const noDef = computeDamage(
      ATTACKER,
      { wDef: 0, mDef: 0, avoid: 0, level: mobDef.level },
      { rng: rng2 },
    );
    expect(withDef.total).toBeLessThan(noDef.total);
    expect(withDef.total).toBeGreaterThan(0);
  });

  it("higher mob defense at the same level reduces damage further", () => {
    const mobDef = MOBS["mob.rock_lizard"]!; // wDef=14, mDef=8
    const baseDefender: DefenderCombatStats = {
      wDef: mobDef.wDef,
      mDef: mobDef.mDef,
      avoid: mobDef.avoid,
      level: mobDef.level,
    };
    const highDefender: DefenderCombatStats = {
      wDef: mobDef.wDef * 3,
      mDef: mobDef.mDef * 3,
      avoid: baseDefender.avoid,
      level: mobDef.level,
    };
    const rng1 = sequence([0.01, 0.99]);
    const rng2 = sequence([0.01, 0.99]);
    const base = computeDamage(ATTACKER, baseDefender, { rng: rng1 });
    const high = computeDamage(ATTACKER, highDefender, { rng: rng2 });
    expect(high.total).toBeLessThan(base.total);
  });
});

// ── computeDamage — deterministic ─────────────────────────────────────────────

describe("computeDamage — deterministic", () => {
  it("identical inputs + same rng produce identical results", () => {
    const makeRng = () => mulberry32(42);
    const a = computeDamage(WARRIOR, NORMAL_MOB, { rng: makeRng() });
    const b = computeDamage(WARRIOR, NORMAL_MOB, { rng: makeRng() });
    expect(a).toEqual(b);
  });

  it("different seeds produce different results (probabilistic)", () => {
    const a = computeDamage(WARRIOR, NORMAL_MOB, { rng: mulberry32(1) });
    const b = computeDamage(WARRIOR, NORMAL_MOB, { rng: mulberry32(999) });
    // Not guaranteed but overwhelmingly likely
    expect(a.total).not.toBe(b.total);
  });
});

// ── computeDamage — edge cases ────────────────────────────────────────────────

describe("computeDamage — edge cases", () => {
  it("attacker with zero attack power still deals min 1 per hit", () => {
    const rng = sequence([0.01, 0.99]);
    const result = computeDamage({ ...WARRIOR, atk: 0, mAtk: 0 }, NORMAL_MOB, {
      rng,
      critMultiplier: 1,
    });
    expect(result.hit).toBe(true);
    expect(result.perHit[0]).toBeGreaterThanOrEqual(1);
  });

  it("hitCount=0 returns empty perHit and total=0", () => {
    const rng = () => 0.01;
    const result = computeDamage({ ...WARRIOR, hitCount: 0 }, NORMAL_MOB, { rng });
    expect(result.hit).toBe(true);
    expect(result.perHit).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("does not mutate input objects", () => {
    const attacker = { ...WARRIOR };
    const defender = { ...NORMAL_MOB };
    const attackerSnapshot = { ...attacker };
    const defenderSnapshot = { ...defender };
    const rng = mulberry32(42);
    computeDamage(attacker, defender, { rng });
    expect(attacker).toEqual(attackerSnapshot);
    expect(defender).toEqual(defenderSnapshot);
  });
});

// ── computeDamage — elemental multiplier ──────────────────────────────────────

describe("computeDamage — elemental multiplier", () => {
  it("returns elementMultiplier=1 when no element is specified", () => {
    const rng = sequence([0.01, 0.99]);
    const result = computeDamage(WARRIOR, NORMAL_MOB, { rng });
    expect(result.elementMultiplier).toBe(1);
  });

  it("returns elementMultiplier=1 when element is set but target has no mods", () => {
    const rng = sequence([0.01, 0.99]);
    const result = computeDamage(WARRIOR, NORMAL_MOB, {
      rng,
      element: "FIRE",
      targetElementMods: {},
    });
    expect(result.elementMultiplier).toBe(1);
  });

  it("applies immunity (0) — total becomes 1 minimum", () => {
    const base = computeDamage(WARRIOR, NORMAL_MOB, { rng: sequence([0.01, 0.5]) });
    const immune = computeDamage(WARRIOR, NORMAL_MOB, {
      rng: sequence([0.01, 0.5]),
      element: "FIRE",
      targetElementMods: { FIRE: 0 },
    });
    expect(immune.elementMultiplier).toBe(0);
    // Total is floored at 1 (minimum)
    expect(immune.total).toBe(1);
    expect(base.total).toBeGreaterThan(1);
  });

  it("applies resist (0.5) — reduces total by half", () => {
    const base = computeDamage(WARRIOR, NORMAL_MOB, { rng: sequence([0.01, 0.5]) });
    const resist = computeDamage(WARRIOR, NORMAL_MOB, {
      rng: sequence([0.01, 0.5]),
      element: "ICE",
      targetElementMods: { ICE: 0.5 },
    });
    expect(resist.elementMultiplier).toBe(0.5);
    expect(resist.total).toBeLessThan(base.total);
    expect(resist.total).toBe(Math.max(1, Math.floor(base.total * 0.5)));
  });

  it("applies weakness (1.5) — increases total by 50%", () => {
    const base = computeDamage(WARRIOR, NORMAL_MOB, { rng: sequence([0.01, 0.5]) });
    const weak = computeDamage(WARRIOR, NORMAL_MOB, {
      rng: sequence([0.01, 0.5]),
      element: "HOLY",
      targetElementMods: { HOLY: 1.5, DARK: 0 },
    });
    expect(weak.elementMultiplier).toBe(1.5);
    expect(weak.total).toBeGreaterThan(base.total);
    expect(weak.total).toBe(Math.floor(base.total * 1.5));
  });

  it("applies multiplier to each hit and total (multi-hit)", () => {
    const rng = sequence([0.01, 0.5, 0.01, 0.5, 0.01, 0.5]);
    const base = computeDamage({ ...WARRIOR, hitCount: 3 }, NORMAL_MOB, { rng });
    const weak = computeDamage({ ...WARRIOR, hitCount: 3 }, NORMAL_MOB, {
      rng: sequence([0.01, 0.5, 0.01, 0.5, 0.01, 0.5]),
      element: "FIRE",
      targetElementMods: { FIRE: 1.5 },
    });
    expect(weak.elementMultiplier).toBe(1.5);
    expect(weak.total).toBeGreaterThan(base.total);
    // Per-hit values are post-element, so total = sum(perHit)
    expect(weak.total).toBe(weak.perHit.reduce((a, b) => a + b, 0));
  });

  it("only looks up the specified element in targetElementMods", () => {
    const rng = sequence([0.01, 0.5]);
    const result = computeDamage(WARRIOR, NORMAL_MOB, {
      rng,
      element: "FIRE",
      targetElementMods: { ICE: 0, FIRE: 1.5, DARK: 0 },
    });
    // FIRE entry = 1.5; ICE and DARK entries are ignored for a FIRE attack
    expect(result.elementMultiplier).toBe(1.5);
  });

  it("default multiplier of 1 when element not in mods map", () => {
    const base = computeDamage(WARRIOR, NORMAL_MOB, { rng: sequence([0.01, 0.5]) });
    const noEntry = computeDamage(WARRIOR, NORMAL_MOB, {
      rng: sequence([0.01, 0.5]),
      element: "LIGHTNING",
      targetElementMods: { FIRE: 1.5 },
    });
    expect(noEntry.elementMultiplier).toBe(1);
    // Same total as base (no modifier applied)
    expect(noEntry.total).toBe(base.total);
  });
});
