import { describe, it, expect } from "vitest";
import {
  PotentialTier,
  TOTAL_POTENTIAL_WEIGHT,
  potentialOdds,
  getPotentialTierInfo,
  createVerifiableRoll,
  isMintWorthy,
} from "../src/rarity.js";
import { rerollPotential, CUBE_REROLL_COST, type ItemInstance } from "../src/items.js";
import { BaseRank } from "../src/rarity.js";
import { mulberry32 } from "./rng.js";

// ─── Fixture ────────────────────────────────────────────────────────────────

function makeInstance(overrides?: Partial<ItemInstance>): ItemInstance {
  return {
    uid: "test_item_001",
    defId: "wpn.bronze_shortsword",
    baseRank: BaseRank.NORMAL,
    potentialTier: PotentialTier.RARE,
    potentialLines: [{ stat: "STR", percent: 3 }],
    ...overrides,
  };
}

// ─── rerollPotential — basic contract ───────────────────────────────────────

describe("rerollPotential", () => {
  it("returns a new ItemInstance preserving uid, defId, baseRank, enhancements", () => {
    const original = makeInstance({
      enhancements: [{ statKind: "ATK", delta: 5 }],
    });
    const rerolled = rerollPotential(original, () => 0);

    expect(rerolled.uid).toBe(original.uid);
    expect(rerolled.defId).toBe(original.defId);
    expect(rerolled.baseRank).toBe(original.baseRank);
    expect(rerolled.enhancements).toEqual(original.enhancements);
  });

  it("never mutates the original instance", () => {
    const original = makeInstance();
    const originalTier = original.potentialTier;
    const originalLines = [...original.potentialLines];

    rerollPotential(original, () => 0.5);

    expect(original.potentialTier).toBe(originalTier);
    expect(original.potentialLines).toEqual(originalLines);
  });

  it("rng=0 yields RARE (most common tier)", () => {
    const rerolled = rerollPotential(makeInstance(), () => 0);
    expect(rerolled.potentialTier).toBe(PotentialTier.RARE);
    expect(rerolled.potentialLines.length).toBe(1); // RARE = 1 line
  });

  it("rng→1 yields LEGENDARY (rarest tier)", () => {
    const rerolled = rerollPotential(makeInstance(), () => 0.99999);
    expect(rerolled.potentialTier).toBe(PotentialTier.LEGENDARY);
    expect(rerolled.potentialLines.length).toBe(3); // LEGENDARY = 3 lines
  });

  it("line count matches the tier's declared line count", () => {
    // Use sequence to force each tier
    const tierSequence: [number, PotentialTier, number][] = [
      [0, PotentialTier.RARE, 1],
      [1100 / TOTAL_POTENTIAL_WEIGHT, PotentialTier.EPIC, 2],
      [1260 / TOTAL_POTENTIAL_WEIGHT, PotentialTier.UNIQUE, 3],
      [0.99999, PotentialTier.LEGENDARY, 3],
    ];

    for (const [rngVal, expectedTier, expectedLines] of tierSequence) {
      const rerolled = rerollPotential(makeInstance(), () => rngVal);
      expect(rerolled.potentialTier).toBe(expectedTier);
      expect(rerolled.potentialLines.length).toBe(expectedLines);
    }
  });

  it("each potential line has a valid stat and percent in [1,12]", () => {
    const rerolled = rerollPotential(makeInstance(), () => 0.5);
    const validStats = new Set(["STR", "DEX", "INT", "LUK", "HP", "MP", "ATK"]);
    for (const line of rerolled.potentialLines) {
      expect(validStats.has(line.stat)).toBe(true);
      expect(line.percent).toBeGreaterThanOrEqual(1);
      expect(line.percent).toBeLessThanOrEqual(12);
    }
  });
});

// ─── rerollPotential — odds match potentialOdds() over many seeded rolls ────

describe("rerollPotential — distribution audit", () => {
  it("observed tier frequencies match public potentialOdds() within tolerance", () => {
    const rng = mulberry32(0xbaad5eed);
    const N = 200_000;
    const odds = potentialOdds();
    const counts: Record<PotentialTier, number> = {
      [PotentialTier.RARE]: 0,
      [PotentialTier.EPIC]: 0,
      [PotentialTier.UNIQUE]: 0,
      [PotentialTier.LEGENDARY]: 0,
    };

    for (let i = 0; i < N; i++) {
      const rerolled = rerollPotential(makeInstance(), rng);
      counts[rerolled.potentialTier]++;
    }

    // Each tier should be within ±2 percentage points of its public odds.
    // This keeps the test stable while catching odds drift.
    const TOLERANCE = 0.02;
    for (const tier of Object.values(PotentialTier)) {
      const observed = counts[tier] / N;
      const expected = odds[tier];
      expect(observed).toBeGreaterThan(expected - TOLERANCE);
      expect(observed).toBeLessThan(expected + TOLERANCE);
    }
  });

  it("over many rerolls, line counts are consistent with tier distribution", () => {
    const rng = mulberry32(0xfaceb00c);
    const N = 10_000;
    let totalLines = 0;

    for (let i = 0; i < N; i++) {
      const rerolled = rerollPotential(makeInstance(), rng);
      totalLines += rerolled.potentialLines.length;
    }

    // Weighted average lines: (1000*1 + 250*2 + 45*3 + 5*3) / 1300 ≈ 1.23
    const avgLines = totalLines / N;
    expect(avgLines).toBeGreaterThan(1.1);
    expect(avgLines).toBeLessThan(1.4);
  });
});

// ─── CUBE_REROLL_COST constant ─────────────────────────────────────────────

describe("CUBE_REROLL_COST", () => {
  it("is a positive integer", () => {
    expect(CUBE_REROLL_COST).toBeGreaterThan(0);
    expect(Number.isInteger(CUBE_REROLL_COST)).toBe(true);
  });

  it("is auditable (exported, not hidden)", () => {
    // If this import compiles, the cost is public + auditable.
    expect(typeof CUBE_REROLL_COST).toBe("number");
  });
});

// ─── Verifiable Roll shape ──────────────────────────────────────────────────

describe("createVerifiableRoll", () => {
  it("returns a valid VerifiableRoll with seed + commitment", () => {
    const roll = createVerifiableRoll(12345, PotentialTier.EPIC);
    expect(roll.seed).toMatch(/^0x[0-9a-f]{8}$/);
    expect(roll.commitment).toMatch(/^0x[0-9a-f]{8}$/);
    expect(roll.newTier).toBe(PotentialTier.EPIC);
    expect(roll.linesCount).toBe(2); // EPIC = 2 lines
    expect(roll.timestamp).toBeGreaterThan(0);
  });

  it("same seed + tier produces same result (deterministic)", () => {
    const a = createVerifiableRoll(99999, PotentialTier.LEGENDARY, 1000);
    const b = createVerifiableRoll(99999, PotentialTier.LEGENDARY, 1000);
    expect(a).toEqual(b);
  });

  it("different seeds produce different hex values", () => {
    const a = createVerifiableRoll(1, PotentialTier.RARE, 1000);
    const b = createVerifiableRoll(2, PotentialTier.RARE, 1000);
    expect(a.seed).not.toBe(b.seed);
    expect(a.commitment).not.toBe(b.commitment);
  });

  it("linesCount matches tier's declared line count", () => {
    for (const tier of Object.values(PotentialTier)) {
      const roll = createVerifiableRoll(42, tier, 1000);
      expect(roll.linesCount).toBe(getPotentialTierInfo(tier).lines);
    }
  });
});

// ─── isMintWorthy — Legendary flags mint-pending ───────────────────────────

describe("isMintWorthy — mint-pending flag", () => {
  it("returns true ONLY for LEGENDARY", () => {
    expect(isMintWorthy(PotentialTier.RARE)).toBe(false);
    expect(isMintWorthy(PotentialTier.EPIC)).toBe(false);
    expect(isMintWorthy(PotentialTier.UNIQUE)).toBe(false);
    expect(isMintWorthy(PotentialTier.LEGENDARY)).toBe(true);
  });

  it("a seeded LEGENDARY roll triggers isMintWorthy", () => {
    // rng→1 yields LEGENDARY (rarest tier).
    const rerolled = rerollPotential(makeInstance(), () => 0.99999);
    expect(rerolled.potentialTier).toBe(PotentialTier.LEGENDARY);
    expect(isMintWorthy(rerolled.potentialTier)).toBe(true);
  });

  it("over 200k rolls, every LEGENDARY triggers isMintWorthy and no other tier does", () => {
    const rng = mulberry32(0xdeadbeef);
    const N = 200_000;
    for (let i = 0; i < N; i++) {
      const rerolled = rerollPotential(makeInstance(), rng);
      const shouldMint = isMintWorthy(rerolled.potentialTier);
      if (rerolled.potentialTier === PotentialTier.LEGENDARY) {
        expect(shouldMint).toBe(true);
      } else {
        expect(shouldMint).toBe(false);
      }
    }
  });
});
