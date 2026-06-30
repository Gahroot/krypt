/**
 * Achievements — a catalog of milestones and the per-character progress tracker.
 *
 * Pure data + pure functions: identical results on authoritative server and client.
 * No runtime dependencies.  Mirrors the style of progression.ts.
 *
 * Each AchievementDef declares one or more conditions (AND logic) and a set of
 * rewards granted when every condition is satisfied.  The runtime state is a
 * thin AchievementProgress map that callers update via `updateAchievementProgress`.
 */

import type { CharacterStats } from "./stats.js";

// ── Condition types ─────────────────────────────────────────────────────────

export type AchievementConditionKind =
  | "total_kills"
  | "level_reached"
  | "quests_completed"
  | "items_collected"
  | "mesos_earned";

export interface AchievementCondition {
  readonly kind: AchievementConditionKind;
  /** Target value to complete the condition. */
  readonly target: number;
  /** Optional key filter (e.g. a specific mobId for total_kills, or item category). */
  readonly key?: string;
}

// ── Rewards ─────────────────────────────────────────────────────────────────

export interface AchievementReward {
  /** Mesos reward. */
  readonly mesos?: number;
  /** EXP reward. */
  readonly exp?: number;
  /** Permanent stat bonus (like codex milestones). */
  readonly statBonus?: Partial<CharacterStats>;
  /** EXP multiplier bonus. */
  readonly expBonus?: number;
  /** Title or cosmetic id unlocked. */
  readonly title?: string;
}

// ── Achievement definition ──────────────────────────────────────────────────

export interface AchievementDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Category for UI grouping. */
  readonly category: "combat" | "exploration" | "collection" | "social" | "milestone";
  /** All conditions must be met (AND logic). */
  readonly conditions: readonly AchievementCondition[];
  readonly rewards: AchievementReward;
  /** Display order within category. */
  readonly order: number;
}

// ── Runtime progress state ──────────────────────────────────────────────────

/** achievementId to progress values per condition (parallel to AchievementDef.conditions). */
export type AchievementProgress = Record<string, number[]>;

/** Snapshot of one achievement for display. */
export interface AchievementSnapshot {
  id: string;
  name: string;
  description: string;
  category: AchievementDef["category"];
  completed: boolean;
  progress: { current: number; target: number }[];
  rewards: AchievementReward;
}

// ── Catalog ─────────────────────────────────────────────────────────────────

export const ACHIEVEMENTS: Readonly<Record<string, AchievementDef>> = {
  // ── Combat ──────────────────────────────────────────────────────────────
  first_blood: {
    id: "first_blood",
    name: "First Blood",
    description: "Defeat your first monster.",
    category: "combat",
    conditions: [{ kind: "total_kills", target: 1 }],
    rewards: { mesos: 100, exp: 50 },
    order: 0,
  },
  monster_hunter: {
    id: "monster_hunter",
    name: "Monster Hunter",
    description: "Defeat 100 monsters.",
    category: "combat",
    conditions: [{ kind: "total_kills", target: 100 }],
    rewards: { mesos: 1000, exp: 500 },
    order: 1,
  },
  slaying_spree: {
    id: "slaying_spree",
    name: "Slaying Spree",
    description: "Defeat 500 monsters.",
    category: "combat",
    conditions: [{ kind: "total_kills", target: 500 }],
    rewards: { mesos: 5000, exp: 2500, title: "Slayer" },
    order: 2,
  },
  boss_slayer: {
    id: "boss_slayer",
    name: "Boss Slayer",
    description: "Defeat a boss monster.",
    category: "combat",
    conditions: [{ kind: "total_kills", target: 1, key: "boss" }],
    rewards: { mesos: 5000, exp: 3000, title: "Boss Slayer" },
    order: 3,
  },

  // ── Exploration (level milestones) ──────────────────────────────────────
  level_10: {
    id: "level_10",
    name: "Getting Started",
    description: "Reach level 10.",
    category: "exploration",
    conditions: [{ kind: "level_reached", target: 10 }],
    rewards: { mesos: 200, exp: 100 },
    order: 0,
  },
  level_30: {
    id: "level_30",
    name: "Rising Star",
    description: "Reach level 30.",
    category: "exploration",
    conditions: [{ kind: "level_reached", target: 30 }],
    rewards: { mesos: 1000, exp: 1000, title: "Rising Star" },
    order: 1,
  },
  level_50: {
    id: "level_50",
    name: "Veteran",
    description: "Reach level 50.",
    category: "exploration",
    conditions: [{ kind: "level_reached", target: 50 }],
    rewards: {
      mesos: 5000,
      exp: 5000,
      statBonus: { STR: 1, DEX: 1, INT: 1, LUK: 1 },
      title: "Veteran",
    },
    order: 2,
  },

  // ── Collection (quests / items) ─────────────────────────────────────────
  quest_beginner: {
    id: "quest_beginner",
    name: "Quest Beginner",
    description: "Complete 5 quests.",
    category: "collection",
    conditions: [{ kind: "quests_completed", target: 5 }],
    rewards: { mesos: 500, exp: 300 },
    order: 0,
  },
  quest_veteran: {
    id: "quest_veteran",
    name: "Quest Veteran",
    description: "Complete 25 quests.",
    category: "collection",
    conditions: [{ kind: "quests_completed", target: 25 }],
    rewards: { mesos: 3000, exp: 2000, title: "Adventurer" },
    order: 1,
  },
  collector: {
    id: "collector",
    name: "Collector",
    description: "Collect 10 unique items.",
    category: "collection",
    conditions: [{ kind: "items_collected", target: 10 }],
    rewards: { mesos: 2000, exp: 1000, title: "Collector" },
    order: 2,
  },

  // ── Milestone (mesos earned) ────────────────────────────────────────────
  mesos_mogul: {
    id: "mesos_mogul",
    name: "Mesos Mogul",
    description: "Earn 10,000 mesos in total.",
    category: "milestone",
    conditions: [{ kind: "mesos_earned", target: 10000 }],
    rewards: { exp: 1000, expBonus: 0.05 },
    order: 0,
  },
  wealthy: {
    id: "wealthy",
    name: "Wealthy",
    description: "Earn 100,000 mesos in total.",
    category: "milestone",
    conditions: [{ kind: "mesos_earned", target: 100000 }],
    rewards: { exp: 5000, expBonus: 0.1, title: "Tycoon" },
    order: 1,
  },
} as const;

// ── Helper predicates ───────────────────────────────────────────────────────

/** Check whether a single condition is satisfied given the current progress value. */
function isConditionMet(condition: AchievementCondition, current: number): boolean {
  return current >= condition.target;
}

/** Check whether ALL conditions for an achievement are satisfied. */
function allConditionsMet(def: AchievementDef, progressValues: readonly number[]): boolean {
  return def.conditions.every((cond, i) => isConditionMet(cond, progressValues[i] ?? 0));
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Initialize empty progress for all achievements. */
export function createAchievementProgress(): AchievementProgress {
  const progress: AchievementProgress = {};
  for (const id of Object.keys(ACHIEVEMENTS)) {
    const def = ACHIEVEMENTS[id];
    if (def) progress[id] = new Array(def.conditions.length).fill(0);
  }
  return progress;
}

/**
 * Update progress for a condition kind.  Returns ids of newly completed achievements.
 *
 * `increment` is how much to add (e.g. +1 for a kill, +N for mesos).
 * `key` is an optional filter (e.g. mobId or item category).
 */
export function updateAchievementProgress(
  progress: AchievementProgress,
  kind: AchievementConditionKind,
  increment: number,
  key?: string,
): string[] {
  const newlyCompleted: string[] = [];

  for (const [id, def] of Object.entries(ACHIEVEMENTS)) {
    // Ensure progress array exists (defensive — createAchievementProgress should be called first).
    let counts = progress[id];
    if (!counts) {
      counts = new Array<number>(def.conditions.length).fill(0);
      progress[id] = counts;
    }

    // Snapshot whether the achievement was already complete *before* this update.
    const wasComplete = allConditionsMet(def, counts);

    let changed = false;

    for (let i = 0; i < def.conditions.length; i++) {
      const cond: AchievementCondition | undefined = def.conditions[i];
      if (!cond) continue;

      // Only update conditions matching the requested kind.
      if (cond.kind !== kind) continue;

      // If the condition has a key filter, only update when the key matches.
      if (cond.key !== undefined && cond.key !== key) continue;

      const current = counts[i];
      if (current === undefined) continue;
      counts[i] = current + increment;
      changed = true;
    }

    // Only report as newly completed if it wasn't already complete before this update.
    if (changed && !wasComplete && allConditionsMet(def, counts)) {
      newlyCompleted.push(id);
    }
  }

  return newlyCompleted;
}

/** Get a snapshot of one achievement. */
export function getAchievementSnapshot(
  achievementId: string,
  progress: AchievementProgress,
): AchievementSnapshot | undefined {
  const def = ACHIEVEMENTS[achievementId];
  if (!def) return undefined;

  const values = progress[achievementId] ?? new Array(def.conditions.length).fill(0);
  const completed = allConditionsMet(def, values);

  return {
    id: def.id,
    name: def.name,
    description: def.description,
    category: def.category,
    completed,
    progress: def.conditions.map((cond, i) => ({
      current: values[i] ?? 0,
      target: cond.target,
    })),
    rewards: def.rewards,
  };
}

/** Get all achievement snapshots for display. */
export function getAllAchievementSnapshots(progress: AchievementProgress): AchievementSnapshot[] {
  const snapshots: AchievementSnapshot[] = [];
  for (const id of Object.keys(ACHIEVEMENTS)) {
    const snap = getAchievementSnapshot(id, progress);
    if (snap) snapshots.push(snap);
  }
  return snapshots;
}
