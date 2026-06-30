import { describe, it, expect } from "vitest";
import { CLASSES, allSkillsForClass, skillStatAt, type SkillDef } from "../src/classes.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Find a skill def by id across all classes (including branches). */
function findSkill(id: string): SkillDef {
  for (const cls of Object.values(CLASSES)) {
    for (const s of allSkillsForClass(cls.archetype)) {
      if (s.id === id) return s;
    }
  }
  throw new Error(`Skill ${id} not found`);
}

// ── skillStatAt — basic resolution ─────────────────────────────────────────

describe("skillStatAt", () => {
  it("returns zeros for a skill with no combat data", () => {
    // A hypothetical skill with no combat fields
    const bare: SkillDef = {
      id: "test.bare",
      name: "Bare",
      description: "No combat data",
      maxLevel: 10,
      jobTier: 1,
      levelReq: 1,
      kind: "active",
    };
    const stats = skillStatAt(bare, 5);
    expect(stats.mpCost).toBe(0);
    expect(stats.cooldownMs).toBe(0);
    expect(stats.damagePercent).toBe(0);
    expect(stats.hitCount).toBe(0);
    expect(stats.targetCount).toBe(0);
    expect(stats.buffDurationMs).toBe(0);
    expect(stats.buffEffect).toBeUndefined();
  });

  it("resolves a static BasePerLevel (perLevel = 0)", () => {
    const flat: SkillDef = {
      id: "test.flat",
      name: "Flat",
      description: "Flat values",
      maxLevel: 10,
      jobTier: 1,
      levelReq: 1,
      kind: "active",
      mpCost: { base: 20, perLevel: 0 },
      cooldownMs: { base: 1000, perLevel: 0 },
    };
    const s1 = skillStatAt(flat, 1);
    const s10 = skillStatAt(flat, 10);
    expect(s1.mpCost).toBe(20);
    expect(s10.mpCost).toBe(20);
    expect(s1.cooldownMs).toBe(1000);
    expect(s10.cooldownMs).toBe(1000);
  });

  it("resolves linear scaling (base + perLevel × (level − 1))", () => {
    const scaling: SkillDef = {
      id: "test.scaling",
      name: "Scaling",
      description: "Scales linearly",
      maxLevel: 10,
      jobTier: 1,
      levelReq: 1,
      kind: "active",
      damagePercent: { base: 100, perLevel: 10 },
    };
    expect(skillStatAt(scaling, 1).damagePercent).toBe(100);
    expect(skillStatAt(scaling, 2).damagePercent).toBe(110);
    expect(skillStatAt(scaling, 5).damagePercent).toBe(140);
    expect(skillStatAt(scaling, 10).damagePercent).toBe(190);
  });

  it("clamps negative results to 0", () => {
    const weird: SkillDef = {
      id: "test.weird",
      name: "Weird",
      description: "Negative perLevel",
      maxLevel: 10,
      jobTier: 1,
      levelReq: 1,
      kind: "active",
      mpCost: { base: 5, perLevel: -2 },
    };
    expect(skillStatAt(weird, 1).mpCost).toBe(5);
    expect(skillStatAt(weird, 3).mpCost).toBe(1);
    expect(skillStatAt(weird, 4).mpCost).toBe(0); // clamped
    expect(skillStatAt(weird, 10).mpCost).toBe(0);
  });

  it("passes through buffEffect unchanged", () => {
    const buffed: SkillDef = {
      id: "test.buffed",
      name: "Buffed",
      description: "Has a buff effect",
      maxLevel: 10,
      jobTier: 1,
      levelReq: 1,
      kind: "buff",
      buffEffect: { atkPercent: 20 },
    };
    expect(skillStatAt(buffed, 1).buffEffect).toEqual({ atkPercent: 20 });
    expect(skillStatAt(buffed, 10).buffEffect).toEqual({ atkPercent: 20 });
  });
});

// ── Warrior Crushing Blow scaling ──────────────────────────────────────────

describe("Crushing Blow combat stats", () => {
  const skill = findSkill("warrior.crushing_blow");

  it("level 1: base values", () => {
    const s = skillStatAt(skill, 1);
    expect(s.mpCost).toBe(8);
    expect(s.cooldownMs).toBe(800);
    expect(s.damagePercent).toBe(150);
    expect(s.hitCount).toBe(1);
    expect(s.targetCount).toBe(1);
    expect(s.buffDurationMs).toBe(0);
    expect(s.buffEffect).toBeUndefined();
  });

  it("level 10: mid-scaling", () => {
    const s = skillStatAt(skill, 10);
    expect(s.mpCost).toBe(17); // 8 + 1×9
    expect(s.damagePercent).toBe(195); // 150 + 5×9
  });

  it("level 20 (max): peak values", () => {
    const s = skillStatAt(skill, 20);
    expect(s.mpCost).toBe(27); // 8 + 1×19
    expect(s.damagePercent).toBe(245); // 150 + 5×19
    expect(s.hitCount).toBe(1);
    expect(s.targetCount).toBe(1);
  });
});

// ── Warrior Iron Hide (passive) ────────────────────────────────────────────

describe("Iron Hide combat stats", () => {
  const skill = findSkill("warrior.iron_hide");

  it("has no mpCost or cooldown", () => {
    const s = skillStatAt(skill, 1);
    expect(s.mpCost).toBe(0);
    expect(s.cooldownMs).toBe(0);
    expect(s.damagePercent).toBe(0);
  });

  it("carries a static buffEffect", () => {
    expect(skillStatAt(skill, 1).buffEffect).toEqual({ defPercent: 10 });
    expect(skillStatAt(skill, 10).buffEffect).toEqual({ defPercent: 10 });
  });
});

// ── Warrior Rally (buff) ───────────────────────────────────────────────────

describe("Rally combat stats", () => {
  const skill = findSkill("warrior.rally");

  it("level 1: base values", () => {
    const s = skillStatAt(skill, 1);
    expect(s.mpCost).toBe(15);
    expect(s.cooldownMs).toBe(30000);
    expect(s.buffDurationMs).toBe(10000);
    expect(s.buffEffect).toEqual({ atkPercent: 15 });
  });

  it("level 10: buff scales with level", () => {
    const s = skillStatAt(skill, 10);
    expect(s.mpCost).toBe(24); // 15 + 1×9
    expect(s.buffDurationMs).toBe(14500); // 10000 + 500×9
    expect(s.buffEffect).toEqual({ atkPercent: 15 });
  });
});

// ── Warrior Cleave (AoE active) ───────────────────────────────────────────

describe("Cleave combat stats", () => {
  const skill = findSkill("warrior.cleave");

  it("level 1: base values", () => {
    const s = skillStatAt(skill, 1);
    expect(s.mpCost).toBe(18);
    expect(s.cooldownMs).toBe(1200);
    expect(s.damagePercent).toBe(120);
    expect(s.hitCount).toBe(1);
    expect(s.targetCount).toBe(3);
  });

  it("level 20 (max): damage scales, target count stays at 3", () => {
    const s = skillStatAt(skill, 20);
    expect(s.mpCost).toBe(56); // 18 + 2×19
    expect(s.damagePercent).toBe(272); // 120 + 8×19
    expect(s.targetCount).toBe(3);
  });
});

// ── Warrior Bulwark (passive) ──────────────────────────────────────────────

describe("Bulwark combat stats", () => {
  const skill = findSkill("warrior.bulwark");

  it("has no mpCost and carries buffEffect", () => {
    const s = skillStatAt(skill, 1);
    expect(s.mpCost).toBe(0);
    expect(s.damagePercent).toBe(0);
    expect(s.buffEffect).toEqual({ defPercent: 15 });
  });
});
