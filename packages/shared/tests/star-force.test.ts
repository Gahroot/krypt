import { describe, it, expect } from "vitest";
import {
  MAX_STARS,
  STAR_FORCE_TABLE,
  getStarForceTier,
  starForceOdds,
  starForceAtkBonus,
  starForceStatBonus,
  starForceCost,
  starForceMaterialCost,
  rollStarForce,
} from "../src/rarity.js";
import { mulberry32, sequence } from "./rng.js";

describe("star force — table invariants", () => {
  it("MAX_STARS is 15", () => {
    expect(MAX_STARS).toBe(15);
  });

  it("table has 15 entries (stars 0–14)", () => {
    expect(STAR_FORCE_TABLE.length).toBe(15);
  });

  it("every row sums to exactly 1.0 (success + fail + destroy)", () => {
    for (const t of STAR_FORCE_TABLE) {
      const sum = t.successRate + t.failRate + t.destroyRate;
      expect(sum).toBeCloseTo(1.0, 10);
    }
  });

  it("star indices are contiguous 0..14", () => {
    for (let i = 0; i < STAR_FORCE_TABLE.length; i++) {
      expect(STAR_FORCE_TABLE[i]!.star).toBe(i);
    }
  });

  it("success rate decreases monotonically", () => {
    for (let i = 1; i < STAR_FORCE_TABLE.length; i++) {
      expect(STAR_FORCE_TABLE[i]!.successRate).toBeLessThanOrEqual(
        STAR_FORCE_TABLE[i - 1]!.successRate,
      );
    }
  });

  it("destroy rate is 0 for stars 0–4 (safe zone)", () => {
    for (let i = 0; i <= 4; i++) {
      expect(STAR_FORCE_TABLE[i]!.destroyRate).toBe(0);
    }
  });

  it("destroy rate increases monotonically from star 5 onward", () => {
    for (let i = 6; i < STAR_FORCE_TABLE.length; i++) {
      expect(STAR_FORCE_TABLE[i]!.destroyRate).toBeGreaterThanOrEqual(
        STAR_FORCE_TABLE[i - 1]!.destroyRate,
      );
    }
  });
});

describe("star force — lookup helpers", () => {
  it("getStarForceTier returns the correct tier", () => {
    const t = getStarForceTier(0);
    expect(t).toBeDefined();
    expect(t!.successRate).toBe(0.95);
  });

  it("getStarForceTier returns undefined for MAX_STARS", () => {
    expect(getStarForceTier(MAX_STARS)).toBeUndefined();
  });

  it("starForceOdds returns matching probabilities", () => {
    const odds = starForceOdds(9);
    expect(odds).toBeDefined();
    expect(odds!.successRate).toBeCloseTo(0.5);
    expect(odds!.failRate).toBeCloseTo(0.35);
    expect(odds!.destroyRate).toBeCloseTo(0.15);
  });

  it("starForceOdds returns undefined when at max", () => {
    expect(starForceOdds(MAX_STARS)).toBeUndefined();
  });
});

describe("star force — cost curves", () => {
  it("meso cost starts at 500 for 0★", () => {
    expect(starForceCost(0)).toBe(500);
  });

  it("meso cost doubles roughly per star", () => {
    // star 5 → 500 * 2^5 = 16000
    expect(starForceCost(5)).toBe(16_000);
    // star 10 → 500 * 2^10 = 512000
    expect(starForceCost(10)).toBe(512_000);
  });

  it("material cost starts at 1 and increases", () => {
    expect(starForceMaterialCost(0)).toBe(1);
    expect(starForceMaterialCost(4)).toBe(5);
    expect(starForceMaterialCost(5)).toBe(6);
    expect(starForceMaterialCost(10)).toBe(18);
  });
});

describe("star force — bonus curves", () => {
  it("0 stars = no bonus", () => {
    expect(starForceAtkBonus(0)).toBe(0);
    expect(starForceStatBonus(0)).toBe(0);
  });

  it("bonuses are cumulative and increasing", () => {
    for (let i = 1; i <= MAX_STARS; i++) {
      expect(starForceAtkBonus(i)).toBeGreaterThan(starForceAtkBonus(i - 1));
      expect(starForceStatBonus(i)).toBeGreaterThan(starForceStatBonus(i - 1));
    }
  });

  it("15 stars gives total ATK bonus = sum of all atkBonus values", () => {
    const totalAtk = STAR_FORCE_TABLE.reduce((s, t) => s + t.atkBonus, 0);
    expect(starForceAtkBonus(MAX_STARS)).toBe(totalAtk);
  });

  it("15 stars gives total stat bonus = sum of all statBonus values", () => {
    const totalStat = STAR_FORCE_TABLE.reduce((s, t) => s + t.statBonus, 0);
    expect(starForceStatBonus(MAX_STARS)).toBe(totalStat);
  });
});

describe("star force — roll boundaries", () => {
  it("rng=0 yields success at 0★ (95% rate)", () => {
    const r = rollStarForce(0, () => 0);
    expect(r).toEqual({ outcome: "success", prevStars: 0, newStars: 1 });
  });

  it("rng=0.94 yields success, rng=0.95 yields fail at 0★", () => {
    expect(rollStarForce(0, () => 0.94)!.outcome).toBe("success");
    expect(rollStarForce(0, () => 0.95)!.outcome).toBe("fail");
  });

  it("rng very high yields destroy at high star levels", () => {
    // 14★: 25% success + 35% fail + 40% destroy. rng=0.99 is past 0.60 → destroy.
    expect(rollStarForce(14, () => 0.99)!.outcome).toBe("destroy");
  });

  it("returns null when already at MAX_STARS", () => {
    expect(rollStarForce(MAX_STARS)).toBeNull();
  });

  it("fail at 0★ keeps stars the same", () => {
    // 0★: 95% success, 5% fail. rng=0.97 → fail.
    const r = rollStarForce(0, () => 0.97);
    expect(r).toEqual({ outcome: "fail", prevStars: 0, newStars: 0 });
  });
});

describe("star force — seeded distribution", () => {
  it("observed frequencies track the public odds across multiple star levels", () => {
    const rng = mulberry32(0xbad51);
    const N = 50_000;

    // Test at several star levels to verify the weighted distribution.
    const testStars = [0, 5, 10, 14];

    for (const star of testStars) {
      const tier = getStarForceTier(star)!;
      let successes = 0;
      let fails = 0;
      let destroys = 0;

      for (let i = 0; i < N; i++) {
        const result = rollStarForce(star, rng);
        expect(result).not.toBeNull();
        if (result!.outcome === "success") successes++;
        else if (result!.outcome === "fail") fails++;
        else destroys++;
      }

      const successRate = successes / N;
      const failRate = fails / N;
      const destroyRate = destroys / N;

      // Allow ±3% tolerance for statistical variance over 50k samples.
      expect(successRate).toBeCloseTo(tier.successRate, 1);
      expect(failRate).toBeCloseTo(tier.failRate, 1);
      expect(destroyRate).toBeCloseTo(tier.destroyRate, 1);
    }
  });

  it("destroy distribution accumulates correctly over many attempts", () => {
    const rng = mulberry32(0xd15c1);
    const N = 100_000;

    // At 14★, destroy rate is 40%. Over 100k attempts, we expect ~40k destroys.
    let destroys = 0;
    for (let i = 0; i < N; i++) {
      const result = rollStarForce(14, rng);
      if (result!.outcome === "destroy") destroys++;
    }

    const destroyRate = destroys / N;
    expect(destroyRate).toBeGreaterThan(0.37);
    expect(destroyRate).toBeLessThan(0.43);
  });

  it("safe zone (stars 0–4) never destroys with any RNG", () => {
    const rng = mulberry32(0x5afe);
    for (let star = 0; star <= 4; star++) {
      for (let i = 0; i < 10_000; i++) {
        const result = rollStarForce(star, rng);
        expect(result!.outcome).not.toBe("destroy");
      }
    }
  });
});

describe("star force — forced outcomes via sequence RNG", () => {
  it("force success at 10★", () => {
    // 10★ success rate is 45%, so rng < 0.45 → success
    const r = rollStarForce(10, sequence([0.1]));
    expect(r).toEqual({ outcome: "success", prevStars: 10, newStars: 11 });
  });

  it("force fail at 10★", () => {
    // 10★: success 0.45, fail 0.35. rng in [0.45, 0.80) → fail
    const r = rollStarForce(10, sequence([0.6]));
    expect(r).toEqual({ outcome: "fail", prevStars: 10, newStars: 10 });
  });

  it("force destroy at 10★", () => {
    // 10★: success 0.45 + fail 0.35 = 0.80. rng >= 0.80 → destroy
    const r = rollStarForce(10, sequence([0.99]));
    expect(r).toEqual({ outcome: "destroy", prevStars: 10, newStars: 0 });
  });
});
