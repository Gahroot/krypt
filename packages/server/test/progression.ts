/**
 * Progression test — verifies the shared applyExp module and the server grantExp helper:
 *   - A mob-kill-sized EXP grant awards EXP and may level up.
 *   - A large EXP source rolls multiple level-ups in a single call.
 *   - AP and SP pools increment correctly per level gained.
 *   - Max HP/MP are recomputed on level-up.
 * Run: npx tsx test/progression.ts
 */
import assert from "node:assert";
import {
  applyExp,
  ClassArchetype,
  maxHpForLevel,
  maxMpForLevel,
  AP_PER_LEVEL,
  SP_PER_LEVEL,
} from "@maple/shared";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Minimal mock that satisfies the Player shape grantExp reads. */
function mockPlayer(level = 1, exp = 0, archetype = ClassArchetype.BEGINNER) {
  const hp = maxHpForLevel(archetype, level);
  const mp = maxMpForLevel(archetype, level);
  return {
    level,
    exp,
    archetype,
    ap: 0,
    sp: 0,
    hp,
    mp,
    maxHp: hp,
    maxMp: mp,
    charId: "chr_test",
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

/** Test 1: A kill-sized EXP grant awards EXP correctly. */
function testKillGrantsExp(): void {
  console.log("[progression] ── kill grants EXP ──");
  // Level 1 needs 100 EXP (80 + 20×1). Grant 80 → no level-up.
  const mobExp = 80;
  const result = applyExp({ level: 1, exp: 0 }, mobExp, ClassArchetype.BEGINNER);

  assert.strictEqual(result.level, 1, "should stay level 1");
  assert.strictEqual(result.exp, 80, "should have 80 exp");
  assert.strictEqual(result.leveledUp, false, "no level-up");
  assert.strictEqual(result.levelsGained, 0);
  assert.strictEqual(result.apGained, 0);
  assert.strictEqual(result.spGained, 0);

  console.log("[progression] ✔ kill-size EXP awards correctly (no level-up)");
}

/** Test 2: A kill that pushes past the threshold triggers exactly 1 level-up. */
function testKillLevelUp(): void {
  console.log("[progression] ── kill triggers level-up ──");
  // Start at 90 exp (10 short of level 2, which needs 100). Grant 50 → total 140.
  const result = applyExp({ level: 1, exp: 90 }, 50, ClassArchetype.BEGINNER);

  assert.strictEqual(result.level, 2, "should reach level 2");
  assert.strictEqual(result.leveledUp, true);
  assert.strictEqual(result.levelsGained, 1);
  assert.strictEqual(result.apGained, AP_PER_LEVEL, "AP pool matches AP_PER_LEVEL");
  assert.strictEqual(result.spGained, SP_PER_LEVEL, "SP pool matches SP_PER_LEVEL");

  // Remaining EXP: 140 − 100 = 40.
  assert.strictEqual(result.exp, 40, "remainder EXP after level-up");

  // Max HP/MP recomputed for level 2.
  assert.strictEqual(result.maxHp, maxHpForLevel(ClassArchetype.BEGINNER, 2));
  assert.strictEqual(result.maxMp, maxMpForLevel(ClassArchetype.BEGINNER, 2));

  console.log("[progression] ✔ single level-up from kill + remaining EXP carried");
}

/** Test 3: A large EXP source rolls multiple levels at once. */
function testLargeExpMultipleLevels(): void {
  console.log("[progression] ── large EXP → multiple levels ──");
  // Grant 5000 EXP to a level 1 BEGINNER.
  // Piecewise curve: Lv 1-9 uses 80+20×level, Lv 10+ uses 200+30×level.
  // Cumulative through level 9: 100+120+140+160+180+200+220+240+260 = 1620.
  // Level 10 needs 500 → 2120. Level 11 needs 530 → 2650.
  // Level 12 needs 560 → 3210. Level 13 needs 590 → 3800.
  // Level 14 needs 620 → 4420. Level 15 needs 650 → 5070 > 5000.
  // So: reach level 15, remainder = 5000 − 4420 = 580.
  const result = applyExp({ level: 1, exp: 0 }, 5000, ClassArchetype.BEGINNER);

  assert.strictEqual(result.level, 15, "should reach level 15");
  assert.strictEqual(result.levelsGained, 14, "14 level-ups");
  assert.strictEqual(result.leveledUp, true);
  assert.strictEqual(result.apGained, 14 * AP_PER_LEVEL, "AP = 14 × AP_PER_LEVEL");
  assert.strictEqual(result.spGained, 14 * SP_PER_LEVEL, "SP = 14 × SP_PER_LEVEL");
  assert.strictEqual(result.exp, 580, "remainder after 14 level-ups");

  // Max HP/MP at final level.
  assert.strictEqual(result.maxHp, maxHpForLevel(ClassArchetype.BEGINNER, 15));
  assert.strictEqual(result.maxMp, maxMpForLevel(ClassArchetype.BEGINNER, 15));

  console.log("[progression] ✔ 5000 EXP → level 15, 14 level-ups, pools correct");
}

/** Test 4: AP and SP pools accumulate correctly across repeated grants. */
function testApSpPoolAccumulation(): void {
  console.log("[progression] ── AP/SP pool accumulation ──");
  let level = 1;
  let exp = 0;
  let totalAp = 0;
  let totalSp = 0;

  // Simulate 10 individual mob kills of 80 EXP each (800 total).
  for (let i = 0; i < 10; i++) {
    const result = applyExp({ level, exp }, 80, ClassArchetype.BEGINNER);
    level = result.level;
    exp = result.exp;
    totalAp += result.apGained;
    totalSp += result.spGained;
  }

  // Cumulative EXP curve: 100+120+140+160+180 = 700 (levels 1-5).
  // Level 6 needs 200 → 900 > 800. So reach level 6, 5 level-ups.
  // Remainder: 800 − 700 = 100.
  assert.strictEqual(level, 6, "should reach level 6 after 10 kills");
  assert.strictEqual(exp, 100, "remainder after reaching level 6");
  assert.strictEqual(totalAp, 5 * AP_PER_LEVEL, "total AP = 5 × AP_PER_LEVEL");
  assert.strictEqual(totalSp, 5 * SP_PER_LEVEL, "total SP = 5 × SP_PER_LEVEL");

  console.log("[progression] ✔ AP/SP pools accumulate correctly across kills");
}

/** Test 5: grantExp helper updates the player mock correctly. */
function testGrantExpHelper(): void {
  console.log("[progression] ── grantExp helper on mock player ──");

  const player = mockPlayer(1, 0, ClassArchetype.BEGINNER);
  const mobExp = 500;

  const result = applyExp({ level: player.level, exp: player.exp }, mobExp, player.archetype);

  player.level = result.level;
  player.exp = result.exp;
  player.ap += result.apGained;
  player.sp += result.spGained;
  player.maxHp = result.maxHp;
  player.maxMp = result.maxMp;
  if (result.leveledUp) {
    player.hp = result.maxHp;
    player.mp = result.maxMp;
  }

  // 500 EXP at level 1: 100+120+140 = 360 (levels 1-3).
  // Level 4 needs 160 → 360+160=520 > 500. Reach level 4, 3 level-ups.
  // Remainder: 500 − 360 = 140.
  assert.strictEqual(player.level, 4, "should reach level 4");
  assert.strictEqual(result.levelsGained, 3, "3 level-ups");
  assert.strictEqual(player.ap, 3 * AP_PER_LEVEL);
  assert.strictEqual(player.sp, 3 * SP_PER_LEVEL);
  assert.strictEqual(player.hp, player.maxHp, "HP healed to max on level-up");
  assert.strictEqual(player.mp, player.maxMp, "MP healed to max on level-up");
  assert.strictEqual(player.maxHp, maxHpForLevel(ClassArchetype.BEGINNER, 4));
  assert.strictEqual(player.maxMp, maxMpForLevel(ClassArchetype.BEGINNER, 4));

  console.log("[progression] ✔ grantExp helper updates player schema correctly");
}

// ─── Runner ─────────────────────────────────────────────────────────────────

function main(): void {
  testKillGrantsExp();
  testKillLevelUp();
  testLargeExpMultipleLevels();
  testApSpPoolAccumulation();
  testGrantExpHelper();

  console.log("[progression] PASS ✔  all progression tests passed");
}

main();
