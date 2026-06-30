import { describe, it, expect } from "vitest";
import {
  ClassArchetype,
  CLASSES,
  getClass,
  maxHpForLevel,
  maxMpForLevel,
  unlockedJobTier,
} from "../src/classes.js";

// ---------------------------------------------------------------------------
// Beginner class
// ---------------------------------------------------------------------------
describe("Beginner class", () => {
  const b = CLASSES[ClassArchetype.BEGINNER];

  it("exists in CLASSES record", () => {
    expect(b).toBeDefined();
    expect(getClass(ClassArchetype.BEGINNER)).toBe(b);
  });

  it("has the correct metadata", () => {
    expect(b.archetype).toBe(ClassArchetype.BEGINNER);
    expect(b.name).toBe("Beginner");
    expect(b.primaryStat).toBe("STR");
    expect(b.hometown).toBe("dawn-isle");
    expect(b.hpGrowth).toBe(12);
    expect(b.mpGrowth).toBe(6);
  });

  it("has exactly one job tier titled 'Islander'", () => {
    expect(b.jobTiers).toHaveLength(1);
    expect(b.jobTiers[0]!.tier).toBe(1);
    expect(b.jobTiers[0]!.title).toBe("Islander");
    expect(b.jobTiers[0]!.levelReq).toBe(10);
  });

  it("has Nimble Strike (active) and Island Ward (passive)", () => {
    const skills = b.jobTiers[0]!.skills;
    expect(skills).toHaveLength(2);

    const nimble = skills.find((s) => s.id === "beginner.nimble_strike");
    expect(nimble).toBeDefined();
    expect(nimble!.kind).toBe("active");
    expect(nimble!.jobTier).toBe(1);
    expect(nimble!.levelReq).toBe(10);

    const ward = skills.find((s) => s.id === "beginner.island_ward");
    expect(ward).toBeDefined();
    expect(ward!.kind).toBe("passive");
    expect(ward!.jobTier).toBe(1);
    expect(ward!.levelReq).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// maxHpForLevel / maxMpForLevel with Beginner
// ---------------------------------------------------------------------------
describe("Beginner HP/MP growth", () => {
  it("starts at base HP (50) at level 1", () => {
    expect(maxHpForLevel(ClassArchetype.BEGINNER, 1)).toBe(50);
  });

  it("gains 12 HP per level", () => {
    // level 10: 50 + 9 * 12 = 158
    expect(maxHpForLevel(ClassArchetype.BEGINNER, 10)).toBe(158);
  });

  it("starts at base MP (5) at level 1", () => {
    expect(maxMpForLevel(ClassArchetype.BEGINNER, 1)).toBe(5);
  });

  it("gains 6 MP per level", () => {
    // level 10: 5 + 9 * 6 = 59
    expect(maxMpForLevel(ClassArchetype.BEGINNER, 10)).toBe(59);
  });
});

// ---------------------------------------------------------------------------
// unlockedJobTier for Beginner
// ---------------------------------------------------------------------------
describe("Beginner unlockedJobTier", () => {
  it("returns 0 before level 10", () => {
    expect(unlockedJobTier(ClassArchetype.BEGINNER, 1)).toBe(0);
    expect(unlockedJobTier(ClassArchetype.BEGINNER, 9)).toBe(0);
  });

  it("unlocks tier 1 at level 10", () => {
    expect(unlockedJobTier(ClassArchetype.BEGINNER, 10)).toBe(1);
    expect(unlockedJobTier(ClassArchetype.BEGINNER, 50)).toBe(1);
  });
});
