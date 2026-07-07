import { describe, it, expect } from "vitest";
import { MAX_LEVEL, deathPenaltyPercent, deathExpLoss } from "../src/progression.js";

// ── deathPenaltyPercent ────────────────────────────────────────────────────

describe("deathPenaltyPercent", () => {
  it("returns 0% for safe / tutorial levels (1–10)", () => {
    for (let lv = 1; lv <= 10; lv++) {
      expect(deathPenaltyPercent(lv)).toBe(0);
    }
  });

  it("returns 2% for levels 11–20", () => {
    for (let lv = 11; lv <= 20; lv++) {
      expect(deathPenaltyPercent(lv)).toBe(2);
    }
  });

  it("returns 4% for levels 21–30", () => {
    for (let lv = 21; lv <= 30; lv++) {
      expect(deathPenaltyPercent(lv)).toBe(4);
    }
  });

  it("returns 5% for levels 31–50", () => {
    for (let lv = 31; lv <= 50; lv++) {
      expect(deathPenaltyPercent(lv)).toBe(5);
    }
  });

  it("returns 6% for levels 51–70", () => {
    for (let lv = 51; lv <= 70; lv++) {
      expect(deathPenaltyPercent(lv)).toBe(6);
    }
  });

  it("returns 7% for levels 71–90", () => {
    for (let lv = 71; lv <= 90; lv++) {
      expect(deathPenaltyPercent(lv)).toBe(7);
    }
  });

  it("returns 8% for levels 91–120", () => {
    for (let lv = 91; lv <= 120; lv++) {
      expect(deathPenaltyPercent(lv)).toBe(8);
    }
  });

  it("returns 9% for levels 121–150", () => {
    for (let lv = 121; lv <= 150; lv++) {
      expect(deathPenaltyPercent(lv)).toBe(9);
    }
  });

  it("returns 10% for levels 151–200", () => {
    for (let lv = 151; lv <= 200; lv++) {
      expect(deathPenaltyPercent(lv)).toBe(10);
    }
  });

  it("is strictly non-decreasing across all levels", () => {
    for (let lv = 1; lv < MAX_LEVEL; lv++) {
      expect(deathPenaltyPercent(lv)).toBeLessThanOrEqual(deathPenaltyPercent(lv + 1));
    }
  });

  it("rejects out-of-range levels", () => {
    expect(() => deathPenaltyPercent(0)).toThrow(RangeError);
    expect(() => deathPenaltyPercent(MAX_LEVEL + 1)).toThrow(RangeError);
    expect(() => deathPenaltyPercent(1.5)).toThrow(RangeError);
  });
});

// ── deathExpLoss ───────────────────────────────────────────────────────────

describe("deathExpLoss", () => {
  it("returns 0 for safe levels (1–10)", () => {
    expect(deathExpLoss(1, 999)).toBe(0);
    expect(deathExpLoss(5, 500)).toBe(0);
    expect(deathExpLoss(10, 1000)).toBe(0);
  });

  it("computes correct loss at level 11 (2% of expForLevel(11))", () => {
    const expected = Math.floor((530 * 2) / 100); // floor(10.6) = 10
    expect(deathExpLoss(11, 9999)).toBe(expected);
  });

  it("computes correct loss at level 50 (5% of expForLevel(50))", () => {
    const expected = Math.floor((26000 * 5) / 100); // 1300
    expect(deathExpLoss(50, 99999)).toBe(expected);
  });

  it("computes correct loss at level 100 (8% of expForLevel(100))", () => {
    const expected = Math.floor((304000 * 8) / 100); // 24320
    expect(deathExpLoss(100, 999999)).toBe(expected);
  });

  it("computes correct loss at level 200 (10% of expForLevel(200) → 0, so loss = 0)", () => {
    // expForLevel(200) = 0 (MAX_LEVEL), so loss = floor(0 * 10 / 100) = 0
    expect(deathExpLoss(200, 999999)).toBe(0);
  });

  it("never exceeds currentExp (no de-level)", () => {
    // Level 50 player with only 50 EXP — penalty is 1300, but clamped to 50
    expect(deathExpLoss(50, 50)).toBe(50);
  });

  it("returns 0 when currentExp is 0", () => {
    expect(deathExpLoss(50, 0)).toBe(0);
    expect(deathExpLoss(100, 0)).toBe(0);
  });

  it("returns 0 when currentExp is negative (defensive)", () => {
    expect(() => deathExpLoss(50, -1)).toThrow(RangeError);
  });

  it("is deterministic (same inputs → same output)", () => {
    const a = deathExpLoss(75, 12345);
    const b = deathExpLoss(75, 12345);
    expect(a).toBe(b);
  });

  it("rejects out-of-range levels", () => {
    expect(() => deathExpLoss(0, 100)).toThrow(RangeError);
    expect(() => deathExpLoss(MAX_LEVEL + 1, 100)).toThrow(RangeError);
  });
});
