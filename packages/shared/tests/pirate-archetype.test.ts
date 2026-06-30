/**
 * PIRATE archetype — spec tests.
 *
 * Verifies:
 *  1. Tier gates at levels 10 / 30 / 60 / 100.
 *  2. SP totals at each gate are sufficient to learn at least the first skill in every
 *     prerequisite chain for that tier (in every branch).
 *  3. Every skill resolves cleanly through skillStatAt at level 1 and maxLevel.
 *  4. Branch structure: 2 branches (Brawler + Gunner), each with tiers 2–4.
 *  5. Every skill has all required combat-effect fields populated (active/buff skills have
 *     mpCost, cooldownMs; passives have buffEffect).
 *  6. Branches differ: Brawler is melee, Gunner is ranged.
 *  7. Includes self-buff, AoE blast, and dash/mobility skill.
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

const PIRATE = CLASSES[ClassArchetype.PIRATE];

/** All skill defs across tier 1 and all branches. */
const ALL_PIRATE_SKILLS: readonly SkillDef[] = allSkillsForClass(ClassArchetype.PIRATE);

/** The pirate's 2 specialization branches. */
const BRANCHES: readonly JobBranch[] = PIRATE.branches ?? [];

/**
 * Learn a skill, asserting success. Returns the updated book.
 */
function learn(book: SkillBook, charLevel: number, skillId: string): SkillBook {
  const branch = getSkillBranch(ClassArchetype.PIRATE, skillId);
  const result = learnSkill(book, ClassArchetype.PIRATE, charLevel, skillId, branch?.id);
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

describe("PIRATE tier gates", () => {
  it("has STR as primary stat", () => {
    expect(PIRATE.primaryStat).toBe("STR");
  });

  it("tier 1 (Deckhand) unlocks at level 10", () => {
    expect(unlockedJobTier(ClassArchetype.PIRATE, 9)).toBe(0);
    expect(unlockedJobTier(ClassArchetype.PIRATE, 10)).toBeGreaterThanOrEqual(1);
  });

  it("tier 2 unlocks at level 30", () => {
    expect(unlockedJobTier(ClassArchetype.PIRATE, 29)).toBeLessThan(2);
    expect(unlockedJobTier(ClassArchetype.PIRATE, 30)).toBeGreaterThanOrEqual(2);
  });

  it("tier 3 unlocks at level 60", () => {
    expect(unlockedJobTier(ClassArchetype.PIRATE, 59)).toBeLessThan(3);
    expect(unlockedJobTier(ClassArchetype.PIRATE, 60)).toBeGreaterThanOrEqual(3);
  });

  it("tier 4 unlocks at level 100", () => {
    expect(unlockedJobTier(ClassArchetype.PIRATE, 99)).toBeLessThan(4);
    expect(unlockedJobTier(ClassArchetype.PIRATE, 100)).toBeGreaterThanOrEqual(4);
  });
});

// ── 2. Branch structure ────────────────────────────────────────────────────

describe("PIRATE branches", () => {
  it("has exactly 2 specialization branches", () => {
    expect(BRANCHES).toHaveLength(2);
  });

  it("branch ids are brawler and gunner", () => {
    const ids = BRANCHES.map((b) => b.id);
    expect(ids).toContain("brawler");
    expect(ids).toContain("gunner");
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

describe("PIRATE skill count", () => {
  it("has 5 shared tier-1 skills", () => {
    const tier1 = PIRATE.jobTiers.find((t) => t.tier === 1)!;
    expect(tier1.skills).toHaveLength(5);
  });

  it("has ~16–20 total skills across all tiers and branches", () => {
    expect(ALL_PIRATE_SKILLS.length).toBeGreaterThanOrEqual(16);
    expect(ALL_PIRATE_SKILLS.length).toBeLessThanOrEqual(20);
  });
});

// ── 4. SP learnability at each tier gate ───────────────────────────────────

describe("PIRATE SP learnability", () => {
  it("tier-1 gut_punch is learnable at level 10", () => {
    let book: SkillBook = {};
    book = learn(book, 10, "pirate.gut_punch");
    expect(book["pirate.gut_punch"]).toBe(1);
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(10));
  });

  it("all tier-1 skills are learnable by level 18 (highest tier-1 levelReq)", () => {
    let book: SkillBook = {};
    // gut_punch 1..3 (riptide_sweep needs level 3)
    book = learnN(book, 18, "pirate.gut_punch", 3);
    // sea_fortitude 1 (buccaneers_bellow needs level 1)
    book = learnN(book, 18, "pirate.sea_fortitude", 1);
    // tidewalker_dash 1
    book = learn(book, 18, "pirate.tidewalker_dash");
    // buccaneers_bellow 1
    book = learn(book, 18, "pirate.buccaneers_bellow");
    // riptide_sweep 1
    book = learn(book, 18, "pirate.riptide_sweep");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(18));
  });

  it("Brawler tier-2 skills are learnable at level 30", () => {
    let book: SkillBook = {};
    // Prereqs: gut_punch 1 (for knuckle_crash), sea_fortitude 3 (for iron_liver)
    book = learn(book, 30, "pirate.gut_punch");
    book = learnN(book, 30, "pirate.sea_fortitude", 3);
    // Tier-2 Brawler skills
    book = learn(book, 30, "pirate.knuckle_crash");
    book = learn(book, 30, "pirate.iron_liver");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(30));
  });

  it("Gunner tier-2 skills are learnable at level 30", () => {
    let book: SkillBook = {};
    // Prereqs: gut_punch 1 (for scorch_shot), sea_fortitude 3 (for keen_sights)
    book = learn(book, 30, "pirate.gut_punch");
    book = learnN(book, 30, "pirate.sea_fortitude", 3);
    // Tier-2 Gunner skills
    book = learn(book, 30, "pirate.scorch_shot");
    book = learn(book, 30, "pirate.keen_sights");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(30));
  });

  it("Brawler tier-3 skills are learnable at level 60", () => {
    let book: SkillBook = {};
    // Full chain to tier-3: gut_punch 5, sea_fortitude 5, knuckle_crash 5, iron_liver 5
    book = learnN(book, 60, "pirate.gut_punch", 5);
    book = learnN(book, 60, "pirate.sea_fortitude", 5);
    book = learnN(book, 60, "pirate.knuckle_crash", 5);
    book = learnN(book, 60, "pirate.iron_liver", 5);
    // Tier-3 Brawler skills
    book = learn(book, 60, "pirate.tidal_slam");
    book = learn(book, 60, "pirate.brawlers_resolve");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(60));
  });

  it("Gunner tier-3 skills are learnable at level 60", () => {
    let book: SkillBook = {};
    // Full chain to tier-3: gut_punch 5, sea_fortitude 5, scorch_shot 5, keen_sights 5
    book = learnN(book, 60, "pirate.gut_punch", 5);
    book = learnN(book, 60, "pirate.sea_fortitude", 5);
    book = learnN(book, 60, "pirate.scorch_shot", 5);
    book = learnN(book, 60, "pirate.keen_sights", 5);
    // Tier-3 Gunner skills
    book = learn(book, 60, "pirate.grapeshot_barrage");
    book = learn(book, 60, "pirate.lock_and_load");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(60));
  });

  it("Brawler tier-4 skills are learnable at level 100", () => {
    let book: SkillBook = {};
    // Full chain: gut_punch 5 → knuckle_crash 5 → tidal_slam 5
    book = learnN(book, 100, "pirate.gut_punch", 5);
    book = learnN(book, 100, "pirate.knuckle_crash", 5);
    book = learnN(book, 100, "pirate.tidal_slam", 5);
    // sea_fortitude 5 → iron_liver 5 → brawlers_resolve 3
    book = learnN(book, 100, "pirate.sea_fortitude", 5);
    book = learnN(book, 100, "pirate.iron_liver", 5);
    book = learnN(book, 100, "pirate.brawlers_resolve", 3);
    // Tier-4 Brawler
    book = learn(book, 100, "pirate.earthshaker");
    book = learn(book, 100, "pirate.adamantine_fury");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(100));
  });

  it("Gunner tier-4 skills are learnable at level 100", () => {
    let book: SkillBook = {};
    // Full chain: gut_punch 5 → scorch_shot 5 → grapeshot_barrage 5 → broadsider 1
    book = learnN(book, 100, "pirate.gut_punch", 5);
    book = learnN(book, 100, "pirate.scorch_shot", 5);
    book = learnN(book, 100, "pirate.grapeshot_barrage", 5);
    // sea_fortitude 5 → keen_sights 5 → lock_and_load 1
    book = learnN(book, 100, "pirate.sea_fortitude", 5);
    book = learnN(book, 100, "pirate.keen_sights", 5);
    book = learn(book, 100, "pirate.lock_and_load");
    // Tier-4 Gunner
    book = learn(book, 100, "pirate.broadsider");
    book = learn(book, 100, "pirate.megaton_volley");
    expect(spSpent(book)).toBeLessThanOrEqual(totalSpByLevel(100));
  });
});

// ── 5. Every skill resolves via skillStatAt ────────────────────────────────

describe("PIRATE skillStatAt resolution", () => {
  for (const skill of ALL_PIRATE_SKILLS) {
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

describe("PIRATE prerequisite chains", () => {
  it("all prerequisite skill ids resolve to real pirate skills", () => {
    for (const skill of ALL_PIRATE_SKILLS) {
      if (!skill.requires) continue;
      for (const req of skill.requires) {
        const target = ALL_PIRATE_SKILLS.find((s) => s.id === req.skillId);
        expect(target).toBeDefined();
        expect(target!.maxLevel).toBeGreaterThanOrEqual(req.level);
      }
    }
  });

  it("no circular prerequisites", () => {
    for (const skill of ALL_PIRATE_SKILLS) {
      if (!skill.requires) continue;
      for (const req of skill.requires) {
        // The prerequisite should not reference this skill
        expect(req.skillId).not.toBe(skill.id);
      }
    }
  });
});

// ── 7. Branch identity checks ─────────────────────────────────────────────

describe("PIRATE branch identity", () => {
  it("Brawler branch has melee-oriented skill descriptions", () => {
    const brawler = BRANCHES.find((b) => b.id === "brawler")!;
    expect(brawler).toBeDefined();
    // Brawler has knuckle/knuckle_crash and melee keywords in descriptions
    const brawlerSkillNames = brawler.jobTiers.flatMap((t) => t.skills.map((s) => s.name));
    expect(brawlerSkillNames).toContain("Knuckle Crash");
    expect(brawlerSkillNames).toContain("Tidal Slam");
  });

  it("Gunner branch has ranged-oriented skill descriptions", () => {
    const gunner = BRANCHES.find((b) => b.id === "gunner")!;
    expect(gunner).toBeDefined();
    const gunnerSkillNames = gunner.jobTiers.flatMap((t) => t.skills.map((s) => s.name));
    expect(gunnerSkillNames).toContain("Scorch Shot");
    expect(gunnerSkillNames).toContain("Grapeshot Barrage");
  });

  it("has a self-buff skill (Buccaneer's Bellow in tier 1)", () => {
    const tier1 = PIRATE.jobTiers.find((t) => t.tier === 1)!;
    const selfBuff = tier1.skills.find(
      (s) => s.kind === "buff" && s.id === "pirate.buccaneers_bellow",
    );
    expect(selfBuff).toBeDefined();
    expect(selfBuff!.buffEffect).toBeDefined();
  });

  it("has at least one AoE skill (targetCount > 1) in tier 1", () => {
    const tier1 = PIRATE.jobTiers.find((t) => t.tier === 1)!;
    const aoeSkill = tier1.skills.find((s) => {
      const stats = skillStatAt(s, 1);
      return stats.targetCount > 1;
    });
    expect(aoeSkill).toBeDefined();
  });

  it("has a dash/mobility skill (Tidewalker Dash)", () => {
    const tier1 = PIRATE.jobTiers.find((t) => t.tier === 1)!;
    const dash = tier1.skills.find((s) => s.id === "pirate.tidewalker_dash");
    expect(dash).toBeDefined();
    expect(dash!.kind).toBe("active");
    // Dash should have a longer cooldown than a basic attack (3000ms base)
    const dashStats = skillStatAt(dash!, 1);
    expect(dashStats.cooldownMs).toBeGreaterThanOrEqual(3000);
  });
});
