import { describe, it, expect } from "vitest";
import {
  ClassArchetype,
  CLASSES,
  getClass,
  maxHpForLevel,
  maxMpForLevel,
  unlockedJobTier,
  allSkillsForClass,
} from "../src/classes.js";
import { skillsAvailableAt } from "../src/skillbook.js";

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

  it("has exactly one job tier titled 'Islander' starting at level 1", () => {
    expect(b.jobTiers).toHaveLength(1);
    expect(b.jobTiers[0]!.tier).toBe(1);
    expect(b.jobTiers[0]!.title).toBe("Islander");
    expect(b.jobTiers[0]!.levelReq).toBe(1);
  });

  it("has 6 skills: 4 tutorial + 2 pre-advancement", () => {
    const skills = b.jobTiers[0]!.skills;
    expect(skills).toHaveLength(6);
  });

  it("has Thrown Shell (active, Lv1, single hit)", () => {
    const skill = allSkillsForClass(ClassArchetype.BEGINNER).find(
      (s) => s.id === "beginner.thrown_shell",
    );
    expect(skill).toBeDefined();
    expect(skill!.kind).toBe("active");
    expect(skill!.jobTier).toBe(1);
    expect(skill!.levelReq).toBe(1);
    expect(skill!.hitCount!.base).toBe(1);
  });

  it("has Nimble Feet (buff, Lv1, speed boost)", () => {
    const skill = allSkillsForClass(ClassArchetype.BEGINNER).find(
      (s) => s.id === "beginner.nimble_feet",
    );
    expect(skill).toBeDefined();
    expect(skill!.kind).toBe("buff");
    expect(skill!.jobTier).toBe(1);
    expect(skill!.levelReq).toBe(1);
    expect(skill!.buffEffect).toEqual({ speed: 15 });
    expect(skill!.buffDurationMs).toBeDefined();
  });

  it("has Recovery (passive, Lv1)", () => {
    const skill = allSkillsForClass(ClassArchetype.BEGINNER).find(
      (s) => s.id === "beginner.recovery",
    );
    expect(skill).toBeDefined();
    expect(skill!.kind).toBe("passive");
    expect(skill!.jobTier).toBe(1);
    expect(skill!.levelReq).toBe(1);
    expect(skill!.buffEffect).toEqual({ hpMpRegen: 5 });
  });

  it("has Leap (passive, Lv3, jump boost)", () => {
    const skill = allSkillsForClass(ClassArchetype.BEGINNER).find((s) => s.id === "beginner.leap");
    expect(skill).toBeDefined();
    expect(skill!.kind).toBe("passive");
    expect(skill!.jobTier).toBe(1);
    expect(skill!.levelReq).toBe(3);
    expect(skill!.buffEffect).toEqual({ jump: 15 });
  });

  it("has Nimble Strike (active, Lv10) and Island Ward (passive, Lv12)", () => {
    const nimble = allSkillsForClass(ClassArchetype.BEGINNER).find(
      (s) => s.id === "beginner.nimble_strike",
    );
    expect(nimble).toBeDefined();
    expect(nimble!.kind).toBe("active");
    expect(nimble!.jobTier).toBe(1);
    expect(nimble!.levelReq).toBe(10);

    const ward = allSkillsForClass(ClassArchetype.BEGINNER).find(
      (s) => s.id === "beginner.island_ward",
    );
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
  it("unlocks tier 1 immediately at level 1", () => {
    expect(unlockedJobTier(ClassArchetype.BEGINNER, 1)).toBe(1);
  });

  it("stays at tier 1 at higher levels (no tier 2)", () => {
    expect(unlockedJobTier(ClassArchetype.BEGINNER, 10)).toBe(1);
    expect(unlockedJobTier(ClassArchetype.BEGINNER, 50)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Skill availability — Beginner gets skills progressively from Lv 1
// ---------------------------------------------------------------------------
describe("Beginner skill availability", () => {
  it("has Recovery, Thrown Shell, and Nimble Feet available at level 1", () => {
    const available = skillsAvailableAt(ClassArchetype.BEGINNER, 1);
    const ids = available.map((s) => s.id);
    expect(ids).toContain("beginner.recovery");
    expect(ids).toContain("beginner.thrown_shell");
    expect(ids).toContain("beginner.nimble_feet");
  });

  it("unlocks Leap at level 3", () => {
    const at2 = skillsAvailableAt(ClassArchetype.BEGINNER, 2).map((s) => s.id);
    expect(at2).not.toContain("beginner.leap");

    const at3 = skillsAvailableAt(ClassArchetype.BEGINNER, 3).map((s) => s.id);
    expect(at3).toContain("beginner.leap");
  });

  it("unlocks Nimble Strike at level 10 and Island Ward at level 12", () => {
    const at9 = skillsAvailableAt(ClassArchetype.BEGINNER, 9).map((s) => s.id);
    expect(at9).not.toContain("beginner.nimble_strike");
    expect(at9).not.toContain("beginner.island_ward");

    const at10 = skillsAvailableAt(ClassArchetype.BEGINNER, 10).map((s) => s.id);
    expect(at10).toContain("beginner.nimble_strike");
    expect(at10).not.toContain("beginner.island_ward");

    const at12 = skillsAvailableAt(ClassArchetype.BEGINNER, 12).map((s) => s.id);
    expect(at12).toContain("beginner.island_ward");
  });
});
