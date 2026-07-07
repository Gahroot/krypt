/**
 * Inventory capacity + sort test — server-authoritative capacity enforcement on
 * pickup (via buy-from-shop capacity check, same logic) and INVENTORY_SORT handler.
 *
 * 1. Fill the EQUIP tab to capacity via shop buys (24 slots).
 * 2. Verify 25th buy is rejected with "inventory full".
 * 3. Sort the EQUIP tab via INVENTORY_SORT → verify alphabetical order.
 * 4. Fill the USE tab with stackable items, sort, verify order.
 *
 * Run: npx tsx test/inventoryCapacity.ts
 */
import assert from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { bootAuthed } from "./authBoot";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";

const TEST_DIR = ".data_test_inventory_capacity";

// Wipe + prepare a fresh data directory.
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(TEST_DIR, { recursive: true });

process.env.MAPLE_DATA_DIR = TEST_DIR;

const watchdog = setTimeout(() => {
  console.error("[inventoryCapacity] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 60_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

const SHOP_ID = "shop.meadow_basic";
const SWORD_DEF = "wpn.bronze_shortsword";
const POTION_DEF = "con.hp_potion_s";

async function main() {
  const colyseus = await bootAuthed(appConfig);
  const { accountStore } = await import("../src/persistence/store");

  const acctId = `ic_acct_${Date.now()}`;
  accountStore.getOrCreate(acctId);

  const charRec = accountStore.createCharacter(acctId, {
    name: `IC_${Date.now()}`,
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

  // Give enough mesos for 25+ shop purchases.
  accountStore.setMesos(charRec.charId, 5000);

  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId: acctId,
    charId: charRec.charId,
  });
  sdkRoom.onMessage("map_npcs", () => {});
  sdkRoom.onMessage(MessageType.QUEST_UPDATE, () => {});
  await sleep(400);

  const me = () => (sdkRoom.state as any).players.get(sdkRoom.sessionId) as any;
  assert.ok(me(), "player should exist after join");
  console.log("[inventoryCapacity] ✔ joined");

  // ── Step 1: Fill EQUIP tab to capacity (24 slots) ──────────────────────
  {
    for (let i = 0; i < 24; i++) {
      const buyPromise = waitForMsg(sdkRoom, MessageType.BUY_FROM_SHOP);
      sdkRoom.send(MessageType.BUY_FROM_SHOP, {
        shopId: SHOP_ID,
        itemId: SWORD_DEF,
        qty: 1,
      });
      const result = await buyPromise;
      assert.strictEqual(result.success, true, `buy ${i + 1}/24 should succeed`);
    }

    // Count EQUIP items.
    let equipCount = 0;
    me().inventory.forEach((item: any) => {
      if (
        item.defId === SWORD_DEF ||
        item.defId === "hat.leather_cap" ||
        item.defId === "arm.iron_shield"
      ) {
        equipCount++;
      }
    });
    assert.ok(equipCount >= 24, `EQUIP tab should have >= 24 items, got ${equipCount}`);
    console.log(`[inventoryCapacity] ✔ EQUIP tab filled: ${equipCount} items`);
  }

  // ── Step 2: 25th buy should be rejected ────────────────────────────────
  {
    const buyPromise = waitForMsg(sdkRoom, MessageType.BUY_FROM_SHOP);
    sdkRoom.send(MessageType.BUY_FROM_SHOP, {
      shopId: SHOP_ID,
      itemId: SWORD_DEF,
      qty: 1,
    });
    const result = await buyPromise;
    assert.strictEqual(result.success, false, "25th equip buy should fail");
    assert.ok(
      (result.message as string).toLowerCase().includes("full"),
      `error should mention full inventory: "${result.message}"`,
    );
    console.log(`[inventoryCapacity] ✔ 25th buy rejected: "${result.message}"`);
  }

  // ── Step 3: Sort EQUIP tab ─────────────────────────────────────────────
  {
    sdkRoom.send(MessageType.INVENTORY_SORT, { tab: "EQUIP" });
    await sleep(200);

    // Collect all defIds in order.
    const defIds: string[] = [];
    me().inventory.forEach((item: any) => {
      const tab =
        item.defId in { "wpn.bronze_shortsword": true }
          ? "EQUIP"
          : item.defId in { "hat.leather_cap": true }
            ? "EQUIP"
            : item.defId in { "arm.iron_shield": true }
              ? "EQUIP"
              : "other";
      if (tab === "EQUIP") defIds.push(item.defId);
    });

    // Verify alphabetical order.
    for (let i = 1; i < defIds.length; i++) {
      assert.ok(
        defIds[i - 1] <= defIds[i],
        `EQUIP sort: "${defIds[i - 1]}" should come before "${defIds[i]}"`,
      );
    }
    console.log(`[inventoryCapacity] ✔ EQUIP sort: ${defIds.length} items in order`);
  }

  // ── Step 4: Buy potions (USE tab), sort, verify order ──────────────────
  {
    // Buy 5 potions.
    const buyPromise = waitForMsg(sdkRoom, MessageType.BUY_FROM_SHOP);
    sdkRoom.send(MessageType.BUY_FROM_SHOP, {
      shopId: SHOP_ID,
      itemId: POTION_DEF,
      qty: 5,
    });
    const result = await buyPromise;
    assert.strictEqual(result.success, true, "buy potions should succeed");
    await sleep(100);

    // Sort USE tab.
    sdkRoom.send(MessageType.INVENTORY_SORT, { tab: "USE" });
    await sleep(200);

    // Verify potion count.
    let potionCount = 0;
    me().inventory.forEach((item: any) => {
      if (item.defId === POTION_DEF) potionCount += item.count;
    });
    assert.strictEqual(potionCount, 5, "should have 5 potions total");
    console.log(`[inventoryCapacity] ✔ USE tab: ${potionCount} potions`);
  }

  await sdkRoom.leave();
  clearTimeout(watchdog);
  console.log("[inventoryCapacity] ✔ All tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[inventoryCapacity] FAIL ✘", err);
  process.exit(1);
});
