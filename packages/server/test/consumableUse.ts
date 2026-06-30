/**
 * Consumable Use test — server-authoritative potion heal/clamp/decrement flow:
 *   1. Buy potions (stack count increases)
 *   2. Use HP potion → heal from low HP + clamp to maxHp + decrement stack
 *   3. Use another HP potion at full HP → no-overheal + decrement
 *   4. Deplete the stack → item removed
 *   5. Buy MP potion → MP restore + clamp to maxMp
 *   6. Large HP potion → oversized heal clamps to maxHp
 *   7. Unknown consumable rejected
 *   8. Depleted item rejected
 *
 * BEGINNER level 1 → maxHp=50, maxMp=5 (from maxHpForLevel/maxMpForLevel).
 * We set stats.HP=10 so the player joins with hp=10 (below maxHp).
 *
 * Run: npx tsx test/consumableUse.ts
 */
import assert from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { boot } from "@colyseus/testing";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { applyHealEffect } from "@maple/shared";

const TEST_DIR = ".data_test_consumableuse";

// Wipe + prepare a fresh data directory.
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(TEST_DIR, { recursive: true });

// Override the data directory for this test run.
process.env.MAPLE_DATA_DIR = TEST_DIR;

const watchdog = setTimeout(() => {
  console.error("[consumableUse] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 30_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HP_POT_S = "con.hp_potion_s"; // heals 50 HP
const HP_POT_M = "con.hp_potion_m"; // heals 150 HP
const MP_POT_S = "con.mp_potion_s"; // heals 30 MP
const SHOP_ID = "shop.meadow_basic";

function waitForMsg(sdkRoom: any, msgType: number, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`message type ${msgType} not received within ${timeoutMs}ms`));
    }, timeoutMs);
    sdkRoom.onMessage(msgType, (message: any) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

async function main() {
  const colyseus = await boot(appConfig);
  const { accountStore } = await import("../src/persistence/store");

  const acctId = `cu_acct_${Date.now()}`;
  accountStore.getOrCreate(acctId);

  // Create character — room will set maxHp=50, maxMp=5 (BEGINNER L1).
  const charRec = accountStore.createCharacter(acctId, {
    name: `Cu_${Date.now()}`,
    archetype: "BEGINNER",
    appearance: {
      gender: "M",
      skinId: "skin_light",
      hairId: "hair_short",
      hairColorId: "color_black",
      faceId: "face_default",
      outfitId: "outfit_tunic",
    },
  });
  accountStore.setMesos(charRec.charId, 500);

  // Set starting stats so the room loads low HP.
  // The room reads: player.hp = character.stats.HP || player.maxHp
  //                player.mp = character.stats.MP || player.maxMp
  // NOTE: || treats 0 as falsy, so stats.MP=0 yields mp=maxMp.
  // We use stats.MP=1 to start with low MP for testing.
  accountStore.updateCharacter(charRec.charId, {
    stats: { STR: 4, DEX: 4, INT: 4, LUK: 4, HP: 10, MP: 1 },
  });

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId: acctId,
    charId: charRec.charId,
  });
  sdkRoom.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  sdkRoom.onMessage(MessageType.QUEST_UPDATE, () => {
    /* suppress unhandled message warning */
  });
  await sleep(400);

  const me = () => (sdkRoom.state as any).players.get(sdkRoom.sessionId) as any;
  assert.ok(me(), "player should exist after join");

  // Room sets maxHp/maxMp from archetype+level; hp from stats.HP, mp from stats.MP.
  const maxHp = me().maxHp;
  const maxMp = me().maxMp;
  console.log(`[consumableUse] ✔ joined: hp=${me().hp}/${maxHp} mp=${me().mp}/${maxMp}`);
  assert.strictEqual(maxHp, 50, "maxHp should be 50 (BEGINNER level 1)");
  assert.strictEqual(maxMp, 5, "maxMp should be 5 (BEGINNER level 1)");
  assert.strictEqual(me().hp, 10, "hp should be 10 (from stats.HP)");
  assert.strictEqual(me().mp, 1, "mp should be 1 (from stats.MP)");

  // ── Step 0: Validate shared-level applyHealEffect (pure function sanity) ──
  {
    const r1 = applyHealEffect({ kind: "heal", hp: 50 }, 10, 5, 100, 50);
    assert.strictEqual(r1.hp, 60, "shared: heal 50 from 10 → 60");
    assert.strictEqual(r1.mp, 5, "shared: mp unchanged");

    const r2 = applyHealEffect({ kind: "heal", hp: 50 }, 90, 5, 100, 50);
    assert.strictEqual(r2.hp, 100, "shared: cannot overheal past maxHp");

    const r3 = applyHealEffect({ kind: "heal", mp: 30 }, 100, 20, 100, 50);
    assert.strictEqual(r3.mp, 50, "shared: MP heal clamped to maxMp");

    console.log("[consumableUse] ✔ shared applyHealEffect clamps correctly");
  }

  // ── Step 1: Buy 3 small HP potions (20 mesos each = 60 total) ──
  {
    const buyPromise = waitForMsg(sdkRoom, MessageType.BUY_FROM_SHOP);
    sdkRoom.send(MessageType.BUY_FROM_SHOP, {
      shopId: SHOP_ID,
      itemId: HP_POT_S,
      qty: 3,
    });
    const buy = await buyPromise;
    assert.strictEqual(buy.success, true, "buy 3 HP potions should succeed");
    console.log(`[consumableUse] ✔ bought 3x ${HP_POT_S}, mesos=${buy.mesos}`);
  }

  await sleep(150);

  // Find the potion stack.
  let potionUid = "";
  me().inventory.forEach((item: any, uid: string) => {
    if (item.defId === HP_POT_S) potionUid = uid;
  });
  assert.ok(potionUid, "potion should be in inventory");
  assert.strictEqual(me().inventory.get(potionUid).count, 3, "stack should be 3");
  console.log(
    `[consumableUse] ✔ potion stack: uid=${potionUid}, count=${me().inventory.get(potionUid).count}`,
  );

  // ── Step 2: Use small HP potion → heal + decrement ──
  // Server hp=10, heal +50 → 60, clamped to maxHp=50
  {
    const usePromise = waitForMsg(sdkRoom, MessageType.USE_CONSUMABLE);
    sdkRoom.send(MessageType.USE_CONSUMABLE, { defId: HP_POT_S });
    const result = await usePromise;
    assert.strictEqual(result.success, true, `use should succeed: ${result.message}`);
    assert.strictEqual(result.defId, HP_POT_S, "result should echo defId");
    console.log(`[consumableUse] ✔ used ${HP_POT_S}: ${result.message}`);
  }

  await sleep(150);

  // Server synced state: hp should be 50 (10+50 clamped), stack 2
  assert.strictEqual(me().hp, maxHp, "hp should clamp to maxHp (50) after heal");
  assert.strictEqual(me().inventory.get(potionUid).count, 2, "stack should be 2 after use");
  console.log(
    `[consumableUse] ✔ healed: hp=${me().hp}/${maxHp}, stack=${me().inventory.get(potionUid).count}`,
  );

  // ── Step 3: Use HP potion at full HP → no-overheal + decrement ──
  {
    const usePromise = waitForMsg(sdkRoom, MessageType.USE_CONSUMABLE);
    sdkRoom.send(MessageType.USE_CONSUMABLE, { defId: HP_POT_S });
    const result = await usePromise;
    assert.strictEqual(result.success, true, "use at full HP should still succeed");
  }
  await sleep(150);

  assert.strictEqual(me().hp, maxHp, "hp should remain at maxHp (no overheal)");
  assert.strictEqual(me().inventory.get(potionUid).count, 1, "stack should be 1");
  console.log(`[consumableUse] ✔ no-overheal: hp=${me().hp} (stayed at maxHp)`);

  // ── Step 4: Use last small HP potion → item depleted + removed ──
  {
    const usePromise = waitForMsg(sdkRoom, MessageType.USE_CONSUMABLE);
    sdkRoom.send(MessageType.USE_CONSUMABLE, { defId: HP_POT_S });
    const result = await usePromise;
    assert.strictEqual(result.success, true);
  }
  await sleep(150);

  assert.strictEqual(me().hp, maxHp, "hp should still be at maxHp");
  // Count 0 → item removed from the MapSchema.
  assert.ok(!me().inventory.has(potionUid), "consumed item should be removed from inventory");
  console.log("[consumableUse] ✔ stack depleted → item removed");

  // ── Step 5: Buy MP potions, test MP restore + clamp ──
  {
    const buyPromise = waitForMsg(sdkRoom, MessageType.BUY_FROM_SHOP);
    sdkRoom.send(MessageType.BUY_FROM_SHOP, {
      shopId: SHOP_ID,
      itemId: MP_POT_S,
      qty: 2,
    });
    const buy = await buyPromise;
    assert.strictEqual(buy.success, true, "buy MP potions should succeed");
  }

  await sleep(150);

  let mpPotUid = "";
  me().inventory.forEach((item: any, uid: string) => {
    if (item.defId === MP_POT_S) mpPotUid = uid;
  });
  assert.ok(mpPotUid, "MP potion should be in inventory");
  assert.strictEqual(me().inventory.get(mpPotUid).count, 2, "MP stack should be 2");

  // Server mp=1, heal +30 → 31, clamped to maxMp=5
  {
    const usePromise = waitForMsg(sdkRoom, MessageType.USE_CONSUMABLE);
    sdkRoom.send(MessageType.USE_CONSUMABLE, { defId: MP_POT_S });
    const result = await usePromise;
    assert.strictEqual(result.success, true, `MP use should succeed: ${result.message}`);
  }
  await sleep(150);

  assert.strictEqual(me().mp, maxMp, "mp should clamp to maxMp (5) from 1+30");
  assert.strictEqual(me().inventory.get(mpPotUid).count, 1, "MP stack should be 1");
  console.log(
    `[consumableUse] ✔ MP healed: mp=${me().mp} (clamped to maxMp), stack=${me().inventory.get(mpPotUid).count}`,
  );

  // Use second MP potion at full MP → no-overheal
  {
    const usePromise = waitForMsg(sdkRoom, MessageType.USE_CONSUMABLE);
    sdkRoom.send(MessageType.USE_CONSUMABLE, { defId: MP_POT_S });
    const result = await usePromise;
    assert.strictEqual(result.success, true);
  }
  await sleep(150);

  assert.strictEqual(me().mp, maxMp, "mp should stay at maxMp (no overheal)");
  assert.ok(!me().inventory.has(mpPotUid), "MP potion stack should be removed");
  console.log("[consumableUse] ✔ MP no-overheal → stack depleted → item removed");

  // ── Step 6: Buy large HP potion, test oversized heal clamps ──
  {
    const buyPromise = waitForMsg(sdkRoom, MessageType.BUY_FROM_SHOP);
    sdkRoom.send(MessageType.BUY_FROM_SHOP, {
      shopId: SHOP_ID,
      itemId: HP_POT_M,
      qty: 1,
    });
    const buy = await buyPromise;
    assert.strictEqual(buy.success, true, "buy large HP potion should succeed");
  }

  await sleep(150);

  let largePotUid = "";
  me().inventory.forEach((item: any, uid: string) => {
    if (item.defId === HP_POT_M) largePotUid = uid;
  });
  assert.ok(largePotUid, "large HP potion should be in inventory");

  // HP is at maxHp (50). Large potion heals 150 → 50+150=200, clamped to 50
  {
    const usePromise = waitForMsg(sdkRoom, MessageType.USE_CONSUMABLE);
    sdkRoom.send(MessageType.USE_CONSUMABLE, { defId: HP_POT_M });
    const result = await usePromise;
    assert.strictEqual(result.success, true, `large HP use should succeed: ${result.message}`);
  }
  await sleep(150);

  assert.strictEqual(me().hp, maxHp, "large HP potion should clamp to maxHp");
  assert.ok(!me().inventory.has(largePotUid), "large HP stack should be removed (consumed)");
  console.log(`[consumableUse] ✔ large HP: hp=${me().hp} (clamped to maxHp), stack consumed`);

  // ── Step 7: Verify unknown consumable is rejected ──
  {
    const usePromise = waitForMsg(sdkRoom, MessageType.USE_CONSUMABLE);
    sdkRoom.send(MessageType.USE_CONSUMABLE, { defId: "fake_potion_999" });
    const result = await usePromise;
    assert.strictEqual(result.success, false, "unknown consumable should fail");
    assert.ok(
      (result.message as string).includes("Unknown"),
      `error should mention unknown: ${result.message}`,
    );
    console.log(`[consumableUse] ✔ unknown consumable rejected: "${result.message}"`);
  }

  // ── Step 8: Verify depleted item not-in-inventory is rejected ──
  {
    const usePromise = waitForMsg(sdkRoom, MessageType.USE_CONSUMABLE);
    sdkRoom.send(MessageType.USE_CONSUMABLE, { defId: HP_POT_S });
    const result = await usePromise;
    assert.strictEqual(result.success, false, "use with empty inventory should fail");
    assert.ok(
      (result.message as string).includes("not in inventory"),
      `error should mention missing item: ${result.message}`,
    );
    console.log(`[consumableUse] ✔ depleted use rejected: "${result.message}"`);
  }

  // ── Cleanup ──
  await sdkRoom.leave();
  await sleep(300);
  await colyseus.shutdown();
  clearTimeout(watchdog);
  rmSync(TEST_DIR, { recursive: true, force: true });

  console.log("[consumableUse] PASS ✔  all tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[consumableUse] FAIL ✘", err);
  clearTimeout(watchdog);
  rmSync(TEST_DIR, { recursive: true, force: true });
  process.exit(1);
});
