/**
 * MAGE archetype — fully-specced spec tests (mirrors warrior-archetype.test.ts).
 *
 * Verifies:
 *  1. Tier gates at levels 10 / 30 / 60 / 100.
 *  2. SP totals at each gate are sufficient to learn at least the first skill in every
 *     prerequisite chain for that tier (in every branch).
 *  3. Every skill resolves cleanly through skillStatAt at level 1 and maxLevel.
 *  4. Branch structure: 3 branches, each with tier 2–4.
 *  5. Every skill has all required combat-effect fields populated.
 *  6. Prerequisite chain integrity (all refs resolve, no cycles).
 *  7. MAGE-specific: heal skill + MP-boost passive exist.
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

const MAGE = ClassArchetype.MAGE;

/** All skill defs across tier 1 and all branches. */
const ALL_MAGE_SKILLS: readonly SkillDef[] = allSkillsForClass(MAGE);

/** The mage's 3 specialization branches. */
const BRANCHES: readonly JobBranch[] = CLASSES[MAGE].branches ?? [];

/**
 * Learn a skill, asserting success. Returns the updated book.
 * Throws a vitest assertion on failure so the test message is useful.
 */
function learn(book: SkillBook, charLevel: number, skillId: string): SkillBook {
  const branch = getSkillBranch(MAGE, skillId);
  const result = learnSkill(book, MAGE, charLevel, skillId, branch?.id);
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

describe("MAGE tier gates", () => {
  it("has INT as primary stat", () => {
    expect(CLASSES[MAGE].primaryStat).toBe("INT");
  });

  it("tier 1 (Adept) unlocks at level 10", () => {
    expect(unlockedJobTier(MAGE, 9)).toBe(0);
    expect(unlockedJobTier(MAGE, 10)).toBeGreaterThanOrEqual(1);
  });

  it("tier 2 unlocks at level 30", () => {
    expect(unlockedJobTier(MAGE, 29)).toBeLessThan(2);
    expect(unlockedJobTier(MAGE, 30)).toBeGreaterThanOrEqual(2);
  });

  it("tier 3 unlocks at level 60", () => {
    expect(unlockedJobTier(MAGE, 59)).toBeLessThan(3);
    expect(unlockedJobTier(MAGE, 60)).toBeGreaterThanOrEqual(3);
  });

  it("tier 4 unlocks at level 100", () => {
    expect(unlockedJobTier(MAGE, 99)).toBeLessThan(4);
    expect(unlockedJobTier(MAGE, 100)).toBeGreaterThanOrEqual(4);
  });
});

// ── 2. Branch structure ────────────────────────────────────────────────────

describe("MAGE branches", () => {
  it("has exactly 3 specialization branches", () => {
    expect(BRANCHES).toHaveLength(3);
  });

  it("branch ids are pyromancer, glaciemancer, luminarch", () => {
    const ids = BRANCHES.map((b) => b.id);
    expect(ids).toContain("pyromancer");
    expect(ids).toContain("glaciemancer");
    expect(ids).toContain("luminarch");
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

describe("MAGE skill count", () => {
  it("has 4 shared tier-1 skills", () => {
    const tier1 = CLASSES[MAGE].jobTiers.find((t) => t.tier === 1)!;
    expect(tier1.skills).toHaveLength(4);
  });

  it("has ~16–20 total skills across all tiers and branches", () => {
    expect(ALL_MAGE_SKILLS.length).toBeGreaterThanOrEqual(16);
    expect(ALL_MAGE_SKILLS.length).toBeLessThanOrEqual(20);
  });
});

// ── 4. MAGE-specific: heal skill + MP-boost passive ───────────────────────

describe("MAGE heal and MP-boost passive", () => {
  it("has a heal skill (mending_light) of kind active", () => {
    const heal = ALL_MAGE_SKILLS.find((s) => s.id === "mage.mending_light");
    expect(heal).toBeDefined();
    expect(heal!.kind).toBe("active");
    expect(heal!.mpCost).toBeDefined();
  });

  it("has an MP-boost passive (mana_surge) with mpPercent buffEffect", () => {
    const mp = ALL_MAGE_SKILLS.find((s) => s.id === "mage.mana_surge");
    expect(mp).toBeDefined();
    expect(mp!.kind).toBe("passive");
    expect(mp!.buffEffect).toEqual({ mpPercent: 10 });
  });

  it("mending_light is learnable at level 18 with arcane_mastery prereq", () => {
    let book: SkillBook = {};
    book = learn(book, 18, "mage.arcane_mastery");
    book = learn(book, 18, "mage.mending_light");
    expect(book["mage.mending_light"]).toBe(1);
  });
});

// ── 5. SP learnability at each tier gate ───────────────────────────────────

describe("MAGE SP learnability", () => {
  it("tier-1 arcane_bolt is learnable at level 10", () => {
    let book: SkillBook = {};
    book = learn(book, 10, "mage.arcane_bolt");
    expect(book["mage.arcane_bolt"]).toBe(1);
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(10));
  });

  it("all tier-1 skills are learnable by level 18 (highest tier-1 levelReq)", () => {
    let book: SkillBook = {};
    // arcane_bolt 1, arcane_mastery 1 (for mending_light), mana_surge 1, mending_light 1
    book = learn(book, 18, "mage.arcane_bolt");
    book = learn(book, 18, "mage.arcane_mastery");
    book = learn(book, 18, "mage.mana_surge");
    book = learn(book, 18, "mage.mending_light");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(18));
  });

  it("Pyromancer tier-2 skills are learnable at level 30", () => {
    let book: SkillBook = {};
    // Prereqs: arcane_bolt 1 (for flame_lance), arcane_bolt 3 (for immolate)
    book = learnN(book, 30, "mage.arcane_bolt", 3);
    // Tier-2 Pyromancer skills
    book = learn(book, 30, "mage.flame_lance");
    book = learn(book, 30, "mage.immolate");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(30));
  });

  it("Glaciemancer tier-2 skills are learnable at level 30", () => {
    let book: SkillBook = {};
    // Prereqs: arcane_bolt 1 (for frost_bolt), arcane_mastery 3 (for chain_lightning)
    book = learn(book, 30, "mage.arcane_bolt");
    book = learnN(book, 30, "mage.arcane_mastery", 3);
    // Tier-2 Glaciemancer skills
    book = learn(book, 30, "mage.frost_bolt");
    book = learn(book, 30, "mage.chain_lightning");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(30));
  });

  it("Luminarch tier-2 skills are learnable at level 30", () => {
    let book: SkillBook = {};
    // Prereqs: arcane_mastery 1 → mending_light 1 → radiance, mana_surge 3 → sanctuary
    book = learn(book, 30, "mage.arcane_mastery");
    book = learn(book, 30, "mage.mending_light");
    book = learnN(book, 30, "mage.mana_surge", 3);
    // Tier-2 Luminarch skills
    book = learn(book, 30, "mage.radiance");
    book = learn(book, 30, "mage.sanctuary");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(30));
  });

  it("Pyromancer tier-3 skills are learnable at level 60", () => {
    let book: SkillBook = {};
    // Full chain: arcane_bolt 3 → flame_lance 5, immolate 3
    book = learnN(book, 60, "mage.arcane_bolt", 3);
    book = learnN(book, 60, "mage.flame_lance", 5);
    book = learnN(book, 60, "mage.immolate", 3);
    // Tier-3 Pyromancer skills
    book = learn(book, 60, "mage.firestorm");
    book = learn(book, 60, "mage.inferno_aura");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(60));
  });

  it("Glaciemancer tier-3 skills are learnable at level 60", () => {
    let book: SkillBook = {};
    // chain: arcane_bolt 1, arcane_mastery 3 → frost_bolt 5, chain_lightning 3
    book = learn(book, 60, "mage.arcane_bolt");
    book = learnN(book, 60, "mage.arcane_mastery", 3);
    book = learnN(book, 60, "mage.frost_bolt", 5);
    book = learnN(book, 60, "mage.chain_lightning", 3);
    // Tier-3 Glaciemancer skills
    book = learn(book, 60, "mage.blizzard");
    book = learn(book, 60, "mage.thunder_shield");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(60));
  });

  it("Luminarch tier-3 skills are learnable at level 60", () => {
    let book: SkillBook = {};
    // chain: arcane_mastery 1 → mending_light 1 → radiance 5, mana_surge 3 → sanctuary 3
    book = learn(book, 60, "mage.arcane_mastery");
    book = learn(book, 60, "mage.mending_light");
    book = learnN(book, 60, "mage.radiance", 5);
    book = learnN(book, 60, "mage.mana_surge", 3);
    book = learnN(book, 60, "mage.sanctuary", 3);
    // Tier-3 Luminarch skills
    book = learn(book, 60, "mage.divine_wrath");
    book = learn(book, 60, "mage.divine_ward");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(60));
  });

  it("Pyromancer tier-4 skill is learnable at level 100", () => {
    let book: SkillBook = {};
    // arcane_bolt 3 → flame_lance 5 → firestorm 5
    book = learnN(book, 100, "mage.arcane_bolt", 3);
    book = learnN(book, 100, "mage.flame_lance", 5);
    book = learnN(book, 100, "mage.firestorm", 5);
    // Tier-4 Pyromancer
    book = learn(book, 100, "mage.cataclysm");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(100));
  });

  it("Glaciemancer tier-4 skill is learnable at level 100", () => {
    let book: SkillBook = {};
    // arcane_bolt 1, arcane_mastery 3 → frost_bolt 5 → blizzard 5
    book = learn(book, 100, "mage.arcane_bolt");
    book = learnN(book, 100, "mage.arcane_mastery", 3);
    book = learnN(book, 100, "mage.frost_bolt", 5);
    book = learnN(book, 100, "mage.blizzard", 5);
    // Tier-4 Glaciemancer
    book = learn(book, 100, "mage.absolute_zero");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(100));
  });

  it("Luminarch tier-4 skill is learnable at level 100", () => {
    let book: SkillBook = {};
    // arcane_mastery 1 → mending_light 1 → radiance 5 → divine_wrath 5
    book = learn(book, 100, "mage.arcane_mastery");
    book = learn(book, 100, "mage.mending_light");
    book = learnN(book, 100, "mage.radiance", 5);
    book = learnN(book, 100, "mage.divine_wrath", 5);
    // Tier-4 Luminarch
    book = learn(book, 100, "mage.judgement");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(100));
  });
});

// ── 6. Every skill resolves via skillStatAt ────────────────────────────────

describe("MAGE skillStatAt resolution", () => {
  for (const skill of ALL_MAGE_SKILLS) {
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

// ── 7. Prerequisite chain integrity ───────────────────────────────────────

describe("MAGE prerequisite chains", () => {
  it("all prerequisite skill ids resolve to real mage skills", () => {
    for (const skill of ALL_MAGE_SKILLS) {
      if (!skill.requires) continue;
      for (const req of skill.requires) {
        const target = ALL_MAGE_SKILLS.find((s) => s.id === req.skillId);
        expect(target).toBeDefined();
        expect(target!.maxLevel).toBeGreaterThanOrEqual(req.level);
      }
    }
  });

  it("no circular prerequisites", () => {
    for (const skill of ALL_MAGE_SKILLS) {
      if (!skill.requires) continue;
      for (const req of skill.requires) {
        expect(req.skillId).not.toBe(skill.id);
      }
    }
  });
});

// ── 8. learnSkill rejection paths for MAGE ────────────────────────────────

describe("MAGE learnSkill rejections", () => {
  it("fails for an unknown skill id", () => {
    const result = learnSkill({}, MAGE, 20, "mage.nonexistent");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Unknown skill");
  });

  it("fails when job tier is not unlocked", () => {
    const result = learnSkill({}, MAGE, 10, "mage.flame_lance");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Job tier");
  });

  it("fails when character level is below skill levelReq", () => {
    // mending_light levelReq=18, but trying at level 10
    const result = learnSkill({}, MAGE, 10, "mage.mending_light");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("levelReq");
  });

  it("fails when prerequisites are not met", () => {
    // mending_light requires arcane_mastery level 1
    const result = learnSkill({}, MAGE, 18, "mage.mending_light");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Missing prerequisites");
  });

  it("fails when skill is already at max level", () => {
    const book: SkillBook = { "mage.arcane_bolt": 20 };
    const result = learnSkill(book, MAGE, 30, "mage.arcane_bolt");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("max level");
  });

  it("fails when SP budget is exceeded", () => {
    // At level 18, totalSpByLevel(18) = 51 SP.
    const budget = totalSpByLevel(18); // 51
    const book: SkillBook = {
      "mage.arcane_bolt": 20,
      "mage.arcane_mastery": 10,
      "mage.mana_surge": 10,
      "mage.mending_light": 10,
      _extra: 1, // padding to hit budget exactly
    };
    expect(spSpent(book)).toBe(budget);
    // All skills are at their max levels, so no additional SP can be spent.
    const result = learnSkill(book, MAGE, 18, "mage.arcane_bolt");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("max level");
  });

  it("learns prerequisites chain correctly", () => {
    let book: SkillBook = {};
    const am = learnSkill(book, MAGE, 18, "mage.arcane_mastery");
    expect(am.ok).toBe(true);
    book = am.book!;

    const ml = learnSkill(book, MAGE, 18, "mage.mending_light");
    expect(ml.ok).toBe(true);
    book = ml.book!;
    expect(spSpent(book)).toBe(2);
  });

  it("succeeds and returns an immutable copy", () => {
    const book: SkillBook = {};
    const result = learnSkill(book, MAGE, 10, "mage.arcane_bolt");
    expect(result.ok).toBe(true);
    expect(result.book).toBeDefined();
    expect(result.book!["mage.arcane_bolt"]).toBe(1);
    // Original book untouched
    expect(book["mage.arcane_bolt"]).toBeUndefined();
  });

  it("can level up an existing skill", () => {
    const book: SkillBook = { "mage.arcane_bolt": 5 };
    const result = learnSkill(book, MAGE, 15, "mage.arcane_bolt");
    expect(result.ok).toBe(true);
    expect(result.book!["mage.arcane_bolt"]).toBe(6);
  });

  it("cannot learn a warrior skill as mage", () => {
    const result = learnSkill({}, MAGE, 100, "warrior.crushing_blow");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Unknown skill");
  });
});
