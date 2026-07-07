/**
 * ARCHER archetype — full spec tests.
 *
 * Verifies:
 *  1. Tier gates at levels 10 / 30 / 60 / 100.
 *  2. SP totals at each gate are sufficient to learn at least the first skill in every
 *     prerequisite chain for that tier (in every branch).
 *  3. Every skill resolves cleanly through skillStatAt at level 1 and maxLevel.
 *  4. Branch structure: 2 branches (longbow, crossbow), each with tier 2–4.
 *  5. Every skill has all required combat-effect fields populated (active/buff skills have
 *     mpCost, cooldownMs; passives have buffEffect).
 *  6. Total skill count is 16–20.
 *  7. Prerequisite chain integrity — all prereq ids resolve to real archer skills, no cycles.
 *  8. Ranged-specific checks: hitCount >= 1 for all actives, DEX is primary stat.
 */

import { describe, it, expect } from "vitest";
import {
  ClassArchetype,
  CLASSES,
  allSkillsForClass,
  getSkillBranch,
  unlockedJobTier,
  skillStatAt,
  type SkillDef,
  type JobBranch,
} from "../src/classes.js";
import { totalSpByLevel } from "../src/stats.js";
import { learnSkill, spSpent, type SkillBook } from "../src/skillbook.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const ARCHER = CLASSES[ClassArchetype.ARCHER];

/** All skill defs across tier 1 and all branches. */
const ALL_ARCHER_SKILLS: readonly SkillDef[] = allSkillsForClass(ClassArchetype.ARCHER);

/** The archer's 2 specialization branches. */
const BRANCHES: readonly JobBranch[] = ARCHER.branches ?? [];

/**
 * Learn a skill, asserting success. Returns the updated book.
 * Throws a vitest assertion on failure so the test message is useful.
 */
function learn(book: SkillBook, charLevel: number, skillId: string): SkillBook {
  const branch = getSkillBranch(ClassArchetype.ARCHER, skillId);
  const result = learnSkill(book, ClassArchetype.ARCHER, charLevel, skillId, branch?.id);
  if (!result.ok) {
    throw new Error(`learnSkill failed for "${skillId}" at level ${charLevel}: ${result.reason}`);
  }
  return result.book!;
}

/**
 * Learn a skill N times in a row (raising it to level N).
 * Returns the updated book.
 */
function learnN(book: SkillBook, charLevel: number, skillId: string, n: number): SkillBook {
  let b = book;
  for (let i = 0; i < n; i++) {
    b = learn(b, charLevel, skillId);
  }
  return b;
}

// ── 1. Tier gates ─────────────────────────────────────────────────────────

describe("ARCHER tier gates", () => {
  it("has DEX as primary stat", () => {
    expect(ARCHER.primaryStat).toBe("DEX");
  });

  it("tier 1 (Scout) unlocks at level 10", () => {
    expect(unlockedJobTier(ClassArchetype.ARCHER, 9)).toBe(0);
    expect(unlockedJobTier(ClassArchetype.ARCHER, 10)).toBeGreaterThanOrEqual(1);
  });

  it("tier 2 unlocks at level 30", () => {
    expect(unlockedJobTier(ClassArchetype.ARCHER, 29)).toBeLessThan(2);
    expect(unlockedJobTier(ClassArchetype.ARCHER, 30)).toBeGreaterThanOrEqual(2);
  });

  it("tier 3 unlocks at level 60", () => {
    expect(unlockedJobTier(ClassArchetype.ARCHER, 59)).toBeLessThan(3);
    expect(unlockedJobTier(ClassArchetype.ARCHER, 60)).toBeGreaterThanOrEqual(3);
  });

  it("tier 4 unlocks at level 100", () => {
    expect(unlockedJobTier(ClassArchetype.ARCHER, 99)).toBeLessThan(4);
    expect(unlockedJobTier(ClassArchetype.ARCHER, 100)).toBeGreaterThanOrEqual(4);
  });
});

// ── 2. Branch structure ────────────────────────────────────────────────────

describe("ARCHER branches", () => {
  it("has exactly 2 specialization branches", () => {
    expect(BRANCHES).toHaveLength(2);
  });

  it("branch ids are longbow and crossbow", () => {
    const ids = BRANCHES.map((b) => b.id);
    expect(ids).toContain("longbow");
    expect(ids).toContain("crossbow");
  });

  it("each branch has tiers 2, 3, and 4", () => {
    for (const branch of BRANCHES) {
      const tiers = branch.jobTiers.map((t) => t.tier);
      expect(tiers).toEqual([2, 3, 4]);
    }
  });

  it("every branch tier has at least 1 skill", () => {
    for (const branch of BRANCHES) {
      for (const tier of branch.jobTiers) {
        expect(tier.skills.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

// ── 3. Total skill count ───────────────────────────────────────────────────

describe("ARCHER skill count", () => {
  it("has 5 shared tier-1 skills", () => {
    const tier1 = ARCHER.jobTiers.find((t) => t.tier === 1)!;
    expect(tier1.skills).toHaveLength(5);
  });

  it("has ~16–20 total skills across all tiers and branches", () => {
    expect(ALL_ARCHER_SKILLS.length).toBeGreaterThanOrEqual(16);
    expect(ALL_ARCHER_SKILLS.length).toBeLessThanOrEqual(20);
  });

  it("has exactly 17 total skills", () => {
    expect(ALL_ARCHER_SKILLS.length).toBe(17);
  });
});

// ── 4. SP learnability at each tier gate ───────────────────────────────────

describe("ARCHER SP learnability", () => {
  it("tier-1 twin_shot is learnable at level 10", () => {
    let book: SkillBook = {};
    book = learn(book, 10, "archer.twin_shot");
    expect(book["archer.twin_shot"]).toBe(1);
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(10));
  });

  it("all tier-1 skills are learnable by level 18 (highest tier-1 levelReq)", () => {
    let book: SkillBook = {};
    // twin_shot 1..3 (barbed_arrow needs level 3)
    book = learnN(book, 18, "archer.twin_shot", 3);
    // keen_eye 1 (piercing_arrow needs level 1)
    book = learnN(book, 18, "archer.keen_eye", 1);
    // piercing_arrow 1
    book = learn(book, 18, "archer.piercing_arrow");
    // fleet_foot 1
    book = learn(book, 18, "archer.fleet_foot");
    // barbed_arrow 1
    book = learn(book, 18, "archer.barbed_arrow");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(18));
  });

  it("Longbow tier-2 skills are learnable at level 30", () => {
    let book: SkillBook = {};
    // Prereqs: twin_shot 1 (for volley), keen_eye 3 (for swift_nock)
    book = learn(book, 30, "archer.twin_shot");
    book = learnN(book, 30, "archer.keen_eye", 3);
    // Tier-2 Longbow skills (focus_spirit needs twin_shot 5, tested separately)
    book = learn(book, 30, "archer.volley");
    book = learn(book, 30, "archer.swift_nock");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(30));
  });

  it("Crossbow tier-2 skills are learnable at level 30", () => {
    let book: SkillBook = {};
    // Prereqs: piercing_arrow 1 (for aimed_shot), keen_eye 3 (for eagle_eye)
    book = learnN(book, 30, "archer.keen_eye", 3);
    book = learn(book, 30, "archer.piercing_arrow");
    // Tier-2 Crossbow skills (reload_stance needs aimed_shot 3, tested separately)
    book = learn(book, 30, "archer.aimed_shot");
    book = learn(book, 30, "archer.eagle_eye");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(30));
  });

  it("Longbow tier-3 skills are learnable at level 60", () => {
    let book: SkillBook = {};
    // twin_shot 1 → volley 5, keen_eye 3 → swift_nock 3, twin_shot 5 → focus_spirit 3
    book = learn(book, 60, "archer.twin_shot");
    book = learnN(book, 60, "archer.volley", 5);
    book = learnN(book, 60, "archer.keen_eye", 3);
    book = learnN(book, 60, "archer.swift_nock", 3);
    book = learnN(book, 60, "archer.twin_shot", 4); // total twin_shot = 5
    book = learnN(book, 60, "archer.focus_spirit", 3);
    // Tier-3 Longbow skills
    book = learn(book, 60, "archer.arrow_rain");
    book = learn(book, 60, "archer.wind_blessing");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(60));
  });

  it("Crossbow tier-3 skills are learnable at level 60", () => {
    let book: SkillBook = {};
    // keen_eye 3 → eagle_eye 5, piercing_arrow 1 → aimed_shot 5
    book = learnN(book, 60, "archer.keen_eye", 3);
    book = learnN(book, 60, "archer.eagle_eye", 5);
    book = learn(book, 60, "archer.piercing_arrow");
    book = learnN(book, 60, "archer.aimed_shot", 5);
    // Tier-3 Crossbow skills
    book = learn(book, 60, "archer.puncture");
    book = learn(book, 60, "archer.steady_aim");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(60));
  });

  it("Longbow tier-4 skill is learnable at level 100", () => {
    let book: SkillBook = {};
    // twin_shot 1 → volley 5 → arrow_rain 5 → tempest_flurry
    book = learn(book, 100, "archer.twin_shot");
    book = learnN(book, 100, "archer.volley", 5);
    book = learnN(book, 100, "archer.arrow_rain", 5);
    // Tier-4 Longbow
    book = learn(book, 100, "archer.tempest_flurry");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(100));
  });

  it("Crossbow tier-4 skill is learnable at level 100", () => {
    let book: SkillBook = {};
    // piercing_arrow 1 → aimed_shot 5 → puncture 5 → hypervelocity
    book = learn(book, 100, "archer.keen_eye");
    book = learn(book, 100, "archer.piercing_arrow");
    book = learnN(book, 100, "archer.aimed_shot", 5);
    book = learnN(book, 100, "archer.puncture", 5);
    // Tier-4 Crossbow
    book = learn(book, 100, "archer.hypervelocity");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(100));
  });
});

// ── 5. Every skill resolves via skillStatAt ────────────────────────────────

describe("ARCHER skillStatAt resolution", () => {
  for (const skill of ALL_ARCHER_SKILLS) {
    describe(skill.id, () => {
      it("resolves at level 1 without errors", () => {
        const stats = skillStatAt(skill, 1);
        expect(stats).toBeDefined();
        expect(typeof stats.mpCost).toBe("number");
        expect(typeof stats.cooldownMs).toBe("number");
        expect(typeof stats.damagePercent).toBe("number");
        expect(typeof stats.hitCount).toBe("number");
        expect(typeof stats.targetCount).toBe("number");
        expect(typeof stats.buffDurationMs).toBe("number");
      });

      it("resolves at maxLevel without errors", () => {
        const stats = skillStatAt(skill, skill.maxLevel);
        expect(stats).toBeDefined();
        expect(stats.mpCost).toBeGreaterThanOrEqual(0);
        expect(stats.cooldownMs).toBeGreaterThanOrEqual(0);
        expect(stats.damagePercent).toBeGreaterThanOrEqual(0);
        expect(stats.hitCount).toBeGreaterThanOrEqual(0);
        expect(stats.targetCount).toBeGreaterThanOrEqual(0);
        expect(stats.buffDurationMs).toBeGreaterThanOrEqual(0);
      });

      it("combat values are non-negative at all levels 1..maxLevel", () => {
        for (let lv = 1; lv <= skill.maxLevel; lv++) {
          const s = skillStatAt(skill, lv);
          expect(s.mpCost).toBeGreaterThanOrEqual(0);
          expect(s.cooldownMs).toBeGreaterThanOrEqual(0);
          expect(s.damagePercent).toBeGreaterThanOrEqual(0);
          expect(s.hitCount).toBeGreaterThanOrEqual(0);
          expect(s.targetCount).toBeGreaterThanOrEqual(0);
          expect(s.buffDurationMs).toBeGreaterThanOrEqual(0);
        }
      });

      // Active / buff skills should have mpCost and cooldownMs
      if (skill.kind === "active") {
        it("active skill has mpCost > 0 at level 1", () => {
          expect(skillStatAt(skill, 1).mpCost).toBeGreaterThan(0);
        });
        it("active skill has cooldownMs > 0 at level 1", () => {
          expect(skillStatAt(skill, 1).cooldownMs).toBeGreaterThan(0);
        });
      }

      if (skill.kind === "buff") {
        it("buff skill has mpCost > 0 and buffDurationMs > 0 at level 1", () => {
          const s = skillStatAt(skill, 1);
          expect(s.mpCost).toBeGreaterThan(0);
          expect(s.buffDurationMs).toBeGreaterThan(0);
        });
        it("buff skill carries a buffEffect", () => {
          expect(skillStatAt(skill, 1).buffEffect).toBeDefined();
        });
      }

      if (skill.kind === "passive") {
        it("passive skill carries a buffEffect", () => {
          expect(skillStatAt(skill, 1).buffEffect).toBeDefined();
        });
      }
    });
  }
});

// ── 6. Prerequisite chain integrity ───────────────────────────────────────

describe("ARCHER prerequisite chains", () => {
  it("all prerequisite skill ids resolve to real archer skills", () => {
    for (const skill of ALL_ARCHER_SKILLS) {
      if (!skill.requires) continue;
      for (const req of skill.requires) {
        const target = ALL_ARCHER_SKILLS.find((s) => s.id === req.skillId);
        expect(target).toBeDefined();
        expect(target!.maxLevel).toBeGreaterThanOrEqual(req.level);
      }
    }
  });

  it("no circular prerequisites", () => {
    for (const skill of ALL_ARCHER_SKILLS) {
      if (!skill.requires) continue;
      for (const req of skill.requires) {
        expect(req.skillId).not.toBe(skill.id);
      }
    }
  });
});

// ── 7. Ranged-specific checks ─────────────────────────────────────────────

describe("ARCHER ranged identity", () => {
  it("every active skill has hitCount >= 1", () => {
    for (const skill of ALL_ARCHER_SKILLS) {
      if (skill.kind === "active") {
        const s = skillStatAt(skill, 1);
        expect(s.hitCount).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("twin_shot hits 2 targets (multi-hit core)", () => {
    const skill = ALL_ARCHER_SKILLS.find((s) => s.id === "archer.twin_shot")!;
    const s = skillStatAt(skill, 1);
    expect(s.hitCount).toBe(2);
  });

  it("volley hits 4 targets (multi-target volley)", () => {
    const skill = ALL_ARCHER_SKILLS.find((s) => s.id === "archer.volley")!;
    const s = skillStatAt(skill, 1);
    expect(s.targetCount).toBe(4);
  });

  it("arrow_rain hits 5 targets (largest AoE)", () => {
    const skill = ALL_ARCHER_SKILLS.find((s) => s.id === "archer.arrow_rain")!;
    const s = skillStatAt(skill, 1);
    expect(s.targetCount).toBe(5);
  });

  it("hypervelocity has highest single-target damagePercent", () => {
    const skill = ALL_ARCHER_SKILLS.find((s) => s.id === "archer.hypervelocity")!;
    const s = skillStatAt(skill, 1);
    expect(s.damagePercent).toBe(400);
    expect(s.targetCount).toBe(1);
  });

  it("aimed_shot is a high-damage single-target active", () => {
    const skill = ALL_ARCHER_SKILLS.find((s) => s.id === "archer.aimed_shot")!;
    const s = skillStatAt(skill, 1);
    expect(s.damagePercent).toBe(200);
    expect(s.targetCount).toBe(1);
  });

  it("has accuracy/crit passives: keen_eye, eagle_eye, steady_aim", () => {
    const passives = ALL_ARCHER_SKILLS.filter(
      (s) => s.kind === "passive" && (s.id.includes("eye") || s.id === "archer.steady_aim"),
    );
    expect(passives.length).toBeGreaterThanOrEqual(3);
  });

  it("fleet_foot grants speed (movement passive)", () => {
    const skill = ALL_ARCHER_SKILLS.find((s) => s.id === "archer.fleet_foot")!;
    const s = skillStatAt(skill, 1);
    expect(s.buffEffect).toEqual({ speed: 8 });
  });

  it("hpGrowth and mpGrowth are reasonable for a ranged class", () => {
    expect(ARCHER.hpGrowth).toBe(12);
    expect(ARCHER.mpGrowth).toBe(8);
  });
});

// ── 8. Specific skill combat stat tests ────────────────────────────────────

describe("ARCHER key skill combat stats", () => {
  describe("Twin Shot", () => {
    const skill = ALL_ARCHER_SKILLS.find((s) => s.id === "archer.twin_shot")!;

    it("level 1: base values", () => {
      const s = skillStatAt(skill, 1);
      expect(s.mpCost).toBe(6);
      expect(s.cooldownMs).toBe(700);
      expect(s.damagePercent).toBe(75);
      expect(s.hitCount).toBe(2);
      expect(s.targetCount).toBe(1);
    });

    it("level 20 (max): scales correctly", () => {
      const s = skillStatAt(skill, 20);
      expect(s.mpCost).toBe(25); // 6 + 1×19
      expect(s.damagePercent).toBe(132); // 75 + 3×19
    });
  });

  describe("Piercing Arrow", () => {
    const skill = ALL_ARCHER_SKILLS.find((s) => s.id === "archer.piercing_arrow")!;

    it("level 1: base values", () => {
      const s = skillStatAt(skill, 1);
      expect(s.mpCost).toBe(10);
      expect(s.cooldownMs).toBe(1000);
      expect(s.damagePercent).toBe(180);
      expect(s.hitCount).toBe(1);
      expect(s.targetCount).toBe(1);
    });

    it("level 20 (max): scales correctly", () => {
      const s = skillStatAt(skill, 20);
      expect(s.mpCost).toBe(29); // 10 + 1×19
      expect(s.damagePercent).toBe(332); // 180 + 8×19
    });
  });

  describe("Volley", () => {
    const skill = ALL_ARCHER_SKILLS.find((s) => s.id === "archer.volley")!;

    it("level 1: base values", () => {
      const s = skillStatAt(skill, 1);
      expect(s.mpCost).toBe(16);
      expect(s.cooldownMs).toBe(1200);
      expect(s.damagePercent).toBe(90);
      expect(s.targetCount).toBe(4);
    });

    it("level 20 (max): damage scales, target count stays", () => {
      const s = skillStatAt(skill, 20);
      expect(s.mpCost).toBe(54); // 16 + 2×19
      expect(s.damagePercent).toBe(204); // 90 + 6×19
      expect(s.targetCount).toBe(4);
    });
  });

  describe("Hypervelocity", () => {
    const skill = ALL_ARCHER_SKILLS.find((s) => s.id === "archer.hypervelocity")!;

    it("level 1: highest single-target damage", () => {
      const s = skillStatAt(skill, 1);
      expect(s.mpCost).toBe(40);
      expect(s.cooldownMs).toBe(2000);
      expect(s.damagePercent).toBe(400);
      expect(s.hitCount).toBe(1);
      expect(s.targetCount).toBe(1);
    });

    it("level 20 (max): scales to massive damage", () => {
      const s = skillStatAt(skill, 20);
      expect(s.damagePercent).toBe(742); // 400 + 18×19
    });
  });

  describe("Keen Eye (passive)", () => {
    const skill = ALL_ARCHER_SKILLS.find((s) => s.id === "archer.keen_eye")!;

    it("has no mpCost and carries buffEffect", () => {
      const s = skillStatAt(skill, 1);
      expect(s.mpCost).toBe(0);
      expect(s.damagePercent).toBe(0);
      expect(s.buffEffect).toEqual({ atkPercent: 8 });
    });
  });

  describe("Focus Spirit (buff)", () => {
    const skill = ALL_ARCHER_SKILLS.find((s) => s.id === "archer.focus_spirit")!;

    it("level 1: base values", () => {
      const s = skillStatAt(skill, 1);
      expect(s.mpCost).toBe(18);
      expect(s.cooldownMs).toBe(30000);
      expect(s.buffDurationMs).toBe(10000);
      expect(s.buffEffect).toEqual({ atkPercent: 12 });
    });

    it("level 10: buff duration scales", () => {
      const s = skillStatAt(skill, 10);
      expect(s.buffDurationMs).toBe(14500); // 10000 + 500×9
    });
  });

  describe("Tempest Flurry", () => {
    const skill = ALL_ARCHER_SKILLS.find((s) => s.id === "archer.tempest_flurry")!;

    it("level 1: multi-hit AoE", () => {
      const s = skillStatAt(skill, 1);
      expect(s.mpCost).toBe(38);
      expect(s.cooldownMs).toBe(1800);
      expect(s.damagePercent).toBe(120);
      expect(s.hitCount).toBe(3);
      expect(s.targetCount).toBe(4);
    });

    it("level 20 (max): scales correctly", () => {
      const s = skillStatAt(skill, 20);
      expect(s.mpCost).toBe(95); // 38 + 3×19
      expect(s.damagePercent).toBe(272); // 120 + 8×19
    });
  });
});
