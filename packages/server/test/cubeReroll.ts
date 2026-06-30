/**
 * Cube reroll integration test — proves the full consume → reroll → persist loop:
 *   1. Create a character with mesos + an item in inventory.
 *   2. Join a MapRoom, send CUBE_REROLL.
 *   3. Assert mesos deducted, item updated, broadcast received.
 *
 * Run: npx tsx test/cubeReroll.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import { ClassArchetype, CUBE_REROLL_COST } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore, type ItemRecord } from "../src/persistence/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[cubeReroll] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 30_000);

const DEFAULT_APPEARANCE = {
  gender: "M" as const,
  skinId: "skin_0",
  hairId: "hair_0",
  hairColorId: "hc_0",
  faceId: "face_0",
  outfitId: "outfit_0",
};

// ─── Test 1: Successful cube reroll ─────────────────────────────────────────

async function testCubeRerollSuccess(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[cubeReroll] ── successful reroll ──");

  const acct = `cube_test_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "CubeTester",
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });

  // Give the character a weapon + plenty of mesos.
  const swordUid = "item_cube_sword_001";
  const swordRecord: ItemRecord = {
    uid: swordUid,
    defId: "wpn.bronze_shortsword",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
    potentialLines: [{ stat: "STR", percent: 3 }],
  };
  accountStore.addItem(rec.charId, swordRecord);
  accountStore.setMesos(rec.charId, 10_000);

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId);
  assert.ok(player, "player should exist");
  assert.ok(player.inventory.has(swordUid), "sword should be in inventory");

  const startMesos = player.mesos;
  const startTier = player.inventory.get(swordUid)!.potentialTier;
  console.log(`[cubeReroll] before: tier=${startTier}, mesos=${startMesos}`);

  // ── Send cube reroll ──
  let result: any = null;
  sdk.onMessage(MessageType.CUBE_REROLL, (msg: any) => {
    result = msg;
  });

  sdk.send(MessageType.CUBE_REROLL, { uid: swordUid });
  await sleep(400);

  assert.ok(result, "should receive cube reroll result");
  assert.strictEqual(result.success, true, "reroll should succeed");
  assert.strictEqual(result.uid, swordUid, "result uid should match");
  assert.strictEqual(result.prevTier, startTier, "prevTier should match original");
  assert.ok(result.newTier, "newTier should be set");
  assert.ok(Array.isArray(result.newLines), "newLines should be an array");
  assert.ok(typeof result.rollSeed === "string", "rollSeed should be a hex string");
  assert.ok(typeof result.rollCommitment === "string", "rollCommitment should be a hex string");
  console.log(`[cubeReroll] after: ${result.prevTier} → ${result.newTier}, mesos=${result.mesos}`);

  // ── Verify mesos deducted ──
  assert.strictEqual(
    result.mesos,
    startMesos - CUBE_REROLL_COST,
    `mesos should be ${startMesos - CUBE_REROLL_COST}`,
  );
  assert.strictEqual(
    player.mesos,
    startMesos - CUBE_REROLL_COST,
    "Colyseus state mesos should match",
  );

  // ── Verify item updated in Colyseus state ──
  const item = player.inventory.get(swordUid)!;
  assert.strictEqual(item.potentialTier, result.newTier, "inventory item tier should match result");
  assert.ok(
    Array.isArray(JSON.parse(item.potentialLines)),
    "inventory item lines should be valid JSON array",
  );

  // ── Verify persisted to store ──
  const persisted = accountStore.getItem(rec.charId, swordUid);
  assert.ok(persisted, "item should be persisted");
  assert.strictEqual(persisted.potentialTier, result.newTier, "persisted tier should match result");

  // ── Verify persisted mesos ──
  const persistedChar = accountStore.getCharacter(rec.charId);
  assert.ok(persistedChar, "character should exist in store");
  assert.strictEqual(
    persistedChar.mesos,
    startMesos - CUBE_REROLL_COST,
    "persisted mesos should match",
  );

  await sdk.leave();
  console.log("[cubeReroll] ✔ successful reroll verified");
}

// ─── Test 2: Not enough mesos ───────────────────────────────────────────────

async function testCubeRerollInsufficientMesos(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[cubeReroll] ── insufficient mesos ──");

  const acct = `cube_poor_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "CubePoor",
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });

  const swordUid = "item_poor_sword_001";
  accountStore.addItem(rec.charId, {
    uid: swordUid,
    defId: "wpn.bronze_shortsword",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
  });
  // Give only 1 meso — not enough for a reroll.
  accountStore.setMesos(rec.charId, 1);

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId);
  assert.ok(player, "player should exist");

  let result: any = null;
  sdk.onMessage(MessageType.CUBE_REROLL, (msg: any) => {
    result = msg;
  });

  sdk.send(MessageType.CUBE_REROLL, { uid: swordUid });
  await sleep(400);

  assert.ok(result, "should receive result");
  assert.strictEqual(result.success, false, "should fail due to insufficient mesos");
  assert.ok(result.message.includes("Not enough mesos"), "error message should mention mesos");
  assert.strictEqual(player.mesos, 1, "mesos should not change");

  // Item should be unchanged.
  const item = player.inventory.get(swordUid)!;
  assert.strictEqual(item.potentialTier, "RARE", "tier should be unchanged");

  await sdk.leave();
  console.log("[cubeReroll] ✔ insufficient mesos handled correctly");
}

// ─── Test 3: Item not in inventory ──────────────────────────────────────────

async function testCubeRerollMissingItem(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[cubeReroll] ── missing item ──");

  const acct = `cube_miss_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "CubeMiss",
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });
  accountStore.setMesos(rec.charId, 10_000);

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  let result: any = null;
  sdk.onMessage(MessageType.CUBE_REROLL, (msg: any) => {
    result = msg;
  });

  sdk.send(MessageType.CUBE_REROLL, { uid: "nonexistent_uid" });
  await sleep(400);

  assert.ok(result, "should receive result");
  assert.strictEqual(result.success, false, "should fail");
  assert.ok(result.message.includes("not found"), "error should mention item not found");

  await sdk.leave();
  console.log("[cubeReroll] ✔ missing item handled correctly");
}

// ─── Test 4: Multiple rerolls consume mesos correctly ────────────────────────

async function testCubeRerollMultiple(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[cubeReroll] ── multiple rerolls ──");

  const acct = `cube_multi_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "CubeMulti",
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });

  const swordUid = "item_multi_sword_001";
  accountStore.addItem(rec.charId, {
    uid: swordUid,
    defId: "wpn.bronze_shortsword",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
    potentialLines: [{ stat: "DEX", percent: 5 }],
  });
  accountStore.setMesos(rec.charId, 1000);

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId);
  assert.ok(player, "player should exist");

  const results: any[] = [];
  sdk.onMessage(MessageType.CUBE_REROLL, (msg: any) => {
    results.push(msg);
  });

  // Send 3 rerolls.
  for (let i = 0; i < 3; i++) {
    sdk.send(MessageType.CUBE_REROLL, { uid: swordUid });
    await sleep(300);
  }

  assert.strictEqual(results.length, 3, "should receive 3 results");
  for (const r of results) {
    assert.strictEqual(r.success, true, "each reroll should succeed");
  }

  // Final mesos = 1000 - 3 * CUBE_REROLL_COST
  const expectedMesos = 1000 - 3 * CUBE_REROLL_COST;
  assert.strictEqual(player.mesos, expectedMesos, "mesos should decrease by 3× cost");
  assert.strictEqual(results[2].mesos, expectedMesos, "last result mesos should match");

  await sdk.leave();
  console.log("[cubeReroll] ✔ multiple rerolls consume mesos correctly");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await boot(appConfig);

  await testCubeRerollSuccess(colyseus);
  await testCubeRerollInsufficientMesos(colyseus);
  await testCubeRerollMissingItem(colyseus);
  await testCubeRerollMultiple(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[cubeReroll] PASS ✔  all cube reroll tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[cubeReroll] FAIL ✘", err);
  process.exit(1);
});
