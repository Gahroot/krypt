/**
 * Branch system — tests for the specialization branch infrastructure.
 *
 * Verifies:
 *  1. branchSkillsFor returns correct skills per branch and level.
 *  2. learnSkill rejects tier-2+ branch skills without a chosen branch.
 *  3. learnSkill rejects tier-2+ branch skills from the wrong branch.
 *  4. learnSkill accepts tier-2+ branch skills when correct branch is chosen.
 *  5. Tier-1 (shared) skills never require a branch.
 *  6. getSkillBranch returns the correct branch for any skill.
 *  7. skillsAvailableAt respects the branch-choice gate.
 *  8. Cross-archetype branch isolation.
 */

import { describe, it, expect } from "vitest";
import {
  ClassArchetype,
  CLASSES,
  allBranchSkills,
  branchSkillsFor,
  getBranch,
  getBranchesForArchetype,
  getSkillBranch,
} from "../src/classes.js";
import { learnSkill, skillsAvailableAt, type SkillBook } from "../src/skillbook.js";

// ── 1. branchSkillsFor ───────────────────────────────────────────────────

describe("branchSkillsFor", () => {
  it("returns berserker branch skills at level 30", () => {
    const book: SkillBook = { "warrior.crushing_blow": 1, "warrior.iron_hide": 3 };
    const skills = branchSkillsFor(ClassArchetype.WARRIOR, "berserker", 30, book);
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("warrior.cleave");
    expect(ids).toContain("warrior.frenzy");
  });

  it("returns guardian branch skills at level 30", () => {
    const book: SkillBook = { "warrior.iron_hide": 1 };
    const skills = branchSkillsFor(ClassArchetype.WARRIOR, "guardian", 30, book);
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("warrior.phalanx");
    expect(ids).toContain("warrior.fortress");
    // bulwark has levelReq 35 — should not appear at 30
    expect(ids).not.toContain("warrior.bulwark");
  });

  it("returns bulwark at level 35 for guardian branch", () => {
    const skills = branchSkillsFor(ClassArchetype.WARRIOR, "guardian", 35);
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("warrior.bulwark");
  });

  it("returns empty array for non-existent branch", () => {
    const skills = branchSkillsFor(ClassArchetype.WARRIOR, "nonexistent", 100);
    expect(skills).toHaveLength(0);
  });

  it("returns empty array for non-existent archetype branch", () => {
    const skills = branchSkillsFor(ClassArchetype.MAGE, "berserker", 100);
    expect(skills).toHaveLength(0);
  });

  it("respects prerequisites: cleave needs crushing_blow", () => {
    // Without the prereq, cleave should not be in the eligible list
    const without = branchSkillsFor(ClassArchetype.WARRIOR, "berserker", 30, {});
    expect(without.map((s) => s.id)).not.toContain("warrior.cleave");

    // With the prereq, cleave appears
    const withPrereq = branchSkillsFor(ClassArchetype.WARRIOR, "berserker", 30, {
      "warrior.crushing_blow": 1,
    });
    expect(withPrereq.map((s) => s.id)).toContain("warrior.cleave");
  });

  it("returns tier 3-4 skills at appropriate levels", () => {
    const book60: SkillBook = {
      "warrior.crushing_blow": 1,
      "warrior.cleave": 5,
      "warrior.iron_hide": 3,
      "warrior.frenzy": 5,
    };
    const at60 = branchSkillsFor(ClassArchetype.WARRIOR, "berserker", 60, book60);
    const ids60 = at60.map((s) => s.id);
    expect(ids60).toContain("warrior.decimate");
    expect(ids60).toContain("warrior.berserk");

    const book100: SkillBook = { ...book60, "warrior.decimate": 5 };
    const at100 = branchSkillsFor(ClassArchetype.WARRIOR, "berserker", 100, book100);
    const ids100 = at100.map((s) => s.id);
    expect(ids100).toContain("warrior.annihilate");
  });
});

// ── 2. Branch validation in learnSkill ────────────────────────────────────

describe("learnSkill branch gate", () => {
  it("rejects tier-2 skill without choosing a branch", () => {
    const book: SkillBook = { "warrior.crushing_blow": 1 };
    const result = learnSkill(book, ClassArchetype.WARRIOR, 30, "warrior.cleave");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Must choose a specialization branch");
  });

  it("accepts tier-2 skill with correct branch", () => {
    const book: SkillBook = { "warrior.crushing_blow": 1 };
    const result = learnSkill(book, ClassArchetype.WARRIOR, 30, "warrior.cleave", "berserker");
    expect(result.ok).toBe(true);
    expect(result.book!["warrior.cleave"]).toBe(1);
  });

  it("rejects tier-2 skill from wrong branch", () => {
    const book: SkillBook = { "warrior.iron_hide": 1 };
    // phalanx belongs to guardian, not berserker
    const result = learnSkill(book, ClassArchetype.WARRIOR, 30, "warrior.phalanx", "berserker");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('belongs to branch "guardian"');
    expect(result.reason).toContain('chose "berserker"');
  });

  it("rejects tier-3 skill without choosing a branch", () => {
    const book: SkillBook = {
      "warrior.crushing_blow": 1,
      "warrior.cleave": 5,
    };
    const result = learnSkill(book, ClassArchetype.WARRIOR, 60, "warrior.decimate");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Must choose a specialization branch");
  });

  it("accepts tier-3 skill with correct branch", () => {
    const book: SkillBook = {
      "warrior.crushing_blow": 1,
      "warrior.cleave": 5,
    };
    const result = learnSkill(book, ClassArchetype.WARRIOR, 60, "warrior.decimate", "berserker");
    expect(result.ok).toBe(true);
  });

  it("rejects tier-4 skill from wrong branch", () => {
    const book: SkillBook = {
      "warrior.crushing_blow": 1,
      "warrior.cleave": 5,
      "warrior.decimate": 5,
    };
    // annihilate belongs to berserker, not guardian
    const result = learnSkill(book, ClassArchetype.WARRIOR, 100, "warrior.annihilate", "guardian");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('belongs to branch "berserker"');
  });

  it("accepts tier-4 skill with correct branch", () => {
    const book: SkillBook = {
      "warrior.crushing_blow": 1,
      "warrior.cleave": 5,
      "warrior.decimate": 5,
    };
    const result = learnSkill(book, ClassArchetype.WARRIOR, 100, "warrior.annihilate", "berserker");
    expect(result.ok).toBe(true);
  });
});

// ── 3. Tier-1 shared skills never require a branch ───────────────────────

describe("tier-1 shared skills", () => {
  it("can learn tier-1 skills without any branch", () => {
    const result = learnSkill({}, ClassArchetype.WARRIOR, 10, "warrior.crushing_blow");
    expect(result.ok).toBe(true);
  });

  it("tier-1 skills are not owned by any branch", () => {
    expect(getSkillBranch(ClassArchetype.WARRIOR, "warrior.crushing_blow")).toBeUndefined();
    expect(getSkillBranch(ClassArchetype.WARRIOR, "warrior.iron_hide")).toBeUndefined();
    expect(getSkillBranch(ClassArchetype.WARRIOR, "warrior.rally")).toBeUndefined();
    expect(getSkillBranch(ClassArchetype.WARRIOR, "warrior.battle_cry")).toBeUndefined();
  });

  it("all archetypes have tier-1 skills that are branch-free", () => {
    for (const archetype of Object.values(ClassArchetype)) {
      const cls = CLASSES[archetype];
      for (const tier of cls.jobTiers) {
        if (tier.tier === 1) {
          for (const skill of tier.skills) {
            expect(getSkillBranch(archetype, skill.id)).toBeUndefined();
          }
        }
      }
    }
  });
});

// ── 4. getSkillBranch ─────────────────────────────────────────────────────

describe("getSkillBranch", () => {
  it("returns correct branch for berserker skills", () => {
    const branch = getSkillBranch(ClassArchetype.WARRIOR, "warrior.cleave");
    expect(branch).toBeDefined();
    expect(branch!.id).toBe("berserker");
  });

  it("returns correct branch for guardian skills", () => {
    const branch = getSkillBranch(ClassArchetype.WARRIOR, "warrior.phalanx");
    expect(branch).toBeDefined();
    expect(branch!.id).toBe("guardian");
  });

  it("returns correct branch for warlord skills", () => {
    const branch = getSkillBranch(ClassArchetype.WARRIOR, "warrior.battle_standard");
    expect(branch).toBeDefined();
    expect(branch!.id).toBe("warlord");
  });

  it("returns undefined for unknown skill id", () => {
    expect(getSkillBranch(ClassArchetype.WARRIOR, "warrior.nonexistent")).toBeUndefined();
  });

  it("returns undefined for skills from other archetypes", () => {
    // mage skills should not appear as warrior branch skills
    expect(getSkillBranch(ClassArchetype.WARRIOR, "mage.arcane_bolt")).toBeUndefined();
  });

  it("works across all archetypes", () => {
    for (const archetype of Object.values(ClassArchetype)) {
      const branches = getBranchesForArchetype(archetype);
      for (const branch of branches) {
        for (const tier of branch.jobTiers) {
          for (const skill of tier.skills) {
            const found = getSkillBranch(archetype, skill.id);
            expect(found).toBeDefined();
            expect(found!.id).toBe(branch.id);
          }
        }
      }
    }
  });
});

// ── 5. skillsAvailableAt branch gate ──────────────────────────────────────

describe("skillsAvailableAt branch gate", () => {
  it("excludes tier-2 branch skills when no branch chosen", () => {
    const book: SkillBook = { "warrior.crushing_blow": 1 };
    const available = skillsAvailableAt(ClassArchetype.WARRIOR, 30, book);
    const ids = available.map((s) => s.id);
    // No branch → no tier-2 branch skills
    expect(ids).not.toContain("warrior.cleave");
    expect(ids).not.toContain("warrior.phalanx");
    expect(ids).not.toContain("warrior.battle_standard");
    // But tier-1 shared skills should still appear
    expect(ids).toContain("warrior.iron_hide");
  });

  it("includes only the chosen branch's tier-2 skills", () => {
    const book: SkillBook = {
      "warrior.crushing_blow": 1,
      "warrior.iron_hide": 3,
      "warrior.rally": 3,
    };
    const berserker = skillsAvailableAt(ClassArchetype.WARRIOR, 30, book, "berserker");
    const ids = berserker.map((s) => s.id);
    expect(ids).toContain("warrior.cleave");
    expect(ids).toContain("warrior.frenzy");
    // Guardian/warlord skills should NOT appear
    expect(ids).not.toContain("warrior.phalanx");
    expect(ids).not.toContain("warrior.fortress");
    expect(ids).not.toContain("warrior.battle_standard");
    expect(ids).not.toContain("warrior.onslaught");
  });

  it("switches branch to see different skills", () => {
    const book: SkillBook = {
      "warrior.iron_hide": 1,
    };
    const guardian = skillsAvailableAt(ClassArchetype.WARRIOR, 30, book, "guardian");
    const ids = guardian.map((s) => s.id);
    expect(ids).toContain("warrior.phalanx");
    expect(ids).toContain("warrior.fortress");
    // Berserker skills should NOT appear
    expect(ids).not.toContain("warrior.cleave");
    expect(ids).not.toContain("warrior.frenzy");
  });
});

// ── 6. Cross-archetype branch isolation ───────────────────────────────────

describe("cross-archetype branch isolation", () => {
  it("cannot learn mage branch skills as warrior", () => {
    const result = learnSkill({}, ClassArchetype.WARRIOR, 30, "mage.flame_lance", "berserker");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Unknown skill");
  });

  it("cannot use warrior branch id for mage skills", () => {
    const result = learnSkill(
      { "mage.arcane_bolt": 1 },
      ClassArchetype.MAGE,
      30,
      "mage.flame_lance",
      "berserker",
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("belongs to branch");
  });

  it("mage branch skills work with correct mage branch", () => {
    const result = learnSkill(
      { "mage.arcane_bolt": 1 },
      ClassArchetype.MAGE,
      30,
      "mage.flame_lance",
      "pyromancer",
    );
    expect(result.ok).toBe(true);
  });
});

// ── 7. allBranchSkills ────────────────────────────────────────────────────

describe("allBranchSkills", () => {
  it("returns all skills from all tiers in a branch", () => {
    const branch = getBranch(ClassArchetype.WARRIOR, "berserker")!;
    const skills = allBranchSkills(branch);
    const ids = skills.map((s) => s.id);
    // Should include tier 2, 3, and 4 skills
    expect(ids).toContain("warrior.cleave"); // tier 2
    expect(ids).toContain("warrior.frenzy"); // tier 2
    expect(ids).toContain("warrior.decimate"); // tier 3
    expect(ids).toContain("warrior.berserk"); // tier 3
    expect(ids).toContain("warrior.annihilate"); // tier 4
  });

  it("every branch across every archetype has at least 1 skill per tier", () => {
    for (const archetype of Object.values(ClassArchetype)) {
      for (const branch of getBranchesForArchetype(archetype)) {
        for (const tier of branch.jobTiers) {
          expect(tier.skills.length).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});

// ── 8. Branch structure integrity ─────────────────────────────────────────

describe("branch structure integrity", () => {
  it("every archetype except BEGINNER has at least 2 branches", () => {
    for (const archetype of Object.values(ClassArchetype)) {
      const branches = getBranchesForArchetype(archetype);
      if (archetype === ClassArchetype.BEGINNER) {
        expect(branches).toHaveLength(0);
      } else {
        expect(branches.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("every branch has unique ids within its archetype", () => {
    for (const archetype of Object.values(ClassArchetype)) {
      const branches = getBranchesForArchetype(archetype);
      const ids = branches.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("every branch has tiers 2, 3, and 4", () => {
    for (const archetype of Object.values(ClassArchetype)) {
      for (const branch of getBranchesForArchetype(archetype)) {
        const tiers = branch.jobTiers.map((t) => t.tier);
        expect(tiers).toEqual([2, 3, 4]);
      }
    }
  });

  it("branch skill ids are globally unique across all archetypes", () => {
    const seen = new Set<string>();
    for (const archetype of Object.values(ClassArchetype)) {
      for (const branch of getBranchesForArchetype(archetype)) {
        for (const skill of allBranchSkills(branch)) {
          expect(seen.has(skill.id)).toBe(false);
          seen.add(skill.id);
        }
      }
    }
  });

  it("branch skill ids do not collide with tier-1 shared skill ids", () => {
    const shared = new Set<string>();
    for (const archetype of Object.values(ClassArchetype)) {
      for (const tier of CLASSES[archetype].jobTiers) {
        if (tier.tier === 1) {
          for (const skill of tier.skills) shared.add(skill.id);
        }
      }
    }
    for (const archetype of Object.values(ClassArchetype)) {
      for (const branch of getBranchesForArchetype(archetype)) {
        for (const skill of allBranchSkills(branch)) {
          expect(shared.has(skill.id)).toBe(false);
        }
      }
    }
  });
});
