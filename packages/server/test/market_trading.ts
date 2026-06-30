/**
 * Market trading end-to-end test — proves the Free Market works across two characters:
 *
 *   1. Store Permit gate: listing without a permit is rejected
 *   2. List: item escrows out of seller's inventory
 *   3. Browse: search/filter returns the correct listings
 *   4. Buy: mesos move to seller minus 2.5% fee; item moves to buyer
 *   5. Cancel: escrowed item returns to seller
 *   6. Edge cases: buy own listing rejected, insufficient mesos rejected
 *
 * Run: npx tsx test/market_trading.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import appConfig from "../src/app.config";
import { accountStore, marketStore } from "../src/persistence/store";
import { STORE_PERMIT_DEFID } from "../src/rooms/MarketRoom";
import { randomizeAppearance } from "@maple/shared";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const watchdog = setTimeout(() => {
  console.error("[market_trading] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 30_000);

async function main() {
  // Clear stale listings from prior test runs.
  while (marketStore.all().length > 0) {
    const rec = marketStore.all()[0];
    marketStore.remove(rec.listingId);
  }

  const colyseus = await boot(appConfig);

  // ── Accounts & characters ──────────────────────────────────────────────────
  const sellerAcct = "acct_mt_seller";
  const buyerAcct = "acct_mt_buyer";

  accountStore.getOrCreate(sellerAcct);
  accountStore.getOrCreate(buyerAcct);

  const seller = accountStore.createCharacter(sellerAcct, {
    name: "SellerMT",
    archetype: "WARRIOR",
    appearance: randomizeAppearance(() => 0.1),
  });
  const buyer = accountStore.createCharacter(buyerAcct, {
    name: "BuyerMT",
    archetype: "MAGE",
    appearance: randomizeAppearance(() => 0.2),
  });

  // ── Seed state ─────────────────────────────────────────────────────────────
  // Seller: 0 mesos, iron broadsword (item_sword_1), 5 potions (item_pots_1), no Store Permit yet.
  accountStore.setMesos(seller.charId, 0);
  accountStore.addItem(seller.charId, {
    uid: "item_sword_1",
    defId: "wpn.iron_broadsword",
    baseRank: "NORMAL",
    potentialTier: "EPIC",
    lines: 2,
    minted: false,
  });
  accountStore.addItem(seller.charId, {
    uid: "item_pots_1",
    defId: "pot.small_hp",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
    count: 5,
  });

  // Buyer: 1000 mesos, no items.
  accountStore.setMesos(buyer.charId, 1000);

  // ── Connect both players ───────────────────────────────────────────────────
  const sellerClient = await colyseus.sdk.joinOrCreate("market_room", { charId: seller.charId });
  await sleep(100);
  const buyerClient = await colyseus.sdk.joinOrCreate("market_room", { charId: buyer.charId });
  await sleep(100);

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: Store Permit gate — listing without a permit is rejected
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("[market_trading] TEST 1: Store Permit gate");
  sellerClient.send("list", { itemUid: "item_sword_1", price: 200 });
  await sleep(200);

  // Re-send to confirm the listing is consistently rejected.
  sellerClient.send("list", { itemUid: "item_sword_1", price: 200 });
  await sleep(200);

  // The listing should NOT exist (no permit).
  assert.ok(
    !marketStore.all().find((l) => l.sellerId === seller.charId),
    "listing should be rejected without Store Permit",
  );
  console.log("[market_trading] TEST 1 ✔  Store Permit gate works");

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: Grant permit + list item → escrow
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("[market_trading] TEST 2: List with Store Permit");
  accountStore.addItem(seller.charId, {
    uid: "permit_1",
    defId: STORE_PERMIT_DEFID,
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 0,
    minted: false,
  });

  sellerClient.send("list", { itemUid: "item_sword_1", price: 200 });
  await sleep(300);

  const swordListing = marketStore
    .all()
    .find((l) => l.sellerId === seller.charId && l.item.defId === "wpn.iron_broadsword");
  assert.ok(swordListing, "sword listing should exist after Store Permit grant");
  assert.strictEqual(swordListing!.price, 200, "listing price should be 200");
  assert.ok(
    !accountStore.getItem(seller.charId, "item_sword_1"),
    "listed item should be escrowed out of seller inventory",
  );
  // Store Permit should still be there (NOT consumed).
  assert.ok(
    accountStore.getItem(seller.charId, "permit_1"),
    "Store Permit should NOT be consumed on listing",
  );
  console.log(
    `[market_trading] TEST 2 ✔  Listed ${swordListing!.listingId} @ ${swordListing!.price} mesos`,
  );

  // Also list the potions (stackable).
  sellerClient.send("list", { itemUid: "item_pots_1", pricePerUnit: 10, qty: 5 });
  await sleep(300);

  const potsListing = marketStore
    .all()
    .find((l) => l.sellerId === seller.charId && l.item.defId === "pot.small_hp");
  assert.ok(potsListing, "potion listing should exist");
  assert.strictEqual(potsListing!.price, 50, "potion total price = 10 × 5 = 50");
  console.log(
    `[market_trading] TEST 2b ✔  Listed potions ${potsListing!.listingId} @ 10/ea (50 total)`,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: Browse / search — returns the correct filtered results
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("[market_trading] TEST 3: Browse/search");

  // 3a: Full browse (no filter) — should see both listings.
  let browseResult: { listings: unknown[]; total: number } | undefined;
  const onBrowse = (msg: unknown) => {
    browseResult = msg as { listings: unknown[]; total: number };
  };
  buyerClient.onMessage("browse_result", onBrowse);

  buyerClient.send("browse", {});
  await sleep(200);
  assert.ok(browseResult, "browse_result should be received");
  assert.strictEqual(browseResult!.total, 2, "all listings visible (2 total)");
  console.log(`[market_trading] TEST 3a ✔  Full browse: ${browseResult!.total} listings`);

  // 3b: Filter by query — search "sword".
  buyerClient.send("browse", { query: "sword" });
  await sleep(200);
  assert.ok(browseResult, "browse_result should be received");
  assert.strictEqual(browseResult!.total, 1, "query 'sword' matches 1 listing");
  console.log("[market_trading] TEST 3b ✔  Query filter works");

  // 3c: Filter by price range — max 50.
  buyerClient.send("browse", { priceMax: 50 });
  await sleep(200);
  assert.ok(browseResult, "browse_result should be received");
  assert.strictEqual(browseResult!.total, 1, "priceMax 50 matches potions (50) only");
  console.log("[market_trading] TEST 3c ✔  Price filter works");

  // 3d: Filter by slot — WEAPON.
  buyerClient.send("browse", { slot: "WEAPON" });
  await sleep(200);
  assert.ok(browseResult, "browse_result should be received");
  assert.strictEqual(browseResult!.total, 1, "slot=WEAPON matches sword only");
  console.log("[market_trading] TEST 3d ✔  Slot filter works");

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: Buy — mesos + fee + item transfer
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("[market_trading] TEST 4: Buy with tax");

  const buyerMesosBefore = accountStore.getCharacter(buyer.charId)!.mesos;
  const listingPrice = swordListing!.price;

  buyerClient.send("buy", { listingId: swordListing!.listingId });
  await sleep(400);

  const sellerRec = accountStore.getCharacter(seller.charId)!;
  const buyerRec = accountStore.getCharacter(buyer.charId)!;
  const fee = Math.floor((listingPrice * 250) / 10_000); // 2.5% of 200 = 5

  assert.strictEqual(
    buyerRec.mesos,
    buyerMesosBefore - listingPrice,
    `buyer pays full price: ${buyerMesosBefore} - ${listingPrice} = ${buyerMesosBefore - listingPrice}`,
  );
  assert.strictEqual(
    sellerRec.mesos,
    listingPrice - fee,
    `seller receives price minus fee: ${listingPrice} - ${fee} = ${listingPrice - fee}`,
  );
  assert.ok(buyerRec.inventory["item_sword_1"], "buyer receives the escrowed item");
  assert.ok(!marketStore.get(swordListing!.listingId), "listing is removed after sale");
  // Store Permit still with seller.
  assert.ok(sellerRec.inventory["permit_1"], "Store Permit stays with seller after sale");

  console.log(
    `[market_trading] TEST 4 ✔  Settled: buyer mesos=${buyerRec.mesos}, ` +
      `seller mesos=${sellerRec.mesos} (fee=${fee}), item transferred`,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 5: Cancel — item returned to seller
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("[market_trading] TEST 5: Cancel listing");

  // The potions listing should still exist — cancel it.
  assert.ok(potsListing, "potion listing should still exist before cancel");

  sellerClient.send("cancel", { listingId: potsListing!.listingId });
  await sleep(300);

  const sellerAfterCancel = accountStore.getCharacter(seller.charId)!;
  assert.ok(
    sellerAfterCancel.inventory["item_pots_1"],
    "cancelled item should be returned to seller",
  );
  assert.ok(
    !marketStore.get(potsListing!.listingId),
    "cancelled listing should be removed from the market",
  );
  console.log("[market_trading] TEST 5 ✔  Cancel returns escrowed item");

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 6: Edge cases
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("[market_trading] TEST 6: Edge cases");

  // 6a: List a new item, then try to buy own listing.
  sellerClient.send("list", { itemUid: "item_pots_1", pricePerUnit: 5, qty: 5 });
  await sleep(300);
  const selfListing = marketStore.all().find((l) => l.sellerId === seller.charId);

  let selfBuyError = "";
  const onErr = (msg: unknown) => {
    selfBuyError = (msg as { reason: string }).reason;
  };
  sellerClient.onMessage("market_error", onErr);
  sellerClient.send("buy", { listingId: selfListing!.listingId });
  await sleep(200);
  assert.ok(selfBuyError.includes("own"), "buying own listing should be rejected");
  console.log("[market_trading] TEST 6a ✔  Self-buy rejected");

  // 6b: Buyer tries to buy with insufficient mesos.
  // Give buyer exactly 3 mesos (not enough for anything).
  accountStore.setMesos(buyer.charId, 3);
  let insufficientError = "";
  const onErr2 = (msg: unknown) => {
    insufficientError = (msg as { reason: string }).reason;
  };
  buyerClient.onMessage("market_error", onErr2);
  buyerClient.send("buy", { listingId: selfListing!.listingId });
  await sleep(200);
  assert.ok(
    insufficientError.includes("Mesos") || insufficientError.includes("enough"),
    "insufficient mesos should be rejected",
  );
  console.log("[market_trading] TEST 6b ✔  Insufficient mesos rejected");

  // 6c: Cancel someone else's listing.
  buyerClient.send("cancel", { listingId: selfListing!.listingId });
  await sleep(200);
  assert.ok(
    marketStore.get(selfListing!.listingId),
    "listing should survive a stranger's cancel attempt",
  );
  console.log("[market_trading] TEST 6c ✔  Stranger cancel rejected");

  // Cleanup
  await sellerClient.leave();
  await buyerClient.leave();
  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log(
    "[market_trading] PASS ✔  Free Market end-to-end: permit gate, escrow, browse, tax, cancel",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[market_trading] FAIL ✘", err);
  process.exit(1);
});
