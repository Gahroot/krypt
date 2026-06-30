import { describe, it, expect } from "vitest";
import {
  getAchievedMilestones,
  evaluateCodexMilestones,
  canGiveFame,
  giveFame,
  meetsFameGate,
  type CodexState,
  type FameState,
} from "../src/codex.js";
import {
  createAchievementProgress,
  updateAchievementProgress,
  getAllAchievementSnapshots,
  ACHIEVEMENTS,
} from "../src/achievements.js";

// ── codex — getAchievedMilestones ──────────────────────────────────────────

describe("codex — getAchievedMilestones", () => {
  it("returns empty array for 0 kills", () => {
    const result = getAchievedMilestones("mob.friendly_snail", 0);
    expect(result).toEqual([]);
  });

  it("returns the first milestone when kills are exactly at it", () => {
    const result = getAchievedMilestones("mob.friendly_snail", 10);
    expect(result).toHaveLength(1);
    expect(result[0]!.kills).toBe(10);
    expect(result[0]!.statBonus).toEqual({ STR: 1 });
  });

  it("returns all milestones when kills exceed the last one", () => {
    const result = getAchievedMilestones("mob.friendly_snail", 200);
    expect(result).toHaveLength(3);
    expect(result[2]!.kills).toBe(200);
  });

  it("returns empty array for unknown mobId", () => {
    const result = getAchievedMilestones("mob.nonexistent", 999);
    expect(result).toEqual([]);
  });
});

// ── codex — evaluateCodexMilestones ────────────────────────────────────────

describe("codex — evaluateCodexMilestones", () => {
  it("empty codex state returns zero bonuses", () => {
    const state: CodexState = {};
    const result = evaluateCodexMilestones(state);
    expect(result.newlyUnlocked).toEqual([]);
    expect(result.totalStatBonus).toEqual({});
    expect(result.totalExpBonus).toBe(0);
  });

  it("single mob at first milestone returns correct stat bonus", () => {
    const state: CodexState = { "mob.friendly_snail": 10 };
    const result = evaluateCodexMilestones(state);
    expect(result.newlyUnlocked).toHaveLength(1);
    expect(result.newlyUnlocked[0]!.mobId).toBe("mob.friendly_snail");
    expect(result.totalStatBonus).toEqual({ STR: 1 });
    expect(result.totalExpBonus).toBe(0);
  });

  it("cumulative bonuses from multiple mobs", () => {
    const state: CodexState = {
      "mob.friendly_snail": 200, // TIER_1: STR+1, DEX+1, expBonus 0.02
      "mob.green_puff": 200, // TIER_1: STR+1, DEX+1, expBonus 0.02
    };
    const result = evaluateCodexMilestones(state);
    expect(result.totalStatBonus.STR).toBe(2);
    expect(result.totalStatBonus.DEX).toBe(2);
  });

  it("expBonus accumulates correctly", () => {
    const state: CodexState = {
      "mob.friendly_snail": 200, // TIER_1: expBonus 0.01 + 0.01 = 0.02
      "mob.green_puff": 200, // TIER_1: expBonus 0.01 + 0.01 = 0.02
    };
    const result = evaluateCodexMilestones(state);
    expect(result.totalExpBonus).toBe(0.04);
  });
});

// ── fame — giveFame ────────────────────────────────────────────────────────

describe("fame — giveFame", () => {
  it("+1 fame succeeds with no history", () => {
    const state: FameState = { fame: 0, fameHistory: {} };
    const result = giveFame(state, "char_bob", 1, 1000);
    expect(result.success).toBe(true);
    expect(result.newFame).toBe(1);
    expect(state.fame).toBe(1);
    expect(state.fameHistory["char_bob"]).toBe(1000);
  });

  it("-1 fame succeeds with no history", () => {
    const state: FameState = { fame: 5, fameHistory: {} };
    const result = giveFame(state, "char_bob", -1, 1000);
    expect(result.success).toBe(true);
    expect(result.newFame).toBe(4);
    expect(state.fame).toBe(4);
  });

  it("+1 fame fails when given to same target within 24h", () => {
    const state: FameState = { fame: 0, fameHistory: { char_bob: 1000 } };
    const result = giveFame(state, "char_bob", 1, 1000 + 86_399_999);
    expect(result.success).toBe(false);
    expect(result.newFame).toBe(0);
  });

  it("+1 fame succeeds when given to same target after 24h", () => {
    const state: FameState = { fame: 0, fameHistory: { char_bob: 1000 } };
    const result = giveFame(state, "char_bob", 1, 1000 + 86_400_001);
    expect(result.success).toBe(true);
    expect(result.newFame).toBe(1);
  });

  it("+2 amount is rejected", () => {
    const state: FameState = { fame: 0, fameHistory: {} };
    const result = giveFame(state, "char_bob", 2, 1000);
    expect(result.success).toBe(false);
    expect(result.message).toContain("must be +1 or -1");
  });

  it("fame is rejected on same day even with different amount", () => {
    const state: FameState = { fame: 0, fameHistory: { char_bob: 1000 } };
    const result = giveFame(state, "char_bob", -1, 1000 + 43_200_000);
    expect(result.success).toBe(false);
    expect(result.newFame).toBe(0);
  });
});

// ── fame — meetsFameGate ───────────────────────────────────────────────────

describe("fame — meetsFameGate", () => {
  it("meets gate when fame >= required", () => {
    const result = meetsFameGate(50, "title");
    expect(result.meets).toBe(true);
  });

  it("fails gate when fame < required", () => {
    const result = meetsFameGate(10, "title");
    expect(result.meets).toBe(false);
    expect(result.required).toBe(50);
  });

  it("unknown slot always meets gate", () => {
    const result = meetsFameGate(0, "unknown_slot");
    expect(result.meets).toBe(true);
  });
});

// ── fame — canGiveFame ─────────────────────────────────────────────────────

describe("fame — canGiveFame", () => {
  it("allowed when no history", () => {
    const state: FameState = { fame: 0, fameHistory: {} };
    const result = canGiveFame(state, "char_bob", 1000);
    expect(result.allowed).toBe(true);
  });

  it("not allowed within 24h", () => {
    const state: FameState = { fame: 0, fameHistory: { char_bob: 1000 } };
    const result = canGiveFame(state, "char_bob", 1000 + 86_399_999);
    expect(result.allowed).toBe(false);
  });

  it("allowed after 24h", () => {
    const state: FameState = { fame: 0, fameHistory: { char_bob: 1_000_000 - 86_400_001 } };
    const result = canGiveFame(state, "char_bob", 1_000_000);
    expect(result.allowed).toBe(true);
  });
});

// ── achievements — createAchievementProgress ───────────────────────────────

describe("achievements — createAchievementProgress", () => {
  it("creates entries for all achievements", () => {
    const progress = createAchievementProgress();
    const ids = Object.keys(ACHIEVEMENTS);
    expect(Object.keys(progress)).toHaveLength(ids.length);
    for (const id of ids) {
      expect(progress[id]).toBeDefined();
    }
  });

  it("each entry has correct length matching conditions count", () => {
    const progress = createAchievementProgress();
    for (const [id, def] of Object.entries(ACHIEVEMENTS)) {
      expect(progress[id]).toHaveLength(def.conditions.length);
    }
  });
});

// ── achievements — updateAchievementProgress ───────────────────────────────

describe("achievements — updateAchievementProgress", () => {
  it("incremental kill progress: 1 kill then another increments the array", () => {
    const progress = createAchievementProgress();
    updateAchievementProgress(progress, "total_kills", 1);
    // first_blood has 1 condition at index 0
    expect(progress["first_blood"]![0]).toBe(1);
    updateAchievementProgress(progress, "total_kills", 1);
    expect(progress["first_blood"]![0]).toBe(2);
  });

  it("'First Blood' completes at 1 kill", () => {
    const progress = createAchievementProgress();
    const completed = updateAchievementProgress(progress, "total_kills", 1);
    expect(completed).toContain("first_blood");
  });

  it("'Monster Hunter' completes at 100 kills but not 99", () => {
    const progress = createAchievementProgress();
    let completed = updateAchievementProgress(progress, "total_kills", 99);
    expect(completed).not.toContain("monster_hunter");
    completed = updateAchievementProgress(progress, "total_kills", 1);
    expect(completed).toContain("monster_hunter");
  });

  it("returns newly completed achievement ids only once", () => {
    const progress = createAchievementProgress();
    const first = updateAchievementProgress(progress, "total_kills", 1);
    expect(first).toContain("first_blood");
    const second = updateAchievementProgress(progress, "total_kills", 1);
    expect(second).not.toContain("first_blood");
  });

  it("key filter: 'boss' key updates boss_slayer and unfiltered achievements", () => {
    const progress = createAchievementProgress();
    updateAchievementProgress(progress, "total_kills", 1, "boss");
    // boss_slayer has key="boss" → matches, so progress increments
    expect(progress["boss_slayer"]![0]).toBe(1);
    // first_blood and monster_hunter have no key filter, so they also get
    // incremented by any total_kills update regardless of the key passed.
    expect(progress["first_blood"]![0]).toBe(1);
    expect(progress["monster_hunter"]![0]).toBe(1);
  });

  it("key filter: non-matching key does not update key-filtered conditions", () => {
    const progress = createAchievementProgress();
    updateAchievementProgress(progress, "total_kills", 1, "regular_mob");
    // boss_slayer requires key="boss" → should NOT be updated
    expect(progress["boss_slayer"]![0]).toBe(0);
    // unfiltered achievements still get updated
    expect(progress["first_blood"]![0]).toBe(1);
  });

  it("mesos_earned progress", () => {
    const progress = createAchievementProgress();
    const completed = updateAchievementProgress(progress, "mesos_earned", 10000);
    expect(progress["mesos_mogul"]![0]).toBe(10000);
    expect(completed).toContain("mesos_mogul");
  });
});

// ── achievements — getAllAchievementSnapshots ───────────────────────────────

describe("achievements — getAllAchievementSnapshots", () => {
  it("returns snapshot for every achievement", () => {
    const progress = createAchievementProgress();
    const snapshots = getAllAchievementSnapshots(progress);
    expect(snapshots).toHaveLength(Object.keys(ACHIEVEMENTS).length);
  });

  it("completed achievement shows completed:true", () => {
    const progress = createAchievementProgress();
    updateAchievementProgress(progress, "total_kills", 1);
    const snapshots = getAllAchievementSnapshots(progress);
    const firstBlood = snapshots.find((s) => s.id === "first_blood");
    expect(firstBlood).toBeDefined();
    expect(firstBlood!.completed).toBe(true);
  });

  it("incomplete shows correct progress values", () => {
    const progress = createAchievementProgress();
    updateAchievementProgress(progress, "total_kills", 50);
    const snapshots = getAllAchievementSnapshots(progress);
    const monsterHunter = snapshots.find((s) => s.id === "monster_hunter");
    expect(monsterHunter).toBeDefined();
    expect(monsterHunter!.completed).toBe(false);
    expect(monsterHunter!.progress[0]).toEqual({ current: 50, target: 100 });
  });
});
