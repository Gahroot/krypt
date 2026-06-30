import { describe, it, expect } from "vitest";
import {
  BaseRank,
  upgradeBaseRank,
  upgradeCost,
  upgradeMaterialCost,
  UPGRADE_BASE_RATE,
  nextBaseRank,
  getBaseRankInfo,
  type UpgradeSuccess,
  type UpgradeDowngrade,
} from "../src/rarity.js";
import { mulberry32 } from "./rng.js";

// ─── upgradeCost / upgradeMaterialCost ───────────────────────────────────────

describe("upgradeCost", () => {
  it("ENHANCED costs 500 mesos", () => {
    expect(upgradeCost(BaseRank.ENHANCED)).toBe(500);
  });
  it("STARFORGED costs 2 000 mesos", () => {
    expect(upgradeCost(BaseRank.STARFORGED)).toBe(2000);
  });
  it("MYTHIC costs 8 000 mesos", () => {
    expect(upgradeCost(BaseRank.MYTHIC)).toBe(8000);
  });
  it("all costs are positive integers", () => {
    for (const rank of [BaseRank.ENHANCED, BaseRank.STARFORGED, BaseRank.MYTHIC]) {
      const cost = upgradeCost(rank);
      expect(cost).toBeGreaterThan(0);
      expect(Number.isInteger(cost)).toBe(true);
    }
  });
});

describe("upgradeMaterialCost", () => {
  it("ENHANCED costs 3 shards", () => {
    expect(upgradeMaterialCost(BaseRank.ENHANCED)).toBe(3);
  });
  it("STARFORGED costs 8 shards", () => {
    expect(upgradeMaterialCost(BaseRank.STARFORGED)).toBe(8);
  });
  it("MYTHIC costs 20 shards", () => {
    expect(upgradeMaterialCost(BaseRank.MYTHIC)).toBe(20);
  });
});

// ─── UPGRADE_BASE_RATE ──────────────────────────────────────────────────────

describe("UPGRADE_BASE_RATE", () => {
  it("is a probability in (0, 1)", () => {
    expect(UPGRADE_BASE_RATE).toBeGreaterThan(0);
    expect(UPGRADE_BASE_RATE).toBeLessThan(1);
  });

  it("is exported and auditable", () => {
    expect(typeof UPGRADE_BASE_RATE).toBe("number");
  });
});

// ─── upgradeBaseRank — success ───────────────────────────────────────────────

describe("upgradeBaseRank — success", () => {
  it("rng=0 (below rate) upgrades NORMAL → ENHANCED", () => {
    const result = upgradeBaseRank(BaseRank.NORMAL, { rng: () => 0 });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    expect((result as UpgradeSuccess).newRank).toBe(BaseRank.ENHANCED);
    expect((result as UpgradeSuccess).prevRank).toBe(BaseRank.NORMAL);
  });

  it("rng=0 upgrades ENHANCED → STARFORGED", () => {
    const result = upgradeBaseRank(BaseRank.ENHANCED, { rng: () => 0 });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    expect((result as UpgradeSuccess).newRank).toBe(BaseRank.STARFORGED);
  });

  it("rng=0 upgrades STARFORGED → MYTHIC", () => {
    const result = upgradeBaseRank(BaseRank.STARFORGED, { rng: () => 0 });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    expect((result as UpgradeSuccess).newRank).toBe(BaseRank.MYTHIC);
  });
});

// ─── upgradeBaseRank — failure (no downgrade) ────────────────────────────────

describe("upgradeBaseRank — failure without downgrade", () => {
  it("rng=1 (above rate) fails NORMAL, rank stays NORMAL", () => {
    const result = upgradeBaseRank(BaseRank.NORMAL, { rng: () => 1 });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    expect(result!.newRank).toBe(BaseRank.NORMAL);
    expect(result!.prevRank).toBe(BaseRank.NORMAL);
  });

  it("rng=0.99 fails STARFORGED, rank stays STARFORGED", () => {
    const result = upgradeBaseRank(BaseRank.STARFORGED, { rng: () => 0.99 });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    expect(result!.newRank).toBe(BaseRank.STARFORGED);
  });
});

// ─── upgradeBaseRank — failure with downgrade ────────────────────────────────

describe("upgradeBaseRank — failure with downgrade", () => {
  it("STARFORGED fails with downgrade → ENHANCED", () => {
    const result = upgradeBaseRank(BaseRank.STARFORGED, {
      rng: () => 1, // force fail
      allowDowngrade: true,
    });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    expect((result as UpgradeDowngrade).downgraded).toBe(true);
    expect(result!.newRank).toBe(BaseRank.ENHANCED);
    expect(result!.prevRank).toBe(BaseRank.STARFORGED);
  });

  it("ENHANCED fails with downgrade → NORMAL", () => {
    const result = upgradeBaseRank(BaseRank.ENHANCED, {
      rng: () => 1,
      allowDowngrade: true,
    });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    expect((result as UpgradeDowngrade).downgraded).toBe(true);
    expect(result!.newRank).toBe(BaseRank.NORMAL);
  });

  it("NORMAL fails with downgrade flag → stays NORMAL (can't go below)", () => {
    const result = upgradeBaseRank(BaseRank.NORMAL, {
      rng: () => 1,
      allowDowngrade: true,
    });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    expect(result!.newRank).toBe(BaseRank.NORMAL);
    // No `downgraded` property on plain UpgradeFailure
    expect((result as UpgradeDowngrade).downgraded).toBeUndefined();
  });
});

// ─── upgradeBaseRank — max rank returns null ─────────────────────────────────

describe("upgradeBaseRank — MYTHIC ceiling", () => {
  it("returns null when already at MYTHIC", () => {
    expect(upgradeBaseRank(BaseRank.MYTHIC)).toBeNull();
  });

  it("returns null regardless of RNG", () => {
    const rng = mulberry32(0xdeadbeef);
    for (let i = 0; i < 100; i++) {
      expect(upgradeBaseRank(BaseRank.MYTHIC, { rng })).toBeNull();
    }
  });
});

// ─── upgradeBaseRank — custom success rate ───────────────────────────────────

describe("upgradeBaseRank — custom successRate", () => {
  it("100% rate always succeeds", () => {
    for (let i = 0; i < 100; i++) {
      const result = upgradeBaseRank(BaseRank.NORMAL, {
        rng: () => 0.999999,
        successRate: 1.0,
      });
      expect(result).not.toBeNull();
      expect(result!.ok).toBe(true);
    }
  });

  it("0% rate always fails", () => {
    for (let i = 0; i < 100; i++) {
      const result = upgradeBaseRank(BaseRank.NORMAL, {
        rng: () => 0,
        successRate: 0,
      });
      expect(result).not.toBeNull();
      expect(result!.ok).toBe(false);
    }
  });
});

// ─── upgradeBaseRank — distribution audit ────────────────────────────────────

describe("upgradeBaseRank — distribution audit", () => {
  it("observed success rate matches UPGRADE_BASE_RATE within tolerance", () => {
    const rng = mulberry32(0xbadcafe1);
    const N = 100_000;
    let successes = 0;

    for (let i = 0; i < N; i++) {
      const result = upgradeBaseRank(BaseRank.NORMAL, { rng });
      if (result && result.ok) successes++;
    }

    const observed = successes / N;
    const TOLERANCE = 0.02;
    expect(observed).toBeGreaterThan(UPGRADE_BASE_RATE - TOLERANCE);
    expect(observed).toBeLessThan(UPGRADE_BASE_RATE + TOLERANCE);
  });
});

// ─── upgradeBaseRank — immutability ──────────────────────────────────────────

describe("upgradeBaseRank — immutability", () => {
  it("does not depend on or mutate external state", () => {
    const rank = BaseRank.NORMAL;
    const result1 = upgradeBaseRank(rank, { rng: () => 0.1 });
    const result2 = upgradeBaseRank(rank, { rng: () => 0.1 });
    expect(result1).toEqual(result2);
    expect(rank).toBe(BaseRank.NORMAL);
  });
});

// ─── nextBaseRank traversal ──────────────────────────────────────────────────

describe("nextBaseRank — full ladder traversal", () => {
  it("traverses the entire ladder: NORMAL → ENHANCED → STARFORGED → MYTHIC → null", () => {
    expect(nextBaseRank(BaseRank.NORMAL)).toBe(BaseRank.ENHANCED);
    expect(nextBaseRank(BaseRank.ENHANCED)).toBe(BaseRank.STARFORGED);
    expect(nextBaseRank(BaseRank.STARFORGED)).toBe(BaseRank.MYTHIC);
    expect(nextBaseRank(BaseRank.MYTHIC)).toBeNull();
  });
});

// ─── statMultiplier progression ──────────────────────────────────────────────

describe("statMultiplier — increases at each rank", () => {
  it("multipliers are strictly increasing", () => {
    const ranks = [BaseRank.NORMAL, BaseRank.ENHANCED, BaseRank.STARFORGED, BaseRank.MYTHIC];
    for (let i = 1; i < ranks.length; i++) {
      expect(getBaseRankInfo(ranks[i]!).statMultiplier).toBeGreaterThan(
        getBaseRankInfo(ranks[i - 1]!).statMultiplier,
      );
    }
  });

  it("NORMAL=1.0, ENHANCED=1.25, STARFORGED=1.6, MYTHIC=2.1", () => {
    expect(getBaseRankInfo(BaseRank.NORMAL).statMultiplier).toBe(1.0);
    expect(getBaseRankInfo(BaseRank.ENHANCED).statMultiplier).toBe(1.25);
    expect(getBaseRankInfo(BaseRank.STARFORGED).statMultiplier).toBe(1.6);
    expect(getBaseRankInfo(BaseRank.MYTHIC).statMultiplier).toBe(2.1);
  });
});
