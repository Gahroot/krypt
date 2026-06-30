/**
 * SpawnManager test — proves killed mobs respawn after their per-mob-type delay,
 * zone counts are maintained, and boss-specific longer timers apply.
 *
 * The SpawnManager exposes a tick-based step (`tick(dt)`) that advances pending
 * respawn timers by an explicit delta. This test drives that step directly with
 * a fixed dt and an injected jitter source (`() => 0`, so respawns fire on an
 * exact boundary), then asserts exact respawn counts after a known number of
 * ticks. There is no wall-clock timing and no `setTimeout`-based sleeping, so
 * the assertions are fully deterministic.
 *
 * Run: npx tsx test/spawnManager.ts
 */
import assert from "node:assert";
import { getMobDef, type GameMap } from "@maple/shared";
import {
  SpawnManager,
  DEFAULT_RESPAWN_MS,
  BOSS_RESPAWN_MS,
  DUNGEON_BOSS_RESPAWN_MS,
} from "../src/spawnManager";
import { TownState } from "../src/rooms/schema/TownState";

// ─── Deterministic clock helpers ────────────────────────────────────────────

/** Fixed simulation step, in ms, that the test advances the manager by. */
const TICK_MS = 100;

/**
 * Inject zero jitter so the effective respawn delay equals the base delay
 * exactly. Combined with a TICK_MS that divides every base delay evenly, this
 * makes the respawn boundary land on a precise, known tick number.
 */
const NO_JITTER = () => 0;

/** Number of fixed ticks required to elapse `delayMs` (exact for our delays). */
function ticksFor(delayMs: number): number {
  assert.strictEqual(delayMs % TICK_MS, 0, `delay ${delayMs} must be a multiple of ${TICK_MS}`);
  return delayMs / TICK_MS;
}

/** Advance the manager by exactly `n` fixed ticks of TICK_MS each. */
function advance(sm: SpawnManager, n: number): void {
  for (let i = 0; i < n; i++) sm.tick(TICK_MS);
}

/** Count alive mobs in state matching a given def id. */
function countMobs(state: TownState, mobDefId: string): number {
  let n = 0;
  state.mobs.forEach((m) => {
    if (m.mobId === mobDefId) n++;
  });
  return n;
}

// ─── Test maps ───────────────────────────────────────────────────────────────

/** Open-field map with a single zone of 3 normal slimes. */
const FIELD_MAP: GameMap = {
  id: "test_field",
  name: "Test Field",
  width: 1600,
  height: 800,
  footholds: [{ id: 0, x1: 0, y1: 600, x2: 1600, y2: 600, solid: true }],
  ladders: [],
  spawns: [{ footholdId: 0, mobId: "mob.meadow_slime", count: 3 }],
  portals: [],
  spawnPoints: {},
  playerSpawn: { x: 100, y: 560 },
};

/** Mixed map with a normal zone and a (field) boss zone. */
const MOCK_MAP: GameMap = {
  id: "frosthold_slopes",
  name: "Test Ruins",
  width: 1600,
  height: 800,
  footholds: [
    { id: 0, x1: 0, y1: 600, x2: 1600, y2: 600, solid: true },
    { id: 1, x1: 500, y1: 140, x2: 900, y2: 140 }, // boss platform
  ],
  ladders: [],
  spawns: [
    { footholdId: 0, mobId: "mob.meadow_slime", count: 3 },
    { footholdId: 1, mobId: "mob.bogmaw", count: 1 }, // isBoss = true
  ],
  portals: [],
  spawnPoints: {},
  playerSpawn: { x: 100, y: 560 },
};

function makeManager(map: GameMap): { sm: SpawnManager; state: TownState } {
  const state = new TownState();
  state.mapId = map.id;
  let idSeq = 0;
  const sm = new SpawnManager(state, map, () => ++idSeq, undefined, undefined, NO_JITTER);
  return { sm, state };
}

/** Find the instance id of the first alive mob with the given def id. */
function firstMobId(state: TownState, mobDefId: string): string {
  for (const [instId, mob] of state.mobs.entries()) {
    if (mob.mobId === mobDefId) return instId;
  }
  return "";
}

// ─── Test 1: Killed mob respawns on an exact tick boundary ──────────────────

function testMobRespawnsAfterDelay() {
  console.log("[spawnManager] ── killed mob respawns after exact delay ──");

  const { sm, state } = makeManager(FIELD_MAP);
  sm.spawnAll();
  assert.strictEqual(countMobs(state, "mob.meadow_slime"), 3, "should spawn 3 slimes");

  // Kill one slime → schedule a single respawn at exactly DEFAULT_RESPAWN_MS.
  const targetId = firstMobId(state, "mob.meadow_slime");
  assert.ok(targetId, "should find a slime to kill");
  const def = getMobDef("mob.meadow_slime");
  assert.ok(def && !def.isBoss, "slime should not be a boss");

  sm.onMobDeath(targetId);
  sm.removeDeadMob(targetId);
  assert.strictEqual(countMobs(state, "mob.meadow_slime"), 2, "alive count drops to 2 after kill");
  assert.strictEqual(sm.pendingCount(0), 1, "one respawn queued");

  // One tick short of the boundary → NOT yet respawned.
  const ticks = ticksFor(DEFAULT_RESPAWN_MS);
  advance(sm, ticks - 1);
  assert.strictEqual(
    countMobs(state, "mob.meadow_slime"),
    2,
    `should still be 2 slimes after ${ticks - 1} ticks (before respawn boundary)`,
  );
  assert.strictEqual(sm.pendingCount(0), 1, "respawn still pending one tick before boundary");

  // Exactly on the boundary → respawned.
  advance(sm, 1);
  assert.strictEqual(
    countMobs(state, "mob.meadow_slime"),
    3,
    `slime should respawn on tick ${ticks}, restoring count to 3`,
  );
  assert.strictEqual(sm.pendingCount(0), 0, "no respawns pending after fire");
  console.log(`[spawnManager] ✔ respawned on exact tick ${ticks} (count restored to 3)`);
}

// ─── Test 2: Multiple kills respawn exactly, never exceeding the zone cap ────

function testZoneCountCap() {
  console.log("[spawnManager] ── zone cap respected after mass kill ──");

  const { sm, state } = makeManager(FIELD_MAP);
  sm.spawnAll();
  assert.strictEqual(countMobs(state, "mob.meadow_slime"), 3, "starts at 3 slimes");

  // Kill all 3 slimes → 0 alive, 3 respawns queued.
  const ids: string[] = [];
  state.mobs.forEach((m) => {
    if (m.mobId === "mob.meadow_slime") ids.push(m.instanceId);
  });
  assert.strictEqual(ids.length, 3, "should have 3 slimes to kill");
  for (const id of ids) {
    sm.onMobDeath(id);
    sm.removeDeadMob(id);
  }
  assert.strictEqual(countMobs(state, "mob.meadow_slime"), 0, "no slimes alive after mass kill");
  assert.strictEqual(sm.pendingCount(0), 3, "three respawns queued");

  // All three share the same zero-jitter delay, so they all fire on the same
  // boundary tick — and the zone cap (count = 3) means we get exactly 3, not 4+.
  advance(sm, ticksFor(DEFAULT_RESPAWN_MS) - 1);
  assert.strictEqual(countMobs(state, "mob.meadow_slime"), 0, "none respawned before boundary");

  advance(sm, 1);
  const restored = countMobs(state, "mob.meadow_slime");
  assert.strictEqual(restored, 3, `exactly 3 slimes should respawn, got ${restored}`);
  assert.strictEqual(sm.zoneFull(0), true, "zone 0 should be at capacity");

  // Ticking far past the boundary must never over-spawn beyond the cap.
  advance(sm, ticksFor(DEFAULT_RESPAWN_MS) * 2);
  assert.strictEqual(
    countMobs(state, "mob.meadow_slime"),
    3,
    "zone cap holds — count never exceeds 3",
  );
  console.log("[spawnManager] ✔ zone cap held at 3 across full + extended windows");
}

// ─── Test 3: Boss has a longer respawn delay than normal mobs ───────────────

function testBossRespawnDelay() {
  console.log("[spawnManager] ── boss uses longer respawn delay ──");

  // Verify constants ordering.
  assert.ok(DEFAULT_RESPAWN_MS < BOSS_RESPAWN_MS, "normal < boss");
  assert.ok(BOSS_RESPAWN_MS < DUNGEON_BOSS_RESPAWN_MS, "boss < dungeon boss");
  console.log(
    `[spawnManager] ✔ delays: normal=${DEFAULT_RESPAWN_MS}ms, boss=${BOSS_RESPAWN_MS}ms, dungeon=${DUNGEON_BOSS_RESPAWN_MS}ms`,
  );

  const { sm, state } = makeManager(MOCK_MAP);
  sm.spawnAll();

  // Should have 3 slimes + 1 boss = 4 alive mobs.
  assert.strictEqual(state.mobs.size, 4, "should spawn 4 mobs (3 slimes + 1 boss)");

  const bossInstanceId = firstMobId(state, "mob.bogmaw");
  const slimeInstanceId = firstMobId(state, "mob.meadow_slime");
  assert.ok(bossInstanceId, "should have boss instance");
  assert.ok(slimeInstanceId, "should have slime instance");

  // Kill the slime → schedule respawn with DEFAULT delay.
  sm.onMobDeath(slimeInstanceId);
  sm.removeDeadMob(slimeInstanceId);
  assert.strictEqual(state.mobs.size, 3, "3 mobs after killing slime");

  // Kill the boss → schedule respawn with BOSS delay.
  sm.onMobDeath(bossInstanceId);
  sm.removeDeadMob(bossInstanceId);
  assert.strictEqual(state.mobs.size, 2, "2 mobs after killing boss");

  // Advance exactly to the normal respawn boundary — slime back, boss not yet.
  advance(sm, ticksFor(DEFAULT_RESPAWN_MS));
  assert.strictEqual(countMobs(state, "mob.meadow_slime"), 3, "slime respawned (3 alive now)");
  assert.strictEqual(countMobs(state, "mob.bogmaw"), 0, "boss should NOT have respawned yet");
  console.log("[spawnManager] ✔ after normal window: 3 slimes, 0 bosses");

  // Advance the remaining time up to the boss boundary — boss now respawns.
  advance(sm, ticksFor(BOSS_RESPAWN_MS) - ticksFor(DEFAULT_RESPAWN_MS));
  assert.strictEqual(countMobs(state, "mob.bogmaw"), 1, "boss should respawn after boss delay");
  console.log("[spawnManager] ✔ after boss window: boss respawned (1 alive)");

  // Zone cap: kill all slimes, they all respawn back to exactly 3.
  const slimeIds: string[] = [];
  state.mobs.forEach((m) => {
    if (m.mobId === "mob.meadow_slime") slimeIds.push(m.instanceId);
  });
  for (const id of slimeIds) {
    sm.onMobDeath(id);
    sm.removeDeadMob(id);
  }
  assert.strictEqual(state.mobs.size, 1, "only boss alive after killing all slimes");

  advance(sm, ticksFor(DEFAULT_RESPAWN_MS));
  assert.strictEqual(countMobs(state, "mob.meadow_slime"), 3, "all 3 slime slots filled");
  console.log("[spawnManager] ✔ full respawn: 3 slimes alive");
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main() {
  testMobRespawnsAfterDelay();
  testZoneCountCap();
  testBossRespawnDelay();

  console.log("[spawnManager] PASS ✔  all spawn manager tests verified");
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error("[spawnManager] FAIL ✘", err);
  process.exit(1);
}
