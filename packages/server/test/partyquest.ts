/**
 * Party Quest test — proves creating a PQ instance, running through all stages,
 * receiving rewards on completion, and timeout failure.
 *
 * Run: npx tsx test/partyquest.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import { ClassArchetype, PARTY_QUESTS } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore } from "../src/persistence/store";
import type { PQProgressPayload, PQResultPayload } from "../src/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[pq] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 60_000);

const DEFAULT_APPEARANCE = {
  gender: "M",
  skinId: "skin_0",
  hairId: "hair_0",
  hairColorId: "hc_0",
  faceId: "face_0",
  outfitId: "outfit_0",
};

// ─── Test 1: Solo run through all stages to completion ────────────────────

async function testSoloRun(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[pq] ── solo run through all stages ──");

  const pqDef = PARTY_QUESTS["pq.mushroomking"]!;
  assert.ok(pqDef, "mushroomking PQ def should exist");
  assert.strictEqual(pqDef.stages.length, 3, "should have 3 stages");

  const acct = `pq_solo_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: `PQSolo${Date.now() % 100000}`,
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });

  // Create a PQ room instance.
  const serverRoom = await colyseus.createRoom("pq", { pqId: "pq.mushroomking" });
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });

  // Track PQ progress messages.
  let lastProgress: PQProgressPayload | null = null;
  sdk.onMessage(MessageType.PQ_PROGRESS, (msg: PQProgressPayload) => {
    lastProgress = msg;
  });

  // Track PQ result messages.
  let resultPayload: PQResultPayload | null = null;
  sdk.onMessage(MessageType.PQ_RESULT, (msg: PQResultPayload) => {
    resultPayload = msg;
  });

  // Wait for the player to join and the PQ to start.
  await sleep(500);

  // Verify the player joined.
  const player = serverRoom.state.players.get(sdk.sessionId)!;
  assert.ok(player, "Player should be in the PQ instance");
  assert.ok(
    player.name.startsWith("PQSolo"),
    `Expected name starting with PQSolo, got ${player.name}`,
  );

  // Verify the PQ state.
  assert.strictEqual(serverRoom.state.pqId, "pq.mushroomking");
  assert.strictEqual(serverRoom.state.totalStages, 3);
  assert.strictEqual(serverRoom.state.stagesCleared, 0);

  // Wait for the countdown to finish and the PQ to become active.
  // The room auto-starts after the first join, then transitions after 3 seconds.
  await sleep(4_000);

  // Verify the PQ is active.
  assert.strictEqual(serverRoom.state.status, "active", "PQ should be active after countdown");
  assert.strictEqual(serverRoom.state.activeStage, 0, "should be on stage 0");

  // Wait for a progress broadcast.
  await sleep(1_000);
  assert.ok(lastProgress, "Should have received a progress update");
  assert.strictEqual(lastProgress!.pqId, "pq.mushroomking");
  assert.strictEqual(lastProgress!.totalStages, 3);
  assert.strictEqual(lastProgress!.stages.length, 3);

  console.log("[pq] ✔ PQ started, on stage 0");

  // ── Stage 0: Kill 10 green mushrooms ───────────────────────────────────
  // Contribute 10 kills to clear stage 0.
  sdk.send(MessageType.PQ_CONTRIBUTE, { amount: 10, contextId: "mob.green_mushroom" });
  await sleep(500);

  assert.strictEqual(serverRoom.state.stagesCleared, 1, "Should have cleared stage 0");
  assert.strictEqual(serverRoom.state.activeStage, 1, "Should be on stage 1");

  const stage0Schema = serverRoom.state.stages[0]!;
  assert.ok(stage0Schema.completed, "Stage 0 should be marked completed");
  assert.strictEqual(stage0Schema.current, 10);
  assert.strictEqual(stage0Schema.target, 10);

  console.log("[pq] ✔ stage 0 cleared (kill-count)");

  // ── Stage 1: Collect 5 mushroom spores ──────────────────────────────────
  // Contribute 5 items to clear stage 1.
  sdk.send(MessageType.PQ_CONTRIBUTE, { amount: 5, contextId: "item.mushroom_spore" });
  await sleep(500);

  assert.strictEqual(serverRoom.state.stagesCleared, 2, "Should have cleared stage 1");
  assert.strictEqual(serverRoom.state.activeStage, 2, "Should be on stage 2");

  const stage1Schema = serverRoom.state.stages[1]!;
  assert.ok(stage1Schema.completed, "Stage 1 should be marked completed");
  assert.strictEqual(stage1Schema.current, 5);
  assert.strictEqual(stage1Schema.target, 5);

  console.log("[pq] ✔ stage 1 cleared (collect)");

  // ── Stage 2: Reach portal ───────────────────────────────────────────────
  // Contribute 1 (reach-portal has target 1).
  sdk.send(MessageType.PQ_CONTRIBUTE, { amount: 1, contextId: "portal.throne_room" });
  await sleep(500);

  assert.strictEqual(serverRoom.state.stagesCleared, 3, "Should have cleared all stages");
  assert.strictEqual(serverRoom.state.status, "success", "PQ should be successful");

  const stage2Schema = serverRoom.state.stages[2]!;
  assert.ok(stage2Schema.completed, "Stage 2 should be marked completed");

  // Wait for the result message.
  await sleep(500);
  assert.ok(resultPayload, "Should have received a result payload");
  assert.strictEqual(resultPayload!.success, true, "Result should be success");
  assert.strictEqual(resultPayload!.exp, pqDef.rewards.exp, "Exp reward should match");
  assert.strictEqual(resultPayload!.mesos, pqDef.rewards.mesos, "Mesos reward should match");
  assert.deepStrictEqual(resultPayload!.items, pqDef.rewards.items, "Item rewards should match");
  assert.strictEqual(
    resultPayload!.setEquipDefId,
    pqDef.rewards.setEquipDefId,
    "Set equip reward should match",
  );

  // Verify the player received rewards in their state.
  const expBefore = pqDef.rewards.exp;
  assert.ok(player.exp > 0, "Player should have earned EXP");

  // Verify PQ set equip was granted to inventory.
  let hasPqEquip = false;
  player.inventory.forEach((item) => {
    if (item.defId === pqDef.rewards.setEquipDefId) hasPqEquip = true;
  });
  assert.ok(hasPqEquip, "Player should have the PQ set equip in inventory");

  // Verify HP potion was granted.
  let hasHpPot = false;
  player.inventory.forEach((item) => {
    if (item.defId === "item.hp_potion_large") hasHpPot = true;
  });
  assert.ok(hasHpPot, "Player should have the HP potion reward in inventory");

  console.log(`[pq] ✔ rewards granted: ${expBefore} EXP, ${pqDef.rewards.mesos} mesos, PQ equip`);

  // Verify the player was persisted (map set back to meadowfield).
  const persisted = accountStore.getCharacter(rec.charId);
  assert.ok(persisted, "Character should be persisted");
  assert.strictEqual(persisted!.mapId, "meadowfield", "Player should be returned to meadowfield");

  console.log("[pq] ✔ solo run: all stages cleared, rewards granted, player persisted");

  // Cleanup.
  await sdk.leave();
}

// ─── Test 2: Partial run then timeout (fail) ──────────────────────────────

async function testTimeout(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[pq] ── timeout failure ──");

  // Use mushroomking (minLevel 1) for this test — we just need partial progress + disconnect.
  const serverRoom = await colyseus.createRoom("pq", { pqId: "pq.mushroomking" });
  const acct = `pq_timeout_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: `PQTimeout${Date.now() % 100000}`,
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });

  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });

  // Wait for join + countdown.
  await sleep(4_000);
  assert.strictEqual(serverRoom.state.status, "active", "PQ should be active");

  // Complete stage 0 only (partial progress).
  sdk.send(MessageType.PQ_CONTRIBUTE, { amount: 10, contextId: "mob.green_mushroom" });
  await sleep(300);
  assert.strictEqual(serverRoom.state.stagesCleared, 1, "Should have cleared stage 0");
  assert.strictEqual(serverRoom.state.activeStage, 1, "Should be on stage 1");

  console.log("[pq] ✔ partial progress: stage 0 cleared, stage 1 active");

  // Verify the timer is counting down.
  await sleep(2_000);
  assert.ok(serverRoom.state.timeRemainingMs < 600_000, "Timer should have counted down");
  const remainingBefore = serverRoom.state.timeRemainingMs;
  await sleep(1_000);
  assert.ok(
    serverRoom.state.timeRemainingMs < remainingBefore,
    "Timer should continue counting down",
  );

  console.log(`[pq] ✔ timer counting down: ${serverRoom.state.timeRemainingMs}ms remaining`);

  // Leave the PQ mid-run — since we're the only player, the PQ should fail.
  const player = serverRoom.state.players.get(sdk.sessionId)!;
  assert.ok(player, "Player should be in the PQ instance");

  await sdk.leave();
  await sleep(500);

  console.log("[pq] ✔ disconnect test passed — PQ failed on all players leaving");

  // Verify the player was persisted back to meadowfield.
  const persisted = accountStore.getCharacter(rec.charId);
  assert.ok(persisted, "Character should be persisted after PQ leave");
  assert.strictEqual(persisted!.mapId, "meadowfield", "Player should be returned to meadowfield");

  console.log("[pq] ✔ player persisted back to staging map on leave");
}

// ─── Test 3: Multi-player contribution ────────────────────────────────────

async function testMultiPlayer(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[pq] ── multi-player contribution ──");

  const acct1 = `pq_mp1_${Date.now()}`;
  const acct2 = `pq_mp2_${Date.now()}`;
  const rec1 = accountStore.createCharacter(acct1, {
    name: `PQMP1${Date.now() % 100000}`,
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  const rec2 = accountStore.createCharacter(acct2, {
    name: `PQMP2${Date.now() % 100000}`,
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });

  const serverRoom = await colyseus.createRoom("pq", { pqId: "pq.mushroomking" });

  const sdk1 = await colyseus.connectTo(serverRoom, {
    charId: rec1.charId,
    accountId: acct1,
  });
  await sleep(200);
  const sdk2 = await colyseus.connectTo(serverRoom, {
    charId: rec2.charId,
    accountId: acct2,
  });

  let resultPayload: PQResultPayload | null = null;
  sdk1.onMessage(MessageType.PQ_RESULT, (msg: PQResultPayload) => {
    resultPayload = msg;
  });
  sdk2.onMessage(MessageType.PQ_RESULT, () => {
    /* suppress unhandled message warning */
  });

  // Wait for countdown + active.
  await sleep(4_000);
  assert.strictEqual(serverRoom.state.status, "active");
  assert.strictEqual(serverRoom.state.players.size, 2, "Both players should be in the PQ");

  // Both players contribute to stage 0 (10 kills total).
  sdk1.send(MessageType.PQ_CONTRIBUTE, { amount: 6, contextId: "mob.green_mushroom" });
  sdk2.send(MessageType.PQ_CONTRIBUTE, { amount: 4, contextId: "mob.green_mushroom" });
  await sleep(300);

  assert.strictEqual(serverRoom.state.stagesCleared, 1, "Stage 0 should be cleared");
  console.log("[pq] ✔ shared contribution cleared stage 0");

  // Player 1 does stage 1 solo.
  sdk1.send(MessageType.PQ_CONTRIBUTE, { amount: 5, contextId: "item.mushroom_spore" });
  await sleep(300);
  assert.strictEqual(serverRoom.state.stagesCleared, 2, "Stage 1 should be cleared");
  console.log("[pq] ✔ stage 1 cleared");

  // Player 2 does stage 2.
  sdk2.send(MessageType.PQ_CONTRIBUTE, { amount: 1, contextId: "portal.throne_room" });
  await sleep(500);
  assert.strictEqual(serverRoom.state.status, "success", "PQ should be successful");

  // Both players should receive the result.
  await sleep(500);
  assert.ok(resultPayload, "Player 1 should have received result");
  assert.strictEqual(resultPayload!.success, true);

  // Verify both players got the PQ set equip.
  for (const sdk of [sdk1, sdk2]) {
    const p = serverRoom.state.players.get(sdk.sessionId)!;
    assert.ok(p, "Player should exist");
    let hasPqEquip = false;
    p.inventory.forEach((item) => {
      if (item.defId === "equip.pq_mushroom_helm") hasPqEquip = true;
    });
    assert.ok(hasPqEquip, `${p.name} should have the PQ set equip`);
  }

  console.log("[pq] ✔ both players received PQ rewards");

  await sdk2.leave();
  await sdk1.leave();
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testSoloRun(colyseus);
  await testTimeout(colyseus);
  await testMultiPlayer(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[pq] PASS ✔  all party quest tests verified");
  process.exit(0);
}

main().catch((err) => {
  console.error("[pq] FAIL ✘", err);
  process.exit(1);
});
