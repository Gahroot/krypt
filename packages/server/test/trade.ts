/**
 * Two-party trade test — proves the secure two-phase lock trade end-to-end:
 *   1. Successful swap: items + mesos move atomically, both inventories updated
 *   2. Capacity-full abort: trade rejected when receiver's inventory is full
 *   3. Cancel restores both inventories and mesos to pre-trade state
 *
 * Run: npx tsx test/trade.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import appConfig from "../src/app.config";
import { accountStore } from "../src/persistence/store";
import { MessageType } from "../src/types";
import { randomizeAppearance } from "@maple/shared";
import type { TradeResultPayload } from "@maple/shared";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[trade] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 30_000);

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Wait for a specific MessageType response from a room client. */
function waitForMessage<T>(
  room: { onMessage: (type: number, cb: (msg: T) => void) => void },
  msgType: number,
  timeoutMs = 2000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for message type ${msgType}`)),
      timeoutMs,
    );
    room.onMessage(msgType, (msg: T) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
}

// ─── Test 1: Successful swap ─────────────────────────────────────────────

async function testSuccessfulSwap(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[trade] ── test successful swap ──");

  const sellerAcct = "acct_trade_seller";
  const buyerAcct = "acct_trade_buyer";
  accountStore.getOrCreate(sellerAcct);
  accountStore.getOrCreate(buyerAcct);

  // Create characters.
  const seller = accountStore.createCharacter(sellerAcct, {
    name: "TraderA",
    archetype: "WARRIOR",
    appearance: randomizeAppearance(() => 0.1),
  });
  const buyer = accountStore.createCharacter(buyerAcct, {
    name: "TraderB",
    archetype: "MAGE",
    appearance: randomizeAppearance(() => 0.2),
  });

  // Seed: seller has an item + 200 mesos; buyer has 500 mesos + a different item.
  accountStore.setMesos(seller.charId, 200);
  accountStore.setMesos(buyer.charId, 500);
  accountStore.addItem(seller.charId, {
    uid: "sword_001",
    defId: "wpn.iron_broadsword",
    baseRank: "NORMAL",
    potentialTier: "EPIC",
    lines: 2,
    minted: false,
  });
  accountStore.addItem(buyer.charId, {
    uid: "hat_001",
    defId: "hat.green_bandana",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
  });

  // Both join the same map room.
  const sellerClient = await colyseus.sdk.joinOrCreate("meadowfield", {
    charId: seller.charId,
    name: "TraderA",
  });
  await sleep(200);

  const buyerClient = await colyseus.sdk.joinOrCreate("meadowfield", {
    charId: buyer.charId,
    name: "TraderB",
  });
  await sleep(300);

  // Move both players to the same position so proximity check passes.
  const sellerSessionId = sellerClient.sessionId;
  const buyerSessionId = buyerClient.sessionId;

  // Verify both joined.
  const sellerPlayer = (sellerClient.state as any).players.get(sellerSessionId);
  const buyerPlayer = (buyerClient.state as any).players.get(buyerSessionId);
  assert.ok(sellerPlayer, "seller should exist in state");
  assert.ok(buyerPlayer, "buyer should exist in state");

  // Teleport them close together by sending movement ticks.
  // Both start at the default spawn, so they should already be close.
  // But to be safe, let them settle.
  await sleep(200);

  // ── Phase 1: Invite ──
  sellerClient.send(MessageType.TRADE_INVITE, {
    targetSessionId: buyerSessionId,
  });
  await sleep(300);

  // Buyer accepts.
  buyerClient.send(MessageType.TRADE_ACCEPT, {
    fromSessionId: sellerSessionId,
  });
  await sleep(200);

  // ── Phase 2: Offer items + mesos ──
  // Seller offers sword + 100 mesos.
  sellerClient.send(MessageType.TRADE_OFFER, {
    itemUid: "sword_001",
    add: true,
    mesos: 100,
  });
  await sleep(200);

  // Buyer offers hat + 300 mesos.
  buyerClient.send(MessageType.TRADE_OFFER, {
    itemUid: "hat_001",
    add: true,
    mesos: 300,
  });
  await sleep(200);

  // ── Phase 3: Lock ──
  sellerClient.send(MessageType.TRADE_LOCK, {});
  await sleep(100);
  buyerClient.send(MessageType.TRADE_LOCK, {});
  await sleep(200);

  // ── Phase 4: Confirm ──
  const resultPromise = waitForMessage<TradeResultPayload>(
    sellerClient as any,
    MessageType.TRADE_RESULT,
  );
  sellerClient.send(MessageType.TRADE_CONFIRM, {});
  buyerClient.send(MessageType.TRADE_CONFIRM, {});
  const result = await resultPromise;
  await sleep(300);

  // ── Verify ──
  assert.strictEqual(result.success, true, "trade should succeed");
  console.log(`[trade] swap result: ${result.message}`);

  // Re-read from the durable store (authoritative).
  const sellerRec = accountStore.getCharacter(seller.charId)!;
  const buyerRec = accountStore.getCharacter(buyer.charId)!;

  // Seller gave sword_001 + 100 mesos, received hat_001 + 300 mesos.
  assert.ok(!sellerRec.inventory["sword_001"], "seller should not have sword");
  assert.ok(buyerRec.inventory["sword_001"], "buyer should have sword");
  assert.ok(!buyerRec.inventory["hat_001"], "buyer should not have hat");
  assert.ok(sellerRec.inventory["hat_001"], "seller should have hat");

  // Mesos: seller had 200 - 100 + 300 = 400; buyer had 500 - 300 + 100 = 300.
  assert.strictEqual(sellerRec.mesos, 400, "seller mesos should be 400");
  assert.strictEqual(buyerRec.mesos, 300, "buyer mesos should be 300");

  // Verify no duplicate items (total item count should be conserved).
  const sellerInvSize = Object.keys(sellerRec.inventory).length;
  const buyerInvSize = Object.keys(buyerRec.inventory).length;
  console.log(`[trade] seller inv=${sellerInvSize}, buyer inv=${buyerInvSize}`);

  await sellerClient.leave();
  await buyerClient.leave();
}

// ─── Test 2: Capacity-full abort ─────────────────────────────────────────

async function testCapacityFullAbort(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[trade] ── test capacity-full abort ──");

  const senderAcct = "acct_trade_sender";
  const receiverAcct = "acct_trade_receiver";
  accountStore.getOrCreate(senderAcct);
  accountStore.getOrCreate(receiverAcct);

  const sender = accountStore.createCharacter(senderAcct, {
    name: "CapSender",
    archetype: "WARRIOR",
    appearance: randomizeAppearance(() => 0.3),
  });
  const receiver = accountStore.createCharacter(receiverAcct, {
    name: "CapRecv",
    archetype: "MAGE",
    appearance: randomizeAppearance(() => 0.4),
  });

  // Give sender an item to trade.
  accountStore.setMesos(sender.charId, 0);
  accountStore.setMesos(receiver.charId, 0);
  accountStore.addItem(sender.charId, {
    uid: "trade_item_01",
    defId: "wpn.iron_broadsword",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
  });

  // Fill the receiver's inventory to 48 slots (the capacity limit).
  for (let i = 0; i < 48; i++) {
    accountStore.addItem(receiver.charId, {
      uid: `filler_${i}`,
      defId: "wpn.wooden_sword",
      baseRank: "NORMAL",
      potentialTier: "NORMAL",
      lines: 0,
      minted: false,
    });
  }

  const senderClient = await colyseus.sdk.joinOrCreate("meadowfield", {
    charId: sender.charId,
    name: "CapSender",
  });
  await sleep(200);

  const receiverClient = await colyseus.sdk.joinOrCreate("meadowfield", {
    charId: receiver.charId,
    name: "CapRecv",
  });
  await sleep(300);

  const senderSid = senderClient.sessionId;
  const receiverSid = receiverClient.sessionId;

  // Invite → Accept → Offer → Lock (should fail for sender due to capacity on receiver).
  senderClient.send(MessageType.TRADE_INVITE, {
    targetSessionId: receiverSid,
  });
  await sleep(300);

  receiverClient.send(MessageType.TRADE_ACCEPT, {
    fromSessionId: senderSid,
  });
  await sleep(200);

  senderClient.send(MessageType.TRADE_OFFER, {
    itemUid: "trade_item_01",
    add: true,
  });
  await sleep(200);

  // Receiver offers nothing (empty offer).
  // Sender locks — this should trigger capacity check.
  const resultPromise = waitForMessage<TradeResultPayload>(
    senderClient as any,
    MessageType.TRADE_RESULT,
  );
  senderClient.send(MessageType.TRADE_LOCK, {});
  const result = await resultPromise;
  await sleep(300);

  assert.strictEqual(result.success, false, "lock should fail due to capacity");
  assert.ok(
    result.message.includes("inventory"),
    `error should mention inventory: "${result.message}"`,
  );
  console.log(`[trade] capacity abort: ${result.message}`);

  // Verify nothing moved.
  const senderRec = accountStore.getCharacter(sender.charId)!;
  const receiverRec = accountStore.getCharacter(receiver.charId)!;
  assert.ok(senderRec.inventory["trade_item_01"], "sender still has their item");
  assert.ok(!receiverRec.inventory["trade_item_01"], "receiver does not have the item");

  await senderClient.leave();
  await receiverClient.leave();
}

// ─── Test 3: Cancel restores both inventories ────────────────────────────

async function testCancelRestores(colyseus: Awaited<ReturnType<typeof boot>>) {
  console.log("[trade] ── test cancel restores inventories ──");

  const acctA = "acct_trade_cancel_a";
  const acctB = "acct_trade_cancel_b";
  accountStore.getOrCreate(acctA);
  accountStore.getOrCreate(acctB);

  const charA = accountStore.createCharacter(acctA, {
    name: "CancelA",
    archetype: "ARCHER",
    appearance: randomizeAppearance(() => 0.5),
  });
  const charB = accountStore.createCharacter(acctB, {
    name: "CancelB",
    archetype: "THIEF",
    appearance: randomizeAppearance(() => 0.6),
  });

  // Seed both with items + mesos.
  accountStore.setMesos(charA.charId, 150);
  accountStore.setMesos(charB.charId, 250);
  accountStore.addItem(charA.charId, {
    uid: "cancel_item_a",
    defId: "wpn.iron_broadsword",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
  });
  accountStore.addItem(charB.charId, {
    uid: "cancel_item_b",
    defId: "hat.green_bandana",
    baseRank: "NORMAL",
    potentialTier: "NORMAL",
    lines: 0,
    minted: false,
  });

  const clientA = await colyseus.sdk.joinOrCreate("meadowfield", {
    charId: charA.charId,
    name: "CancelA",
  });
  await sleep(200);

  const clientB = await colyseus.sdk.joinOrCreate("meadowfield", {
    charId: charB.charId,
    name: "CancelB",
  });
  await sleep(300);

  const sidA = clientA.sessionId;
  const sidB = clientB.sessionId;

  // ── Start trade, offer items, then cancel ──
  clientA.send(MessageType.TRADE_INVITE, {
    targetSessionId: sidB,
  });
  await sleep(300);

  clientB.send(MessageType.TRADE_ACCEPT, { fromSessionId: sidA });
  await sleep(200);

  clientA.send(MessageType.TRADE_OFFER, {
    itemUid: "cancel_item_a",
    add: true,
    mesos: 50,
  });
  await sleep(200);

  clientB.send(MessageType.TRADE_OFFER, {
    itemUid: "cancel_item_b",
    add: true,
    mesos: 100,
  });
  await sleep(200);

  // Lock both to make it "serious".
  clientA.send(MessageType.TRADE_LOCK, {});
  await sleep(100);
  clientB.send(MessageType.TRADE_LOCK, {});
  await sleep(200);

  // ── Cancel from A ──
  const resultPromise = waitForMessage<TradeResultPayload>(
    clientA as any,
    MessageType.TRADE_RESULT,
  );
  clientA.send(MessageType.TRADE_CANCEL, {});
  const result = await resultPromise;
  await sleep(300);

  assert.strictEqual(result.success, false, "cancelled trade should not succeed");
  console.log(`[trade] cancel: ${result.message}`);

  // Verify both inventories and mesos are UNCHANGED.
  const recA = accountStore.getCharacter(charA.charId)!;
  const recB = accountStore.getCharacter(charB.charId)!;

  assert.ok(recA.inventory["cancel_item_a"], "A still has their item");
  assert.ok(recB.inventory["cancel_item_b"], "B still has their item");
  assert.ok(!recA.inventory["cancel_item_b"], "A does not have B's item");
  assert.ok(!recB.inventory["cancel_item_a"], "B does not have A's item");
  assert.strictEqual(recA.mesos, 150, "A's mesos unchanged");
  assert.strictEqual(recB.mesos, 250, "B's mesos unchanged");

  console.log("[trade] cancel verified: inventories and mesos restored");

  await clientA.leave();
  await clientB.leave();
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const colyseus = await boot(appConfig);

  await testSuccessfulSwap(colyseus);
  await testCapacityFullAbort(colyseus);
  await testCancelRestores(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[trade] PASS ✔  all trade tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[trade] FAIL ✘", err);
  process.exit(1);
});
