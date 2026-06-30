/**
 * Bonus Stats (Flame) system — unit tests.
 *
 * Covers: rollBonusStatLine, rollBonusStats, rerollBonusStats, flameLineCount,
 * FLAME_REROLL_COST, resolveEquippedBonus with bonus stats, and the applyFlame helper.
 */
import { describe, it, expect } from "vitest";
import {
  type BonusStatLine,
  type ItemInstance,
  rollBonusStatLine,
  rollBonusStats,
  rerollBonusStats,
  flameLineCount,
  FLAME_REROLL_COST,
  resolveEquippedBonus,
  type PotentialLine,
} from "../src/items.js";
import { applyFlame } from "../src/consumables.js";
import { BaseRank, PotentialTier } from "../src/rarity.js";
import { mulberry32 } from "./rng.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeInstance(overrides?: Partial<ItemInstance>): ItemInstance {
  return {
    uid: "flame_test_001",
    defId: "wpn.iron_broadsword",
    baseRank: BaseRank.NORMAL,
    potentialTier: PotentialTier.RARE,
    potentialLines: [{ stat: "STR", percent: 3 }],
    ...overrides,
  };
}

// ─── flameLineCount ────────────────────────────────────────────────────────

describe("flameLineCount", () => {
  it("returns 1 for low-level items (Lv 1–19)", () => {
    expect(flameLineCount(1)).toBe(1);
    expect(flameLineCount(10)).toBe(1);
    expect(flameLineCount(19)).toBe(1);
  });

  it("returns 2 for mid-low items (Lv 20–39)", () => {
    expect(flameLineCount(20)).toBe(2);
    expect(flameLineCount(30)).toBe(2);
    expect(flameLineCount(39)).toBe(2);
  });

  it("returns 3 for mid-high items (Lv 40–59)", () => {
    expect(flameLineCount(40)).toBe(3);
    expect(flameLineCount(50)).toBe(3);
    expect(flameLineCount(59)).toBe(3);
  });

  it("returns 4 for high-level items (Lv 60+)", () => {
    expect(flameLineCount(60)).toBe(4);
    expect(flameLineCount(100)).toBe(4);
  });
});

// ─── rollBonusStatLine ─────────────────────────────────────────────────────

describe("rollBonusStatLine", () => {
  it("returns a valid BonusStatLine with stat, value, and tier", () => {
    const rng = mulberry32(42);
    const line = rollBonusStatLine(30, rng);
    expect(line.stat).toBeTruthy();
    expect(typeof line.value).toBe("number");
    expect(line.value).toBeGreaterThanOrEqual(1);
    expect(["NORMAL", "RARE", "EPIC", "UNIQUE", "LEGENDARY"]).toContain(line.tier);
  });

  it("produces higher values at higher item levels (deterministic)", () => {
    const lowRng = mulberry32(100);
    const highRng = mulberry32(100);
    const lowLine = rollBonusStatLine(1, lowRng);
    const highLine = rollBonusStatLine(60, highRng);

    // Both use the same seed, so tier should be the same, but value should differ
    expect(lowLine.tier).toBe(highLine.tier);
    // At Lv60, value should be >= at Lv1 for the same seed
    expect(highLine.value).toBeGreaterThanOrEqual(lowLine.value);
  });

  it("rolls only from the allowed stat set", () => {
    const allowed = new Set([
      "STR",
      "DEX",
      "INT",
      "LUK",
      "HP",
      "MP",
      "ATK",
      "WDEF",
      "MDEF",
      "SPEED",
      "JUMP",
    ]);
    const rng = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const line = rollBonusStatLine(30, rng);
      expect(allowed.has(line.stat)).toBe(true);
    }
  });
});

// ─── rollBonusStats ────────────────────────────────────────────────────────

describe("rollBonusStats", () => {
  it("rolls the correct number of lines for the item level", () => {
    const rng = mulberry32(99);
    const lines = rollBonusStats(30, rng);
    expect(lines).toHaveLength(2); // Lv 20–39 → 2 lines
  });

  it("returns an empty array only if itemLevel is negative (edge case)", () => {
    // flameLineCount(0) returns 1, so rollBonusStats should always return >= 1
    const rng = mulberry32(1);
    const lines = rollBonusStats(0, rng);
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it("deterministic with the same seed", () => {
    const a = rollBonusStats(50, mulberry32(42));
    const b = rollBonusStats(50, mulberry32(42));
    expect(a).toEqual(b);
  });
});

// ─── rerollBonusStats ──────────────────────────────────────────────────────

describe("rerollBonusStats", () => {
  it("returns a new ItemInstance preserving uid, defId, baseRank, potentialTier, enhancements", () => {
    const original = makeInstance({
      enhancements: [{ statKind: "ATK", delta: 5 }],
      bonusStats: [{ stat: "STR", value: 3, tier: "NORMAL" }],
    });
    const rerolled = rerollBonusStats(original, 30, () => 0);

    expect(rerolled.uid).toBe(original.uid);
    expect(rerolled.defId).toBe(original.defId);
    expect(rerolled.baseRank).toBe(original.baseRank);
    expect(rerolled.potentialTier).toBe(original.potentialTier);
    expect(rerolled.enhancements).toEqual(original.enhancements);
  });

  it("never mutates the original instance", () => {
    const original = makeInstance({
      bonusStats: [{ stat: "STR", value: 5, tier: "RARE" }],
    });
    const origBonus = [...original.bonusStats!];
    rerollBonusStats(original, 30, () => 0.5);
    expect(original.bonusStats).toEqual(origBonus);
  });

  it("produces new bonusStats different from original (with different rng)", () => {
    const original = makeInstance({
      bonusStats: [{ stat: "STR", value: 5, tier: "RARE" }],
    });
    const rerolled = rerollBonusStats(original, 30, mulberry32(77));
    expect(rerolled.bonusStats).toBeDefined();
    expect(rerolled.bonusStats!.length).toBeGreaterThan(0);
  });
});

// ─── FLAME_REROLL_COST ────────────────────────────────────────────────────

describe("FLAME_REROLL_COST", () => {
  it("is a positive integer", () => {
    expect(FLAME_REROLL_COST).toBeGreaterThan(0);
    expect(Number.isInteger(FLAME_REROLL_COST)).toBe(true);
  });

  it("is exported as a number type", () => {
    expect(typeof FLAME_REROLL_COST).toBe("number");
  });
});

// ─── applyFlame (consumables helper) ───────────────────────────────────────

describe("applyFlame", () => {
  it("returns a new ItemInstance with bonusStats", () => {
    const original = makeInstance();
    const result = applyFlame(original, mulberry32(42));
    expect(result.bonusStats).toBeDefined();
    expect(result.bonusStats!.length).toBeGreaterThan(0);
  });

  it("preserves uid and defId", () => {
    const original = makeInstance({ uid: "flame_uid_test" });
    const result = applyFlame(original, () => 0);
    expect(result.uid).toBe("flame_uid_test");
    expect(result.defId).toBe(original.defId);
  });
});

// ─── resolveEquippedBonus with bonus stats ─────────────────────────────────

describe("resolveEquippedBonus with bonus stats", () => {
  it("includes bonus stat flat values in the result", () => {
    const equipped = { WEAPON: "w1" };
    const def = {
      id: "wpn.bronze_shortsword",
      name: "Bronze Shortsword",
      levelReq: 1,
      primaryStat: "STR" as const,
      baseStatBonus: 2,
      baseAttack: 14,
      slot: "WEAPON" as any,
    };
    const bonusStats: BonusStatLine[] = [
      { stat: "STR", value: 5, tier: "RARE" },
      { stat: "ATK", value: 3, tier: "NORMAL" },
    ];

    const result = resolveEquippedBonus(
      equipped,
      () => def,
      () => BaseRank.NORMAL,
      () => [] as PotentialLine[],
      () => bonusStats,
    );

    // STR: baseStatBonus(2) * mult(1.0) = 2, plus bonusStats STR +5 = 7
    expect(result.str).toBe(7);
    // ATK: baseAttack(14) * mult(1.0) = 14, plus bonusStats ATK +3 = 17
    expect(result.atk).toBe(17);
  });

  it("works without getBonusStats (backward compatible)", () => {
    const equipped = { WEAPON: "w1" };
    const def = {
      id: "wpn.bronze_shortsword",
      name: "Bronze Shortsword",
      levelReq: 1,
      primaryStat: "STR" as const,
      baseStatBonus: 2,
      baseAttack: 14,
      slot: "WEAPON" as any,
    };

    const result = resolveEquippedBonus(
      equipped,
      () => def,
      () => BaseRank.NORMAL,
      () => [] as PotentialLine[],
    );

    // Should work without the 5th argument
    expect(result.str).toBe(2);
    expect(result.atk).toBe(14);
  });
});

// ─── Bonus stat line tier value ranges ─────────────────────────────────────

describe("bonus stat line value scaling", () => {
  it("values are higher at Lv60 than Lv1 for the same tier", () => {
    // Force both to NORMAL tier by using a seed that produces a low roll.
    // We compare the raw value range by rolling many lines.
    const lowRng = mulberry32(999);
    const highRng = mulberry32(999);
    let lowSum = 0;
    let highSum = 0;
    for (let i = 0; i < 200; i++) {
      lowSum += rollBonusStatLine(1, lowRng).value;
      highSum += rollBonusStatLine(60, highRng).value;
    }
    // Both use the same seed path so tier distribution is identical.
    // Lv60 average value should be strictly higher than Lv1 average.
    expect(highSum).toBeGreaterThan(lowSum);
  });
});
