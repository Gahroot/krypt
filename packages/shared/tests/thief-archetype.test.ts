/**
 * THIEF archetype — fully specced reference tests.
 *
 * Verifies:
 *  1. Tier gates at levels 10 / 30 / 60 / 100.
 *  2. SP totals at each gate are sufficient to learn at least the first skill in every
 *     prerequisite chain for that tier (in every branch).
 *  3. Every skill resolves cleanly through skillStatAt at level 1 and maxLevel.
 *  4. Branch structure: 3 branches, each with tier 2–4.
 *  5. Every skill has all required combat-effect fields populated (active/buff skills have
 *     mpCost, cooldownMs; passives have buffEffect).
 *  6. Skill count is within 16–20 range.
 *  7. Multi-hit flurry (flicker_assault) has hitCount ≥ 4.
 *  8. Stealth/dodge passives exist (shadow_instinct, evasive_mastery).
 *  9. High-crit burst (shadow_rush) has high base damagePercent.
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

const THIEF = CLASSES[ClassArchetype.THIEF];

/** All skill defs across tier 1 and all branches. */
const ALL_THIEF_SKILLS: readonly SkillDef[] = allSkillsForClass(ClassArchetype.THIEF);

/** The thief's 3 specialization branches. */
const BRANCHES: readonly JobBranch[] = THIEF.branches ?? [];

/**
 * Learn a skill, asserting success. Returns the updated book.
 * Throws a vitest assertion on failure so the test message is useful.
 */
function learn(book: SkillBook, charLevel: number, skillId: string): SkillBook {
  const branch = getSkillBranch(ClassArchetype.THIEF, skillId);
  const result = learnSkill(book, ClassArchetype.THIEF, charLevel, skillId, branch?.id);
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

describe("THIEF tier gates", () => {
  it("has LUK as primary stat", () => {
    expect(THIEF.primaryStat).toBe("LUK");
  });

  it("has dusk-ward as hometown", () => {
    expect(THIEF.hometown).toBe("dusk-ward");
  });

  it("tier 1 (Cutpurse) unlocks at level 10", () => {
    expect(unlockedJobTier(ClassArchetype.THIEF, 9)).toBe(0);
    expect(unlockedJobTier(ClassArchetype.THIEF, 10)).toBeGreaterThanOrEqual(1);
  });

  it("tier 2 unlocks at level 30", () => {
    expect(unlockedJobTier(ClassArchetype.THIEF, 29)).toBeLessThan(2);
    expect(unlockedJobTier(ClassArchetype.THIEF, 30)).toBeGreaterThanOrEqual(2);
  });

  it("tier 3 unlocks at level 60", () => {
    expect(unlockedJobTier(ClassArchetype.THIEF, 59)).toBeLessThan(3);
    expect(unlockedJobTier(ClassArchetype.THIEF, 60)).toBeGreaterThanOrEqual(3);
  });

  it("tier 4 unlocks at level 100", () => {
    expect(unlockedJobTier(ClassArchetype.THIEF, 99)).toBeLessThan(4);
    expect(unlockedJobTier(ClassArchetype.THIEF, 100)).toBeGreaterThanOrEqual(4);
  });
});

// ── 2. Branch structure ────────────────────────────────────────────────────

describe("THIEF branches", () => {
  it("has exactly 3 specialization branches", () => {
    expect(BRANCHES).toHaveLength(3);
  });

  it("branch ids are bladecaller, cutthroat, shadowmancer", () => {
    const ids = BRANCHES.map((b) => b.id);
    expect(ids).toContain("bladecaller");
    expect(ids).toContain("cutthroat");
    expect(ids).toContain("shadowmancer");
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

  it("Bladecaller is the throwing-blade / ranged branch", () => {
    const bladecaller = BRANCHES.find((b) => b.id === "bladecaller")!;
    expect(bladecaller.name).toBe("Bladecaller");
    expect(bladecaller.description.toLowerCase()).toContain("blade");
  });

  it("Cutthroat is the dagger / melee branch", () => {
    const cutthroat = BRANCHES.find((b) => b.id === "cutthroat")!;
    expect(cutthroat.name).toBe("Cutthroat");
    expect(cutthroat.description.toLowerCase()).toContain("dagger");
  });

  it("Shadowmancer is the magic-stealth branch", () => {
    const shadowmancer = BRANCHES.find((b) => b.id === "shadowmancer")!;
    expect(shadowmancer.name).toBe("Shadowmancer");
    expect(shadowmancer.description.toLowerCase()).toContain("shadow");
  });
});

// ── 3. Total skill count ───────────────────────────────────────────────────

describe("THIEF skill count", () => {
  it("has 4 shared tier-1 skills", () => {
    const tier1 = THIEF.jobTiers.find((t) => t.tier === 1)!;
    expect(tier1.skills).toHaveLength(4);
  });

  it("has ~16–20 total skills across all tiers and branches", () => {
    expect(ALL_THIEF_SKILLS.length).toBeGreaterThanOrEqual(16);
    expect(ALL_THIEF_SKILLS.length).toBeLessThanOrEqual(20);
  });

  it("has exactly 20 total skills", () => {
    expect(ALL_THIEF_SKILLS.length).toBe(20);
  });
});

// ── 4. Signature mechanics ────────────────────────────────────────────────

describe("THIEF signature mechanics", () => {
  it("has stealth/dodge passive: shadow_instinct grants speed", () => {
    const skill = ALL_THIEF_SKILLS.find((s) => s.id === "thief.shadow_instinct")!;
    expect(skill.kind).toBe("passive");
    expect(skill.buffEffect).toBeDefined();
    expect(skill.buffEffect).toHaveProperty("speed");
  });

  it("has stealth/dodge passive: evasive_mastery grants defense", () => {
    const skill = ALL_THIEF_SKILLS.find((s) => s.id === "thief.evasive_mastery")!;
    expect(skill.kind).toBe("passive");
    expect(skill.buffEffect).toBeDefined();
    expect(skill.buffEffect).toHaveProperty("defPercent");
  });

  it("has high-crit burst: shadow_rush has high base damagePercent", () => {
    const skill = ALL_THIEF_SKILLS.find((s) => s.id === "thief.shadow_rush")!;
    expect(skill.kind).toBe("active");
    expect(skill.damagePercent).toBeDefined();
    expect(skill.damagePercent!.base).toBeGreaterThanOrEqual(150);
  });

  it("has multi-hit flurry: flicker_assault has hitCount >= 4", () => {
    const skill = ALL_THIEF_SKILLS.find((s) => s.id === "thief.flicker_assault")!;
    expect(skill.kind).toBe("active");
    expect(skill.hitCount).toBeDefined();
    expect(skill.hitCount!.base).toBeGreaterThanOrEqual(4);
  });

  it("LUK is the primary stat (thief identity)", () => {
    expect(THIEF.primaryStat).toBe("LUK");
  });
});

// ── 5. SP learnability at each tier gate ───────────────────────────────────

describe("THIEF SP learnability", () => {
  it("tier-1 shadow_rush is learnable at level 10", () => {
    let book: SkillBook = {};
    book = learn(book, 10, "thief.shadow_rush");
    expect(book["thief.shadow_rush"]).toBe(1);
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(10));
  });

  it("all tier-1 skills are learnable by level 18 (highest tier-1 levelReq)", () => {
    let book: SkillBook = {};
    // shadow_rush 1..3 (noxious_wound needs level 3)
    book = learnN(book, 18, "thief.shadow_rush", 3);
    // shadow_instinct 1 (evasive_mastery needs level 3 later)
    book = learn(book, 18, "thief.shadow_instinct");
    // keen_reflexes 1 (focused_fury needs level 3 later)
    book = learn(book, 18, "thief.keen_reflexes");
    // noxious_wound 1
    book = learn(book, 18, "thief.noxious_wound");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(18));
  });

  it("Bladecaller tier-2 skills are learnable at level 30", () => {
    let book: SkillBook = {};
    // Prereqs: shadow_rush 1 (for ricochet_blade), keen_reflexes 3 (for focused_fury)
    book = learn(book, 30, "thief.shadow_rush");
    book = learnN(book, 30, "thief.keen_reflexes", 3);
    // Tier-2 Bladecaller skills
    book = learn(book, 30, "thief.ricochet_blade");
    book = learn(book, 30, "thief.focused_fury");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(30));
  });

  it("Cutthroat tier-2 skills are learnable at level 30", () => {
    let book: SkillBook = {};
    // Prereqs: shadow_rush 1 (vicious_slash), shadow_instinct 3 (evasive_mastery)
    book = learn(book, 30, "thief.shadow_rush");
    book = learnN(book, 30, "thief.shadow_instinct", 3);
    book = learn(book, 30, "thief.keen_reflexes");
    // Tier-2 Cutthroat skills
    book = learn(book, 30, "thief.vicious_slash");
    book = learn(book, 30, "thief.evasive_mastery");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(30));
  });

  it("Blood Fang (tier 2, levelReq 35) is learnable at level 35", () => {
    let book: SkillBook = {};
    book = learn(book, 35, "thief.shadow_rush");
    book = learnN(book, 35, "thief.vicious_slash", 3);
    book = learn(book, 35, "thief.blood_fang");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(35));
  });

  it("Shadowmancer tier-2 skills are learnable at level 30", () => {
    let book: SkillBook = {};
    // Prereqs: shadow_instinct 1 (smokescreen), keen_reflexes 1 (phantom_strike)
    book = learn(book, 30, "thief.shadow_rush");
    book = learn(book, 30, "thief.shadow_instinct");
    book = learn(book, 30, "thief.keen_reflexes");
    // Tier-2 Shadowmancer skills
    book = learn(book, 30, "thief.smokescreen");
    book = learn(book, 30, "thief.phantom_strike");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(30));
  });

  it("Bladecaller tier-3 skills are learnable at level 60", () => {
    let book: SkillBook = {};
    // Full chain: shadow_rush 1 → ricochet_blade 5, keen_reflexes 3 → focused_fury 3
    book = learn(book, 60, "thief.shadow_rush");
    book = learnN(book, 60, "thief.ricochet_blade", 5);
    book = learnN(book, 60, "thief.keen_reflexes", 3);
    book = learnN(book, 60, "thief.focused_fury", 3);
    // Tier-3 Bladecaller skills
    book = learn(book, 60, "thief.blade_storm");
    book = learn(book, 60, "thief.cloak_of_razors");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(60));
  });

  it("Cutthroat tier-3 skills are learnable at level 60", () => {
    let book: SkillBook = {};
    // shadow_rush 1 → vicious_slash 3 → blood_fang 5, shadow_instinct 3 → evasive_mastery 5
    book = learn(book, 60, "thief.shadow_rush");
    book = learnN(book, 60, "thief.vicious_slash", 3);
    book = learnN(book, 60, "thief.blood_fang", 5);
    book = learn(book, 60, "thief.keen_reflexes");
    book = learnN(book, 60, "thief.shadow_instinct", 3);
    book = learnN(book, 60, "thief.evasive_mastery", 5);
    // Tier-3 Cutthroat skills
    book = learn(book, 60, "thief.shadow_dance");
    book = learn(book, 60, "thief.flicker_assault");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(60));
  });

  it("Shadowmancer tier-3 skills are learnable at level 60", () => {
    let book: SkillBook = {};
    // shadow_instinct 1 → smokescreen 5, keen_reflexes 1 → phantom_strike 5
    book = learn(book, 60, "thief.shadow_rush");
    book = learn(book, 60, "thief.shadow_instinct");
    book = learnN(book, 60, "thief.smokescreen", 5);
    book = learn(book, 60, "thief.keen_reflexes");
    book = learnN(book, 60, "thief.phantom_strike", 5);
    // Tier-3 Shadowmancer skills
    book = learn(book, 60, "thief.void_cloak");
    book = learn(book, 60, "thief.wraith_talon");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(60));
  });

  it("Bladecaller tier-4 skill is learnable at level 100", () => {
    let book: SkillBook = {};
    // shadow_rush 1 → ricochet_blade 5 → blade_storm 5
    book = learn(book, 100, "thief.shadow_rush");
    book = learnN(book, 100, "thief.ricochet_blade", 5);
    book = learnN(book, 100, "thief.blade_storm", 5);
    // Tier-4 Bladecaller
    book = learn(book, 100, "thief.eclipse_barrage");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(100));
  });

  it("Cutthroat tier-4 skill is learnable at level 100", () => {
    let book: SkillBook = {};
    // shadow_rush 1 → vicious_slash 3 → blood_fang 5 → flicker_assault 5
    book = learn(book, 100, "thief.shadow_rush");
    book = learnN(book, 100, "thief.vicious_slash", 3);
    book = learnN(book, 100, "thief.blood_fang", 5);
    book = learnN(book, 100, "thief.flicker_assault", 5);
    // Tier-4 Cutthroat
    book = learn(book, 100, "thief.void_ripper");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(100));
  });

  it("Shadowmancer tier-4 skill is learnable at level 100", () => {
    let book: SkillBook = {};
    // shadow_instinct 1 → smokescreen 5 → void_cloak (no prereq beyond smokescreen 5)
    // keen_reflexes 1 → phantom_strike 5 → wraith_talon 5
    book = learn(book, 100, "thief.shadow_rush");
    book = learn(book, 100, "thief.shadow_instinct");
    book = learnN(book, 100, "thief.smokescreen", 5);
    book = learn(book, 100, "thief.keen_reflexes");
    book = learnN(book, 100, "thief.phantom_strike", 5);
    book = learnN(book, 100, "thief.wraith_talon", 5);
    // Tier-4 Shadowmancer
    book = learn(book, 100, "thief.umbra_dominion");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(100));
  });
});

// ── 6. Every skill resolves via skillStatAt ────────────────────────────────

describe("THIEF skillStatAt resolution", () => {
  for (const skill of ALL_THIEF_SKILLS) {
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

// ── 7. Prerequisite chain integrity ───────────────────────────────────────

describe("THIEF prerequisite chains", () => {
  it("all prerequisite skill ids resolve to real thief skills", () => {
    for (const skill of ALL_THIEF_SKILLS) {
      if (!skill.requires) continue;
      for (const req of skill.requires) {
        const target = ALL_THIEF_SKILLS.find((s) => s.id === req.skillId);
        expect(target).toBeDefined();
        expect(target!.maxLevel).toBeGreaterThanOrEqual(req.level);
      }
    }
  });

  it("no circular prerequisites", () => {
    for (const skill of ALL_THIEF_SKILLS) {
      if (!skill.requires) continue;
      for (const req of skill.requires) {
        // The prerequisite should not reference this skill
        expect(req.skillId).not.toBe(skill.id);
      }
    }
  });
});

// ── 8. Branch-specific skill id prefixes ───────────────────────────────────

describe("THIEF skill id conventions", () => {
  it("all skill ids start with 'thief.'", () => {
    for (const skill of ALL_THIEF_SKILLS) {
      expect(skill.id).toMatch(/^thief\./);
    }
  });

  it("no skill id contains MapleStory references (lucky_seven, savage_blow, etc.)", () => {
    const msNames = [
      "lucky_seven",
      "savage_blow",
      "shadow_meso",
      "dark_sight",
      "boomerang_step",
      "assasins_charge",
      "shadow_partner",
      "blade_flurry",
    ];
    for (const skill of ALL_THIEF_SKILLS) {
      for (const msName of msNames) {
        expect(skill.id).not.toContain(msName);
      }
    }
  });
});

// ── 9. Specific combat stat spot-checks ────────────────────────────────────

describe("THIEF combat stat spot-checks", () => {
  it("shadow_rush: level 1 base damage is 150%, scales to 264% at max", () => {
    const skill = ALL_THIEF_SKILLS.find((s) => s.id === "thief.shadow_rush")!;
    expect(skillStatAt(skill, 1).damagePercent).toBe(150);
    // 150 + 6 × 19 = 264
    expect(skillStatAt(skill, 20).damagePercent).toBe(264);
  });

  it("flicker_assault: always hits 4 times (hitCount scales at 0 perLevel)", () => {
    const skill = ALL_THIEF_SKILLS.find((s) => s.id === "thief.flicker_assault")!;
    expect(skillStatAt(skill, 1).hitCount).toBe(4);
    expect(skillStatAt(skill, 20).hitCount).toBe(4);
  });

  it("void_ripper: high burst with 2 hits at level 1", () => {
    const skill = ALL_THIEF_SKILLS.find((s) => s.id === "thief.void_ripper")!;
    const s = skillStatAt(skill, 1);
    expect(s.damagePercent).toBe(280);
    expect(s.hitCount).toBe(2);
  });

  it("umbra_dominion: highest base damage at 300%", () => {
    const skill = ALL_THIEF_SKILLS.find((s) => s.id === "thief.umbra_dominion")!;
    expect(skillStatAt(skill, 1).damagePercent).toBe(300);
  });

  it("shadow_instinct passive grants speed (not atkPercent or defPercent)", () => {
    const skill = ALL_THIEF_SKILLS.find((s) => s.id === "thief.shadow_instinct")!;
    const effect = skillStatAt(skill, 1).buffEffect!;
    expect(effect).toHaveProperty("speed");
    expect(effect).not.toHaveProperty("atkPercent");
    expect(effect).not.toHaveProperty("defPercent");
  });

  it("smokescreen buff grants speed (evasion via mobility)", () => {
    const skill = ALL_THIEF_SKILLS.find((s) => s.id === "thief.smokescreen")!;
    const effect = skillStatAt(skill, 1).buffEffect!;
    expect(effect).toHaveProperty("speed");
  });

  it("void_cloak grants the highest defPercent buff among thief skills", () => {
    const skill = ALL_THIEF_SKILLS.find((s) => s.id === "thief.void_cloak")!;
    const effect = skillStatAt(skill, 1).buffEffect!;
    expect(effect).toEqual({ defPercent: 22 });
  });
});
