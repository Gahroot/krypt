import { describe, it, expect } from "vitest";
import {
  PotentialTier,
  POTENTIAL_TIERS,
  TOTAL_POTENTIAL_WEIGHT,
  rollPotential,
  potentialOdds,
  isMintWorthy,
  getPotentialTierInfo,
  BaseRank,
  nextBaseRank,
} from "../src/rarity.js";
import { mulberry32, sequence } from "./rng.js";

describe("potential odds", () => {
  it("weights total 1300", () => {
    expect(TOTAL_POTENTIAL_WEIGHT).toBe(1300);
  });

  it("odds sum to 1", () => {
    const odds = potentialOdds();
    const sum = Object.values(odds).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("each tier has a distinct border color", () => {
    const colors = new Set(POTENTIAL_TIERS.map((t) => t.color));
    expect(colors.size).toBe(POTENTIAL_TIERS.length);
  });
});

describe("rollPotential — boundaries", () => {
  it("rng=0 yields the most common tier (RARE)", () => {
    expect(rollPotential(() => 0)).toBe(PotentialTier.RARE);
  });

  it("rng→1 yields the rarest tier (LEGENDARY)", () => {
    expect(rollPotential(() => 0.99999)).toBe(PotentialTier.LEGENDARY);
  });

  it("lands in EPIC just past the RARE weight boundary", () => {
    // cumulative: RARE [0,1000). EPIC [1000,1250). Pick roll=1100/1300.
    expect(rollPotential(() => 1100 / TOTAL_POTENTIAL_WEIGHT)).toBe(PotentialTier.EPIC);
  });
});

describe("rollPotential — distribution (seeded, deterministic)", () => {
  it("observed frequencies track the public weights", () => {
    const rng = mulberry32(0xc0ffee);
    const N = 200_000;
    const counts: Record<PotentialTier, number> = {
      [PotentialTier.RARE]: 0,
      [PotentialTier.EPIC]: 0,
      [PotentialTier.UNIQUE]: 0,
      [PotentialTier.LEGENDARY]: 0,
    };
    for (let i = 0; i < N; i++) counts[rollPotential(rng)]++;

    expect(counts[PotentialTier.RARE] / N).toBeGreaterThan(0.74);
    expect(counts[PotentialTier.RARE] / N).toBeLessThan(0.8);
    expect(counts[PotentialTier.EPIC] / N).toBeGreaterThan(0.17);
    expect(counts[PotentialTier.EPIC] / N).toBeLessThan(0.21);
    expect(counts[PotentialTier.UNIQUE] / N).toBeGreaterThan(0.025);
    expect(counts[PotentialTier.UNIQUE] / N).toBeLessThan(0.045);
    expect(counts[PotentialTier.LEGENDARY] / N).toBeGreaterThan(0.002);
    expect(counts[PotentialTier.LEGENDARY] / N).toBeLessThan(0.006);
  });
});

describe("Legendary mint flag path", () => {
  it("only LEGENDARY is mint-worthy", () => {
    expect(isMintWorthy(PotentialTier.RARE)).toBe(false);
    expect(isMintWorthy(PotentialTier.EPIC)).toBe(false);
    expect(isMintWorthy(PotentialTier.UNIQUE)).toBe(false);
    expect(isMintWorthy(PotentialTier.LEGENDARY)).toBe(true);
  });

  it("a forced Legendary roll sets the mint-pending condition", () => {
    // Force the rarest outcome, then exercise the exact branch the server uses to flag a mint.
    const tier = rollPotential(sequence([0.99999]));
    const mintPending = isMintWorthy(tier);
    expect(tier).toBe(PotentialTier.LEGENDARY);
    expect(mintPending).toBe(true);
  });

  it("a forced common roll does NOT flag a mint", () => {
    const tier = rollPotential(sequence([0]));
    expect(isMintWorthy(tier)).toBe(false);
  });
});

describe("base rank ladder", () => {
  it("each tier exposes lines + info", () => {
    expect(getPotentialTierInfo(PotentialTier.LEGENDARY).lines).toBe(3);
    expect(getPotentialTierInfo(PotentialTier.RARE).lines).toBe(1);
  });

  it("upgrades Normal → Enhanced → Star-forged → Mythic → null", () => {
    expect(nextBaseRank(BaseRank.NORMAL)).toBe(BaseRank.ENHANCED);
    expect(nextBaseRank(BaseRank.ENHANCED)).toBe(BaseRank.STARFORGED);
    expect(nextBaseRank(BaseRank.STARFORGED)).toBe(BaseRank.MYTHIC);
    expect(nextBaseRank(BaseRank.MYTHIC)).toBeNull();
  });
});
