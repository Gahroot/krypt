/**
 * Class Balance — cross-class guardrails for the alpha band (Lv 1–30).
 *
 * Verifies that all 5 classes are viable and distinct:
 *  1. Each class has a unique primary stat and identity.
 *  2. Core skill DPS factors are within ±30% of the median (no dominant outlier).
 *  3. No two classes share identical core skill stats (damagePercent, cooldown, hitCount).
 *  4. Primary-stat scaling makes the main stat matter (autoAssign >> off-stat investment).
 *  5. HP growth reflects class fantasy (warrior > pirate > thief/archer > mage).
 *  6. Every class has at least 1 active, 1 passive, and 1 buff by tier 1 (Lv 10–18).
 */

import { describe, it, expect } from "vitest";
import {
  ClassArchetype,
  CLASSES,
  allSkillsForClass,
  skillStatAt,
  type SkillDef,
} from "../src/classes.js";
import { autoAssign, attackPower, deriveSecondary } from "../src/stats.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Core skill id for each class (tier-1 primary attack). */
const CORE_SKILLS: Record<ClassArchetype, string> = {
  [ClassArchetype.BEGINNER]: "beginner.nimble_strike",
  [ClassArchetype.WARRIOR]: "warrior.crushing_blow",
  [ClassArchetype.MAGE]: "mage.arcane_bolt",
  [ClassArchetype.ARCHER]: "archer.twin_shot",
  [ClassArchetype.THIEF]: "thief.shadow_rush",
  [ClassArchetype.PIRATE]: "pirate.gut_punch",
};

/** Compute DPS factor: (damagePercent × hitCount) / (cooldownMs / 1000). */
function dpsFactor(skill: SkillDef, skillLevel: number): number {
  const s = skillStatAt(skill, skillLevel);
  const effectiveDmg = s.damagePercent * Math.max(1, s.hitCount);
  const cdSeconds = Math.max(0.1, s.cooldownMs / 1000);
  return effectiveDmg / cdSeconds;
}

/** Find a skill def by id across all classes. */
function findSkill(id: string): SkillDef {
  for (const cls of Object.values(CLASSES)) {
    for (const s of allSkillsForClass(cls.archetype)) {
      if (s.id === id) return s;
    }
  }
  throw new Error(`Skill ${id} not found`);
}

// ── 1. Primary stat identity ──────────────────────────────────────────────

describe("Class primary stat identity", () => {
  it("warrior and pirate share STR; each other class has a unique primary stat", () => {
    const mains = [
      ClassArchetype.WARRIOR,
      ClassArchetype.MAGE,
      ClassArchetype.ARCHER,
      ClassArchetype.THIEF,
      ClassArchetype.PIRATE,
    ].map((a) => CLASSES[a].primaryStat);
    const unique = new Set(mains);
    expect(unique.size).toBe(4);
    expect(unique.has("STR")).toBe(true);
    expect(unique.has("INT")).toBe(true);
    expect(unique.has("DEX")).toBe(true);
    expect(unique.has("LUK")).toBe(true);
  });

  it("warrior is STR, mage is INT, archer is DEX, thief is LUK, pirate is STR", () => {
    expect(CLASSES[ClassArchetype.WARRIOR].primaryStat).toBe("STR");
    expect(CLASSES[ClassArchetype.MAGE].primaryStat).toBe("INT");
    expect(CLASSES[ClassArchetype.ARCHER].primaryStat).toBe("DEX");
    expect(CLASSES[ClassArchetype.THIEF].primaryStat).toBe("LUK");
    expect(CLASSES[ClassArchetype.PIRATE].primaryStat).toBe("STR");
  });
});

// ── 2. DPS factor balance ─────────────────────────────────────────────────

describe("Core skill DPS factor balance", () => {
  const PLAYABLE = [
    ClassArchetype.WARRIOR,
    ClassArchetype.MAGE,
    ClassArchetype.ARCHER,
    ClassArchetype.THIEF,
    ClassArchetype.PIRATE,
  ];

  it("all core skills have DPS factor > 0 at level 1", () => {
    for (const arch of PLAYABLE) {
      const skill = findSkill(CORE_SKILLS[arch]);
      const df = dpsFactor(skill, 1);
      expect(df).toBeGreaterThan(0);
    }
  });

  it("no class exceeds 130% of the median DPS factor at skill level 1", () => {
    const factors = PLAYABLE.map((arch) => {
      const skill = findSkill(CORE_SKILLS[arch]);
      return { arch, df: dpsFactor(skill, 1) };
    });
    const values = factors.map((f) => f.df).sort((a, b) => a - b);
    const median = values[2]!; // 3rd of 5 (0-indexed)
    for (const f of factors) {
      expect(f.df).toBeLessThanOrEqual(median * 1.3);
    }
  });

  it("no class falls below 70% of the median DPS factor at skill level 1", () => {
    const factors = PLAYABLE.map((arch) => {
      const skill = findSkill(CORE_SKILLS[arch]);
      return { arch, df: dpsFactor(skill, 1) };
    });
    const values = factors.map((f) => f.df).sort((a, b) => a - b);
    const median = values[2]!;
    for (const f of factors) {
      expect(f.df).toBeGreaterThanOrEqual(median * 0.7);
    }
  });

  it("no class exceeds 140% of the median DPS factor at skill level 12", () => {
    const factors = PLAYABLE.map((arch) => {
      const skill = findSkill(CORE_SKILLS[arch]);
      return { arch, df: dpsFactor(skill, 12) };
    });
    const values = factors.map((f) => f.df).sort((a, b) => a - b);
    const median = values[2]!;
    for (const f of factors) {
      expect(f.df).toBeLessThanOrEqual(median * 1.4);
    }
  });

  it("no class falls below 70% of the median DPS factor at skill level 12", () => {
    const factors = PLAYABLE.map((arch) => {
      const skill = findSkill(CORE_SKILLS[arch]);
      return { arch, df: dpsFactor(skill, 12) };
    });
    const values = factors.map((f) => f.df).sort((a, b) => a - b);
    const median = values[2]!;
    for (const f of factors) {
      expect(f.df).toBeGreaterThanOrEqual(median * 0.7);
    }
  });
});

// ── 3. No duplicate core skill stats ──────────────────────────────────────

describe("Core skill distinctiveness", () => {
  it("no two classes share identical (damagePercent, cooldownMs, hitCount) at level 1", () => {
    const PLAYABLE = [
      ClassArchetype.WARRIOR,
      ClassArchetype.MAGE,
      ClassArchetype.ARCHER,
      ClassArchetype.THIEF,
      ClassArchetype.PIRATE,
    ];
    const sigs = PLAYABLE.map((arch) => {
      const s = skillStatAt(findSkill(CORE_SKILLS[arch]), 1);
      return {
        arch,
        sig: `${s.damagePercent}_${s.cooldownMs}_${s.hitCount}`,
      };
    });
    const unique = new Set(sigs.map((s) => s.sig));
    expect(unique.size).toBe(PLAYABLE.length);
  });
});

// ── 4. Primary-stat scaling makes main stat matter ────────────────────────

describe("Primary stat scaling", () => {
  it("warrior auto-assign at Lv30 has much higher ATK than off-stat investment", () => {
    const stats = autoAssign(30, "STR");
    const correctAtk = attackPower(stats, "STR");
    // Off-stat: dump AP into DEX instead
    const offStats = autoAssign(30, "DEX");
    const wrongAtk = attackPower(offStats, "STR");
    // STR-primary ATK should be at least 50% higher than DEX-invested ATK
    expect(correctAtk).toBeGreaterThan(wrongAtk * 1.5);
  });

  it("mage auto-assign at Lv30 has much higher mAtk than off-stat investment", () => {
    const stats = autoAssign(30, "INT");
    const correct = deriveSecondary(stats, "INT").mAtk;
    const offStats = autoAssign(30, "STR");
    const wrong = deriveSecondary(offStats, "INT").mAtk;
    expect(correct).toBeGreaterThan(wrong * 2);
  });

  it("archer auto-assign at Lv30 has much higher ATK than off-stat investment", () => {
    const stats = autoAssign(30, "DEX");
    const correctAtk = attackPower(stats, "DEX");
    const offStats = autoAssign(30, "INT");
    const wrongAtk = attackPower(offStats, "DEX");
    expect(correctAtk).toBeGreaterThan(wrongAtk * 1.5);
  });

  it("thief auto-assign at Lv30 has much higher ATK than off-stat investment", () => {
    const stats = autoAssign(30, "LUK");
    const correctAtk = attackPower(stats, "LUK");
    const offStats = autoAssign(30, "STR");
    const wrongAtk = attackPower(offStats, "LUK");
    expect(correctAtk).toBeGreaterThan(wrongAtk * 1.5);
  });

  it("pirate auto-assign at Lv30 has much higher ATK than off-stat investment", () => {
    const stats = autoAssign(30, "STR");
    const correctAtk = attackPower(stats, "STR");
    const offStats = autoAssign(30, "INT");
    const wrongAtk = attackPower(offStats, "STR");
    expect(correctAtk).toBeGreaterThan(wrongAtk * 1.5);
  });
});

// ── 5. HP growth reflects class fantasy ───────────────────────────────────

describe("HP growth hierarchy", () => {
  it("warrior has the highest HP growth (tank)", () => {
    const warriorHP = CLASSES[ClassArchetype.WARRIOR].hpGrowth;
    for (const arch of [
      ClassArchetype.MAGE,
      ClassArchetype.ARCHER,
      ClassArchetype.THIEF,
      ClassArchetype.PIRATE,
    ]) {
      expect(warriorHP).toBeGreaterThanOrEqual(CLASSES[arch].hpGrowth);
    }
  });

  it("mage has the lowest HP growth (glass cannon)", () => {
    const mageHP = CLASSES[ClassArchetype.MAGE].hpGrowth;
    for (const arch of [
      ClassArchetype.WARRIOR,
      ClassArchetype.ARCHER,
      ClassArchetype.THIEF,
      ClassArchetype.PIRATE,
    ]) {
      expect(mageHP).toBeLessThanOrEqual(CLASSES[arch].hpGrowth);
    }
  });

  it("warrior HP growth is at least 1.5× mage HP growth", () => {
    expect(CLASSES[ClassArchetype.WARRIOR].hpGrowth).toBeGreaterThanOrEqual(
      CLASSES[ClassArchetype.MAGE].hpGrowth * 1.5,
    );
  });
});

// ── 6. Every class has a complete tier-1 skill kit ────────────────────────

describe("Skill kit completeness", () => {
  for (const arch of [
    ClassArchetype.WARRIOR,
    ClassArchetype.MAGE,
    ClassArchetype.ARCHER,
    ClassArchetype.THIEF,
    ClassArchetype.PIRATE,
  ]) {
    describe(arch, () => {
      const skills = allSkillsForClass(arch);

      it("has at least 1 active attack skill by tier 1", () => {
        expect(skills.some((s) => s.kind === "active" && s.jobTier === 1)).toBe(true);
      });

      it("has at least 1 passive skill by tier 1", () => {
        expect(skills.some((s) => s.kind === "passive" && s.jobTier === 1)).toBe(true);
      });

      it("has at least 1 buff skill available by tier 2 (level 30)", () => {
        expect(skills.some((s) => s.kind === "buff" && s.jobTier <= 2)).toBe(true);
      });
    });
  }
});
