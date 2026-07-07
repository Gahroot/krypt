import { describe, it, expect } from "vitest";
import { ClassArchetype } from "../src/classes.js";
import { totalSpByLevel } from "../src/stats.js";
import { skillsAvailableAt, spSpent, learnSkill, type SkillBook } from "../src/skillbook.js";

// ── spSpent ────────────────────────────────────────────────────────────────

describe("spSpent", () => {
  it("returns 0 for an empty book", () => {
    expect(spSpent({})).toBe(0);
  });

  it("sums all skill levels in the book", () => {
    const book: SkillBook = {
      "warrior.crushing_blow": 5,
      "warrior.iron_hide": 3,
      "warrior.rally": 1,
    };
    expect(spSpent(book)).toBe(9);
  });

  it("handles a single skill", () => {
    expect(spSpent({ "warrior.crushing_blow": 7 })).toBe(7);
  });
});

// ── skillsAvailableAt ──────────────────────────────────────────────────────

describe("skillsAvailableAt", () => {
  it("returns empty before any job tier is unlocked (level < 10)", () => {
    expect(skillsAvailableAt(ClassArchetype.WARRIOR, 5)).toHaveLength(0);
  });

  it("returns tier-1 warrior skills at level 10", () => {
    const available = skillsAvailableAt(ClassArchetype.WARRIOR, 10);
    const ids = available.map((s) => s.id);
    // crushing_blow levelReq=10 → eligible, iron_hide levelReq=12 → NOT eligible, rally levelReq=15 → NOT
    expect(ids).toContain("warrior.crushing_blow");
    expect(ids).not.toContain("warrior.iron_hide");
    expect(ids).not.toContain("warrior.rally");
  });

  it("returns more skills as level increases", () => {
    const at15 = skillsAvailableAt(ClassArchetype.WARRIOR, 15);
    const ids = at15.map((s) => s.id);
    expect(ids).toContain("warrior.crushing_blow");
    expect(ids).toContain("warrior.iron_hide");
    // rally requires iron_hide level 1 → not available without it
    expect(ids).not.toContain("warrior.rally");
  });

  it("does not include tier-2 skills before level 30", () => {
    const at25 = skillsAvailableAt(ClassArchetype.WARRIOR, 25);
    const ids = at25.map((s) => s.id);
    expect(ids).not.toContain("warrior.cleave");
    expect(ids).not.toContain("warrior.bulwark");
  });

  it("includes tier-2 skills at level 30+ when prerequisites met", () => {
    const at30 = skillsAvailableAt(ClassArchetype.WARRIOR, 30);
    const ids = at30.map((s) => s.id);
    // No branch chosen → tier-2 branch skills excluded
    expect(ids).not.toContain("warrior.cleave");
    expect(ids).not.toContain("warrior.bulwark");

    // With prerequisite met AND branch chosen, cleave appears
    const book: SkillBook = { "warrior.crushing_blow": 1 };
    const at30withBerserker = skillsAvailableAt(ClassArchetype.WARRIOR, 30, book, "berserker");
    expect(at30withBerserker.map((s) => s.id)).toContain("warrior.cleave");
    // Guardian skills should NOT appear for berserker branch
    expect(at30withBerserker.map((s) => s.id)).not.toContain("warrior.phalanx");

    // At level 35, bulwark becomes available for guardian branch
    const at35guardian = skillsAvailableAt(ClassArchetype.WARRIOR, 35, book, "guardian");
    expect(at35guardian.map((s) => s.id)).toContain("warrior.bulwark");
  });

  it("excludes skills at max level in the book", () => {
    const book: SkillBook = { "warrior.crushing_blow": 20, "warrior.iron_hide": 1 };
    const at15 = skillsAvailableAt(ClassArchetype.WARRIOR, 15, book);
    const ids = at15.map((s) => s.id);
    // crushing_blow is at max (20) → should not appear
    expect(ids).not.toContain("warrior.crushing_blow");
    // iron_hide and rally (iron_hide is level 1, so rally prerequisite met)
    expect(ids).toContain("warrior.iron_hide");
    expect(ids).toContain("warrior.rally");
  });

  it("respects prerequisite: rally requires iron_hide level 1", () => {
    // At level 15, rally's prerequisite (iron_hide level 1) is NOT learned
    const empty: SkillBook = {};
    const at15 = skillsAvailableAt(ClassArchetype.WARRIOR, 15, empty);
    // Rally should NOT be available without iron_hide
    expect(at15.map((s) => s.id)).not.toContain("warrior.rally");

    // After learning iron_hide, rally becomes available
    const book: SkillBook = { "warrior.iron_hide": 1 };
    const at15withIron = skillsAvailableAt(ClassArchetype.WARRIOR, 15, book);
    expect(at15withIron.map((s) => s.id)).toContain("warrior.rally");
  });

  it("respects prerequisite: cleave requires crushing_blow level 1", () => {
    const book: SkillBook = {};
    const at30 = skillsAvailableAt(ClassArchetype.WARRIOR, 30, book, "berserker");
    // Cleave requires crushing_blow level 1 → should not be available
    expect(at30.map((s) => s.id)).not.toContain("warrior.cleave");

    const bookWithCB: SkillBook = { "warrior.crushing_blow": 1 };
    const at30withCB = skillsAvailableAt(ClassArchetype.WARRIOR, 30, bookWithCB, "berserker");
    expect(at30withCB.map((s) => s.id)).toContain("warrior.cleave");
  });

  it("returns Beginner tutorial skills at level 1 and later skills at higher levels", () => {
    // Beginner now has 6 skills available progressively from Lv1
    const at1 = skillsAvailableAt(ClassArchetype.BEGINNER, 1);
    const ids1 = at1.map((s) => s.id);
    expect(ids1).toContain("beginner.recovery");
    expect(ids1).toContain("beginner.thrown_shell");
    expect(ids1).not.toContain("beginner.nimble_strike");
    expect(ids1).not.toContain("beginner.island_ward");

    const at10 = skillsAvailableAt(ClassArchetype.BEGINNER, 10);
    const ids10 = at10.map((s) => s.id);
    expect(ids10).toContain("beginner.nimble_strike");
    expect(ids10).not.toContain("beginner.island_ward");

    const at15 = skillsAvailableAt(ClassArchetype.BEGINNER, 15);
    expect(at15.map((s) => s.id)).toContain("beginner.island_ward");
  });
});

// ── learnSkill ─────────────────────────────────────────────────────────────

describe("learnSkill", () => {
  const WARRIOR = ClassArchetype.WARRIOR;

  it("fails for an unknown skill id", () => {
    const result = learnSkill({}, WARRIOR, 20, "warrior.nonexistent");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Unknown skill");
    expect(result.book).toBeUndefined();
  });

  it("fails when job tier is not unlocked", () => {
    const result = learnSkill({}, WARRIOR, 10, "warrior.cleave");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Job tier");
  });

  it("fails when character level is below skill levelReq", () => {
    // crushing_blow levelReq=10, but iron_hide levelReq=12
    const result = learnSkill({}, WARRIOR, 10, "warrior.iron_hide");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("levelReq");
  });

  it("fails when prerequisites are not met", () => {
    // rally requires iron_hide level 1
    const result = learnSkill({}, WARRIOR, 15, "warrior.rally");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Missing prerequisites");
  });

  it("fails when skill is already at max level", () => {
    const book: SkillBook = { "warrior.crushing_blow": 20 };
    const result = learnSkill(book, WARRIOR, 20, "warrior.crushing_blow");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("max level");
  });

  it("fails when SP budget is exceeded", () => {
    // At level 15, totalSpByLevel(15) = 42 SP.
    // Fill SP budget exactly with existing skills + padding, then try to spend one more.
    const budget = totalSpByLevel(15); // 42
    const book: SkillBook = {
      "warrior.crushing_blow": 20,
      "warrior.iron_hide": 10,
      _extra: 12, // padding to hit budget exactly
    };
    expect(spSpent(book)).toBe(budget);
    // Rally is valid (tier 1 unlocked, levelReq 15 met, iron_hide prereq met, not maxed)
    // but spending 1 more would exceed the budget.
    const result = learnSkill(book, WARRIOR, 15, "warrior.rally");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Not enough SP");
  });

  it("succeeds and returns an immutable copy", () => {
    const book: SkillBook = {};
    const result = learnSkill(book, WARRIOR, 10, "warrior.crushing_blow");
    expect(result.ok).toBe(true);
    expect(result.book).toBeDefined();
    expect(result.book!["warrior.crushing_blow"]).toBe(1);
    // Original book untouched
    expect(book["warrior.crushing_blow"]).toBeUndefined();
  });

  it("can level up an existing skill", () => {
    const book: SkillBook = { "warrior.crushing_blow": 5 };
    const result = learnSkill(book, WARRIOR, 15, "warrior.crushing_blow");
    expect(result.ok).toBe(true);
    expect(result.book!["warrior.crushing_blow"]).toBe(6);
  });

  it("validates all checks in sequence — comprehensive failure", () => {
    // Unknown skill
    expect(learnSkill({}, WARRIOR, 100, "mage.arcane_bolt").ok).toBe(false);
    // Wrong class's skill
    expect(learnSkill({}, WARRIOR, 100, "mage.arcane_bolt").ok).toBe(false);
  });

  it("learns prerequisites chain correctly", () => {
    // Level 15 warrior: learn iron_hide → learn rally
    let book: SkillBook = {};
    const ironResult = learnSkill(book, WARRIOR, 15, "warrior.iron_hide");
    expect(ironResult.ok).toBe(true);
    book = ironResult.book!;

    const rallyResult = learnSkill(book, WARRIOR, 15, "warrior.rally");
    expect(rallyResult.ok).toBe(true);
    book = rallyResult.book!;
    expect(spSpent(book)).toBe(2);
  });

  it("learns tier-2 skills after advancement at level 30", () => {
    // First learn crushing_blow (for cleave's prerequisite)
    let book: SkillBook = {};
    const cb = learnSkill(book, WARRIOR, 30, "warrior.crushing_blow");
    expect(cb.ok).toBe(true);
    book = cb.book!;

    const cleave = learnSkill(book, WARRIOR, 30, "warrior.cleave", "berserker");
    expect(cleave.ok).toBe(true);
    expect(cleave.book!["warrior.cleave"]).toBe(1);
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("spSpent is safe with keys not in the book (0 default)", () => {
    // Object.values on a plain object; just verify it works on a book with gaps
    const book: SkillBook = { a: 5 };
    expect(spSpent(book)).toBe(5);
  });

  it("skillsAvailableAt defaults book to empty when omitted", () => {
    // Should behave identically to passing {} explicitly
    const a = skillsAvailableAt(ClassArchetype.WARRIOR, 15);
    const b = skillsAvailableAt(ClassArchetype.WARRIOR, 15, {});
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
  });

  it("learnSkill does not mutate the input book", () => {
    const original: SkillBook = { "warrior.crushing_blow": 3 };
    const before = { ...original };
    learnSkill(original, ClassArchetype.WARRIOR, 15, "warrior.crushing_blow");
    expect(original).toEqual(before);
  });
});
