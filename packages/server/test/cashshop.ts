/**
 * Cash shop test — server-authoritative cosmetic purchase + equip:
 *   1. Buy a cosmetic (balance drops, item appears in cash inventory)
 *   2. Equip it (character appearance changes in synced state)
 *   3. Unequip it (appearance reverts)
 *   4. Unaffordable purchase is rejected
 *   5. Equipping an unowned item is rejected
 *
 * Run: npx tsx test/cashshop.ts
 */
import assert from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { bootAuthed } from "./authBoot";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { getCashItem } from "@maple/shared";

const TEST_DIR = ".data_test_cashshop";

// Wipe + prepare a fresh data directory for this test.
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(TEST_DIR, { recursive: true });

const watchdog = setTimeout(() => {
  console.error("[cashshop] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 20_000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RAINBOW_HAIR = "cash_hair_rainbow"; // price 500
const PHOENIX_ROBE = "cash_outfit_phoenix_robe"; // price 2000
const MINI_DRAGON = "cash_pet_mini_dragon"; // price 3000

/** Wait for the next message on a given numeric type from the SDK room. */
function waitForNumericMessage(sdkRoom: any, msgType: number, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`message type ${msgType} was not called within ${timeoutMs}ms`));
    }, timeoutMs);
    sdkRoom.onMessage(msgType, (message: any) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

async function main() {
  const colyseus = await bootAuthed(appConfig);

  // Use the same singleton accountStore that MapRoom uses.
  const { accountStore } = await import("../src/persistence/store");

  const acctId = `cashshop_acct_${Date.now()}`;
  accountStore.getOrCreate(acctId);

  // Set balance to exactly 600 MC — enough for rainbow hair (500) but not phoenix robe (2000).
  const acc = accountStore.getOrCreate(acctId);
  acc.cash = 600;

  // Create a character with a known appearance.
  const charRec = accountStore.createCharacter(acctId, {
    name: "CashModel",
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

  // Use createRoom + connectTo for precise control.
  const serverRoom = await colyseus.createRoom("meadowfield", {});
  const sdkRoom = await colyseus.connectTo(serverRoom, {
    accountId: acctId,
    charId: charRec.charId,
  });
  // Suppress map_npcs and quest_update warnings.
  sdkRoom.onMessage("map_npcs", () => {
    /* suppress unhandled message warning */
  });
  sdkRoom.onMessage(MessageType.QUEST_UPDATE, () => {
    /* suppress unhandled message warning */
  });
  await sleep(300);

  const sessionId = sdkRoom.sessionId;
  const me = () => (sdkRoom.state as any).players.get(sessionId) as any;
  assert.ok(me(), "player should exist after join");

  // ── Phase 1: Verify initial appearance (no cash items equipped) ──
  assert.strictEqual(me().hairId, "hair_short", "initial hairId");
  assert.strictEqual(me().hairColorId, "color_black", "initial hairColorId");
  assert.strictEqual(me().outfitId, "outfit_tunic", "initial outfitId");
  console.log("[cashshop] ✔ initial appearance is base (no cosmetics)");

  // ── Phase 2: Buy a cosmetic (rainbow hair, 500 MC from 600 balance) ──
  const buyResultPromise = waitForNumericMessage(sdkRoom, MessageType.BUY_CASH_ITEM);
  sdkRoom.send(MessageType.BUY_CASH_ITEM, { itemId: RAINBOW_HAIR });
  const buyResult = await buyResultPromise;
  assert.strictEqual(buyResult.success, true, "buy should succeed");
  assert.strictEqual(buyResult.itemId, RAINBOW_HAIR, "bought rainbow hair");
  assert.strictEqual(
    buyResult.balance,
    100,
    `balance should be 100 (600 - 500), got ${buyResult.balance}`,
  );
  console.log(`[cashshop] ✔ bought ${RAINBOW_HAIR} for 500 MC, balance=${buyResult.balance}`);

  // ── Phase 3: Equip the cosmetic (appearance should change) ──
  const equipResultPromise = waitForNumericMessage(sdkRoom, MessageType.EQUIP_CASH_ITEM);
  sdkRoom.send(MessageType.EQUIP_CASH_ITEM, { itemId: RAINBOW_HAIR, charId: charRec.charId });
  const equipResult = await equipResultPromise;
  assert.strictEqual(equipResult.success, true, "equip should succeed");
  assert.strictEqual(equipResult.category, "hair", "equipped in hair category");
  console.log(`[cashshop] ✔ equipped ${RAINBOW_HAIR} in category ${equipResult.category}`);

  // Wait for state sync.
  await sleep(150);

  // Verify appearance changed on the synced player.
  const def = getCashItem(RAINBOW_HAIR)!;
  assert.strictEqual(me().hairId, def.appearanceOverride!.hairId, "hairId overridden by cash item");
  assert.strictEqual(
    me().hairColorId,
    def.appearanceOverride!.hairColorId,
    "hairColorId overridden by cash item",
  );
  // Outfit should be untouched.
  assert.strictEqual(me().outfitId, "outfit_tunic", "outfitId unchanged");
  console.log("[cashshop] ✔ appearance updated to cash cosmetic");

  // ── Phase 4: Unequip (toggle) — appearance reverts to base ──
  const unequipPromise = waitForNumericMessage(sdkRoom, MessageType.EQUIP_CASH_ITEM);
  sdkRoom.send(MessageType.EQUIP_CASH_ITEM, { itemId: RAINBOW_HAIR, charId: charRec.charId });
  const unequipResult = await unequipPromise;
  assert.strictEqual(unequipResult.success, true, "unequip should succeed");
  await sleep(150);

  assert.strictEqual(me().hairId, "hair_short", "hairId reverted to base after unequip");
  assert.strictEqual(me().hairColorId, "color_black", "hairColorId reverted to base after unequip");
  console.log("[cashshop] ✔ unequip reverts appearance to base");

  // ── Phase 5: Unaffordable purchase rejected ──
  // Balance is 100 MC; try to buy phoenix robe (2000 MC).
  const failBuyPromise = waitForNumericMessage(sdkRoom, MessageType.BUY_CASH_ITEM);
  sdkRoom.send(MessageType.BUY_CASH_ITEM, { itemId: PHOENIX_ROBE });
  const failResult = await failBuyPromise;
  assert.strictEqual(failResult.success, false, "buy should fail (too expensive)");
  assert.ok(
    failResult.message.includes("Not enough"),
    `error message mentions affordability: ${failResult.message}`,
  );
  console.log(`[cashshop] ✔ unaffordable purchase rejected: "${failResult.message}"`);

  // ── Phase 6: Equipping an unowned item is rejected ──
  const failEquipPromise = waitForNumericMessage(sdkRoom, MessageType.EQUIP_CASH_ITEM);
  sdkRoom.send(MessageType.EQUIP_CASH_ITEM, { itemId: MINI_DRAGON, charId: charRec.charId });
  const failEquip = await failEquipPromise;
  assert.strictEqual(failEquip.success, false, "equip of unowned item should fail");
  assert.ok(
    failEquip.message.includes("do not own"),
    `error mentions ownership: ${failEquip.message}`,
  );
  console.log(`[cashshop] ✔ equip of unowned item rejected: "${failEquip.message}"`);

  // ── Cleanup ──
  await sdkRoom.leave();
  await sleep(300);
  await colyseus.shutdown();
  clearTimeout(watchdog);
  rmSync(TEST_DIR, { recursive: true, force: true });

  console.log("[cashshop] PASS ✔  all tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[cashshop] FAIL ✘", err);
  clearTimeout(watchdog);
  rmSync(TEST_DIR, { recursive: true, force: true });
  process.exit(1);
});
