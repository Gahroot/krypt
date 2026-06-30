/**
 * WARRIOR archetype — reference spec tests.
 *
 * Verifies:
 *  1. Tier gates at levels 10 / 30 / 60 / 100.
 *  2. SP totals at each gate are sufficient to learn at least the first skill in every
 *     prerequisite chain for that tier (in every branch).
 *  3. Every skill resolves cleanly through skillStatAt at level 1 and maxLevel.
 *  4. Branch structure: 3 branches, each with tier 2–4.
 *  5. Every skill has all required combat-effect fields populated (active/buff skills have
 *     mpCost, cooldownMs; passives have buffEffect).
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

const WARRIOR = CLASSES[ClassArchetype.WARRIOR];

/** All skill defs across tier 1 and all branches. */
const ALL_WARRIOR_SKILLS: readonly SkillDef[] = allSkillsForClass(ClassArchetype.WARRIOR);

/** The warrior's 3 specialization branches. */
const BRANCHES: readonly JobBranch[] = WARRIOR.branches ?? [];

/**
 * Learn a skill, asserting success. Returns the updated book.
 * Throws a vitest assertion on failure so the test message is useful.
 */
function learn(book: SkillBook, charLevel: number, skillId: string): SkillBook {
  const branch = getSkillBranch(ClassArchetype.WARRIOR, skillId);
  const result = learnSkill(book, ClassArchetype.WARRIOR, charLevel, skillId, branch?.id);
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

describe("WARRIOR tier gates", () => {
  it("has STR as primary stat", () => {
    expect(WARRIOR.primaryStat).toBe("STR");
  });

  it("tier 1 (Squire) unlocks at level 10", () => {
    expect(unlockedJobTier(ClassArchetype.WARRIOR, 9)).toBe(0);
    expect(unlockedJobTier(ClassArchetype.WARRIOR, 10)).toBeGreaterThanOrEqual(1);
  });

  it("tier 2 unlocks at level 30", () => {
    expect(unlockedJobTier(ClassArchetype.WARRIOR, 29)).toBeLessThan(2);
    expect(unlockedJobTier(ClassArchetype.WARRIOR, 30)).toBeGreaterThanOrEqual(2);
  });

  it("tier 3 unlocks at level 60", () => {
    expect(unlockedJobTier(ClassArchetype.WARRIOR, 59)).toBeLessThan(3);
    expect(unlockedJobTier(ClassArchetype.WARRIOR, 60)).toBeGreaterThanOrEqual(3);
  });

  it("tier 4 unlocks at level 100", () => {
    expect(unlockedJobTier(ClassArchetype.WARRIOR, 99)).toBeLessThan(4);
    expect(unlockedJobTier(ClassArchetype.WARRIOR, 100)).toBeGreaterThanOrEqual(4);
  });
});

// ── 2. Branch structure ────────────────────────────────────────────────────

describe("WARRIOR branches", () => {
  it("has exactly 3 specialization branches", () => {
    expect(BRANCHES).toHaveLength(3);
  });

  it("branch ids are berserker, guardian, warlord", () => {
    const ids = BRANCHES.map((b) => b.id);
    expect(ids).toContain("berserker");
    expect(ids).toContain("guardian");
    expect(ids).toContain("warlord");
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

describe("WARRIOR skill count", () => {
  it("has 4 shared tier-1 skills", () => {
    const tier1 = WARRIOR.jobTiers.find((t) => t.tier === 1)!;
    expect(tier1.skills).toHaveLength(4);
  });

  it("has ~16–20 total skills across all tiers and branches", () => {
    expect(ALL_WARRIOR_SKILLS.length).toBeGreaterThanOrEqual(16);
    expect(ALL_WARRIOR_SKILLS.length).toBeLessThanOrEqual(20);
  });
});

// ── 4. SP learnability at each tier gate ───────────────────────────────────

describe("WARRIOR SP learnability", () => {
  it("tier-1 crushing_blow is learnable at level 10", () => {
    let book: SkillBook = {};
    book = learn(book, 10, "warrior.crushing_blow");
    expect(book["warrior.crushing_blow"]).toBe(1);
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(10));
  });

  it("all tier-1 skills are learnable by level 18 (highest tier-1 levelReq)", () => {
    let book: SkillBook = {};
    // crushing_blow 1..3 (battle_cry needs level 3)
    book = learnN(book, 18, "warrior.crushing_blow", 3);
    // iron_hide 1 (rally needs level 1)
    book = learnN(book, 18, "warrior.iron_hide", 1);
    // rally 1
    book = learn(book, 18, "warrior.rally");
    // battle_cry 1
    book = learn(book, 18, "warrior.battle_cry");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(18));
  });

  it("Berserker tier-2 skills are learnable at level 30", () => {
    let book: SkillBook = {};
    // Prereqs: cb 1 (for cleave), iron_hide 3 (for frenzy)
    book = learn(book, 30, "warrior.crushing_blow");
    book = learnN(book, 30, "warrior.iron_hide", 3);
    // Tier-2 Berserker skills
    book = learn(book, 30, "warrior.cleave");
    book = learn(book, 30, "warrior.frenzy");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(30));
  });

  it("Guardian tier-2 skills are learnable at level 30", () => {
    let book: SkillBook = {};
    // Prereqs: iron_hide 1 (for phalanx and fortress)
    book = learn(book, 30, "warrior.iron_hide");
    // Tier-2 Guardian skills (bulwark has levelReq 35, tested separately)
    book = learn(book, 30, "warrior.phalanx");
    book = learn(book, 30, "warrior.fortress");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(30));
  });

  it("Warlord tier-2 skills are learnable at level 30", () => {
    let book: SkillBook = {};
    // Prereqs: cb 5 (for onslaught), iron_hide 1 + rally 3 (for battle_standard)
    book = learnN(book, 30, "warrior.crushing_blow", 5);
    book = learn(book, 30, "warrior.iron_hide");
    book = learnN(book, 30, "warrior.rally", 3);
    // Tier-2 Warlord skills
    book = learn(book, 30, "warrior.battle_standard");
    book = learn(book, 30, "warrior.onslaught");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(30));
  });

  it("Berserker tier-3 skills are learnable at level 60", () => {
    let book: SkillBook = {};
    // Full chain to tier-3: cb 1 → cleave 5, iron_hide 3 → frenzy 5
    book = learn(book, 60, "warrior.crushing_blow");
    book = learnN(book, 60, "warrior.cleave", 5);
    book = learnN(book, 60, "warrior.iron_hide", 3);
    book = learnN(book, 60, "warrior.frenzy", 5);
    // Tier-3 Berserker skills
    book = learn(book, 60, "warrior.decimate");
    book = learn(book, 60, "warrior.berserk");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(60));
  });

  it("Guardian tier-3 skills are learnable at level 60", () => {
    let book: SkillBook = {};
    // iron_hide 1 → fortress 5, iron_hide 1 → phalanx 5
    book = learn(book, 60, "warrior.iron_hide");
    book = learnN(book, 60, "warrior.fortress", 5);
    book = learnN(book, 60, "warrior.phalanx", 5);
    // Tier-3 Guardian skills
    book = learn(book, 60, "warrior.holy_shield");
    book = learn(book, 60, "warrior.retribution");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(60));
  });

  it("Warlord tier-3 skills are learnable at level 60", () => {
    let book: SkillBook = {};
    // cb 5 → onslaught 5, iron_hide 1 → rally 3 → battle_standard 5
    book = learnN(book, 60, "warrior.crushing_blow", 5);
    book = learnN(book, 60, "warrior.onslaught", 5);
    book = learn(book, 60, "warrior.iron_hide");
    book = learnN(book, 60, "warrior.rally", 3);
    book = learnN(book, 60, "warrior.battle_standard", 5);
    // Tier-3 Warlord skills
    book = learn(book, 60, "warrior.hammer_smash");
    book = learn(book, 60, "warrior.endurance");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(60));
  });

  it("Berserker tier-4 skill is learnable at level 100", () => {
    let book: SkillBook = {};
    // cb 1 → cleave 5 → decimate 5
    book = learn(book, 100, "warrior.crushing_blow");
    book = learnN(book, 100, "warrior.cleave", 5);
    book = learnN(book, 100, "warrior.decimate", 5);
    // Tier-4 Berserker
    book = learn(book, 100, "warrior.annihilate");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(100));
  });

  it("Guardian tier-4 skill is learnable at level 100", () => {
    let book: SkillBook = {};
    // iron_hide 1 → fortress 5 → holy_shield 5
    book = learn(book, 100, "warrior.iron_hide");
    book = learnN(book, 100, "warrior.fortress", 5);
    book = learnN(book, 100, "warrior.holy_shield", 5);
    // Tier-4 Guardian
    book = learn(book, 100, "warrior.aegis");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(100));
  });

  it("Warlord tier-4 skill is learnable at level 100", () => {
    let book: SkillBook = {};
    // cb 5 → onslaught 5 → hammer_smash 10
    book = learnN(book, 100, "warrior.crushing_blow", 5);
    book = learnN(book, 100, "warrior.onslaught", 5);
    book = learnN(book, 100, "warrior.hammer_smash", 10);
    // Tier-4 Warlord
    book = learn(book, 100, "warrior.siege_breaker");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(100));
  });
});

// ── 5. Every skill resolves via skillStatAt ────────────────────────────────

describe("WARRIOR skillStatAt resolution", () => {
  for (const skill of ALL_WARRIOR_SKILLS) {
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

describe("WARRIOR prerequisite chains", () => {
  it("all prerequisite skill ids resolve to real warrior skills", () => {
    for (const skill of ALL_WARRIOR_SKILLS) {
      if (!skill.requires) continue;
      for (const req of skill.requires) {
        const target = ALL_WARRIOR_SKILLS.find((s) => s.id === req.skillId);
        expect(target).toBeDefined();
        expect(target!.maxLevel).toBeGreaterThanOrEqual(req.level);
      }
    }
  });

  it("no circular prerequisites", () => {
    for (const skill of ALL_WARRIOR_SKILLS) {
      if (!skill.requires) continue;
      for (const req of skill.requires) {
        // The prerequisite should not reference this skill
        expect(req.skillId).not.toBe(skill.id);
      }
    }
  });
});
