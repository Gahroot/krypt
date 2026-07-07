/**
 * Multi-client integration test — exercises true multiplayer beyond the single-client smoke test.
 *
 * Spins up 3 bot clients in the same MapRoom and verifies:
 *   1. Players see each other in room state
 *   2. Form a party via invite + accept (2 members)
 *   3. Kill a shared mob → EXP split across party members, solo player gets nothing
 *   4. Loot drops → single-pickup ownership (no dupe)
 *   5. Two-party trade → item + mesos swap, no dupe
 *   6. Market: one lists → another buys → fee + balances verified
 *
 * Run: npx tsx test/multi_client.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import { ClassArchetype, getMobDef } from "@maple/shared";
import appConfig from "../src/app.config";
import { MessageType } from "../src/types";
import { accountStore, marketStore } from "../src/persistence/store";
import type {
  PartyUpdatePayload,
  PartyInviteReceivedPayload,
  TradeResultPayload,
} from "../src/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const watchdog = setTimeout(() => {
  console.error("[multi_client] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 120_000);

const DEFAULT_APPEARANCE = {
  gender: "M",
  skinId: "skin_0",
  hairId: "hair_0",
  hairColorId: "hc_0",
  faceId: "face_0",
  outfitId: "outfit_0",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Wait for a specific MessageType from a room client. */
function waitForMessage<T>(
  room: { onMessage: (type: number, cb: (msg: T) => void) => void },
  msgType: number,
  timeoutMs = 3000,
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

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 1: Party formation, shared EXP, single-pickup loot
// ═══════════════════════════════════════════════════════════════════════════════

async function testPartyCombatLoot(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[multi_client] ── phase 1: party + combat + loot ──");

  // ── Create 3 characters + seed ALL items BEFORE joining ────────────────
  const acctA = `mc_a_${Date.now()}`;
  const acctB = `mc_b_${Date.now()}`;
  const acctC = `mc_c_${Date.now()}`;

  const recA = accountStore.createCharacter(acctA, {
    name: "Alice",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  const recB = accountStore.createCharacter(acctB, {
    name: "Bob",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });
  const recC = accountStore.createCharacter(acctC, {
    name: "Charlie",
    archetype: ClassArchetype.BEGINNER,
    appearance: DEFAULT_APPEARANCE,
  });

  // Seed mesos.
  accountStore.setMesos(recA.charId, 500);
  accountStore.setMesos(recB.charId, 300);
  accountStore.setMesos(recC.charId, 800);

  // Seed items for Alice (sword for trading on market later).
  accountStore.addItem(recA.charId, {
    uid: "alice_sword",
    defId: "wpn.iron_broadsword",
    baseRank: "NORMAL",
    potentialTier: "EPIC",
    lines: 2,
    minted: false,
  });
  accountStore.addItem(recA.charId, {
    uid: "alice_permit",
    defId: "cash.store_permit",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 0,
    minted: false,
  });

  // Seed Bob's tradeable item (helmet) — must be in accountStore BEFORE join
  // so onJoin loads it into Colyseus state for the trade handler.
  accountStore.addItem(recB.charId, {
    uid: "bob_helmet",
    defId: "hat.green_bandana",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
  });

  // ── All 3 join dawn_isle ───────────────────────────────────────────────
  const serverRoom = await colyseus.createRoom("dawn_isle", {});
  const sdkA = await colyseus.connectTo(serverRoom, {
    charId: recA.charId,
    accountId: acctA,
  });
  const sdkB = await colyseus.connectTo(serverRoom, {
    charId: recB.charId,
    accountId: acctB,
  });
  const sdkC = await colyseus.connectTo(serverRoom, {
    charId: recC.charId,
    accountId: acctC,
  });

  // Suppress unhandled message warnings.
  for (const sdk of [sdkA, sdkB, sdkC]) {
    sdk.onMessage("map_npcs", () => {});
    sdk.onMessage("boss_hp", () => {});
  }
  await sleep(300);

  // ── 1. Verify all 3 players see each other ─────────────────────────────
  assert.strictEqual(serverRoom.state.players.size, 3, "all 3 players should be in room state");

  const pA = serverRoom.state.players.get(sdkA.sessionId)!;
  const pB = serverRoom.state.players.get(sdkB.sessionId)!;
  const pC = serverRoom.state.players.get(sdkC.sessionId)!;
  assert.ok(pA && pB && pC, "all 3 players should exist in state");
  assert.strictEqual(pA.name, "Alice");
  assert.strictEqual(pB.name, "Bob");
  assert.strictEqual(pC.name, "Charlie");
  console.log("[multi_client] ✔ 3 players see each other in dawn_isle");

  // ── 2. Form a party: Alice invites Bob (Charlie stays solo) ─────────────
  const invitePromise = waitForMessage<PartyInviteReceivedPayload>(
    sdkB as any,
    MessageType.PARTY_INVITE_RECEIVED,
  );
  sdkA.send(MessageType.PARTY_INVITE, { targetName: "Bob" });
  const invite = await invitePromise;
  assert.strictEqual(invite.fromName, "Alice", "Bob should get invite from Alice");

  let partyUpdateB: PartyUpdatePayload | null = null;
  sdkB.onMessage(MessageType.PARTY_UPDATE, (msg: PartyUpdatePayload) => {
    partyUpdateB = msg;
  });
  sdkB.send(MessageType.PARTY_ACCEPT, { fromCharId: recA.charId });
  await sleep(200);

  assert.ok(partyUpdateB, "Bob should receive party update");
  assert.strictEqual(partyUpdateB!.members.length, 2, "party should have 2 members");
  assert.ok(
    partyUpdateB!.members.some((m) => m.leader),
    "one member should be the leader",
  );
  console.log("[multi_client] ✔ Bob joined Alice's party (2-member party, Charlie solo)");

  // ── 3. Position all players near a mob, kill it, verify EXP split ──────
  pA.x = 200;
  pA.y = 300;
  pB.x = 220;
  pB.y = 300;
  pC.x = 240;
  pC.y = 300;

  // Find a live mob.
  let mobId = "";
  let mobDefId = "";
  for (const [id, mob] of serverRoom.state.mobs.entries()) {
    if (!mob.dead) {
      mobId = id;
      mobDefId = mob.mobId;
      break;
    }
  }
  assert.ok(mobId, "should find an alive mob");
  const mob = serverRoom.state.mobs.get(mobId)!;
  const mobDef = getMobDef(mobDefId)!;
  assert.ok(mobDef, "mob def should exist");

  // Place mob near all players.
  mob.x = 210;
  mob.y = 300;
  mob.hp = mobDef.maxHp;

  // Record EXP before.
  const expABefore = pA.exp;
  const expBBefore = pB.exp;
  const expCBefore = pC.exp;
  const mesosABefore = pA.mesos;
  console.log(`[multi_client] mob: ${mobDef.name} (HP ${mob.maxHp}, EXP ${mobDef.exp})`);
  console.log(`[multi_client] EXP before: A=${expABefore} B=${expBBefore} C=${expCBefore}`);

  // Have Alice kill the mob (set HP to 1, push attack input).
  mob.hp = 1;
  pA.attackCooldown = 0;
  pA.x = mob.x - 30;
  pA.facing = 1;
  pA.climbing = false;
  pA.dead = false;
  pA.inputQueue.push({
    left: false,
    right: false,
    up: false,
    down: false,
    attack: true,
    jump: false,
    interact: false,
    tick: 9999,
  });

  await sleep(400);

  // Verify EXP was shared between Alice and Bob (party members).
  const expAAfter = pA.exp;
  const expBAfter = pB.exp;
  const expCAfter = pC.exp;
  console.log(`[multi_client] EXP after: A=${expAAfter} B=${expBAfter} C=${expCAfter}`);

  assert.ok(expAAfter > expABefore, "Alice (killer) should gain EXP");
  assert.ok(expBAfter > expBBefore, "Bob should gain shared party EXP");
  assert.strictEqual(expCAfter, expCBefore, "Charlie (solo) should NOT gain EXP from party kill");

  // Party bonus: each party member gets floor(mobExp * 1.1 / qualifyingMembers).
  const expectedShare = Math.max(1, Math.floor((mobDef.exp * 1.1) / 2));
  assert.ok(
    expAAfter - expABefore >= expectedShare - 1,
    `Alice EXP share ~${expectedShare}, got ${expAAfter - expABefore}`,
  );
  console.log(
    `[multi_client] ✔ EXP split: A +${expAAfter - expABefore}, B +${expBAfter - expBBefore} ` +
      `(share ~${expectedShare}), C +0 (solo, no share)`,
  );

  // Mesos go to killer only.
  assert.ok(pA.mesos > mesosABefore, "Alice should gain mesos from the kill");
  console.log(`[multi_client] ✔ mesos: Alice ${mesosABefore} → ${pA.mesos} (killer only)`);

  // ── 4. Loot: single-pickup ownership ───────────────────────────────────
  if (serverRoom.state.loot.size > 0) {
    const firstLoot = serverRoom.state.loot.values().next().value!;
    const lootDefId = firstLoot.defId;
    console.log(
      `[multi_client] loot dropped: ${lootDefId} at (${Math.round(firstLoot.x)}, ${Math.round(firstLoot.y)})`,
    );

    // Move Charlie (solo) near the loot.
    pC.x = firstLoot.x;
    pC.y = firstLoot.y;

    // Charlie picks it up.
    sdkC.send(MessageType.PICKUP, { uid: firstLoot.uid });
    await sleep(200);

    // Verify loot is gone from ground.
    assert.ok(
      !serverRoom.state.loot.has(firstLoot.uid),
      "loot should be removed from ground after pickup",
    );

    // Verify Charlie has it and Alice/Bob don't.
    const charlieHasItem = [...pC.inventory.values()].some((item: any) => item.defId === lootDefId);
    assert.ok(charlieHasItem, "Charlie should have the picked-up item");

    // Count total instances across all 3 players — no dupe.
    let totalCount = 0;
    for (const player of [pA, pB, pC]) {
      for (const item of player.inventory.values()) {
        if ((item as any).defId === lootDefId) totalCount++;
      }
    }
    assert.strictEqual(totalCount, 1, "loot item should exist exactly once (no dupe)");
    console.log(`[multi_client] ✔ single-pickup: Charlie got ${lootDefId}, no dupe`);
  } else {
    console.log("[multi_client] (no loot dropped — RNG, skipping pickup assertion)");
  }

  // ── 5. Trade between Bob and Charlie ────────────────────────────────────
  console.log("[multi_client] ── trade between Bob and Charlie ──");

  // Verify Bob has the helmet in his room state inventory.
  const bobHelmet = pB.inventory.get("bob_helmet");
  assert.ok(bobHelmet, "Bob should have helmet in inventory (loaded via onJoin)");

  // Position Bob and Charlie close together (within TRADE_RANGE_X=150, TRADE_RANGE_Y=100).
  pB.x = 300;
  pB.y = 300;
  pC.x = 320;
  pC.y = 300;

  // Charlie invites Bob to trade.
  const tradeResultPromise = waitForMessage<TradeResultPayload>(
    sdkC as any,
    MessageType.TRADE_RESULT,
  );

  sdkC.send(MessageType.TRADE_INVITE, { targetSessionId: sdkB.sessionId });
  await sleep(300);

  // Bob accepts trade.
  sdkB.send(MessageType.TRADE_ACCEPT, { fromSessionId: sdkC.sessionId });
  await sleep(200);

  // Bob offers helmet + 50 mesos.
  sdkB.send(MessageType.TRADE_OFFER, {
    itemUid: "bob_helmet",
    add: true,
    mesos: 50,
  });
  await sleep(200);

  // Charlie offers 200 mesos (no item).
  sdkC.send(MessageType.TRADE_OFFER, {
    add: false,
    mesos: 200,
  });
  await sleep(200);

  // Lock both.
  sdkB.send(MessageType.TRADE_LOCK, {});
  await sleep(100);
  sdkC.send(MessageType.TRADE_LOCK, {});
  await sleep(200);

  // Confirm both.
  sdkB.send(MessageType.TRADE_CONFIRM, {});
  sdkC.send(MessageType.TRADE_CONFIRM, {});

  const tradeResult = await tradeResultPromise;
  await sleep(300);

  assert.strictEqual(tradeResult.success, true, "trade should succeed");
  console.log(`[multi_client] trade result: ${tradeResult.message}`);

  // Verify from durable store (authoritative).
  const bobRecAfter = accountStore.getCharacter(recB.charId)!;
  const charlieRecAfter = accountStore.getCharacter(recC.charId)!;

  // Bob gave helmet + 50 mesos; received 200 mesos.
  assert.ok(!bobRecAfter.inventory["bob_helmet"], "Bob should no longer have helmet");
  assert.ok(charlieRecAfter.inventory["bob_helmet"], "Charlie should have the helmet");

  // Mesos: Bob 300 - 50 + 200 = 450; Charlie 800 - 200 = 600.
  assert.strictEqual(bobRecAfter.mesos, 450, "Bob mesos after trade");
  assert.strictEqual(charlieRecAfter.mesos, 600, "Charlie mesos after trade");

  // No dupe: item exists exactly once.
  const hatCount =
    (bobRecAfter.inventory["bob_helmet"] ? 1 : 0) +
    (charlieRecAfter.inventory["bob_helmet"] ? 1 : 0);
  assert.strictEqual(hatCount, 1, "helmet should exist exactly once (no dupe)");
  console.log("[multi_client] ✔ trade verified: no dupe, mesos correct");

  // ── Leave MapRoom for market phase ─────────────────────────────────────
  await sdkA.leave();
  await sdkB.leave();
  await sdkC.leave();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2: Market list → buy between two bot clients
// ═══════════════════════════════════════════════════════════════════════════════

async function testMarketFromBots(colyseus: Awaited<ReturnType<typeof bootAuthed>>) {
  console.log("[multi_client] ── phase 2: market list → buy ──");

  // Clean up any stale market data from prior test runs.
  for (const l of marketStore.all()) {
    marketStore.remove(l.listingId);
  }

  const sellerAcct = `mc_seller_${Date.now()}`;
  const buyerAcct = `mc_buyer_${Date.now()}`;

  accountStore.getOrCreate(sellerAcct);
  accountStore.getOrCreate(buyerAcct);

  const seller = accountStore.createCharacter(sellerAcct, {
    name: "SellerMC",
    archetype: "WARRIOR",
    appearance: DEFAULT_APPEARANCE,
  });
  const buyer = accountStore.createCharacter(buyerAcct, {
    name: "BuyerMC",
    archetype: "MAGE",
    appearance: DEFAULT_APPEARANCE,
  });

  // Seed: seller has an item + store permit, buyer has mesos.
  accountStore.setMesos(seller.charId, 0);
  accountStore.setMesos(buyer.charId, 2000);
  accountStore.addItem(seller.charId, {
    uid: "mc_market_sword",
    defId: "wpn.iron_broadsword",
    baseRank: "NORMAL",
    potentialTier: "EPIC",
    lines: 2,
    minted: false,
  });
  accountStore.addItem(seller.charId, {
    uid: "mc_permit",
    defId: "cash.store_permit",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 0,
    minted: false,
  });

  // Both join market_room.
  const sellerClient = await colyseus.sdk.joinOrCreate("market_room", {
    charId: seller.charId,
  });
  await sleep(150);

  const buyerClient = await colyseus.sdk.joinOrCreate("market_room", {
    charId: buyer.charId,
  });
  await sleep(150);

  // Seller lists the sword at 500 mesos.
  sellerClient.send("list", { itemUid: "mc_market_sword", price: 500 });
  await sleep(300);

  // Verify listing exists.
  const listing = marketStore
    .all()
    .find((l) => l.sellerId === seller.charId && l.item.defId === "wpn.iron_broadsword");
  assert.ok(listing, "listing should exist after list");
  assert.strictEqual(listing.price, 500, "listing price should be 500");

  // Item should be escrowed (not in seller inventory).
  assert.ok(
    !accountStore.getItem(seller.charId, "mc_market_sword"),
    "listed item should be escrowed",
  );
  console.log("[multi_client] ✔ item listed on market");

  // Buyer buys the listing.
  buyerClient.send("buy", { listingId: listing.listingId });
  await sleep(400);

  // Verify balances.
  const sellerRec = accountStore.getCharacter(seller.charId)!;
  const buyerRec = accountStore.getCharacter(buyer.charId)!;

  // Fee: floor(500 * 250 / 10000) = floor(12.5) = 12.
  const expectedFee = Math.floor((500 * 250) / 10_000);

  assert.strictEqual(sellerRec.mesos, 500 - expectedFee, "seller gets price minus fee");
  assert.strictEqual(buyerRec.mesos, 1500, "buyer pays 500 mesos (2000 - 500)");
  assert.ok(buyerRec.inventory["mc_market_sword"], "buyer receives the item");
  assert.ok(!marketStore.get(listing.listingId), "listing removed after sale");

  console.log(
    `[multi_client] ✔ market buy: seller +${500 - expectedFee} mesos (fee ${expectedFee}), buyer got item`,
  );

  await sellerClient.leave();
  await buyerClient.leave();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const colyseus = await bootAuthed(appConfig);

  await testPartyCombatLoot(colyseus);
  await testMarketFromBots(colyseus);

  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[multi_client] PASS ✔  all multiplayer integration tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[multi_client] FAIL ✘", err);
  process.exit(1);
});
