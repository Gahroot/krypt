/**
 * Base-rank upgrade integration test — proves the full cost → roll → persist → broadcast loop:
 *   1. Create a character with mesos + upgrade shards + an item in inventory.
 *   2. Join a MapRoom, send UPGRADE_ITEM.
 *   3. Assert mesos/shards deducted, rank changed (or not), item updated, broadcast received.
 *
 * Run: npx tsx test/upgradeRank.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import {
  ClassArchetype,
  BaseRank,
  upgradeCost,
  upgradeMaterialCost,
  UPGRADE_SHARD_DEF_ID,
} from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore, type ItemRecord } from "../src/persistence/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[upgradeRank] FAIL ✘ watchdog timeout");
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

// ─── Test 1: Successful upgrade NORMAL → ENHANCED ────────────────────────────

async function testUpgradeSuccess(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[upgradeRank] ── successful upgrade ──");

  const acct = `upgrade_test_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "UpgradeTester",
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });

  const swordUid = "item_upgrade_sword_001";
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

  // Give enough mesos for ENHANCED upgrade (500)
  accountStore.setMesos(rec.charId, 5000);

  // Give upgrade shards
  const shardUid = "item_shard_001";
  accountStore.addItem(rec.charId, {
    uid: shardUid,
    defId: UPGRADE_SHARD_DEF_ID,
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 0,
    minted: false,
    count: 10,
  });

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
  const startRank = player.inventory.get(swordUid)!.baseRank;
  console.log(`[upgradeRank] before: rank=${startRank}, mesos=${startMesos}`);

  // ── Send upgrade ──
  let result: any = null;
  sdk.onMessage(MessageType.UPGRADE_ITEM, (msg: any) => {
    result = msg;
  });

  sdk.send(MessageType.UPGRADE_ITEM, { uid: swordUid });
  await sleep(400);

  assert.ok(result, "should receive upgrade result");
  console.log(
    `[upgradeRank] result: ok=${result.success}, rank=${result.prevRank}→${result.newRank}, msg=${result.message}`,
  );

  // If success, verify rank changed; if fail, verify rank stayed same
  if (result.success) {
    assert.strictEqual(result.prevRank, "NORMAL", "prevRank should be NORMAL");
    assert.strictEqual(result.newRank, "ENHANCED", "newRank should be ENHANCED");

    // Verify Colyseus state updated
    const item = player.inventory.get(swordUid)!;
    assert.strictEqual(item.baseRank, "ENHANCED", "inventory item rank should be ENHANCED");

    // Verify persisted
    const persisted = accountStore.getItem(rec.charId, swordUid);
    assert.ok(persisted, "item should be persisted");
    assert.strictEqual(persisted.baseRank, "ENHANCED", "persisted rank should be ENHANCED");
  }

  // ── Verify mesos deducted ──
  const mesosCost = upgradeCost(BaseRank.ENHANCED);
  assert.strictEqual(
    player.mesos,
    startMesos - mesosCost,
    `mesos should be ${startMesos - mesosCost} after upgrade`,
  );
  assert.strictEqual(result.mesos, player.mesos, "result mesos should match player mesos");

  // ── Verify shards deducted ──
  const shardCost = upgradeMaterialCost(BaseRank.ENHANCED); // 3
  const shardItem = player.inventory.get(shardUid);
  if (shardItem) {
    assert.strictEqual(shardItem.count, 10 - shardCost, "shard count should decrease by 3");
  }

  // ── Verify persisted mesos ──
  const persistedChar = accountStore.getCharacter(rec.charId);
  assert.ok(persistedChar, "character should exist in store");
  assert.strictEqual(persistedChar.mesos, startMesos - mesosCost, "persisted mesos should match");

  await sdk.leave();
  console.log("[upgradeRank] ✔ successful upgrade verified");
}

// ─── Test 2: Not enough mesos ────────────────────────────────────────────────

async function testUpgradeInsufficientMesos(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[upgradeRank] ── insufficient mesos ──");

  const acct = `upgrade_poor_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "UpgradePoor",
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
  // Only 1 meso — not enough for ENHANCED upgrade (500)
  accountStore.setMesos(rec.charId, 1);

  // Give enough shards
  accountStore.addItem(rec.charId, {
    uid: "shard_poor_001",
    defId: UPGRADE_SHARD_DEF_ID,
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 0,
    minted: false,
    count: 10,
  });

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
  sdk.onMessage(MessageType.UPGRADE_ITEM, (msg: any) => {
    result = msg;
  });

  sdk.send(MessageType.UPGRADE_ITEM, { uid: swordUid });
  await sleep(400);

  assert.ok(result, "should receive result");
  assert.strictEqual(result.success, false, "should fail due to insufficient mesos");
  assert.ok(result.message.includes("Not enough mesos"), "error message should mention mesos");

  // Item rank should be unchanged
  const player = serverRoom.state.players.get(sdk.sessionId)!;
  const item = player.inventory.get(swordUid)!;
  assert.strictEqual(item.baseRank, "NORMAL", "rank should be unchanged");
  assert.strictEqual(player.mesos, 1, "mesos should not change");

  await sdk.leave();
  console.log("[upgradeRank] ✔ insufficient mesos handled correctly");
}

// ─── Test 3: Item not in inventory ───────────────────────────────────────────

async function testUpgradeMissingItem(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[upgradeRank] ── missing item ──");

  const acct = `upgrade_miss_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "UpgradeMiss",
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
  sdk.onMessage(MessageType.UPGRADE_ITEM, (msg: any) => {
    result = msg;
  });

  sdk.send(MessageType.UPGRADE_ITEM, { uid: "nonexistent_uid" });
  await sleep(400);

  assert.ok(result, "should receive result");
  assert.strictEqual(result.success, false, "should fail");
  assert.ok(result.message.includes("not found"), "error should mention item not found");

  await sdk.leave();
  console.log("[upgradeRank] ✔ missing item handled correctly");
}

// ─── Test 4: Not enough shards ───────────────────────────────────────────────

async function testUpgradeInsufficientShards(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[upgradeRank] ── insufficient shards ──");

  const acct = `upgrade_noshard_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "UpgradeNoShard",
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });

  const swordUid = "item_noshard_sword_001";
  accountStore.addItem(rec.charId, {
    uid: swordUid,
    defId: "wpn.bronze_shortsword",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
  });
  accountStore.setMesos(rec.charId, 10_000);

  // Give only 1 shard — not enough for ENHANCED (needs 3)
  accountStore.addItem(rec.charId, {
    uid: "shard_little_001",
    defId: UPGRADE_SHARD_DEF_ID,
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 0,
    minted: false,
    count: 1,
  });

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
  sdk.onMessage(MessageType.UPGRADE_ITEM, (msg: any) => {
    result = msg;
  });

  sdk.send(MessageType.UPGRADE_ITEM, { uid: swordUid });
  await sleep(400);

  assert.ok(result, "should receive result");
  assert.strictEqual(result.success, false, "should fail due to insufficient shards");
  assert.ok(result.message.includes("Shard"), "error message should mention shards");

  await sdk.leave();
  console.log("[upgradeRank] ✔ insufficient shards handled correctly");
}

// ─── Test 5: Already MYTHIC ──────────────────────────────────────────────────

async function testUpgradeAlreadyMythic(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[upgradeRank] ── already mythic ──");

  const acct = `upgrade_mythic_${Date.now()}`;
  const rec = accountStore.createCharacter(acct, {
    name: "UpgradeMythic",
    archetype: ClassArchetype.WARRIOR,
    appearance: DEFAULT_APPEARANCE,
  });

  const swordUid = "item_mythic_sword_001";
  accountStore.addItem(rec.charId, {
    uid: swordUid,
    defId: "wpn.bronze_shortsword",
    baseRank: "MYTHIC",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
  });
  accountStore.setMesos(rec.charId, 100_000);

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdk = await colyseus.connectTo(serverRoom, {
    charId: rec.charId,
    accountId: acct,
  });
  sdk.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  await sleep(200);

  const player = serverRoom.state.players.get(sdk.sessionId)!;
  const startMesos = player.mesos;

  let result: any = null;
  sdk.onMessage(MessageType.UPGRADE_ITEM, (msg: any) => {
    result = msg;
  });

  sdk.send(MessageType.UPGRADE_ITEM, { uid: swordUid });
  await sleep(400);

  assert.ok(result, "should receive result");
  assert.strictEqual(result.success, false, "should fail — already max rank");
  assert.ok(result.message.includes("maximum rank"), "error should mention max rank");
  assert.strictEqual(player.mesos, startMesos, "mesos should not change");

  await sdk.leave();
  console.log("[upgradeRank] ✔ already mythic handled correctly");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testUpgradeSuccess(colyseus);
  await testUpgradeInsufficientMesos(colyseus);
  await testUpgradeMissingItem(colyseus);
  await testUpgradeInsufficientShards(colyseus);
  await testUpgradeAlreadyMythic(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[upgradeRank] PASS ✔  all upgrade rank tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[upgradeRank] FAIL ✘", err);
  process.exit(1);
});
