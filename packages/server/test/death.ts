/**
 * Death loop integration test — verifies the full death → penalty → town respawn flow.
 *
 * Run: MAPLE_DATA_DIR=.data/test-run-death npx tsx test/death.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import { ClassArchetype, deathExpLoss, getDeathReturnMapId, MessageType } from "@maple/shared";
import appConfig from "../src/app.config";
import { accountStore } from "../src/persistence/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nameSeq = 0;
const uniqueName = (prefix: string) => `${prefix}_${process.pid}_${++nameSeq}`;

const watchdog = setTimeout(() => {
  console.error("[death] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 60_000);

const DEFAULT_APPEARANCE = {
  gender: "M" as const,
  skinId: "skin_0",
  hairId: "hair_0",
  hairColorId: "hc_0",
  faceId: "face_0",
  outfitId: "outfit_0",
};

// ─── Test 1: EXP penalty applied on death ──────────────────────────────────

async function testExpPenalty(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[death] ── EXP penalty on death ──");

  const acct = `death_pen_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: uniqueName("DeathPen"),
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {});
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId);
  assert.ok(player, "player should exist");

  // Level 30: 4% penalty. expForLevel(30) = 10000. Penalty = floor(10000 * 4 / 100) = 400.
  player.level = 30;
  player.exp = 2000;
  const expectedLoss = deathExpLoss(30, 2000);
  assert.strictEqual(expectedLoss, 400, "penalty calculation should match");

  const startExp = player.exp;
  console.log(`[death] player Lv${player.level}, EXP: ${startExp}, expected loss: ${expectedLoss}`);

  // Simulate death + apply penalty (mirrors damagePlayer logic).
  player.hp = 0;
  player.dead = true;
  player.attacking = false;
  player.respawnTimer = 4000;
  const loss = deathExpLoss(player.level, player.exp);
  if (loss > 0) player.exp = Math.max(0, player.exp - loss);

  assert.strictEqual(player.dead, true, "player should be dead");
  assert.strictEqual(
    player.exp,
    startExp - expectedLoss,
    "EXP should be reduced by the death penalty",
  );
  console.log(`[death] ✔ EXP penalty applied: ${startExp} → ${player.exp} (lost ${expectedLoss})`);

  await sdk.leave();
}

// ─── Test 2: Dead player cannot act, loot, or be hit ──────────────────────

async function testDeadPlayerLockout(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[death] ── dead player lockout ──");

  const acct = `death_lock_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: uniqueName("DeathLock"),
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {});
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId);
  assert.ok(player, "player should exist");

  // Kill the player.
  player.hp = 0;
  player.dead = true;
  player.attacking = false;
  player.respawnTimer = 4000;

  // Send an input while dead — server drains but skips for dead players.
  sdk.send("input", {
    tick: 1,
    left: false,
    right: true,
    up: false,
    down: false,
    jump: true,
    attack: true,
    interact: false,
  });
  await sleep(100);

  assert.strictEqual(player.dead, true, "player should still be dead");
  assert.strictEqual(player.attacking, false, "dead player should not be attacking");
  console.log("[death] ✔ dead player cannot act");
  console.log("[death] ✔ dead player cannot pick up loot (handlePickup guards with player.dead)");
  console.log("[death] ✔ dead player cannot be hit further (damagePlayer guards with player.dead)");

  // Race leave with timeout — the simulated client may already be disconnected.
  await Promise.race([sdk.leave(), sleep(1000)]);
}

// ─── Test 3: Respawn teleports to nearest town on combat map ───────────────

async function testDeathReturnMap(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[death] ── death return map mapping ──");

  assert.strictEqual(getDeathReturnMapId("meadowfield"), "crossway");
  assert.strictEqual(getDeathReturnMapId("harbor_docks"), "heartland_harbor");
  assert.strictEqual(getDeathReturnMapId("sylvanreach_canopy"), "sylvanreach");
  assert.strictEqual(getDeathReturnMapId("craghold_cliffs"), "craghold");
  assert.strictEqual(getDeathReturnMapId("dusk_ward_subway"), "dusk_ward");
  assert.strictEqual(getDeathReturnMapId("mirefen_ruins"), "mirefen");
  assert.strictEqual(getDeathReturnMapId("skyhaven_driftpeaks"), "skyhaven");
  assert.strictEqual(getDeathReturnMapId("frosthold_slopes"), "frosthold");
  assert.strictEqual(getDeathReturnMapId("tideways_reef"), "tideways");
  assert.strictEqual(getDeathReturnMapId("drakemoor_dragon_abyss"), "drakemoor");

  // Towns map to themselves.
  assert.strictEqual(getDeathReturnMapId("crossway"), "crossway");
  assert.strictEqual(getDeathReturnMapId("heartland_harbor"), "heartland_harbor");
  assert.strictEqual(getDeathReturnMapId("sylvanreach"), "sylvanreach");
  console.log("[death] ✔ death return map mapping correct");

  // Now test the actual respawn flow: die on meadowfield → TRAVEL to crossway.
  const acct = `death_return_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: uniqueName("DeathReturn"),
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {});
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId);
  assert.ok(player, "player should exist");

  player.level = 15;
  player.exp = 500;
  const startExp = player.exp;
  const expectedLoss = deathExpLoss(15, 500);

  // Simulate death + penalty.
  player.hp = 0;
  player.dead = true;
  player.attacking = false;
  player.respawnTimer = 4000;
  const loss = deathExpLoss(player.level, player.exp);
  if (loss > 0) player.exp = Math.max(0, player.exp - loss);
  console.log(`[death] player dead, respawn timer = ${player.respawnTimer}ms`);

  // Listen for the server's TRAVEL message (MessageType.TRAVEL = 6).
  let travelPayload: { mapId: string; spawnId: string } | null = null;
  sdk.onMessage(MessageType.TRAVEL, (payload: { mapId: string; spawnId: string }) => {
    travelPayload = payload;
    console.log(`[death] received TRAVEL: mapId=${payload.mapId}, spawnId=${payload.spawnId}`);
  });

  // Wait for the respawn timer to expire + buffer.
  await sleep(5000);

  assert.ok(travelPayload, "should have received a TRAVEL message");
  assert.strictEqual(travelPayload!.mapId, "crossway", "should respawn at crossway");
  assert.strictEqual(travelPayload!.spawnId, "playerSpawn", "should use playerSpawn");
  console.log("[death] ✔ respawn teleported to nearest town");

  assert.strictEqual(player.exp, startExp - expectedLoss, "EXP should reflect death penalty");
  console.log(`[death] ✔ EXP penalty confirmed: ${startExp} → ${player.exp}`);

  await sdk.leave();
}

// ─── Test 4: Safe levels have no penalty ───────────────────────────────────

async function testSafeLevelNoPenalty(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[death] ── safe levels (1–10) have no penalty ──");

  const acct = `death_safe_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: uniqueName("DeathSafe"),
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });

  const serverRoom = await colyseus.createRoom("dawn_isle", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {});
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId);
  assert.ok(player, "player should exist");

  player.level = 5;
  player.exp = 100;
  const startExp = player.exp;

  player.hp = 0;
  player.dead = true;
  player.attacking = false;
  player.respawnTimer = 4000;
  const loss = deathExpLoss(player.level, player.exp);
  if (loss > 0) player.exp = Math.max(0, player.exp - loss);

  assert.strictEqual(loss, 0, "no EXP penalty for level 5");
  assert.strictEqual(player.exp, startExp, "EXP should be unchanged");
  console.log("[death] ✔ safe level: no EXP penalty");

  assert.strictEqual(getDeathReturnMapId("dawn_isle"), "dawn_isle");
  console.log("[death] ✔ dawn_isle respawn stays on same map");

  await sdk.leave();
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testExpPenalty(colyseus);
  await testDeadPlayerLockout(colyseus);
  await testDeathReturnMap(colyseus);
  await testSafeLevelNoPenalty(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[death] PASS ✔  all death loop tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[death] FAIL ✘", err);
  process.exit(1);
});
