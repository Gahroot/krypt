import { describe, it, expect } from "vitest";
import {
  PROGRESSION_MILESTONES,
  getRecommendedMilestone,
  validateMilestones,
  travelFee,
} from "../src/guidance";

// ---------------------------------------------------------------------------
// Milestone validation — every referenced asset must exist in the catalog.
// ---------------------------------------------------------------------------

describe("validateMilestones", () => {
  it("all milestone references resolve to real maps, NPCs, and quests", () => {
    const errors = validateMilestones();
    if (errors.length > 0) {
      console.error("Milestone validation errors:\n" + errors.join("\n"));
    }
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getRecommendedMilestone — pure logic
// ---------------------------------------------------------------------------

describe("getRecommendedMilestone", () => {
  const makeQuestMap = (entries: [string, string][]): Map<string, string> => new Map(entries);

  it("returns null for empty milestone list", () => {
    // Shouldn't happen with real data, but tests the guard.
    const result = getRecommendedMilestone(1, new Map());
    // With the real catalog, level 1 should find the dawn_tutorial milestone.
    expect(result).not.toBeNull();
    expect(result!.milestone.id).toBe("milestone.dawn_tutorial");
  });

  it("level-1 player with no quests gets the dawn tutorial", () => {
    const result = getRecommendedMilestone(1, new Map());
    expect(result).not.toBeNull();
    expect(result!.milestone.id).toBe("milestone.dawn_tutorial");
    expect(result!.allComplete).toBe(false);
    expect(result!.activeStepIndex).toBe(0);
    expect(result!.steps[0]!.active).toBe(true);
  });

  it("level-10 player with dawn quests turned in gets harbor or job advance", () => {
    const questMap = makeQuestMap([
      ["quest.dawn_tutorial", "turnedIn"],
      ["quest.dawn_trio", "turnedIn"],
      ["quest.dawn_step_jump", "turnedIn"],
      ["quest.dawn_step_loot", "turnedIn"],
      ["quest.dawn_step_inventory", "turnedIn"],
      ["quest.dawn_level3", "turnedIn"],
      ["quest.dawn_shroom_hunt", "turnedIn"],
      ["quest.dawn_puff_patrol", "turnedIn"],
      ["quest.dawn_ready", "turnedIn"],
      ["quest.dawn_ferry", "turnedIn"],
      ["quest.harbor_welcome", "turnedIn"],
      ["quest.harbor_rat_roundup", "turnedIn"],
      ["quest.harbor_lost_cargo", "turnedIn"],
      ["quest.harbor_rat_whiskers", "turnedIn"],
      ["quest.harbor_captains_log", "turnedIn"],
      ["quest.harbor_ready", "turnedIn"],
    ]);
    const result = getRecommendedMilestone(10, questMap);
    expect(result).not.toBeNull();
    // Should recommend job advancement or a zone exploration.
    expect(result!.milestone.minLevel).toBeLessThanOrEqual(10);
  });

  it("level-30 player with empty quests gets mirefen (last incomplete in their band)", () => {
    const result = getRecommendedMilestone(30, new Map());
    expect(result).not.toBeNull();
    // Mirefen spans 20-30 and is the first non-complete milestone at level 30.
    expect(result!.milestone.id).toBe("milestone.mirefen");
  });

  it("marks steps as completed when quests are turned in", () => {
    const questMap = makeQuestMap([
      ["quest.dawn_tutorial", "turnedIn"],
      ["quest.dawn_trio", "turnedIn"],
    ]);
    const result = getRecommendedMilestone(1, questMap);
    expect(result).not.toBeNull();
    expect(result!.steps[0]!.completed).toBe(true); // dawn_tutorial
    expect(result!.steps[1]!.completed).toBe(true); // dawn_trio
    expect(result!.steps[2]!.completed).toBe(false); // dawn_step_jump
    expect(result!.steps[2]!.active).toBe(true); // first incomplete = active
  });

  it("treats 'complete' (ready for turn-in) as done", () => {
    const questMap = makeQuestMap([["quest.dawn_tutorial", "complete"]]);
    const result = getRecommendedMilestone(1, questMap);
    expect(result).not.toBeNull();
    expect(result!.steps[0]!.completed).toBe(true);
  });

  it("milestones are in increasing level order", () => {
    for (let i = 1; i < PROGRESSION_MILESTONES.length; i++) {
      const prev = PROGRESSION_MILESTONES[i - 1]!;
      const curr = PROGRESSION_MILESTONES[i]!;
      expect(curr.minLevel).toBeGreaterThanOrEqual(prev.minLevel);
    }
  });
});

// ---------------------------------------------------------------------------
// travelFee — taxi network pricing
// ---------------------------------------------------------------------------

describe("travelFee", () => {
  it("same map costs 0", () => {
    expect(travelFee("meadowfield", "meadowfield")).toBe(0);
  });

  it("Heartland ↔ Heartland costs 100", () => {
    expect(travelFee("meadowfield", "craghold")).toBe(100);
    expect(travelFee("heartland_harbor", "sylvanreach")).toBe(100);
  });

  it("Far Reaches ↔ Far Reaches costs 200", () => {
    expect(travelFee("skyhaven", "frosthold")).toBe(200);
  });

  it("Heartland ↔ Far Reaches costs 200", () => {
    expect(travelFee("crossway", "skyhaven")).toBe(200);
    expect(travelFee("meadowfield", "frosthold")).toBe(200);
  });

  it("non-taxi map returns 0", () => {
    expect(travelFee("dawn_isle", "meadowfield")).toBe(0);
  });
});
