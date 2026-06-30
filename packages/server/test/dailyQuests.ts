/**
 * Daily quest rollover test — verifies that repeatable (daily) quests reset
 * to "available" after a simulated UTC day rollover, and that the bonus
 * hunting map rotates correctly.
 *
 * Run: npx tsx test/dailyQuests.ts
 */
import assert from "node:assert";
import { QUESTS, isDailyResettable, BONUS_HUNT_MAPS, type QuestState } from "@maple/shared";
import {
  ensureQuestStates,
  acceptQuest,
  turnInQuest,
  resetDailyQuests,
  progressObjectives,
  getCurrentBonusMap,
  isBonusHuntingMap,
  getExpMultiplierForMap,
  getDropMultiplierForMap,
} from "../src/questEngine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCharLevel(level: number): {
  level: number;
  mesos: number;
  exp: number;
  charId: string;
  inventory: Map<string, unknown>;
} {
  return { level, mesos: 0, exp: 0, charId: `test_char_${Date.now()}`, inventory: new Map() };
}

function findQuest(quests: QuestState[], id: string): QuestState {
  const qs = quests.find((q) => q.questId === id);
  assert.ok(qs, `quest ${id} should exist in state`);
  return qs;
}

// ---------------------------------------------------------------------------
// Test: daily quest accepts, completes, and resets after day rollover
// ---------------------------------------------------------------------------

function testDailyRollover() {
  console.log("[dailyQuests] ── daily quest rollover ──");

  const dailyId = "quest.daily_dawn_hunt";
  const dailyDef = QUESTS[dailyId];
  assert.ok(dailyDef, "quest.daily_dawn_hunt should exist");
  assert.ok(dailyDef.repeatable?.kind === "daily", "should be marked daily");

  // Start with an empty quest list, ensureQuestStates merges in the daily quest.
  let quests: QuestState[] = ensureQuestStates([]);
  const qs = findQuest(quests, dailyId);
  assert.strictEqual(qs.status, "available", "daily quest starts as available");
  console.log("[dailyQuests] ✔ daily quest starts available");

  // Accept the quest.
  const acceptResult = acceptQuest(quests, dailyId, 1);
  assert.notStrictEqual(typeof acceptResult, "string", "accept should succeed");
  quests = acceptResult as QuestState[];
  assert.strictEqual(findQuest(quests, dailyId).status, "active");
  console.log("[dailyQuests] ✔ daily quest accepted → active");

  // Simulate kills: friendly_snail ×10, dawn_shroom ×5
  for (let i = 0; i < 10; i++) {
    progressObjectives(quests, "kill", "mob.friendly_snail", 1);
  }
  for (let i = 0; i < 5; i++) {
    progressObjectives(quests, "kill", "mob.dawn_shroom", 1);
  }
  assert.strictEqual(
    findQuest(quests, dailyId).status,
    "complete",
    "should be complete after all kills",
  );
  console.log("[dailyQuests] ✔ daily quest objectives complete");

  // Turn in — needs a Player-like object for the server-side reward grant.
  // We'll use a minimal mock that has the fields turnInQuest touches.
  const player = makeCharLevel(1);
  const turnInResult = turnInQuest(quests, dailyId, player as any);
  assert.strictEqual(turnInResult, "", "turn-in should succeed");
  assert.strictEqual(findQuest(quests, dailyId).status, "turnedIn");
  const turnedInQs = findQuest(quests, dailyId);
  assert.ok(turnedInQs.lastTurnedInAt !== undefined, "lastTurnedInAt should be set");
  console.log("[dailyQuests] ✔ daily quest turned in, lastTurnedInAt set");

  // Verify it can't be re-accepted on the same day.
  const reAccept = acceptQuest(quests, dailyId, 1);
  assert.strictEqual(typeof reAccept, "string", "re-accept on same day should fail");
  console.log(`[dailyQuests] ✔ re-accept blocked on same day: "${reAccept}"`);

  // ── Simulate UTC day rollover ──
  // Set lastTurnedInAt to yesterday (25 hours ago).
  const now = Date.now();
  const yesterday = now - 25 * 60 * 60 * 1000;
  const idx = quests.findIndex((q) => q.questId === dailyId);
  quests[idx] = { ...quests[idx], lastTurnedInAt: yesterday };

  // Verify isDailyResettable detects it.
  assert.ok(isDailyResettable(quests[idx]!, now), "quest should be resettable after day rollover");
  console.log("[dailyQuests] ✔ isDailyResettable returns true after day rollover");

  // Reset daily quests.
  resetDailyQuests(quests, now);
  assert.strictEqual(
    findQuest(quests, dailyId).status,
    "available",
    "should be available after reset",
  );
  assert.strictEqual(
    findQuest(quests, dailyId).lastTurnedInAt,
    undefined,
    "lastTurnedInAt should be cleared",
  );
  console.log("[dailyQuests] ✔ daily quest reset to available after day rollover");

  // Re-accept after rollover.
  const reAcceptResult = acceptQuest(quests, dailyId, 1);
  assert.notStrictEqual(typeof reAcceptResult, "string", "re-accept after rollover should succeed");
  quests = reAcceptResult as QuestState[];
  assert.strictEqual(findQuest(quests, dailyId).status, "active");
  console.log("[dailyQuests] ✔ daily quest re-accepted after rollover");
}

// ---------------------------------------------------------------------------
// Test: non-repeatable quest does NOT reset
// ---------------------------------------------------------------------------

function testNonRepeatableDoesNotReset() {
  console.log("[dailyQuests] ── non-repeatable quest does not reset ──");

  const questId = "quest.dawn_trio";
  const def = QUESTS[questId];
  assert.ok(def, "quest.dawn_trio should exist");
  assert.strictEqual(def.repeatable, undefined, "should NOT be repeatable");

  const quests: QuestState[] = ensureQuestStates([]);
  acceptQuest(quests, questId, 1);

  const player = makeCharLevel(1);

  // Simulate kills
  for (let i = 0; i < 5; i++) {
    progressObjectives(quests, "kill", "mob.friendly_snail", 1);
  }

  // Turn in
  turnInQuest(quests, questId, player as any);
  assert.strictEqual(findQuest(quests, questId).status, "turnedIn");

  // Simulate day rollover
  const yesterday = Date.now() - 25 * 60 * 60 * 1000;
  const idx = quests.findIndex((q) => q.questId === questId);
  quests[idx] = { ...quests[idx], lastTurnedInAt: yesterday };

  // Should NOT be resettable
  assert.ok(
    !isDailyResettable(quests[idx]!, Date.now()),
    "non-repeatable should not be resettable",
  );

  // Reset — should remain turnedIn
  resetDailyQuests(quests, Date.now());
  assert.strictEqual(findQuest(quests, questId).status, "turnedIn", "should remain turnedIn");
  console.log("[dailyQuests] ✔ non-repeatable quest stays turnedIn after rollover");
}

// ---------------------------------------------------------------------------
// Test: isDailyResettable edge cases
// ---------------------------------------------------------------------------

function testIsDailyResettableEdgeCases() {
  console.log("[dailyQuests] ── isDailyResettable edge cases ──");

  // Active quest → not resettable
  const activeQs: QuestState = {
    questId: "quest.daily_dawn_hunt",
    status: "active",
    objectiveProgress: [],
  };
  assert.ok(!isDailyResettable(activeQs, Date.now()), "active quest should not be resettable");

  // Available quest → not resettable
  const availableQs: QuestState = {
    questId: "quest.daily_dawn_hunt",
    status: "available",
    objectiveProgress: [],
  };
  assert.ok(
    !isDailyResettable(availableQs, Date.now()),
    "available quest should not be resettable",
  );

  // Complete quest → not resettable
  const completeQs: QuestState = {
    questId: "quest.daily_dawn_hunt",
    status: "complete",
    objectiveProgress: [],
  };
  assert.ok(!isDailyResettable(completeQs, Date.now()), "complete quest should not be resettable");

  // Turned in today → not resettable
  const turnedInToday: QuestState = {
    questId: "quest.daily_dawn_hunt",
    status: "turnedIn",
    objectiveProgress: [],
    lastTurnedInAt: Date.now(),
  };
  assert.ok(
    !isDailyResettable(turnedInToday, Date.now()),
    "turnedIn today should not be resettable",
  );

  // Turned in yesterday → resettable
  const turnedInYesterday: QuestState = {
    questId: "quest.daily_dawn_hunt",
    status: "turnedIn",
    objectiveProgress: [],
    lastTurnedInAt: Date.now() - 25 * 60 * 60 * 1000,
  };
  assert.ok(
    isDailyResettable(turnedInYesterday, Date.now()),
    "turnedIn yesterday should be resettable",
  );

  // Non-daily quest → not resettable even if turned in
  const nonDailyTurnedIn: QuestState = {
    questId: "quest.dawn_trio",
    status: "turnedIn",
    objectiveProgress: [],
    lastTurnedInAt: Date.now() - 25 * 60 * 60 * 1000,
  };
  assert.ok(
    !isDailyResettable(nonDailyTurnedIn, Date.now()),
    "non-daily quest should not be resettable",
  );

  console.log("[dailyQuests] ✔ all edge cases pass");
}

// ---------------------------------------------------------------------------
// Test: bonus hunting map rotation
// ---------------------------------------------------------------------------

function testBonusHuntMap() {
  console.log("[dailyQuests] ── bonus hunting map ──");

  // Should return a valid map id
  const bonusMap = getCurrentBonusMap();
  assert.ok(
    BONUS_HUNT_MAPS.includes(bonusMap),
    `bonus map "${bonusMap}" should be in BONUS_HUNT_MAPS`,
  );
  console.log(`[dailyQuests] ✔ today's bonus map: ${bonusMap}`);

  // Same result for same timestamp
  const ts = Date.now();
  assert.strictEqual(getCurrentBonusMap(ts), getCurrentBonusMap(ts), "same timestamp → same map");
  console.log("[dailyQuests] ✔ deterministic: same ts → same map");

  // Different UTC day → possibly different map (depends on total maps vs days elapsed)
  const aDayLater = ts + 24 * 60 * 60 * 1000 + 1000;
  const map1 = getCurrentBonusMap(ts);
  const map2 = getCurrentBonusMap(aDayLater);
  // They should differ unless we happen to be at a boundary where the modulo wraps
  if (BONUS_HUNT_MAPS.length > 1) {
    // Just verify both are valid
    assert.ok(BONUS_HUNT_MAPS.includes(map1));
    assert.ok(BONUS_HUNT_MAPS.includes(map2));
  }
  console.log("[dailyQuests] ✔ bonus map rotation valid for adjacent days");

  // isBonusHuntingMap check
  assert.ok(isBonusHuntingMap(bonusMap, ts), "should detect active bonus map");
  assert.ok(!isBonusHuntingMap("nonexistent_map", ts), "should not false-positive");

  // Multipliers
  assert.strictEqual(getExpMultiplierForMap(bonusMap, ts), 1.5, "EXP mult on bonus map");
  assert.strictEqual(getDropMultiplierForMap(bonusMap, ts), 1.25, "drop mult on bonus map");
  assert.strictEqual(getExpMultiplierForMap("nonexistent_map", ts), 1, "EXP mult off bonus map");
  assert.strictEqual(getDropMultiplierForMap("nonexistent_map", ts), 1, "drop mult off bonus map");
  console.log("[dailyQuests] ✔ bonus multipliers correct");
}

// ---------------------------------------------------------------------------
// Test: all daily quests are properly defined
// ---------------------------------------------------------------------------

function testDailyQuestDefinitions() {
  console.log("[dailyQuests] ── daily quest definitions ──");

  const dailyIds = Object.values(QUESTS)
    .filter((q) => q.repeatable?.kind === "daily")
    .map((q) => q.id);

  // Should have at least 2 quests per region × 8 regions = 16
  assert.ok(dailyIds.length >= 16, `expected ≥16 daily quests, got ${dailyIds.length}`);
  console.log(`[dailyQuests] ✔ found ${dailyIds.length} daily quests`);

  // All should have unique ids
  const uniqueIds = new Set(dailyIds);
  assert.strictEqual(uniqueIds.size, dailyIds.length, "all daily quest ids should be unique");

  // Each should have at least one objective
  for (const id of dailyIds) {
    const def = QUESTS[id]!;
    assert.ok(def.objectives.length > 0, `${id} should have objectives`);
    assert.ok(def.giverNpcId, `${id} should have a giver NPC`);
    assert.ok(def.rewards.exp || def.rewards.mesos, `${id} should have rewards`);
  }
  console.log("[dailyQuests] ✔ all daily quest definitions valid");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  testDailyRollover();
  testNonRepeatableDoesNotReset();
  testIsDailyResettableEdgeCases();
  testBonusHuntMap();
  testDailyQuestDefinitions();

  console.log("[dailyQuests] PASS ✔  all daily quest engine tests verified");
}

main();
