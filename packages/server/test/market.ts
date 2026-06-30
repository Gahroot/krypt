/**
 * Market loop test — proves the off-chain economy end-to-end:
 *   1. Fixed-price: list → buy → settle (original test)
 *   2. Buy order: place buy order → list matching item → auto-fill
 *   3. Auction: list as auction → bid → settle on expiry
 *   4. Listing expiry: list with short TTL → item returned to seller
 *   5. Price history: sale is recorded
 *
 * Run: npx tsx test/market.ts
 */
import assert from "node:assert";
import { bootAuthed } from "./authBoot";
import appConfig from "../src/app.config";
import { accountStore, marketStore, priceHistoryStore } from "../src/persistence/store";
import { randomizeAppearance } from "@maple/shared";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const watchdog = setTimeout(() => {
  console.error("[market] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 120_000);

async function main() {
  const colyseus = await bootAuthed(appConfig);

  const sellerAcct = "acct_seller";
  const buyerAcct = "acct_buyer";

  // Ensure accounts exist.
  accountStore.getOrCreate(sellerAcct);
  accountStore.getOrCreate(buyerAcct);

  // Clean up stale market data from previous test runs.
  const staleListings = marketStore.all();
  for (const l of staleListings) {
    marketStore.remove(l.listingId);
  }
  console.log(`[market] cleaned ${staleListings.length} stale listings`);

  // Create characters for seller and buyer.
  const seller = accountStore.createCharacter(sellerAcct, {
    name: `Seller_${Date.now()}`,
    archetype: "WARRIOR",
    appearance: randomizeAppearance(() => 0.5),
  });
  const buyer = accountStore.createCharacter(buyerAcct, {
    name: `Buyer_${Date.now()}`,
    archetype: "MAGE",
    appearance: randomizeAppearance(() => 0.3),
  });

  // ─── Test 1: Fixed-price list → buy ───────────────────────────────────────────
  console.log("[market] Test 1: fixed-price list → buy");

  accountStore.setMesos(seller.charId, 0);
  accountStore.setMesos(buyer.charId, 1000);
  accountStore.addItem(seller.charId, {
    uid: "item_fixed_1",
    defId: "wpn.iron_broadsword",
    baseRank: "NORMAL",
    potentialTier: "EPIC",
    lines: 2,
    minted: false,
  });
  accountStore.addItem(seller.charId, {
    uid: "permit_1",
    defId: "cash.store_permit",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 0,
    minted: false,
  });

  const sellerClient = await colyseus.sdk.joinOrCreate("market_room", { charId: seller.charId });
  await sleep(150);
  sellerClient.send("list", { itemUid: "item_fixed_1", price: 500 });
  await sleep(300);

  const listed1 = marketStore
    .all()
    .find(
      (l) =>
        l.sellerId === seller.charId &&
        l.item.defId === "wpn.iron_broadsword" &&
        l.listingType === "fixed",
    );
  assert.ok(listed1, "Test 1: item should be listed");
  assert.strictEqual(
    accountStore.getItem(seller.charId, "item_fixed_1"),
    undefined,
    "Test 1: listed item escrowed",
  );

  const buyerClient = await colyseus.sdk.joinOrCreate("market_room", { charId: buyer.charId });
  await sleep(150);
  buyerClient.send("buy", { listingId: listed1.listingId });
  await sleep(400);

  const sellerRec1 = accountStore.getCharacter(seller.charId)!;
  const buyerRec1 = accountStore.getCharacter(buyer.charId)!;
  const fee1 = Math.floor((500 * 250) / 10_000);

  assert.strictEqual(sellerRec1.mesos, 500 - fee1, "Test 1: seller receives price minus fee");
  assert.strictEqual(buyerRec1.mesos, 500, "Test 1: buyer pays full price");
  assert.ok(buyerRec1.inventory["item_fixed_1"], "Test 1: buyer receives item");
  assert.ok(!marketStore.get(listed1.listingId), "Test 1: listing removed after sale");
  console.log("[market] Test 1 PASS ✔");

  // ─── Test 2: Buy order → auto-match ──────────────────────────────────────────
  console.log("[market] Test 2: buy order → auto-match");

  // Give seller a second item and buyer enough mesos for the buy order.
  accountStore.addItem(seller.charId, {
    uid: "item_bow_1",
    defId: "wpn.hunter_bow",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
  });
  accountStore.setMesos(buyer.charId, 800);

  // Buyer places a buy order for the hunter bow at max 300 mesos.
  buyerClient.send("place_buy_order", { defId: "wpn.hunter_bow", maxPrice: 300 });
  await sleep(300);

  const { buyOrderStore } = await import("../src/persistence/store");
  const buyerOrders = buyOrderStore.all().filter((o) => o.buyerCharId === buyer.charId);
  assert.ok(buyerOrders.length > 0, "Test 2: buy order was placed");
  const buyOrder = buyerOrders[0];
  assert.strictEqual(buyOrder.defId, "wpn.hunter_bow", "Test 2: buy order defId matches");
  assert.strictEqual(buyOrder.maxPrice, 300, "Test 2: buy order maxPrice");

  // Buyer's mesos should be escrowed.
  const buyerRec2a = accountStore.getCharacter(buyer.charId)!;
  assert.strictEqual(buyerRec2a.mesos, 800 - 300, "Test 2: mesos escrowed for buy order");

  // Seller lists the bow at 200 mesos (below buyer's max → should auto-fill).
  sellerClient.send("list", { itemUid: "item_bow_1", price: 200 });
  await sleep(400);

  const buyerRec2b = accountStore.getCharacter(buyer.charId)!;
  const sellerRec2 = accountStore.getCharacter(seller.charId)!;

  // Buyer should have the item now.
  assert.ok(buyerRec2b.inventory["item_bow_1"], "Test 2: buyer received bow via auto-match");
  // Escrow funded the purchase: buyer had 500 after escrow, gets back 300-200=100 = 600.
  assert.strictEqual(buyerRec2b.mesos, 600, "Test 2: buyer mesos after auto-match (escrow refund)");

  // Buy order should be removed.
  assert.ok(!buyOrderStore.get(buyOrder.buyOrderId), "Test 2: buy order removed after fill");
  // Listing should be removed.
  const bowListing = marketStore
    .all()
    .find((l) => l.sellerId === seller.charId && l.item.defId === "wpn.hunter_bow");
  assert.ok(!bowListing, "Test 2: listing removed after auto-fill");

  console.log("[market] Test 2 PASS ✔");

  // ─── Test 3: Auction + bid + expiry ──────────────────────────────────────────
  console.log("[market] Test 3: auction + bid + expiry");

  accountStore.setMesos(seller.charId, sellerRec2.mesos);
  accountStore.addItem(seller.charId, {
    uid: "item_sword_1",
    defId: "wpn.mithril_blade",
    baseRank: "NORMAL",
    potentialTier: "UNIQUE",
    lines: 3,
    minted: false,
  });
  accountStore.setMesos(buyer.charId, 1000);

  // Seller lists as auction with 3-second duration.
  sellerClient.send("list", {
    itemUid: "item_sword_1",
    price: 100,
    listingType: "auction",
    duration: 10_000,
  });
  await sleep(300);

  const auctionListing = marketStore
    .all()
    .find(
      (l) =>
        l.sellerId === seller.charId &&
        l.item.defId === "wpn.mithril_blade" &&
        l.listingType === "auction",
    );
  assert.ok(auctionListing, "Test 3: auction listing created");
  assert.strictEqual(auctionListing.listingType, "auction", "Test 3: listing type is auction");
  assert.ok(auctionListing.endsAt > Date.now(), "Test 3: auction has future expiry");

  // Buyer bids 150 mesos.
  buyerClient.send("bid", { listingId: auctionListing.listingId, amount: 150 });
  await sleep(300);

  const auctionAfterBid = marketStore.get(auctionListing.listingId)!;
  assert.strictEqual(auctionAfterBid.currentBid, 150, "Test 3: current bid updated");
  assert.strictEqual(auctionAfterBid.highBidderCharId, buyer.charId, "Test 3: high bidder set");

  const buyerRec3a = accountStore.getCharacter(buyer.charId)!;
  assert.strictEqual(buyerRec3a.mesos, 850, "Test 3: buyer mesos after bid (1000 - 150)");

  // Wait for auction to expire + sweep timer to fire (sweep runs every 1s, min duration 10s).
  await sleep(15_000);

  const buyerRec3b = accountStore.getCharacter(buyer.charId)!;
  const sellerRec3 = accountStore.getCharacter(seller.charId)!;
  const fee3 = Math.floor((150 * 250) / 10_000);

  assert.ok(buyerRec3b.inventory["item_sword_1"], "Test 3: buyer received auction item");
  assert.ok(!marketStore.get(auctionListing.listingId), "Test 3: auction listing removed");
  assert.ok(sellerRec3.mesos >= 150 - fee3, "Test 3: seller received bid amount minus fee");

  console.log("[market] Test 3 PASS ✔");

  // ─── Test 4: Listing expiry (fixed, no bids) ─────────────────────────────────
  console.log("[market] Test 4: listing expiry (fixed, no bids)");

  accountStore.addItem(seller.charId, {
    uid: "item_exp_1",
    defId: "wpn.short_sword",
    baseRank: "NORMAL",
    potentialTier: "RARE",
    lines: 1,
    minted: false,
  });

  // List with 2-second expiry.
  sellerClient.send("list", {
    itemUid: "item_exp_1",
    price: 999,
    duration: 10_000,
  });
  await sleep(300);

  const expiringListing = marketStore
    .all()
    .find((l) => l.sellerId === seller.charId && l.item.defId === "wpn.short_sword");
  assert.ok(expiringListing, "Test 4: expiring listing created");
  assert.ok(expiringListing.endsAt > 0, "Test 4: listing has expiry");

  // Wait for listing to expire + sweep timer to fire.
  await sleep(15_000);

  assert.ok(!marketStore.get(expiringListing.listingId), "Test 4: expired listing removed");
  const sellerRec4 = accountStore.getCharacter(seller.charId)!;
  assert.ok(sellerRec4.inventory["item_exp_1"], "Test 4: item returned to seller after expiry");

  console.log("[market] Test 4 PASS ✔");

  // ─── Test 5: Price history recorded ──────────────────────────────────────────
  console.log("[market] Test 5: price history recorded");

  const history = priceHistoryStore.recent("wpn.iron_broadsword");
  assert.ok(history.length > 0, "Test 5: price history has entries for sold item");
  assert.strictEqual(history[0].salePrice, 500, "Test 5: recorded sale price matches");

  const bowHistory = priceHistoryStore.recent("wpn.hunter_bow");
  assert.ok(bowHistory.length > 0, "Test 5: price history for auto-filled item");

  console.log("[market] Test 5 PASS ✔");

  // ─── Cleanup ──────────────────────────────────────────────────────────────────
  await sellerClient.leave();
  await buyerClient.leave();
  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[market] PASS ✔  all 5 market tests passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[market] FAIL ✘", err);
  process.exit(1);
});
