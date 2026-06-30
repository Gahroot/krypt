/**
 * SkillBook — the runtime SP-spending system that complements the SkillDef catalog in classes.ts
 * and totalSpByLevel() in stats.ts.
 *
 * A SkillBook is a plain Record<skillId, learnedLevel> mapping each learned skill to its current
 * SP investment. All helpers are pure and deterministic so they run identically on the authoritative
 * server (source of truth) and the client (UI display).
 */

import type { ClassArchetype, SkillDef } from "./classes.js";
import { allSkillsForClass, getBranch, getSkillBranch, unlockedJobTier } from "./classes.js";
import { totalSpByLevel } from "./stats.js";

// ── Types ──────────────────────────────────────────────────────────────────

/** A skill book: maps each learned skill id to its current level (0 = not learned). */
export type SkillBook = Record<string, number>;

/** Result of a learnSkill attempt. */
export interface LearnSkillResult {
  /** Whether the skill was learned (or levelled up) successfully. */
  readonly ok: boolean;
  /** The updated skill book (only present when ok is true). */
  readonly book?: SkillBook;
  /** Human-readable rejection reason (only present when ok is false). */
  readonly reason?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * List every SkillDef the character is *eligible* to learn (or level up) at their current
 * level. This respects:
 *  - jobTier unlock (via unlockedJobTier)
 *  - skill levelReq
 *  - prerequisite skills (if defined on the SkillDef)
 *  - branch-choice gate: tier 2+ branch skills require `chosenBranchId`
 */
export function skillsAvailableAt(
  archetype: ClassArchetype,
  charLevel: number,
  book: SkillBook = {},
  chosenBranchId?: string,
): readonly SkillDef[] {
  const tier = unlockedJobTier(archetype, charLevel);
  return allSkillsForClass(archetype).filter((s) => {
    // Must have unlocked the skill's job tier.
    if (s.jobTier > tier) return false;
    // Must meet the skill's character-level requirement.
    if (charLevel < s.levelReq) return false;
    // Must not already be at max level.
    const current = book[s.id] ?? 0;
    if (current >= s.maxLevel) return false;
    // Must meet all prerequisites.
    if (!meetsPrerequisites(s, book)) return false;
    // Branch-choice gate: tier 2+ branch skills require a matching branch.
    if (s.jobTier >= 2) {
      const skillBranch = getSkillBranch(archetype, s.id);
      if (skillBranch && skillBranch.id !== chosenBranchId) return false;
    }
    return true;
  });
}

/** Sum all SP currently spent across every skill in the book. */
export function spSpent(book: SkillBook): number {
  let total = 0;
  for (const lvl of Object.values(book)) {
    total += lvl;
  }
  return total;
}

/**
 * Attempt to learn or level-up a skill. Returns `{ ok: true, book }` with a new (immutable)
 * SkillBook on success, or `{ ok: false, reason }` explaining the failure.
 *
 * Validation order:
 *  1. Skill exists in the class definition.
 *  2. Job tier is unlocked for the character level.
 *  3. Character meets the skill's levelReq.
 *  4. Prerequisite skills are met (if any).
 *  5. Skill is not already at maxLevel.
 *  6. SP spent after learning would not exceed totalSpByLevel(charLevel).
 *  7. Branch-choice gate: tier 2+ branch skills require `chosenBranchId` to match.
 */
export function learnSkill(
  book: SkillBook,
  archetype: ClassArchetype,
  charLevel: number,
  skillId: string,
  chosenBranchId?: string,
): LearnSkillResult {
  // 1. Find the SkillDef.
  const skill = allSkillsForClass(archetype).find((s) => s.id === skillId);
  if (!skill) {
    return { ok: false, reason: `Unknown skill "${skillId}" for ${archetype}` };
  }

  // 2. Job tier unlock.
  const tier = unlockedJobTier(archetype, charLevel);
  if (skill.jobTier > tier) {
    return {
      ok: false,
      reason: `Job tier ${skill.jobTier} not unlocked (char level ${charLevel}, highest tier: ${tier})`,
    };
  }

  // 3. Character level requirement.
  if (charLevel < skill.levelReq) {
    return {
      ok: false,
      reason: `Character level ${charLevel} does not meet skill levelReq ${skill.levelReq}`,
    };
  }

  // 4. Prerequisites.
  if (!meetsPrerequisites(skill, book)) {
    const missing = (skill.requires ?? []).filter((r) => (book[r.skillId] ?? 0) < r.level);
    const desc = missing.map((r) => `"${r.skillId}" level ${r.level}`).join(", ");
    return { ok: false, reason: `Missing prerequisites: ${desc}` };
  }

  // 5. Max level check.
  const current = book[skillId] ?? 0;
  if (current >= skill.maxLevel) {
    return { ok: false, reason: `Skill "${skillId}" already at max level ${skill.maxLevel}` };
  }

  // 6. SP budget check.
  const spent = spSpent(book) + 1;
  const budget = totalSpByLevel(charLevel);
  if (spent > budget) {
    return {
      ok: false,
      reason: `Not enough SP: would spend ${spent} but only ${budget} available`,
    };
  }

  // 7. Branch-choice gate: tier 2+ branch skills require a chosen branch.
  if (skill.jobTier >= 2) {
    const skillBranch = getSkillBranch(archetype, skillId);
    if (skillBranch) {
      if (!chosenBranchId) {
        return {
          ok: false,
          reason: `Must choose a specialization branch before learning tier ${skill.jobTier} skill "${skillId}"`,
        };
      }
      if (skillBranch.id !== chosenBranchId) {
        const branchDef = getBranch(archetype, chosenBranchId);
        return {
          ok: false,
          reason: `Skill "${skillId}" belongs to branch "${skillBranch.id}" but character chose "${chosenBranchId}" (${branchDef?.name ?? "unknown"})`,
        };
      }
    }
  }

  // All checks passed — return new immutable book.
  return { ok: true, book: { ...book, [skillId]: current + 1 } };
}

// ── Internal ───────────────────────────────────────────────────────────────

/** Check whether all prerequisites on a SkillDef are met by the given book. */
function meetsPrerequisites(skill: SkillDef, book: SkillBook): boolean {
  if (!skill.requires) return true;
  return skill.requires.every((r) => (book[r.skillId] ?? 0) >= r.level);
}
