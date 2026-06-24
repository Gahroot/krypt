/**
 * Market loop test — proves the off-chain economy end-to-end across two accounts:
 *   1. seller earns Mesos in town (kills) and we grant them an item via the store
 *   2. seller lists the item on the Free Market
 *   3. buyer purchases it → item moves to buyer, Mesos move to seller (minus fee)
 *
 * Run: npx tsx test/market.ts
 */
import assert from "node:assert";
import { boot } from "@colyseus/testing";
import appConfig from "../src/app.config";
import { accountStore, marketStore } from "../src/persistence/store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const watchdog = setTimeout(() => {
  console.error("[market] FAIL ✘ watchdog timeout");
  process.exit(1);
}, 30_000);

async function main() {
  const colyseus = await boot(appConfig);

  const sellerId = "acct_seller";
  const buyerId = "acct_buyer";

  // Seed: give the seller an item + known mesos; give the buyer enough to purchase.
  accountStore.getOrCreate(sellerId);
  accountStore.getOrCreate(buyerId);
  accountStore.setMesos(sellerId, 0);
  accountStore.setMesos(buyerId, 1000);
  accountStore.addItem(sellerId, {
    uid: "item_test_1",
    defId: "wpn.iron_broadsword",
    baseRank: "NORMAL",
    potentialTier: "EPIC",
    lines: 2,
    minted: false,
  });

  // Seller connects and lists.
  const sellerClient = await colyseus.sdk.joinOrCreate("market_room", { accountId: sellerId });
  await sleep(150);
  sellerClient.send("list", { itemUid: "item_test_1", price: 500 });
  await sleep(300);

  const listed = marketStore.all().find((l) => l.sellerId === sellerId);
  assert.ok(listed, "item should be listed on the market");
  assert.strictEqual(accountStore.getOrCreate(sellerId).inventory["item_test_1"], undefined,
    "listed item should be escrowed out of seller inventory");
  console.log(`[market] listed ${listed.listingId} @ ${listed.price}`);

  // Buyer connects and buys.
  const buyerClient = await colyseus.sdk.joinOrCreate("market_room", { accountId: buyerId });
  await sleep(150);
  buyerClient.send("buy", { listingId: listed.listingId });
  await sleep(400);

  const seller = accountStore.getOrCreate(sellerId);
  const buyer = accountStore.getOrCreate(buyerId);
  const fee = Math.floor((500 * 250) / 10_000); // 2.5%

  console.log(
    `[market] settled: seller mesos=${seller.mesos} (expect ${500 - fee}), ` +
      `buyer mesos=${buyer.mesos} (expect 500), buyerHasItem=${!!buyer.inventory["item_test_1"]}`,
  );

  assert.strictEqual(seller.mesos, 500 - fee, "seller receives price minus fee");
  assert.strictEqual(buyer.mesos, 500, "buyer pays the full price");
  assert.ok(buyer.inventory["item_test_1"], "buyer receives the item");
  assert.ok(!marketStore.get(listed.listingId), "listing is removed after sale");

  await sellerClient.leave();
  await buyerClient.leave();
  await colyseus.shutdown();
  clearTimeout(watchdog);
  console.log("[market] PASS ✔  off-chain list → buy → settle works");
  process.exit(0);
}

main().catch((err) => {
  console.error("[market] FAIL ✘", err);
  process.exit(1);
});
