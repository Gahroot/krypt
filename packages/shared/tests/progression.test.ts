import { describe, it, expect } from "vitest";
import { ClassArchetype } from "../src/classes.js";
import { MAX_LEVEL, expForLevel, totalExpToLevel, applyExp } from "../src/progression.js";
import { AP_PER_LEVEL, SP_PER_LEVEL } from "../src/stats.js";

// ── expForLevel ────────────────────────────────────────────────────────────

describe("expForLevel", () => {
  it("returns 100 at level 1", () => {
    expect(expForLevel(1)).toBe(100);
  });

  it("matches the piecewise curve at key breakpoints", () => {
    // Lv 1–9: 80 + 20 × level
    expect(expForLevel(1)).toBe(100); // 80 + 20×1
    expect(expForLevel(5)).toBe(180); // 80 + 20×5
    expect(expForLevel(9)).toBe(260); // 80 + 20×9
    // Lv 10–29: 200 + 30 × level
    expect(expForLevel(10)).toBe(500); // 200 + 30×10
    expect(expForLevel(20)).toBe(800); // 200 + 30×20
    expect(expForLevel(29)).toBe(1070); // 200 + 30×29
    // Lv 30–69: 1000 + 10 × level²
    expect(expForLevel(30)).toBe(10000); // 1000 + 10×900
    expect(expForLevel(50)).toBe(26000); // 1000 + 10×2500
    expect(expForLevel(69)).toBe(48610); // 1000 + 10×4761
    // Lv 70–199: 4000 + 30 × level²
    expect(expForLevel(70)).toBe(151000); // 4000 + 30×4900
    expect(expForLevel(100)).toBe(304000); // 4000 + 30×10000
    expect(expForLevel(199)).toBe(1192030); // 4000 + 30×39601
  });

  it("returns 0 at MAX_LEVEL", () => {
    expect(expForLevel(MAX_LEVEL)).toBe(0);
  });

  it("is strictly monotonic below MAX_LEVEL", () => {
    for (let l = 1; l < MAX_LEVEL - 1; l++) {
      expect(expForLevel(l)).toBeLessThan(expForLevel(l + 1));
    }
  });

  it("rejects out-of-range levels", () => {
    expect(() => expForLevel(0)).toThrow(RangeError);
    expect(() => expForLevel(MAX_LEVEL + 1)).toThrow(RangeError);
    expect(() => expForLevel(1.5)).toThrow(RangeError);
  });
});

// ── totalExpToLevel ────────────────────────────────────────────────────────

describe("totalExpToLevel", () => {
  it("level 1 requires 0 total EXP", () => {
    expect(totalExpToLevel(1)).toBe(0);
  });

  it("level 2 = expForLevel(1)", () => {
    expect(totalExpToLevel(2)).toBe(expForLevel(1));
  });

  it("matches cumulative sum", () => {
    let sum = 0;
    for (let l = 1; l <= 10; l++) sum += expForLevel(l);
    expect(totalExpToLevel(11)).toBe(sum);
  });

  it("rejects out-of-range levels", () => {
    expect(() => totalExpToLevel(0)).toThrow(RangeError);
    expect(() => totalExpToLevel(MAX_LEVEL + 1)).toThrow(RangeError);
  });
});

// ── applyExp: single level-up ──────────────────────────────────────────────

describe("applyExp — single level-up", () => {
  it("levels up from 1 → 2 with exactly enough EXP", () => {
    const result = applyExp(
      { level: 1, exp: 0 },
      expForLevel(1), // 100
      ClassArchetype.WARRIOR,
    );
    expect(result.level).toBe(2);
    expect(result.exp).toBe(0);
    expect(result.leveledUp).toBe(true);
    expect(result.levelsGained).toBe(1);
    expect(result.apGained).toBe(AP_PER_LEVEL);
    expect(result.spGained).toBe(SP_PER_LEVEL);
  });

  it("carries leftover EXP after a single level-up", () => {
    const result = applyExp(
      { level: 1, exp: 0 },
      expForLevel(1) + 50, // 150 total: level up to 2, 50 leftover
      ClassArchetype.MAGE,
    );
    expect(result.level).toBe(2);
    expect(result.exp).toBe(50);
    expect(result.levelsGained).toBe(1);
  });

  it("does not level up when EXP is insufficient", () => {
    const result = applyExp(
      { level: 1, exp: 0 },
      50, // need 100
      ClassArchetype.ARCHER,
    );
    expect(result.level).toBe(1);
    expect(result.exp).toBe(50);
    expect(result.leveledUp).toBe(false);
    expect(result.levelsGained).toBe(0);
    expect(result.apGained).toBe(0);
    expect(result.spGained).toBe(0);
  });
});

// ── applyExp: multi-level rollover ─────────────────────────────────────────

describe("applyExp — multi-level rollover", () => {
  it("rolls over multiple levels with a large EXP gain", () => {
    // From level 1, grant EXP to reach level 5
    // expForLevel(1..4) = 100+120+140+160 = 520
    const needed = totalExpToLevel(5); // sum of expForLevel(1..4)
    const result = applyExp({ level: 1, exp: 0 }, needed, ClassArchetype.THIEF);
    expect(result.level).toBe(5);
    expect(result.exp).toBe(0);
    expect(result.levelsGained).toBe(4);
    expect(result.apGained).toBe(4 * AP_PER_LEVEL);
    expect(result.spGained).toBe(4 * SP_PER_LEVEL);
  });

  it("rolls over many levels and keeps leftover EXP", () => {
    // Level 1 with 0 EXP, grant 10 000 EXP.
    // expForLevel(1..9) = 100+120+140+160+180+200+220+240+260 = 1620
    // expForLevel(10) = 500 → 2120, Lv11=530 → 2650, Lv12=560 → 3210
    // Lv13=590 → 3800, Lv14=620 → 4420, Lv15=650 → 5070
    // Lv16=680 → 5750, Lv17=710 → 6460, Lv18=740 → 7200
    // Lv19=770 → 7970, Lv20=800 → 8770, Lv21=830 → 9600
    // Lv22=860 → 10460 (exceeds 10000)
    // So: reach level 22, leftover = 10000 - 9600 = 400.
    const result = applyExp({ level: 1, exp: 0 }, 10_000, ClassArchetype.BEGINNER);
    expect(result.level).toBe(22);
    expect(result.exp).toBe(400);
    expect(result.levelsGained).toBe(21);
    expect(result.apGained).toBe(21 * AP_PER_LEVEL);
    expect(result.spGained).toBe(21 * SP_PER_LEVEL);
  });

  it("accumulates EXP from a previous partial level", () => {
    const result = applyExp({ level: 5, exp: 100 }, 2000, ClassArchetype.WARRIOR);
    // At level 5, need expForLevel(5) = 180 to reach 6.
    // Total EXP available: 2100. Should level up multiple times.
    expect(result.level).toBeGreaterThan(5);
    expect(result.leveledUp).toBe(true);
  });
});

// ── applyExp: MAX_LEVEL cap ────────────────────────────────────────────────

describe("applyExp — MAX_LEVEL cap", () => {
  it("discards EXP at MAX_LEVEL", () => {
    const result = applyExp({ level: MAX_LEVEL, exp: 0 }, 999_999_999, ClassArchetype.WARRIOR);
    expect(result.level).toBe(MAX_LEVEL);
    expect(result.exp).toBe(0);
    expect(result.levelsGained).toBe(0);
    expect(result.leveledUp).toBe(false);
  });

  it("caps exactly at MAX_LEVEL with excess EXP", () => {
    const result = applyExp(
      { level: MAX_LEVEL - 1, exp: 0 },
      expForLevel(MAX_LEVEL - 1) + 999_999,
      ClassArchetype.MAGE,
    );
    expect(result.level).toBe(MAX_LEVEL);
    expect(result.exp).toBe(0); // leftover discarded at cap
    expect(result.levelsGained).toBe(1);
  });
});

// ── applyExp: HP/MP recomputation ──────────────────────────────────────────

describe("applyExp — max HP/MP recomputation", () => {
  it("returns correct maxHp/maxMp for the final level (warrior)", () => {
    const result = applyExp({ level: 1, exp: 0 }, expForLevel(1), ClassArchetype.WARRIOR);
    expect(result.level).toBe(2);
    // Warrior: hpGrowth=22, mpGrowth=3
    expect(result.maxHp).toBe(50 + (2 - 1) * 22);
    expect(result.maxMp).toBe(5 + (2 - 1) * 3);
  });

  it("returns correct maxHp/maxMp for mage at level 10", () => {
    const needed = totalExpToLevel(10);
    const result = applyExp({ level: 1, exp: 0 }, needed, ClassArchetype.MAGE);
    expect(result.level).toBe(10);
    // Mage: hpGrowth=6, mpGrowth=18
    expect(result.maxHp).toBe(50 + (10 - 1) * 6);
    expect(result.maxMp).toBe(5 + (10 - 1) * 18);
  });
});

// ── applyExp: AP/SP accrual across archetypes ──────────────────────────────

describe("applyExp — AP/SP accrual", () => {
  it.each([
    [ClassArchetype.WARRIOR, 5, 25, 15],
    [ClassArchetype.MAGE, 3, 15, 9],
    [ClassArchetype.ARCHER, 10, 50, 30],
    [ClassArchetype.THIEF, 2, 10, 6],
    [ClassArchetype.PIRATE, 7, 35, 21],
    [ClassArchetype.BEGINNER, 1, 5, 3],
  ] as const)(
    "%s gains %d level(s) → %d AP, %d SP",
    (archetype, levels, expectedAp, expectedSp) => {
      let needed = 0;
      for (let l = 1; l < 1 + levels; l++) needed += expForLevel(l);
      const result = applyExp({ level: 1, exp: 0 }, needed, archetype);
      expect(result.levelsGained).toBe(levels);
      expect(result.apGained).toBe(expectedAp);
      expect(result.spGained).toBe(expectedSp);
    },
  );
});

// ── applyExp: edge cases ───────────────────────────────────────────────────

describe("applyExp — edge cases", () => {
  it("zero gain does nothing", () => {
    const result = applyExp({ level: 50, exp: 99 }, 0, ClassArchetype.WARRIOR);
    expect(result.level).toBe(50);
    expect(result.exp).toBe(99);
    expect(result.leveledUp).toBe(false);
  });

  it("rejects negative EXP gain", () => {
    expect(() => applyExp({ level: 1, exp: 0 }, -10, ClassArchetype.WARRIOR)).toThrow(RangeError);
  });

  it("rejects invalid current level", () => {
    expect(() => applyExp({ level: 0, exp: 0 }, 100, ClassArchetype.WARRIOR)).toThrow(RangeError);
    expect(() => applyExp({ level: MAX_LEVEL + 1, exp: 0 }, 100, ClassArchetype.WARRIOR)).toThrow(
      RangeError,
    );
  });
});

// ── Pure / deterministic ───────────────────────────────────────────────────

describe("applyExp — determinism", () => {
  it("same inputs always produce the same output", () => {
    const a = applyExp({ level: 10, exp: 500 }, 12_345, ClassArchetype.MAGE);
    const b = applyExp({ level: 10, exp: 500 }, 12_345, ClassArchetype.MAGE);
    expect(a).toEqual(b);
  });
});
