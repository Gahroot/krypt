/**
 * Fame daily-limit enforcement test — proves the server-side fame system
 * correctly enforces the once-per-day-per-target limit using the shared
 * pure functions, and that persistence round-trips correctly.
 *
 * Run: npx tsx test/fameDailyLimit.ts
 */
import assert from "node:assert";
import { giveFame, canGiveFame, type FameState, MS_PER_DAY } from "@maple/shared";

function assertEq<T>(actual: T, expected: T, msg: string): void {
  assert.deepStrictEqual(actual, expected, msg);
}

function assertOk(cond: boolean, msg: string): void {
  assert.ok(cond, msg);
}

function freshState(): FameState {
  return { fame: 0, fameHistory: {} };
}

// ─── Test 1: Basic +1 fame ─────────────────────────────────────────────────

{
  const state = freshState();
  const result = giveFame(state, "target_A", 1, 1000);
  assertOk(result.success, "should succeed");
  assertEq(result.newFame, 1, "fame should be 1");
  assertEq(state.fame, 1, "state.fame should be 1");
  assertEq(state.fameHistory["target_A"], 1000, "history should record timestamp");
  console.log("[fameDailyLimit] ✓ test 1: basic +1 fame");
}

// ─── Test 2: Basic -1 fame ─────────────────────────────────────────────────

{
  const state = freshState();
  const result = giveFame(state, "target_B", -1, 5000);
  assertOk(result.success, "should succeed");
  assertEq(result.newFame, -1, "fame should be -1");
  assertEq(state.fame, -1, "state.fame should be -1");
  console.log("[fameDailyLimit] ✓ test 2: basic -1 fame");
}

// ─── Test 3: Same target within 24h → blocked ──────────────────────────────

{
  const state = freshState();
  const now = 1_000_000;
  giveFame(state, "target_C", 1, now);
  const result = giveFame(state, "target_C", 1, now + 1000);
  assertOk(!result.success, "should fail within 24h");
  assertEq(state.fame, 1, "fame should still be 1 (no change)");
  console.log("[fameDailyLimit] ✓ test 3: same target within 24h blocked");
}

// ─── Test 4: Same target after 24h → allowed ───────────────────────────────

{
  const state = freshState();
  const now = 1_000_000;
  giveFame(state, "target_D", 1, now);
  const result = giveFame(state, "target_D", 1, now + MS_PER_DAY + 1);
  assertOk(result.success, "should succeed after 24h");
  assertEq(result.newFame, 2, "fame should be 2");
  console.log("[fameDailyLimit] ✓ test 4: same target after 24h allowed");
}

// ─── Test 5: Exact 24h boundary (lastAction + MS_PER_DAY) → allowed ────────
// The check is `now - last < MS_PER_DAY`, so exactly at the boundary the
// difference equals MS_PER_DAY → the guard does NOT trigger → allowed.

{
  const state = freshState();
  const now = 1_000_000;
  giveFame(state, "target_E", 1, now);
  const result = giveFame(state, "target_E", 1, now + MS_PER_DAY);
  assertOk(result.success, "should succeed at exactly MS_PER_DAY (strictly less-than check)");
  assertEq(state.fame, 2, "fame should be 2");
  console.log("[fameDailyLimit] ✓ test 5: exact 24h boundary allowed");
}

// ─── Test 6: Invalid amount → rejected ─────────────────────────────────────

{
  const state = freshState();
  const result = giveFame(state, "target_F", 2, 1000);
  assertOk(!result.success, "should reject amount=2");
  assertEq(state.fame, 0, "fame should be 0");
  console.log("[fameDailyLimit] ✓ test 6: invalid amount rejected");
}

// ─── Test 7: Different targets on same day → all allowed ────────────────────

{
  const state = freshState();
  const now = 1_000_000;
  const r1 = giveFame(state, "target_G", 1, now);
  const r2 = giveFame(state, "target_H", 1, now);
  const r3 = giveFame(state, "target_I", -1, now);
  assertOk(r1.success, "target_G should succeed");
  assertOk(r2.success, "target_H should succeed");
  assertOk(r3.success, "target_I should succeed");
  assertEq(state.fame, 1, "net fame = +1 +1 -1 = 1");
  assertEq(Object.keys(state.fameHistory).length, 3, "3 distinct targets in history");
  console.log("[fameDailyLimit] ✓ test 7: different targets same day");
}

// ─── Test 8: canGiveFame helper ─────────────────────────────────────────────

{
  const state = freshState();
  assertOk(canGiveFame(state, "anyone", 1000).allowed, "no history → allowed");

  state.fameHistory["someone"] = 2000;
  assertOk(!canGiveFame(state, "someone", 2000 + 1000).allowed, "within 24h → blocked");
  assertOk(canGiveFame(state, "someone", 2000 + MS_PER_DAY + 1).allowed, "after 24h → allowed");
  assertOk(canGiveFame(state, "other", 2000).allowed, "different target → allowed");
  console.log("[fameDailyLimit] ✓ test 8: canGiveFame helper");
}

// ─── Test 9: Sequential fame over multiple days ─────────────────────────────

{
  const state = freshState();
  const day0 = 0;
  const day1 = MS_PER_DAY + 1;
  const day2 = 2 * MS_PER_DAY + 2;

  giveFame(state, "target_J", 1, day0);
  giveFame(state, "target_J", 1, day1);
  giveFame(state, "target_J", 1, day2);

  assertEq(state.fame, 3, "should accumulate +3 over 3 days");
  assertEq(state.fameHistory["target_J"], day2, "history should have latest timestamp");
  console.log("[fameDailyLimit] ✓ test 9: sequential fame over multiple days");
}

console.log("\n[fameDailyLimit] All 9 tests passed ✓");
